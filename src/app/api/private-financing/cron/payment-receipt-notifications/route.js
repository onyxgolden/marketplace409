import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import {
  buildReceiptDeliveryId,
  buildReceiptEmail,
  buildReceiptProviderIdempotencyKey,
  isBorrowerReceiptAllowed,
  resolvePaymentReceiptConfig,
  RECEIPT_RECIPIENT_TYPE,
} from "@/domains/private-financing/paymentReceiptNotifications";
import { buildReceiptDeliveryRow } from "@/application/private-financing/queuePaymentReceiptNotification";
import { isOwnerNotificationAllowed } from "@/domains/owner-notifications/ownerNotificationConfig";
import { isQuietHours } from "@/domains/owner-notifications/ownerPaymentNotifications";

export const runtime = "nodejs";

// Personal-loan payment-received notifications. Two jobs in one run:
//   1. Reconcile succeeded borrower payments from the last few days: any payment without a
//      receipt-delivery row gets its owner + borrower rows queued (detection-time disposition:
//      'queued' when sending is on and both the owner allowlist and the PF_RECEIPT_BORROWER_IDS
//      borrower allowlist pass — recipient-level rollout restriction, Jason's 2026-09-29
//      instruction; terminal 'skipped_disabled' otherwise). This is the durable healing path
//      for webhook queue writes that were caught and swallowed to protect webhook processing.
//   2. Deliver queued rows: claim each row BEFORE the provider call with a unique claim token
//      (the claim is the distributed lock), then send via Resend when sending is enabled.
//      Quiet hours (23:00-07:00 America/Chicago, Jason's rule): delivery inside the window is
//      deferred wholesale — rows stay queued for the next run after 07:00. The window is
//      checked before the run, rechecked before every claim, and checked a final time
//      immediately before the provider call; a claim interrupted by the final gate is released
//      back to 'queued' without burning a retry attempt.
//
// Terminal payment events are ALSO queued in real time by the Stripe webhook hook; the
// reconciler is the backstop. The dedup key makes every queue insertion idempotent, so
// webhook redeliveries, reconciliations, and overlapping cron runs can never double-notify.
//
// This route is deliberately NOT yet registered in vercel.json — it exists and can be invoked
// manually (with the cron secret) for verification, but does not run on a schedule until a
// separate, later authorization adds it there.
//
// ?dryRun=true calculates the full plan (including which emails WOULD be sent) without calling
// the email provider or writing any delivery row.
const TERMINAL_PAYMENT_LOOKBACK_DAYS = 3;
const QUERY_PAGE_SIZE = 1000;

function fetchAllPages(fetchPage) {
  const run = async () => {
    const rows = [];
    for (let page = 0; ; page += 1) {
      const { data, error } = await fetchPage(page);
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < QUERY_PAGE_SIZE) break;
    }
    return rows;
  };
  return run();
}

function pageRange(page) {
  return [page * QUERY_PAGE_SIZE, (page + 1) * QUERY_PAGE_SIZE - 1];
}

function quietHoursNow(config) {
  return isQuietHours({
    startHour: config.quietStartHour,
    endHour: config.quietEndHour,
    timeZone: config.quietTimeZone,
  });
}

