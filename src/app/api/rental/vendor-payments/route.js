import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  buildVendorPaymentId,
  serializeVendorPayment,
  validateVendorPaymentInput,
} from "@/application/rental/vendorPayments";

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot record vendor payments." }, { status: 403 });
  }
  return null;
}

const PAYMENT_COLUMNS =
  "id, vendor_id, payment_date, payment_method, amount_cents, bank_account_id, check_number, memo, financial_event_ids, status, void_reason, voided_at, created_at, updated_at";
const BILL_COLUMNS = "id, vendor_id, status, amount_cents, paid_amount_cents";
const VENDOR_NAME_COLUMNS = "id, name";

function mapRpcError(error) {
  if (!error) return null;
  const code = error.code;
  const message = typeof error.message === "string" ? error.message : "";
  if (code === "23505") return "duplicate";
  if (code === "P0001" && message.toLowerCase().includes("already reconciled")) return "reconciled";
  if (["22023", "22000", "P0002"].includes(code)) {
    return { status: 400, error: message || "The payment could not be recorded." };
  }
  return null;
}

async function findOwnedPayment(supabaseClient, ownerId, paymentId) {
  const { data, error } = await supabaseClient
    .from("rental_vendor_payments")
    .select(PAYMENT_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadApplications(supabaseClient, ownerId, paymentIds) {
  if (paymentIds.length === 0) return [];
  const { data, error } = await supabaseClient
    .from("rental_vendor_payment_applications")
    .select("payment_id, bill_id, amount_cents, rental_vendor_bills!inner(bill_date, due_date, amount_cents)")
    .eq("owner_id", ownerId)
    .in("payment_id", paymentIds);
  if (error) throw error;
  return (data || []).map((app) => ({
    payment_id: app.payment_id,
    bill_id: app.bill_id,
    amount_cents: app.amount_cents,
    bill_bill_date: app.rental_vendor_bills?.bill_date || null,
    bill_due_date: app.rental_vendor_bills?.due_date || null,
    bill_amount_cents: app.rental_vendor_bills?.amount_cents ?? null,
  }));
}

async function loadVendorNames(supabaseClient, ownerId, vendorIds) {
  if (vendorIds.length === 0) return new Map();
  const { data, error } = await supabaseClient
    .from("rental_vendors")
    .select(VENDOR_NAME_COLUMNS)
    .eq("owner_id", ownerId)
    .in("id", vendorIds);
  if (error) throw error;
  return new Map((data || []).map((vendor) => [vendor.id, vendor.name]));
}

// GET /api/rental/vendor-payments?vendorId=&status=&billId=
// status: active | voided | all (default all). billId narrows to payments
// applied to that bill. Read-only members may read.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const url = new URL(request.url);
    const vendorId = url.searchParams.get("vendorId");
    const status = url.searchParams.get("status") || "all";
    const billId = url.searchParams.get("billId");

    let paymentIds = null;
    if (billId) {
      const { data: apps, error: appsError } = await supabaseClient
        .from("rental_vendor_payment_applications")
        .select("payment_id")
        .eq("owner_id", effectiveOwnerId)
        .eq("bill_id", billId);
      if (appsError) throw appsError;
      paymentIds = (apps || []).map((app) => app.payment_id);
      if (paymentIds.length === 0) {
        return NextResponse.json({ success: true, payments: [] });
      }
    }

    let query = supabaseClient
      .from("rental_vendor_payments")
      .select(PAYMENT_COLUMNS)
      .eq("owner_id", effectiveOwnerId);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (status === "active" || status === "voided") query = query.eq("status", status);
    if (paymentIds) query = query.in("id", paymentIds);
    query = query.order("payment_date", { ascending: false }).order("created_at", { ascending: false });

    const { data: payments, error } = await query;
    if (error) throw error;

    const rows = payments || [];
    const applications = await loadApplications(supabaseClient, effectiveOwnerId, rows.map((row) => row.id));
    const appsByPayment = new Map();
    for (const app of applications) {
      if (!appsByPayment.has(app.payment_id)) appsByPayment.set(app.payment_id, []);
      appsByPayment.get(app.payment_id).push(app);
    }
    const vendorNames = await loadVendorNames(
      supabaseClient,
      effectiveOwnerId,
      [...new Set(rows.map((row) => row.vendor_id))]
    );

    return NextResponse.json({
      success: true,
      payments: rows.map((row) =>
        serializeVendorPayment(row, {
          applications: appsByPayment.get(row.id) || [],
          vendorName: vendorNames.get(row.vendor_id) || null,
        })
      ),
    });
  } catch (error) {
    console.error("Vendor payments list error", error);
    return NextResponse.json({ error: "Unable to load vendor payments." }, { status: 500 });
  }
}

