import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { createRentalUnit } from "@/domains/rental-unit";
import { createRentalTenant } from "@/domains/rental-tenant";
import { createRentalLease } from "@/domains/rental-lease";
import { createRentSchedule } from "@/domains/rent-schedule";

function badRequest(message) { return NextResponse.json({ error: message }, { status: 400 }); }
function now() { return new Date().toISOString(); }
function id(prefix, supplied) { return supplied?.trim() || `${prefix}_${crypto.randomUUID()}`; }

export async function GET() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const [chargesResult, unitsResult, tenantsResult, schedulesResult] = await Promise.all([
      authenticated.supabaseClient.from("rent_charges")
        .select("id, lease_id, period, due_date, amount_cents, paid_amount_cents, currency_code, status")
        .in("status", ["scheduled", "due", "partially_paid", "overdue"]).order("due_date", { ascending: true }),
      authenticated.supabaseClient.from("rental_units")
        .select("id, property_id, label, status").order("label", { ascending: true }),
      authenticated.supabaseClient.from("rental_tenants")
        .select("id, display_name, email, status").order("display_name", { ascending: true }),
      authenticated.supabaseClient.from("rent_schedules")
        .select("id, lease_id, status, amount_cents, currency_code, due_day, effective_start_date, effective_end_date")
        .order("effective_start_date", { ascending: false }),
    ]);
    const error = chargesResult.error || unitsResult.error || tenantsResult.error || schedulesResult.error;
    if (error) throw error;
    return NextResponse.json({ success: true, openCharges: chargesResult.data || [],
      units: unitsResult.data || [], tenants: tenantsResult.data || [], schedules: schedulesResult.data || [] });
  } catch (error) {
    console.error("Rental Manager query error", error);
    return NextResponse.json({ error: "Unable to load open rent charges." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const body = await request.json();
    const { application, user } = authenticated;
    const timestamp = now();

    switch (body?.operation) {
      case "save-unit": {
        const input = body.unit;
        if (!input || typeof input !== "object") return badRequest("unit is required.");
        const unit = createRentalUnit({ ...input, id: id("rental_unit", input.id), createdAt: input.createdAt || timestamp,
          updatedAt: timestamp, bedrooms: input.bedrooms ?? null, bathrooms: input.bathrooms ?? null,
          squareFeet: input.squareFeet ?? null, availableAt: input.availableAt ?? null, notes: input.notes ?? null });
        return NextResponse.json({ success: true, unit: await application.saveUnit(unit, user.id) });
      }
      case "save-tenant": {
        const input = body.tenant;
        if (!input || typeof input !== "object") return badRequest("tenant is required.");
        const tenant = createRentalTenant({ ...input, id: id("rental_tenant", input.id), authUserId: input.authUserId ?? null,
          phone: input.phone ?? null, status: input.status ?? "invited", invitedAt: input.invitedAt ?? timestamp,
          activatedAt: input.activatedAt ?? null, createdAt: input.createdAt || timestamp, updatedAt: timestamp });
        return NextResponse.json({ success: true, tenant: await application.saveTenant(tenant, user.id) });
      }
      case "save-lease": {
        const input = body.lease;
        if (!input || typeof input !== "object") return badRequest("lease is required.");
        const lease = createRentalLease({ ...input, id: id("rental_lease", input.id), status: input.status ?? "draft",
          endDate: input.endDate ?? null, documentEvidenceId: input.documentEvidenceId ?? null,
          activatedAt: input.activatedAt ?? null, endedAt: input.endedAt ?? null,
          createdAt: input.createdAt || timestamp, updatedAt: timestamp, notes: input.notes ?? null });
        return NextResponse.json({ success: true, lease: await application.saveLease(lease, user.id) });
      }
      case "save-schedule": {
        const input = body.schedule;
        if (!input || typeof input !== "object") return badRequest("schedule is required.");
        const schedule = createRentSchedule({ ...input, id: id("rent_schedule", input.id), status: input.status ?? "draft",
          effectiveEndDate: input.effectiveEndDate ?? null, createdAt: input.createdAt || timestamp, updatedAt: timestamp });
        return NextResponse.json({ success: true, schedule: await application.saveSchedule(schedule, user.id) });
      }
      case "generate-charge": {
        if (!body.scheduleId || !body.period) return badRequest("scheduleId and period are required.");
        const charge = await application.generateMonthlyCharge(body.scheduleId, body.period, user.id);
        if (!charge) return NextResponse.json({ error: "The schedule must be active and effective for the selected month." }, { status: 409 });
        return NextResponse.json({ success: true, charge });
      }
      case "activate-lease-schedule": {
        if (!body.scheduleId) return badRequest("scheduleId is required.");
        const { data, error } = await authenticated.supabaseClient.rpc("activate_rental_lease_schedule", {
          p_owner_id: user.id, p_schedule_id: body.scheduleId,
        });
        if (error) throw error;
        return NextResponse.json({ success: true, activation: data });
      }
      case "record-offline-payment": {
        const input = body.payment;
        if (!input?.chargeId || !["cash", "cashiers_check"].includes(input.paymentMethod))
          return badRequest("chargeId and a supported offline payment method are required.");
        const amountCents = Number(input.amountCents);
        if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return badRequest("A positive payment amount is required.");
        const { data, error } = await authenticated.supabaseClient.rpc("record_offline_rental_payment", {
          p_owner_id: user.id, p_charge_id: input.chargeId, p_payment_method: input.paymentMethod,
          p_amount_cents: amountCents, p_received_at: input.receivedAt,
          p_receipt_reference: input.receiptReference || null, p_notes: input.notes || null,
        });
        if (error) throw error;
        return NextResponse.json({ success: true, payment: data });
      }
      default:
        return badRequest("A supported Rental Manager operation is required.");
    }
  } catch (error) {
    console.error("Rental Manager operation error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to complete Rental Manager operation." }, { status: 500 });
  }
}
