import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { requireRentalPermission } from "@/lib/rental/teamAuthorization";
import { getChartAccounts, isChartTableMissing } from "@/application/rental/chartOfAccounts";
import { MANUAL_FINANCIAL_EVENT_CATEGORIES } from "@/application/financial/manualFinancialEventCategories";
import {
  buildVendorBillId,
  buildVendorBillSourceKey,
  serializeVendorBill,
  validateVendorBillInput,
  VENDOR_BILL_STATUSES,
} from "@/application/rental/vendorBills";

// R17: managing vendor bills needs vendor_bills.manage (was: read_only-only check).
async function requireBillManager(authenticated, request) {
  const gate = await requireRentalPermission({ authenticated, request, permission: "vendor_bills.manage" });
  return gate.response;
}

const BILL_COLUMNS = "id, vendor_id, property_id, bill_date, due_date, amount_cents, paid_amount_cents, expense_account_code, memo, attachment_reference, status, void_reason, voided_at, created_at, updated_at";

// The owner's active EXPENSE accounts — the only codes a bill may post to.
// Chart unavailable for any reason other than a missing table fails closed:
// a bill must never post to an account Brandy deactivated.
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

async function vendorNamesById(supabaseClient, ownerId, vendorIds) {
  if (vendorIds.length === 0) return new Map();
  const { data, error } = await supabaseClient
    .from("rental_vendors")
    .select("id, name")
    .eq("owner_id", ownerId)
    .in("id", vendorIds);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.id, row.name]));
}

// GET /api/rental/vendor-bills — the AP list.
// ?vendorId=, ?status=open|partial|paid|voided, ?propertyId=. Newest first.
// Read-only members may read.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const params = new URL(request.url).searchParams;
    const vendorId = String(params.get("vendorId") || "").trim();
    const status = String(params.get("status") || "").trim();
    const propertyId = String(params.get("propertyId") || "").trim();

    // Validate filters before touching the database.
    if (status && !VENDOR_BILL_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Unknown bill status." }, { status: 400 });
    }

    let query = supabaseClient
      .from("rental_vendor_bills")
      .select(BILL_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .order("bill_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (status) query = query.eq("status", status);
    if (propertyId) query = query.eq("property_id", propertyId);

    const { data, error } = await query;
    if (error) throw error;
    const bills = data || [];
    const names = await vendorNamesById(supabaseClient, effectiveOwnerId, [...new Set(bills.map((b) => b.vendor_id))]);
    return NextResponse.json({
      success: true,
      bills: bills.map((bill) => serializeVendorBill(bill, names.get(bill.vendor_id) || null)),
    });
  } catch (error) {
    console.error("Vendor bills list error", error);
    return NextResponse.json({ error: "Unable to load vendor bills." }, { status: 500 });
  }
}

// POST /api/rental/vendor-bills — record a bill against a vendor + property.
// Body: { vendorId*, propertyId?, billDate*, dueDate*, amountCents*,
//         expenseAccountCode*, memo?, attachmentReference? }.
// Idempotent: source_key is unique per bill, so a retried POST never creates
// a second payable. Recording a bill creates NO financial_events row — the
// expense posts when the bill is PAID (slice R4), mirroring tenant charges.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireBillManager(authenticated, request);
    if (forbidden) return forbidden;
    const { supabaseClient, effectiveOwnerId, user } = authenticated;

    const body = await request.json();
    let expenseAccountCodes;
    try {
      expenseAccountCodes = await resolveExpenseAccountCodes(supabaseClient, effectiveOwnerId);
    } catch {
      return NextResponse.json({ error: "The chart of accounts could not be read. No bill was recorded." }, { status: 503 });
    }
    const check = validateVendorBillInput(body, { expenseAccountCodes });
    if (!check.valid) return NextResponse.json({ error: check.errors.join(" ") }, { status: 400 });
    const value = check.value;

    const { data: vendor, error: vendorError } = await supabaseClient
      .from("rental_vendors")
      .select("id, name, is_active")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", value.vendorId)
      .maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor) return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });

    if (value.propertyId) {
      const { data: unit, error: unitError } = await supabaseClient
        .from("rental_units")
        .select("id")
        .eq("owner_id", effectiveOwnerId)
        .or(`property_id.eq.${value.propertyId},id.eq.${value.propertyId}`)
        .limit(1)
        .maybeSingle();
      if (unitError) throw unitError;
      if (!unit) return NextResponse.json({ error: "Property was not found." }, { status: 404 });
    }

    const id = buildVendorBillId();
    const { data, error } = await supabaseClient
      .from("rental_vendor_bills")
      .insert({
        owner_id: effectiveOwnerId,
        id,
        vendor_id: vendor.id,
        property_id: value.propertyId,
        bill_date: value.billDate,
        due_date: value.dueDate,
        amount_cents: value.amountCents,
        paid_amount_cents: 0,
        expense_account_code: value.expenseAccountCode,
        memo: value.memo,
        attachment_reference: value.attachmentReference,
        status: "open",
        source_key: buildVendorBillSourceKey(id),
        created_by: user.id,
      })
      .select(BILL_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, bill: serializeVendorBill(data, vendor.name) }, { status: 201 });
  } catch (error) {
    console.error("Vendor bill create error", error);
    return NextResponse.json({ error: "Unable to record the bill." }, { status: 500 });
  }
}
