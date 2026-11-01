import { NextResponse } from "next/server";
import { badRequest } from "./shared.js";

// Controls-sweep B3: landlord autopay controls. The tenant cancel RPC
// (cancel_rental_autopay_enrollment) requires the tenant's own session, so the
// landlord cannot call it — these landlord ops use owner-scoped direct updates
// under the existing owner_all policy instead. Every transition is guarded by
// the current status so a stale button cannot move an enrollment twice.
// The sweep charges only status = "active" enrollments, so pause and cancel
// both stop the next sweep, and resume restarts it. Charge-day / reminder
// edits take effect on the next cycle. Changing the payment METHOD is
// deliberately not offered here: a new method needs a new Stripe payment
// method + mandate, which only the tenant can consent to in the portal — the
// landlord path for a method change is cancel + tenant re-enrolment.
const CURRENT = ["setup_required", "active", "paused"];

async function loadEnrollment(client, effectiveOwnerId, enrollmentId) {
  const { data, error } = await client.from("rental_autopay_enrollments")
    .select("id, lease_id, tenant_id, status, payment_method_type, charge_day, reminder_days_before")
    .eq("owner_id", effectiveOwnerId).eq("id", enrollmentId).maybeSingle();
  if (error) throw error;
  return data;
}

async function transition({ authenticated, effectiveOwnerId, enrollmentId, from, values }) {
  const { data, error } = await authenticated.supabaseClient.from("rental_autopay_enrollments")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("owner_id", effectiveOwnerId).eq("id", enrollmentId).in("status", from)
    .select("id, lease_id, tenant_id, status, payment_method_type, charge_day, reminder_days_before, cancelled_at").maybeSingle();
  if (error) throw error;
  return data;
}

function requireId(body) {
  if (typeof body.enrollmentId !== "string" || !body.enrollmentId.trim()) return null;
  return body.enrollmentId.trim();
}

export async function pauseAutopay({ authenticated, body, effectiveOwnerId }) {
  const enrollmentId = requireId(body);
  if (!enrollmentId) return badRequest("enrollmentId is required.");
  const enrollment = await loadEnrollment(authenticated.supabaseClient, effectiveOwnerId, enrollmentId);
  if (!enrollment) return NextResponse.json({ error: "Autopay enrollment was not found." }, { status: 404 });
  if (enrollment.status !== "active") return NextResponse.json({ error: "Only an active enrollment can be paused." }, { status: 409 });
  const updated = await transition({ authenticated, effectiveOwnerId, enrollmentId, from: ["active"], values: { status: "paused" } });
  if (!updated) return NextResponse.json({ error: "Enrollment could not be paused." }, { status: 409 });
  return NextResponse.json({ success: true, enrollment: updated });
}

export async function resumeAutopay({ authenticated, body, effectiveOwnerId }) {
  const enrollmentId = requireId(body);
  if (!enrollmentId) return badRequest("enrollmentId is required.");
  const enrollment = await loadEnrollment(authenticated.supabaseClient, effectiveOwnerId, enrollmentId);
  if (!enrollment) return NextResponse.json({ error: "Autopay enrollment was not found." }, { status: 404 });
  if (enrollment.status !== "paused") return NextResponse.json({ error: "Only a paused enrollment can be resumed." }, { status: 409 });
  const updated = await transition({ authenticated, effectiveOwnerId, enrollmentId, from: ["paused"], values: { status: "active" } });
  if (!updated) return NextResponse.json({ error: "Enrollment could not be resumed." }, { status: 409 });
  return NextResponse.json({ success: true, enrollment: updated });
}

export async function cancelAutopay({ authenticated, body, effectiveOwnerId }) {
  const enrollmentId = requireId(body);
  if (!enrollmentId) return badRequest("enrollmentId is required.");
  if (typeof body.reason !== "string" || !body.reason.trim()) return badRequest("A reason is required to cancel autopay.");
  if (body.ownerConfirmed !== true) return badRequest("Owner confirmation is required to cancel autopay.");
  const enrollment = await loadEnrollment(authenticated.supabaseClient, effectiveOwnerId, enrollmentId);
  if (!enrollment) return NextResponse.json({ error: "Autopay enrollment was not found." }, { status: 404 });
  if (!CURRENT.includes(enrollment.status)) return NextResponse.json({ error: "This enrollment is already cancelled." }, { status: 409 });
  const updated = await transition({ authenticated, effectiveOwnerId, enrollmentId, from: CURRENT,
    values: { status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_reason: body.reason.trim() } });
  if (!updated) return NextResponse.json({ error: "Enrollment could not be cancelled." }, { status: 409 });
  return NextResponse.json({ success: true, enrollment: updated });
}

export async function updateAutopay({ authenticated, body, effectiveOwnerId }) {
  const enrollmentId = requireId(body);
  if (!enrollmentId) return badRequest("enrollmentId is required.");
  const chargeDay = Number(body.chargeDay);
  const reminderDaysBefore = Number(body.reminderDaysBefore);
  if (!Number.isSafeInteger(chargeDay) || chargeDay < 1 || chargeDay > 28) return badRequest("Charge day must be between 1 and 28.");
  if (!Number.isSafeInteger(reminderDaysBefore) || reminderDaysBefore < 0 || reminderDaysBefore > 14) return badRequest("Reminder days must be between 0 and 14.");
  const enrollment = await loadEnrollment(authenticated.supabaseClient, effectiveOwnerId, enrollmentId);
  if (!enrollment) return NextResponse.json({ error: "Autopay enrollment was not found." }, { status: 404 });
  if (!CURRENT.includes(enrollment.status)) return NextResponse.json({ error: "A cancelled enrollment cannot be edited." }, { status: 409 });
  const updated = await transition({ authenticated, effectiveOwnerId, enrollmentId, from: CURRENT,
    values: { charge_day: chargeDay, reminder_days_before: reminderDaysBefore } });
  if (!updated) return NextResponse.json({ error: "Enrollment could not be updated." }, { status: 409 });
  return NextResponse.json({ success: true, enrollment: updated });
}
