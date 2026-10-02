import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { requireRentalPermission } from "@/lib/rental/teamAuthorization";
import { getChartAccounts, isChartTableMissing } from "@/application/rental/chartOfAccounts";
import { MANUAL_FINANCIAL_EVENT_CATEGORIES } from "@/application/financial/manualFinancialEventCategories";
import {
  canEditBill,
  canUnvoidBill,
  canVoidBill,
  isProbableReplacementBill,
  serializeVoidAudit,
  serializeVendorBill,
  validateVendorBillEdit,
} from "@/application/rental/vendorBills";

// R17: changing vendor bills needs vendor_bills.manage (was: read_only-only check).
// Voiding a bill is bill management, not a payment void -- it stays under this permission.
async function requireBillManager(authenticated, request) {
  const gate = await requireRentalPermission({ authenticated, request, permission: "vendor_bills.manage" });
  return gate.response;
}

const BILL_COLUMNS = "id, vendor_id, property_id, bill_date, due_date, amount_cents, paid_amount_cents, expense_account_code, memo, attachment_reference, status, void_reason, voided_at, created_at, updated_at";

async function findOwnedBill(supabaseClient, ownerId, billId) {
  const { data, error } = await supabaseClient
    .from("rental_vendor_bills")
    .select(BILL_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("id", billId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function resolveExpenseAccountCodes(supabaseClient, ownerId) {
  try {
    const accounts = await getChartAccounts(supabaseClient, ownerId);
    return new Set(accounts.filter((a) => a.is_active && a.account_type === "expense").map((a) => a.code));
  } catch (error) {
    if (isChartTableMissing(error)) {
      return new Set(
        MANUAL_FINANCIAL_EVENT_CATEGORIES
          .filter((c) => !["rental_income", "cam_income"].includes(c.value))
          .map((c) => c.value)
      );
    }
    throw error;
  }
}

// GET /api/rental/vendor-bills/[id] — one bill with its vendor name.
// Read-only members may read.
export async function GET(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const bill = await findOwnedBill(supabaseClient, effectiveOwnerId, params.id);
    if (!bill) return NextResponse.json({ error: "Bill was not found." }, { status: 404 });

    const { data: vendor } = await supabaseClient
      .from("rental_vendors")
      .select("name")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", bill.vendor_id)
      .maybeSingle();

    // R18: the void/un-void audit trail, newest first — visible on the record.
    const { data: audits, error: auditsError } = await supabaseClient
      .from("rental_void_audits")
      .select("id, entity_type, entity_id, action, reason, actor_id, created_at")
      .eq("owner_id", effectiveOwnerId)
      .eq("entity_type", "vendor_bill")
      .eq("entity_id", bill.id)
      .order("created_at", { ascending: false });
    if (auditsError) throw auditsError;

    return NextResponse.json({
      success: true,
      bill: serializeVendorBill(bill, vendor?.name || null),
      audits: (audits || []).map(serializeVoidAudit),
    });
  } catch (error) {
    console.error("Vendor bill detail error", error);
    return NextResponse.json({ error: "Unable to load the bill." }, { status: 500 });
  }
}

// PATCH /api/rental/vendor-bills/[id] — edit an open bill, void it, or un-void it.
// Edit body: { billDate?, dueDate?, amountCents?, expenseAccountCode?,
//              propertyId?, memo?, attachmentReference? }.
// Void body: { void: true, voidReason* } — voiding is reversal, never delete:
// the bill stays on the ledger as history. A voided bill can never be
// re-opened; record a corrected bill instead.
// Un-void body (R18): { unvoid: true, unvoidReason* } — restores a voided bill
// to open. Blocked when a probable replacement bill exists (409, plain
// English). Un-voiding a vendor *payment* is not offered — re-issue instead.
export async function PATCH(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireBillManager(authenticated, request);
    if (forbidden) return forbidden;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const bill = await findOwnedBill(supabaseClient, effectiveOwnerId, params.id);
    if (!bill) return NextResponse.json({ error: "Bill was not found." }, { status: 404 });

    const body = await request.json();

    if (body.void === true) {
      if (!canVoidBill(bill)) {
        return NextResponse.json({ error: "Only unpaid open bills can be voided." }, { status: 409 });
      }
      const voidReason = typeof body.voidReason === "string" ? body.voidReason.trim() : "";
      if (!voidReason) {
        return NextResponse.json({ error: "A reason is required to void a bill." }, { status: 400 });
      }
      // Write-time guard: the bill must still be open AND unpaid — a payment
      // recorded between the read and the write (e.g. R4's payment RPC, which
      // transitions status on its own schedule) must not be silently voided
      // away. Zero rows = the bill changed → 409.
      const { data, error } = await supabaseClient
        .from("rental_vendor_bills")
        .update({ status: "voided", void_reason: voidReason.slice(0, 500), voided_at: new Date().toISOString() })
        .eq("owner_id", effectiveOwnerId)
        .eq("id", bill.id)
        .eq("status", "open")
        .eq("paid_amount_cents", 0)
        .select(BILL_COLUMNS)
        .single();
      if (error) {
        if (error.code === "PGRST116") {
          return NextResponse.json({ error: "The bill changed while you were editing it. Please review the latest state and try again." }, { status: 409 });
        }
        throw error;
      }
      const { data: vendor } = await supabaseClient
        .from("rental_vendors").select("name")
        .eq("owner_id", effectiveOwnerId).eq("id", data.vendor_id).maybeSingle();
      return NextResponse.json({ success: true, bill: serializeVendorBill(data, vendor?.name || null) });
    }

    // ---- Un-void (R18) ------------------------------------------------------
    // Restores a voided bill to open. Safe because void requires an untouched
    // bill (open + zero applied payments) — un-void restores exactly that
    // state. Blocked when a probable replacement bill exists (the bill was
    // re-entered after the void; un-voiding would double the payable).
    if (body.unvoid === true) {
      if (!canUnvoidBill(bill)) {
        return NextResponse.json({ error: "Only voided bills can be un-voided." }, { status: 409 });
      }
      const unvoidReason = typeof body.unvoidReason === "string" ? body.unvoidReason.trim() : "";
      if (!unvoidReason) {
        return NextResponse.json({ error: "A reason is required to un-void a bill." }, { status: 400 });
      }
      // Supersession guard: a newer, non-voided bill for the same vendor +
      // property + bill date + amount is almost certainly the re-entered
      // replacement. Name it in plain English so the denial is actionable.
      const { data: candidates, error: candidatesError } = await supabaseClient
        .from("rental_vendor_bills")
        .select("id, vendor_id, property_id, bill_date, amount_cents, status, created_at")
        .eq("owner_id", effectiveOwnerId)
        .eq("vendor_id", bill.vendor_id)
        .eq("bill_date", bill.bill_date)
        .eq("amount_cents", bill.amount_cents)
        .neq("id", bill.id)
        .neq("status", "voided");
      if (candidatesError) throw candidatesError;
      const replacement = (candidates || []).find((candidate) => isProbableReplacementBill(candidate, bill));
      if (replacement) {
        return NextResponse.json({
          error: `This bill cannot be un-voided — a replacement bill for the same ${bill.bill_date} charge already exists (entered ${String(replacement.created_at || "").slice(0, 10)}). Un-voiding would double the amount owed.`,
        }, { status: 409 });
      }
      // Atomic un-void: the RPC reopens the bill AND appends the audit row in
      // one transaction, so a staff member authorized for vendor_bills.manage
      // can never leave a reopened bill without its reason/actor history
      // (the audit table's INSERT policy requires owner/co-owner workspace
      // access, which staff lack — the RPC's SECURITY DEFINER covers exactly
      // this authorized operation). The RPC re-checks the voided+untouched
      // guard at write time; no rows = the bill changed → 409.
      const { data: rpcData, error: rpcError } = await supabaseClient
        .rpc("unvoid_vendor_bill", {
          p_owner_id: effectiveOwnerId,
          p_bill_id: bill.id,
          p_reason: unvoidReason,
        });
      if (rpcError) {
        // P0001 = our "not in a voided, untouched state" raise → the bill
        // changed between the read and the write.
        if (rpcError.code === "P0001") {
          return NextResponse.json({ error: "The bill changed while you were editing it. Please review the latest state and try again." }, { status: 409 });
        }
        // 42501 = the RPC's own permission check denied the caller.
        if (rpcError.code === "42501") {
          return NextResponse.json({ error: "You do not have permission to un-void vendor bills." }, { status: 403 });
        }
        throw rpcError;
      }
      const { data, error } = await supabaseClient
        .from("rental_vendor_bills")
        .select(BILL_COLUMNS)
        .eq("owner_id", effectiveOwnerId)
        .eq("id", bill.id)
        .single();
      if (error) throw error;
      const { data: vendor } = await supabaseClient
        .from("rental_vendors").select("name")
        .eq("owner_id", effectiveOwnerId).eq("id", data.vendor_id).maybeSingle();
      return NextResponse.json({ success: true, bill: serializeVendorBill(data, vendor?.name || null) });
    }

    let expenseAccountCodes;
    try {
      expenseAccountCodes = await resolveExpenseAccountCodes(supabaseClient, effectiveOwnerId);
    } catch {
      return NextResponse.json({ error: "The chart of accounts could not be read. No changes were saved." }, { status: 503 });
    }
    const check = validateVendorBillEdit(body, bill, { expenseAccountCodes });
    if (!check.valid) {
      const status = check.errors.some((e) => e.includes("Only open")) ? 409 : 400;
      return NextResponse.json({ error: check.errors.join(" ") }, { status });
    }

    // Write-time guard: still open and unpaid, so a concurrent payment cannot
    // be silently overwritten by this edit.
    const { data, error } = await supabaseClient
      .from("rental_vendor_bills")
      .update(check.patch)
      .eq("owner_id", effectiveOwnerId)
      .eq("id", bill.id)
      .eq("status", "open")
      .eq("paid_amount_cents", 0)
      .select(BILL_COLUMNS)
      .single();
    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "The bill changed while you were editing it. Please review the latest state and try again." }, { status: 409 });
      }
      throw error;
    }
    const { data: vendor } = await supabaseClient
      .from("rental_vendors").select("name")
      .eq("owner_id", effectiveOwnerId).eq("id", data.vendor_id).maybeSingle();
    return NextResponse.json({ success: true, bill: serializeVendorBill(data, vendor?.name || null) });
  } catch (error) {
    console.error("Vendor bill update error", error);
    return NextResponse.json({ error: "Unable to update the bill." }, { status: 500 });
  }
}
