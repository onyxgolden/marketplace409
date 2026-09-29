// Queues private-financing (personal loan) payment-received notifications for a succeeded
// borrower Stripe payment. Called from the Stripe webhook route AFTER the payment projection
// succeeds. NEVER throws: notification queueing must not break webhook processing — a failure
// is logged and the webhook still returns 200.
//
// Two rows are queued per payment: an 'owner' receipt to the owner-notification recipient
// (brandykaymorgan@gmail.com per Jason's 2026-09-29 instruction, resolved through the shared
// owner-notification config) and a 'borrower' receipt to the borrower's own email.
//
// Detection-time disposition mirrors the rental owner-notification precedent: rows are written
// as 'queued' when sending is enabled at detection time AND the owner is allowlisted AND the
// borrower is on the PF_RECEIPT_BORROWER_IDS allowlist (recipient-level rollout restriction —
// the owner allowlist alone would receipt every borrower), or terminally as
// 'skipped_disabled' when they are not. A disabled-at-detection event can never be
// delivered later.
//
// The insert is first-write-wins (ignoreDuplicates): a webhook redelivery or a later
// reconciler pass can never flip a terminal row ('sent', 'skipped_disabled',
// 'skipped_not_allowlisted') back to 'queued', so double-notify and resurrection of a
// disabled-at-detection event are both impossible.
//
// options.dryRun: run the full eligibility decision and return the rows that WOULD be
// written, without any database write. Used by the no-send acceptance harness.
import {
  RECEIPT_RECIPIENT_TYPE,
  buildReceiptDeliveryId,
  isBorrowerReceiptAllowed,
  resolvePaymentReceiptConfig,
} from "@/domains/private-financing/paymentReceiptNotifications";
import { isOwnerNotificationAllowed } from "@/domains/owner-notifications/ownerNotificationConfig";

// Pure row builder, shared with the cron route's reconciler. The reconciler exists so a lost
// webhook queue write (caught and swallowed here to protect webhook processing) still heals
// within one cron run. The row is the dedup record, not the email draft: borrower name,
// account product, and autopay sourcing are re-resolved by the sender at send time so the
// email always reflects current data.
export function buildReceiptDeliveryRow({
  payment,
  recipientType,
  recipientEmail,
  sendingEnabled,
  ownerAllowed,
  borrowerAllowed,
}) {
  const deliverable = sendingEnabled && ownerAllowed && borrowerAllowed && Boolean(recipientEmail);
  return {
    owner_id: payment.owner_id,
    id: buildReceiptDeliveryId({
      ownerId: payment.owner_id,
      paymentId: payment.id,
      recipientType,
    }),
    account_id: payment.account_id,
    payment_id: payment.id,
    borrower_id: payment.borrower_id,
    recipient_type: recipientType,
    recipient_email: recipientEmail || "",
    status: deliverable ? "queued" : "skipped_disabled",
    failure_reason: deliverable
      ? null
      : !sendingEnabled
        ? "Sending disabled at detection time."
        : !ownerAllowed
          ? "Owner not allowlisted for notifications."
          : !borrowerAllowed
            ? "Borrower not allowlisted for payment receipts."
            : "Recipient email unavailable.",
  };
}

export async function queuePaymentReceiptNotificationForWebhookEvent(db, payment, options = {}) {
  try {
    const dryRun = options.dryRun === true;
    const config = resolvePaymentReceiptConfig();
    const sendingEnabled = options.sendingEnabled ?? config.enabled;
    const ownerAllowed = isOwnerNotificationAllowed(
      { allowedOwnerIds: options.allowedOwnerIds ?? config.allowedOwnerIds },
      payment.owner_id,
    );
    const borrowerAllowed = isBorrowerReceiptAllowed(
      { allowedBorrowerIds: options.allowedBorrowerIds ?? config.allowedBorrowerIds },
      payment.borrower_id,
    );

    const borrowerResult = await db
      .from("private_financing_borrowers")
      .select("email")
      .eq("id", payment.borrower_id)
      .maybeSingle();
    if (borrowerResult.error) throw borrowerResult.error;

    const borrower = borrowerResult.data || {};
    const rows = [
      buildReceiptDeliveryRow({
        payment,
        recipientType: RECEIPT_RECIPIENT_TYPE.OWNER,
        recipientEmail: config.recipientEmail,
        sendingEnabled,
        ownerAllowed,
        borrowerAllowed,
      }),
      buildReceiptDeliveryRow({
        payment,
        recipientType: RECEIPT_RECIPIENT_TYPE.BORROWER,
        recipientEmail: borrower.email,
        sendingEnabled,
        ownerAllowed,
        borrowerAllowed,
      }),
    ];

    for (const row of rows) {
      if (dryRun) continue;
      const { error } = await db.from("private_financing_payment_receipt_deliveries").upsert(row, {
        onConflict: "owner_id,payment_id,recipient_type",
        ignoreDuplicates: true,
      });
      if (error) throw error;
    }
    return {
      queued: rows.filter((row) => row.status === "queued").length,
      dryRun,
      rows,
    };
  } catch (error) {
    console.error("Private financing payment receipt queueing failed", {
      paymentId: payment?.id,
      name: error?.name || "Error",
    });
    return { queued: 0, queueError: true };
  }
}