// Reconciler: succeeded borrower online payments in the lookback window that have no receipt
// rows yet. Returns the rows it queued (or would queue in dry-run).
async function reconcileMissingReceipts(db, config, { dryRun }) {
  const since = new Date(Date.now() - TERMINAL_PAYMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const payments = await fetchAllPages((page) =>
    db
      .from("private_financing_online_payments")
      .select("owner_id,id,account_id,borrower_id,amount_cents,succeeded_at")
      .eq("status", "succeeded")
      .gte("succeeded_at", since)
      .order("succeeded_at", { ascending: true })
      .range(...pageRange(page)),
  );
  if (payments.length === 0) return { reconciled: 0, skippedAtDetection: 0 };

  const paymentIds = payments.map((payment) => payment.id);
  const existing = await fetchAllPages((page) =>
    db
      .from("private_financing_payment_receipt_deliveries")
      .select("payment_id,recipient_type")
      .in("payment_id", paymentIds)
      .range(...pageRange(page)),
  );
  const existingKeys = new Set(existing.map((row) => `${row.payment_id}:${row.recipient_type}`));

  // Borrower emails for the borrower receipts, resolved once for the batch.
  const borrowerIds = [...new Set(payments.map((payment) => payment.borrower_id))];
  const borrowerRows = await fetchAllPages((page) =>
    db.from("private_financing_borrowers").select("id,email").in("id", borrowerIds).range(...pageRange(page)),
  );
  const borrowerEmailById = new Map(borrowerRows.map((row) => [row.id, row.email]));

  let reconciled = 0;
  let skippedAtDetection = 0;
  for (const payment of payments) {
    const ownerAllowed = isOwnerNotificationAllowed(config, payment.owner_id);
    const borrowerAllowed = isBorrowerReceiptAllowed(config, payment.borrower_id);
    for (const recipientType of [RECEIPT_RECIPIENT_TYPE.OWNER, RECEIPT_RECIPIENT_TYPE.BORROWER]) {
      if (existingKeys.has(`${payment.id}:${recipientType}`)) continue;
      const row = buildReceiptDeliveryRow({
        payment,
        recipientType,
        recipientEmail:
          recipientType === RECEIPT_RECIPIENT_TYPE.OWNER
            ? config.recipientEmail
            : borrowerEmailById.get(payment.borrower_id),
        sendingEnabled: config.enabled,
        ownerAllowed,
        borrowerAllowed,
      });
      const wouldQueue = row.status === "queued";
      if (!dryRun) {
        const { data, error } = await db
          .from("private_financing_payment_receipt_deliveries")
          .upsert(row, { onConflict: "owner_id,payment_id,recipient_type", ignoreDuplicates: true })
          .select("id");
        if (error) throw error;
        // Only the run that actually inserted the row counts it — a no-op
        // upsert means another writer (webhook, overlapping run, or a send
        // that already flipped the row) recorded it first, and first-write-wins
        // leaves that row untouched.
        if ((data || []).length === 1) {
          if (wouldQueue) reconciled += 1;
          else skippedAtDetection += 1;
        }
      } else {
        if (wouldQueue) reconciled += 1;
        else skippedAtDetection += 1;
      }
    }
  }
  return { reconciled, skippedAtDetection };
}

async function loadDeliveryCandidates(db, config) {
  const candidates = await fetchAllPages((page) =>
    db
      .from("private_financing_payment_receipt_deliveries")
      .select("*")
      .in("status", ["queued", "failed", "sending"])
      .order("created_at", { ascending: true })
      .range(...pageRange(page)),
  );
  const staleCutoff = Date.now() - config.staleClaimMinutes * 60 * 1000;
  return candidates.filter((row) => {
    if (row.status === "queued") return true;
    if (row.status === "failed") return row.attempt_count < config.maxAttempts;
    if (row.status === "sending") {
      return (
        row.attempt_count < config.maxAttempts &&
        row.last_attempted_at &&
        new Date(row.last_attempted_at).getTime() < staleCutoff
      );
    }
    return false;
  });
}

async function claimRow(db, row) {
  const now = new Date().toISOString();
  const claimToken = `claim_${randomUUID()}`;
  let query = db
    .from("private_financing_payment_receipt_deliveries")
    .update({
      status: "sending",
      claim_token: claimToken,
      attempt_count: row.attempt_count + 1,
      first_attempted_at: row.first_attempted_at || now,
      last_attempted_at: now,
      failure_reason: null,
    })
    .eq("owner_id", row.owner_id)
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("attempt_count", row.attempt_count);
  // NULL never equals NULL in SQL: an untouched last_attempted_at needs IS NULL, not = NULL.
  query = row.last_attempted_at == null ? query.is("last_attempted_at", null) : query.eq("last_attempted_at", row.last_attempted_at);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return data?.length === 1 ? claimToken : null;
}

async function recordOutcome(db, row, outcome, claimToken) {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("private_financing_payment_receipt_deliveries")
    .update({
      status: outcome.status,
      claim_token: null,
      provider_message_id: outcome.providerMessageId ?? null,
      failure_reason: outcome.failureReason ?? null,
      last_attempted_at: now,
    })
    .eq("owner_id", row.owner_id)
    .eq("id", row.id)
    .eq("claim_token", claimToken)
    .select("id");
  if (error) throw error;
  return data?.length === 1;
}

async function releaseClaimToQueue(db, row, claimToken) {
  const { data, error } = await db
    .from("private_financing_payment_receipt_deliveries")
    .update({
      status: "queued",
      claim_token: null,
      attempt_count: row.attempt_count,
      failure_reason: null,
      first_attempted_at: row.first_attempted_at,
      last_attempted_at: row.last_attempted_at,
    })
    .eq("owner_id", row.owner_id)
    .eq("id", row.id)
    .eq("claim_token", claimToken)
    .select("id");
  if (error) throw error;
  return data?.length === 1;
}

// Email facts re-resolved at send time so the email reflects current data, not the
// detection-time snapshot.
async function resolveReceiptFacts(db, row) {
  const [paymentResult, borrowerResult, accountResult, autopayResult] = await Promise.all([
    db
      .from("private_financing_online_payments")
      .select("amount_cents,succeeded_at")
      .eq("owner_id", row.owner_id)
      .eq("id", row.payment_id)
      .maybeSingle(),
    db
      .from("private_financing_borrowers")
      .select("full_name,email")
      .eq("id", row.borrower_id)
      .maybeSingle(),
    db
      .from("private_financing_accounts")
      .select("product")
      .eq("owner_id", row.owner_id)
      .eq("id", row.account_id)
      .maybeSingle(),
    db
      .from("private_financing_autopay_attempts")
      .select("id")
      .eq("owner_id", row.owner_id)
      .eq("payment_id", row.payment_id)
      .maybeSingle(),
  ]);
  if (paymentResult.error) throw paymentResult.error;
  if (borrowerResult.error) throw borrowerResult.error;
  if (accountResult.error) throw accountResult.error;
  if (autopayResult.error) throw autopayResult.error;
  const payment = paymentResult.data;
  if (!payment) return null;
  return {
    borrowerName: borrowerResult.data?.full_name,
    amountCents: payment.amount_cents,
    product: accountResult.data?.product,
    occurredAt: payment.succeeded_at,
    isAutopay: Boolean(autopayResult.data),
    borrowerEmail: borrowerResult.data?.email,
  };
}

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";
  const config = resolvePaymentReceiptConfig();

  try {
    const db = createRentalWebhookClient();

    const { reconciled, skippedAtDetection } = await reconcileMissingReceipts(db, config, { dryRun });

    let sent = 0;
    let failed = 0;
    let deferredQuietHours = 0;
    let skippedDisabled = 0;
    let skippedNotAllowlisted = 0;
    const wouldSend = [];

    const inQuietHours = quietHoursNow(config);
    if (!inQuietHours) {
      const emailProvider = dryRun ? null : createResendRentalEmailProvider();
      const candidates = await loadDeliveryCandidates(db, config);
      for (const row of candidates) {
        const claimToken = dryRun ? "dry-run" : await claimRow(db, row);
        if (!claimToken) continue;

        if (!isOwnerNotificationAllowed(config, row.owner_id)) {
          // Belt-and-braces: a row queued before the allow-list existed (or for an owner
          // since removed from it) can never be delivered. Terminally marked, not retried.
          if (dryRun) {
            skippedNotAllowlisted += 1;
          } else if (await recordOutcome(db, row, { status: "skipped_not_allowlisted" }, claimToken)) {
            skippedNotAllowlisted += 1;
          }
          continue;
        }

        if (!isBorrowerReceiptAllowed(config, row.borrower_id)) {
          // Same belt-and-braces for the borrower allow-list: a row queued for a
          // borrower since removed from PF_RECEIPT_BORROWER_IDS (or with no recorded
          // borrower) can never be delivered. Terminally marked, not retried.
          if (dryRun) {
            skippedNotAllowlisted += 1;
          } else if (await recordOutcome(db, row, { status: "skipped_not_allowlisted" }, claimToken)) {
            skippedNotAllowlisted += 1;
          }
          continue;
        }

        const facts = await resolveReceiptFacts(db, row);
        if (!facts) {
          if (!dryRun)
            await recordOutcome(
              db,
              row,
              { status: "failed", failureReason: "Payment row no longer exists." },
              claimToken,
            );
          failed += 1;
          continue;
        }
        const recipient =
          row.recipient_type === RECEIPT_RECIPIENT_TYPE.OWNER
            ? config.recipientEmail
            : facts.borrowerEmail || row.recipient_email;
        const email = buildReceiptEmail({ recipientType: row.recipient_type, facts });

        if (!config.enabled) {
          // The flag flipped off after detection: log what would have been sent and
          // terminally mark the row. Never delivered later.
          console.log("Private financing payment receipt (sending disabled) would send", {
            to: recipient,
            subject: email.subject,
          });
          if (!dryRun) {
            if (await recordOutcome(db, row, { status: "skipped_disabled" }, claimToken))
              skippedDisabled += 1;
          } else {
            skippedDisabled += 1;
          }
          continue;
        }

        if (!recipient) {
          if (!dryRun)
            await recordOutcome(
              db,
              row,
              { status: "failed", failureReason: "Recipient email unavailable." },
              claimToken,
            );
          failed += 1;
          continue;
        }

        // Final gate: the clock may have crossed into quiet hours during the claim and the
        // rechecks above. Check once more immediately before the provider call; on quiet,
        // release the claim back to 'queued' (the attempt is not burned) and stop the run.
        if (quietHoursNow(config)) {
          if (!dryRun) await releaseClaimToQueue(db, row, claimToken);
          deferredQuietHours = "run_stopped_at_quiet_hours";
          break;
        }

        if (dryRun) {
          wouldSend.push({ to: recipient, subject: email.subject });
          continue;
        }
        try {
          const result = await emailProvider.send({
            id: buildReceiptProviderIdempotencyKey(row.id),
            senderName: "FORGE Private Financing",
            senderEmail: config.senderEmail,
            recipient,
            subject: email.subject,
            bodyText: email.bodyText,
          });
          if (await recordOutcome(db, row, { status: "sent", providerMessageId: result.messageId }, claimToken))
            sent += 1;
        } catch (deliveryError) {
          console.error("Private financing payment receipt delivery failed", {
            deliveryId: row.id,
            code: deliveryError?.name || "unknown",
          });
          if (
            await recordOutcome(
              db,
              row,
              { status: "failed", failureReason: deliveryError?.message?.slice(0, 500) || "unknown" },
              claimToken,
            )
          )
            failed += 1;
        }
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      sendingEnabled: config.enabled,
      reconciled,
      skippedAtDetection,
      sent,
      failed,
      skippedDisabled,
      skippedNotAllowlisted,
      deferredQuietHours: inQuietHours ? "whole_run_deferred" : deferredQuietHours,
      wouldSend,
    });
  } catch (error) {
    console.error("Private financing payment receipt cron error", error);
    return NextResponse.json({ error: "Unable to run payment receipt notifications." }, { status: 500 });
  }
}
