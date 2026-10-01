import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { serializeVendor, validateVendorInput } from "@/application/rental/vendors";
import { billBalanceCents, serializeVendorBill } from "@/application/rental/vendorBills";
import { serializeVendorPayment } from "@/application/rental/vendorPayments";

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot change vendors." }, { status: 403 });
  }
  return null;
}

const VENDOR_COLUMNS = "id, name, contact_name, email, phone, address, trade, tax_classification, tax_id_last4, notes, is_active, created_at, updated_at";
const BILL_COLUMNS = "id, vendor_id, property_id, bill_date, due_date, amount_cents, paid_amount_cents, expense_account_code, memo, attachment_reference, status, void_reason, voided_at, created_at, updated_at";
const PAYMENT_COLUMNS = "id, vendor_id, payment_date, payment_method, amount_cents, bank_account_id, check_number, memo, financial_event_ids, status, void_reason, voided_at, created_at, updated_at";

async function findOwnedVendor(supabaseClient, ownerId, vendorId) {
  const { data, error } = await supabaseClient
    .from("rental_vendors")
    .select(VENDOR_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("id", vendorId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// GET /api/rental/vendors/[id] — one vendor plus its bill history (the vendor
// ledger): every bill, open balance, lifetime billed/paid. Read-only members
// may read.
export async function GET(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const vendor = await findOwnedVendor(supabaseClient, effectiveOwnerId, params.id);
    if (!vendor) return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });

    const { data: bills, error: billsError } = await supabaseClient
      .from("rental_vendor_bills")
      .select(BILL_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .eq("vendor_id", vendor.id)
      .order("bill_date", { ascending: false });
    if (billsError) throw billsError;

    const live = (bills || []).filter((bill) => bill.status !== "voided");
    const totals = {
      billCount: live.length,
      billedCents: live.reduce((sum, bill) => sum + Number(bill.amount_cents || 0), 0),
      paidCents: live.reduce((sum, bill) => sum + Number(bill.paid_amount_cents || 0), 0),
      openCents: live.reduce((sum, bill) => sum + billBalanceCents(bill), 0),
    };

    // Payment history for the vendor ledger: every payment with its bill
    // applications, newest first.
    const { data: payments, error: paymentsError } = await supabaseClient
      .from("rental_vendor_payments")
      .select(PAYMENT_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .eq("vendor_id", vendor.id)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (paymentsError) throw paymentsError;
    const paymentRows = payments || [];
    let paymentApplications = [];
    if (paymentRows.length > 0) {
      const { data: apps, error: appsError } = await supabaseClient
        .from("rental_vendor_payment_applications")
        .select("payment_id, bill_id, amount_cents, rental_vendor_bills!inner(bill_date, due_date, amount_cents)")
        .eq("owner_id", effectiveOwnerId)
        .in("payment_id", paymentRows.map((payment) => payment.id));
      if (appsError) throw appsError;
      paymentApplications = (apps || []).map((app) => ({
        payment_id: app.payment_id,
        bill_id: app.bill_id,
        amount_cents: app.amount_cents,
        bill_bill_date: app.rental_vendor_bills?.bill_date || null,
        bill_due_date: app.rental_vendor_bills?.due_date || null,
        bill_amount_cents: app.rental_vendor_bills?.amount_cents ?? null,
      }));
    }
    const appsByPayment = new Map();
    for (const app of paymentApplications) {
      if (!appsByPayment.has(app.payment_id)) appsByPayment.set(app.payment_id, []);
      appsByPayment.get(app.payment_id).push(app);
    }

    return NextResponse.json({
      success: true,
      vendor: serializeVendor(vendor),
      bills: (bills || []).map((bill) => serializeVendorBill(bill, vendor.name)),
      totals,
      payments: paymentRows.map((payment) =>
        serializeVendorPayment(payment, {
          applications: appsByPayment.get(payment.id) || [],
          vendorName: vendor.name,
        })
      ),
    });
  } catch (error) {
    console.error("Vendor detail error", error);
    return NextResponse.json({ error: "Unable to load the vendor." }, { status: 500 });
  }
}

// PATCH /api/rental/vendors/[id] — edit the vendor, or deactivate/reactivate
// via { isActive }. Deactivation never deletes history: bills stay on the
// ledger and the vendor can be reactivated.
export async function PATCH(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const vendor = await findOwnedVendor(supabaseClient, effectiveOwnerId, params.id);
    if (!vendor) return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });

    const body = await request.json();
    const check = validateVendorInput(body, { forUpdate: true });
    if (!check.valid) return NextResponse.json({ error: check.errors.join(" ") }, { status: 400 });

    const patch = {};
    const bodyKeys = { name: "name", contactName: "contact_name", email: "email", phone: "phone", address: "address", trade: "trade", taxClassification: "tax_classification", taxIdLast4: "tax_id_last4", notes: "notes" };
    const explicit = {
      name: check.value.name,
      contact_name: check.value.contactName,
      email: check.value.email,
      phone: check.value.phone,
      address: check.value.address,
      trade: check.value.trade,
      tax_classification: check.value.taxClassification,
      tax_id_last4: check.value.taxIdLast4,
      notes: check.value.notes,
    };
    const finalPatch = {};
    for (const [bodyKey, column] of Object.entries(bodyKeys)) {
      if (body[bodyKey] !== undefined) patch[column] = explicit[column];
    }
    if (body.isActive !== undefined) patch.is_active = Boolean(body.isActive);
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const { data, error } = await supabaseClient
      .from("rental_vendors")
      .update(patch)
      .eq("owner_id", effectiveOwnerId)
      .eq("id", vendor.id)
      .select(VENDOR_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, vendor: serializeVendor(data) });
  } catch (error) {
    console.error("Vendor update error", error);
    return NextResponse.json({ error: "Unable to update the vendor." }, { status: 500 });
  }
}
