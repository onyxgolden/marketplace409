import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { createTenantCharge } from "@/application/rental/tenantCharges";

// Charge types the rent_charges check constraint allows (migration
// 20260926160000). Kept as an explicit allowlist — never inferred.
const EDITABLE_CHARGE_TYPES = ["rent", "proration", "late_fee", "damage", "fee", "utility", "other"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidDate = (value) => typeof value === "string" && DATE_RE.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));

function serializeCharge(charge) {
  return {
    id: charge.id,
    leaseId: charge.lease_id,
    chargeType: charge.charge_type || "rent",
    amountCents: Number(charge.amount_cents || 0),
    paidCents: Number(charge.paid_amount_cents || 0),
    dueDate: charge.due_date || null,
    period: charge.period || null,
    status: charge.status || "unknown",
    notes: charge.notes || "",
  };
}

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot change tenant charges." }, { status: 403 });
  }
  return null;
}

async function findOwnedCharge(supabaseClient, ownerId, chargeId) {
  const { data, error } = await supabaseClient.from("rent_charges")
    .select("id, lease_id, charge_type, amount_cents, paid_amount_cents, due_date, period, status, notes")
    .eq("owner_id", ownerId).eq("id", chargeId).maybeSingle();
  if (error) throw error;
  return data || null;
}

// GET /api/rental/tenant-charges?chargeId= — single charge detail for the
// invoice editor. Owner-scoped; 404 when the charge belongs to another
// workspace. Read-only members may read.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const chargeId = new URL(request.url).searchParams.get("chargeId");
    if (!chargeId || !chargeId.trim()) {
      return NextResponse.json({ error: "chargeId is required." }, { status: 400 });
    }
    const charge = await findOwnedCharge(authenticated.supabaseClient, authenticated.effectiveOwnerId, chargeId.trim());
    if (!charge) return NextResponse.json({ error: "Charge was not found." }, { status: 404 });
    return NextResponse.json({ success: true, charge: serializeCharge(charge) });
  } catch (error) {
    console.error("Tenant charge detail error", error);
    return NextResponse.json({ error: "Unable to load the charge." }, { status: 500 });
  }
}

// PATCH /api/rental/tenant-charges — edit a charge (the invoice editor's save).
// Body: { chargeId, dueDate?, chargeType?, amountCents?, notes? }.
// Payment-history safety: the invoiced amount can never drop below what has
// already been applied to the charge — lowering it would silently rewrite
// payment history. Paid charges are amount-final; voided charges are immutable.
// The status and paid-balance guards are enforced TWICE: once against the
// initial read (for specific, helpful error messages) and again atomically in
// the UPDATE's WHERE clause, so a payment applied — or a paid/void transition
// — between the read and the write cannot slip through. When the write-time
// guards fail, the update touches zero rows and the client gets a 409 asking
// to review the latest state and retry.
// Owner-scoped; read-only members get a 403.
export async function PATCH(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;

    const body = await request.json();
    const chargeId = typeof body?.chargeId === "string" ? body.chargeId.trim() : "";
    if (!chargeId) return NextResponse.json({ error: "chargeId is required." }, { status: 400 });

    const charge = await findOwnedCharge(authenticated.supabaseClient, authenticated.effectiveOwnerId, chargeId);
    if (!charge) return NextResponse.json({ error: "Charge was not found." }, { status: 404 });
    if (charge.status === "void") {
      return NextResponse.json({ error: "Voided charges cannot be edited." }, { status: 409 });
    }

    const paidCents = Number(charge.paid_amount_cents || 0);
    const patch = {};

    if (body.dueDate !== undefined) {
      if (!isValidDate(body.dueDate)) {
        return NextResponse.json({ error: "Due date must be a valid date (YYYY-MM-DD)." }, { status: 400 });
      }
      patch.due_date = body.dueDate;
    }
    if (body.chargeType !== undefined) {
      if (!EDITABLE_CHARGE_TYPES.includes(body.chargeType)) {
        return NextResponse.json({ error: `Charge type must be one of: ${EDITABLE_CHARGE_TYPES.join(", ")}.` }, { status: 400 });
      }
      patch.charge_type = body.chargeType;
    }
    if (body.amountCents !== undefined) {
      const amountCents = Number(body.amountCents);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        return NextResponse.json({ error: "Charge amount must be a positive number of cents." }, { status: 400 });
      }
      if (charge.status === "paid" && amountCents !== paidCents) {
        return NextResponse.json({ error: "Paid charges are final — the amount cannot be changed once fully paid." }, { status: 409 });
      }
      if (amountCents < paidCents) {
        return NextResponse.json({
          error: `This charge has ${(paidCents / 100).toFixed(2)} already applied — the invoiced amount cannot go below applied payments.`,
        }, { status: 409 });
      }
      patch.amount_cents = amountCents;
      // Lowering the amount onto the paid balance settles the charge.
      if (amountCents === paidCents && ["due", "partially_paid", "overdue", "scheduled"].includes(charge.status)) {
        patch.status = "paid";
      }
    }
    if (body.notes !== undefined) {
      patch.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    // Write-time guards: re-check status and the paid balance against the
    // CURRENT row inside the UPDATE itself, so a concurrent payment (or a
    // paid/void transition) between our read and this write blocks the edit
    // instead of being silently overwritten. Zero updated rows => 409 below.
    let write = authenticated.supabaseClient.from("rent_charges")
      .update(patch).eq("owner_id", authenticated.effectiveOwnerId).eq("id", chargeId)
      .neq("status", "void");
    if (patch.amount_cents !== undefined) {
      const newAmountCents = patch.amount_cents;
      write = write
        // The invoiced amount must still cover every applied payment.
        .lte("paid_amount_cents", newAmountCents)
        // A charge that became paid after our read keeps its amount final,
        // unless the new amount exactly matches what is now paid.
        .or(`status.neq.paid,paid_amount_cents.eq.${newAmountCents}`);
    }

    const { data: updated, error: updateError } = await write
      .select("id, lease_id, charge_type, amount_cents, paid_amount_cents, due_date, period, status, notes")
      .single();
    if (updateError) {
      if (updateError.code === "PGRST116") {
        return NextResponse.json({
          error: "This charge changed while you were editing it — a payment may have been applied or its status changed. Please review the latest details and try again.",
        }, { status: 409 });
      }
      throw updateError;
    }
    return NextResponse.json({ success: true, charge: serializeCharge(updated) });
  } catch (error) {
    console.error("Tenant charge update error", error);
    return NextResponse.json({ error: "Unable to update the charge." }, { status: 500 });
  }
}

// POST /api/rental/tenant-charges — standalone ad-hoc tenant charge (damage,
// fee, utility, other). No expense is fabricated: this creates ONLY the
// schedule-less rent_charges row. For expense-linked charges, post through
// /api/rental/transactions with chargeTenant=true instead.
// Body: { leaseId, chargeType, amountCents, description, dueDate?, chargeDate? }.
// Owner-scoped to the effective workspace owner; read-only members get a 403.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;

    const body = await request.json();
    const charge = await createTenantCharge(authenticated.supabaseClient, {
      ownerId: authenticated.effectiveOwnerId,
      leaseId: body?.leaseId,
      chargeType: body?.chargeType,
      amountCents: body?.amountCents,
      description: body?.description,
      dueDate: body?.dueDate,
      chargeDate: body?.chargeDate,
    });
    return NextResponse.json({ success: true, charge });
  } catch (error) {
    console.error("Tenant charge create error", error);
    const message = error?.message || "Unable to save the tenant charge.";
    const status = /required|must be|was not found/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
