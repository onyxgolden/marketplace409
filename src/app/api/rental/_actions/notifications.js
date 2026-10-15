import { NextResponse } from "next/server";
import { badRequest } from "./shared.js";

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

export async function queueInsuranceRenewals({ authenticated, body, effectiveOwnerId }) {
  const { data, error } = await authenticated.supabaseClient.rpc("queue_renters_insurance_renewal_reminders", {
    p_owner_id: effectiveOwnerId, p_as_of: body.asOf || new Date().toISOString().slice(0, 10),
  });
  if (error) throw error;
  return NextResponse.json({ success: true, queued: Number(data || 0) });
}
