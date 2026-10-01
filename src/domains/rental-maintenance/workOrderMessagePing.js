import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";

// Rentec parity R5: the new-message ping for work-order threads.
//
// Same durability contract as the R2 tenant-statement email: one outbox row per message
// (event_key unique on the message id, so a retried POST can never double-ping), guarded
// claim to 'sending', immediate Resend attempt, 'sent'/'failed'. Failed rows ride the
// existing /api/rental/notifications/deliver retry flow. No new email infrastructure, no
// bulk send -- one ping per message, addressed to the other party only.
const MAX_SEND_ATTEMPTS = 3;

export function buildWorkOrderMessageEventKey({ messageId }) {
  return `work-order-message:${messageId}`;
}

export function buildWorkOrderMessagePing({ direction, tenantName, workOrderScope }) {
  const scope = workOrderScope ? ` (${workOrderScope})` : "";
  if (direction === "tenant_to_owner") {
    return {
      subject: `New tenant message on work order${scope}`,
      bodyText:
        `${tenantName || "Your tenant"} sent a new message on a maintenance work order${scope}. ` +
        `Sign in to the FORGE Rental Manager to read and reply.`,
    };
  }
  return {
    subject: `New message about your maintenance request${scope}`,
    bodyText:
      `Your landlord sent a new message about a maintenance work order${scope}. ` +
      `Sign in to the FORGE tenant portal to read and reply.`,
  };
}

function newOutboxId() {
  return `rental_notification_${crypto.randomUUID()}`;
}

async function findExistingPing(db, ownerId, eventKey) {
  const { data, error } = await db.from("rental_notification_outbox")
    .select("id, status, attempt_count, max_attempts")
    .eq("owner_id", ownerId).eq("event_key", eventKey).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Queues the ping and attempts immediate delivery. Returns
// { notificationId, recipient, alreadySent } on the queued/sent path, or
// { notificationId, deliveryError } when the send failed but the row is queued for retry.
export async function queueWorkOrderMessagePing({
  supabaseClient, ownerId, tenantId, leaseId, eventKey, recipient, subject, bodyText,
}) {
  const { data: inserted, error: insertError } = await supabaseClient.from("rental_notification_outbox")
    .insert({
      owner_id: ownerId, id: newOutboxId(), tenant_id: tenantId, lease_id: leaseId,
      event_key: eventKey, notification_type: "work_order_message", recipient,
      subject, body_text: bodyText, status: "queued",
    })
    .select("id");
  if (insertError && insertError.code !== "23505") throw insertError;
  let notificationId = inserted?.[0]?.id || null;
  if (!notificationId) {
    const existing = await findExistingPing(supabaseClient, ownerId, eventKey);
    if (existing && ["queued", "sending", "sent"].includes(existing.status)) {
      return { notificationId: existing.id, recipient, alreadySent: true };
    }
    if (existing && existing.status === "failed" && Number(existing.attempt_count || 0) < Number(existing.max_attempts || MAX_SEND_ATTEMPTS)) {
      const { data: reclaimed, error: reclaimError } = await supabaseClient.from("rental_notification_outbox")
        .update({ status: "queued", failure_message: null })
        .eq("owner_id", ownerId).eq("id", existing.id).eq("status", "failed")
        .select("id");
      if (reclaimError) throw reclaimError;
      if (reclaimed?.length === 1) notificationId = existing.id;
      else return { notificationId: existing.id, recipient, alreadySent: true };
    } else {
      return { notificationId: existing?.id || null, recipient, alreadySent: true };
    }
  }

  // Guarded transition to 'sending' -- the loser of a race finds zero rows.
  const { data: claimed, error: claimError } = await supabaseClient.from("rental_notification_outbox")
    .update({ status: "sending", attempt_count: 1, last_attempt_at: new Date().toISOString() })
    .eq("owner_id", ownerId).eq("id", notificationId).eq("status", "queued")
    .select("id");
  if (claimError) throw claimError;
  if (!claimed?.length) return { notificationId, recipient, alreadySent: true };

  try {
    const sent = await createResendRentalEmailProvider().send({
      id: eventKey,
      senderName: "FORGE Rental Manager",
      senderEmail: process.env.RENTAL_EMAIL_SENDER || "rentals@mail.409marketplace.online",
      recipient, subject, bodyText,
    });
    const { error: doneError } = await supabaseClient.from("rental_notification_outbox")
      .update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: sent.messageId })
      .eq("owner_id", ownerId).eq("id", notificationId);
    if (doneError) throw doneError;
    return { notificationId, recipient };
  } catch (sendError) {
    console.error("Work-order message ping failed", { eventKey, code: sendError?.name || "unknown" });
    await supabaseClient.from("rental_notification_outbox")
      .update({ status: "failed", failure_message: String(sendError?.message || "Email delivery failed.").slice(0, 500) })
      .eq("owner_id", ownerId).eq("id", notificationId);
    return { notificationId, recipient, deliveryError: "The ping email could not be sent. It is queued for retry." };
  }
}
