import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { getChartAccounts, isChartTableMissing } from "@/application/rental/chartOfAccounts";
import { MANUAL_FINANCIAL_EVENT_CATEGORIES } from "@/application/financial/manualFinancialEventCategories";
import {
  canEditBill,
  canVoidBill,
  serializeVendorBill,
  validateVendorBillEdit,
} from "@/application/rental/vendorBills";

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot change vendor bills." }, { status: 403 });
  }
  return null;
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

    return NextResponse.json({ success: true, bill: serializeVendorBill(bill, vendor?.name || null) });
  } catch (error) {
    console.error("Vendor bill detail error", error);
    return NextResponse.json({ error: "Unable to load the bill." }, { status: 500 });
  }
}

// PATCH /api/rental/vendor-bills/[id] — edit an open bill, or void it.
// Edit body: { billDate?, dueDate?, amountCents?, expenseAccountCode?,
//              propertyId?, memo?, attachmentReference? }.
// Void body: { void: true, voidReason* } — voiding is reversal, never delete:
// the bill stays on the ledger as history. A voided bill can never be
// re-opened; record a corrected bill instead.
export async function PATCH(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
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
