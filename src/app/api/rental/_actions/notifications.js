import { NextResponse } from "next/server";
import { badRequest, readOnlyWriteBlocked } from "./shared.js";

export async function queueRentReminder({ authenticated, body, effectiveOwnerId }) {
  if (!body.chargeId || !["rent_reminder", "balance_overdue"].includes(body.notificationType) || !body.scheduledFor)
    return badRequest("Charge, reminder type, and schedule are required.");
  const attempts = Number(body.maxAttempts);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5)
    return badRequest("Retry limit must be between 1 and 5.");
  const { data, error } = await authenticated.supabaseClient.rpc("queue_rental_balance_reminder", {
    p_owner_id: effectiveOwnerId, p_charge_id: body.chargeId, p_scheduled_for: body.scheduledFor,
    p_notification_type: body.notificationType, p_max_attempts: attempts,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, notification: data });
}

export async function cancelRentNotification({ authenticated, body, effectiveOwnerId }) {
  if (!body.notificationId) return badRequest("notificationId is required.");
  const { data, error } = await authenticated.supabaseClient.rpc("cancel_rental_notification", {
    p_owner_id: effectiveOwnerId, p_notification_id: body.notificationId,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, notification: data });
}

// Controls-sweep follow-up G24 (O-16): retry a failed delivery by
// requeueing the SAME row — attempts reset so the bounded retry budget
// starts fresh, the failure note cleared, the sent stamps cleared. Only
// from 'failed': a queued row is already in the pipeline, a sent row is
// history (resend it instead), a cancelled row stays cancelled.
export async function retryRentNotification({ authenticated, body, effectiveOwnerId }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot retry notifications." }, { status: 403 });
  if (!body.notificationId) return badRequest("notificationId is required.");
  const { data, error } = await authenticated.supabaseClient.from("rental_notification_outbox").update({
    status: "queued", attempt_count: 0, failure_message: null, sent_at: null,
    provider_message_id: null, scheduled_for: new Date().toISOString(),
  }).eq("owner_id", effectiveOwnerId).eq("id", body.notificationId).eq("status", "failed")
    .select("*").maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Failed notification was not found." }, { status: 404 });
  return NextResponse.json({ success: true, notification: data });
}

// Controls-sweep follow-up G24 (O-16): resend a sent notice as a NEW
// queued copy — the original stays 'sent' as delivery history, never
// rewritten. Only from 'sent': anything else has no delivery to repeat.
export async function resendRentNotification({ authenticated, body, effectiveOwnerId }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot resend notifications." }, { status: 403 });
  if (!body.notificationId) return badRequest("notificationId is required.");
  const { data: original, error: loadError } = await authenticated.supabaseClient.from("rental_notification_outbox")
    .select("tenant_id, lease_id, notification_type, channel, recipient, subject, body_text, max_attempts")
    .eq("owner_id", effectiveOwnerId).eq("id", body.notificationId).eq("status", "sent").maybeSingle();
  if (loadError) throw loadError;
  if (!original) return NextResponse.json({ error: "Sent notification was not found." }, { status: 404 });
  const { data, error } = await authenticated.supabaseClient.from("rental_notification_outbox").insert({
    owner_id: effectiveOwnerId, id: `rental_notification_${crypto.randomUUID()}`,
    tenant_id: original.tenant_id, lease_id: original.lease_id,
    event_key: `resend:${body.notificationId}:${crypto.randomUUID()}`,
    notification_type: original.notification_type, channel: original.channel, recipient: original.recipient,
    subject: original.subject, body_text: original.body_text,
    scheduled_for: new Date().toISOString(), max_attempts: original.max_attempts,
  }).select("*").single();
  if (error) throw error;
  return NextResponse.json({ success: true, notification: data });
}

export async function queueInsuranceRenewals({ authenticated, body, effectiveOwnerId }) {
  const { data, error } = await authenticated.supabaseClient.rpc("queue_renters_insurance_renewal_reminders", {
    p_owner_id: effectiveOwnerId, p_as_of: body.asOf || new Date().toISOString().slice(0, 10),
  });
  if (error) throw error;
  return NextResponse.json({ success: true, queued: Number(data || 0) });
}