// POST /api/rental/vendor-payments — record a check/ACH payment against bills.
// The id (client-generated, or created server-side) is the idempotency key: a
// retried submit with the same id returns the existing payment instead of
// double-posting. Read-only members cannot post.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const writerError = await requireWriter(authenticated);
    if (writerError) return writerError;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    let body = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
    }

    const billIds = Array.isArray(body?.applications)
      ? [...new Set(body.applications.map((app) => app?.billId).filter(Boolean))]
      : [];
    let bills = [];
    if (billIds.length > 0) {
      const { data, error } = await supabaseClient
        .from("rental_vendor_bills")
        .select(BILL_COLUMNS)
        .eq("owner_id", effectiveOwnerId)
        .in("id", billIds);
      if (error) throw error;
      bills = data || [];
    }

    const { valid, errors, value } = validateVendorPaymentInput(body, { bills });
    if (!valid) {
      return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    }
    const paymentId = value.id || buildVendorPaymentId();

    // Idempotency: a retried submit returns the payment already recorded.
    const existing = await findOwnedPayment(supabaseClient, effectiveOwnerId, paymentId);
    if (existing) {
      const applications = await loadApplications(supabaseClient, effectiveOwnerId, [paymentId]);
      const vendorNames = await loadVendorNames(supabaseClient, effectiveOwnerId, [existing.vendor_id]);
      return NextResponse.json({
        success: true,
        deduplicated: true,
        payment: serializeVendorPayment(existing, {
          applications,
          vendorName: vendorNames.get(existing.vendor_id) || null,
        }),
      });
    }

    const { data: rpcData, error: rpcError } = await supabaseClient.rpc("record_vendor_payment", {
      p_owner_id: effectiveOwnerId,
      p_payment: {
        id: paymentId,
        vendorId: value.vendorId,
        paymentDate: value.paymentDate,
        paymentMethod: value.paymentMethod,
        checkNumber: value.checkNumber || null,
        bankAccountId: value.bankAccountId,
        memo: value.memo || null,
        amountCents: value.amountCents,
        applications: value.applications.map((app) => ({ billId: app.billId, amountCents: app.amountCents })),
      },
    });

    if (rpcError) {
      const mapped = mapRpcError(rpcError);
      if (mapped === "duplicate") {
        // Lost the race with a concurrent identical submit — return the winner.
        const winner = await findOwnedPayment(supabaseClient, effectiveOwnerId, paymentId);
        if (winner) {
          const applications = await loadApplications(supabaseClient, effectiveOwnerId, [paymentId]);
          const vendorNames = await loadVendorNames(supabaseClient, effectiveOwnerId, [winner.vendor_id]);
          return NextResponse.json({
            success: true,
            deduplicated: true,
            payment: serializeVendorPayment(winner, {
              applications,
              vendorName: vendorNames.get(winner.vendor_id) || null,
            }),
          });
        }
        return NextResponse.json({ error: "A payment with this id already exists." }, { status: 409 });
      }
      if (mapped && mapped !== "reconciled") {
        return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      }
      console.error("record_vendor_payment error", rpcError);
      return NextResponse.json({ error: "Unable to record the payment." }, { status: 500 });
    }

    const createdId = rpcData?.paymentId || paymentId;
    const created = await findOwnedPayment(supabaseClient, effectiveOwnerId, createdId);
    if (!created) {
      console.error("record_vendor_payment succeeded but the payment row is missing", { createdId });
      return NextResponse.json({ error: "Unable to record the payment." }, { status: 500 });
    }
    const applications = await loadApplications(supabaseClient, effectiveOwnerId, [createdId]);
    const vendorNames = await loadVendorNames(supabaseClient, effectiveOwnerId, [created.vendor_id]);

    return NextResponse.json(
      {
        success: true,
        payment: serializeVendorPayment(created, {
          applications,
          vendorName: vendorNames.get(created.vendor_id) || null,
        }),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Vendor payment create error", error);
    return NextResponse.json({ error: "Unable to record the payment." }, { status: 500 });
  }
}
