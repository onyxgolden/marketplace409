import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import {
  buildTenantReceiptDeliveryId,
  buildTenantReceiptEmail,
  buildTenantReceiptProviderIdempotencyKey,
} from "@/domains/rental/tenantPaymentReceipts";
import {
  buildTenantReceiptDeliveryRow,
  queueTenantPaymentReceiptForWebhookEvent,
} from "@/application/rental/queueTenantPaymentReceipt";
import { resolvePropertyLabel } from "@/application/rental/queueOwnerPaymentNotification";
import {
  isOwnerNotificationAllowed,
  isTenantNotificationAllowed,
  resolveRentalNotificationConfig,
} from "@/domains/owner-notifications/ownerNotificationConfig";
import { isQuietHours } from "@/domains/owner-notifications/ownerPaymentNotifications";

export const runtime = "nodejs";

// Rental tenant payment receipts: one FORGE receipt email per succeeded tenant
// Stripe payment, to the tenant's own email (Jason's 2026-09-29 instruction;
// initial rollout: Eric Carrillo, 308 Paula). Two jobs in one run:
//   1. Reconcile succeeded tenant payments from the last few days: any payment
//      without a receipt row gets one queued (detection-time disposition:
//      'queued' when sending is on and both the owner and tenant allowlists
//      pass — recipient-level rollout restriction; terminal
//      'skipped_disabled' otherwise). The durable healing path for webhook
//      queue writes that were caught and swallowed to protect webhook
//      processing.
//   2. Deliver queued rows: claim each row BEFORE the provider call with a
//      unique claim token (the claim is the distributed lock), then send via
//      Resend when sending is enabled. Quiet hours (23:00-07:00
//      America/Chicago, Jason's rule): delivery inside the window is deferred
//      wholesale — rows stay queued for the next run after 07:00.
//
// Succeeded ONLY: receipts go out only after Stripe confirms the payment,
// never when the tenant merely initiates one.
//
// This route is deliberately NOT registered in vercel.json — it exists and
// can be invoked manually (with the cron secret) for verification, but does
// not run on a schedule until a separate, later authorization adds it there.
//
// ?dryRun=true calculates the full plan (including which emails WOULD be
// sent) without calling the email provider or writing any delivery row.
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

// Reconciler: succeeded tenant Stripe payments in the lookback window that
// have no receipt row yet.
async function reconcileMissingReceipts(db, config, { dryRun }) {
  const since = new Date(Date.now() - TERMINAL_PAYMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const payments = await fetchAllPages((page) =>
    db
      .from("rental_payments")
      .select("owner_id,id,lease_id,tenant_id,amount_cents,provider_payment_id")
      .eq("provider", "stripe")
      .eq("status", "succeeded")
      .gte("succeeded_at", since)
      .order("succeeded_at", { ascending: true })
      .range(...pageRange(page)),
  );
  if (payments.length === 0) return { reconciled: 0, skippedAtDetection: 0 };

  const eligible = payments.filter(
    (payment) =>
      isOwnerNotificationAllowed(config, payment.owner_id) &&
      isTenantNotificationAllowed(config, payment.tenant_id),
  );

  const paymentIds = eligible.map((payment) => payment.id);
  const existing = paymentIds.length
    ? await fetchAllPages((page) =>
        db
          .from("rental_tenant_receipt_deliveries")
          .select("payment_id")
          .in("payment_id", paymentIds)
          .range(...pageRange(page)),
      )
    : [];
  const existingIds = new Set(existing.map((row) => row.payment_id));

  const tenantIds = [...new Set(eligible.map((payment) => payment.tenant_id).filter(Boolean))];
  const tenantEmailById = new Map();
  for (let i = 0; i < tenantIds.length; i += QUERY_PAGE_SIZE) {
    const { data, error } = await db
      .from("rental_tenants")
      .select("id,email")
      .in("id", tenantIds.slice(i, i + QUERY_PAGE_SIZE));
    if (error) throw error;
    for (const row of data || []) tenantEmailById.set(row.id, row.email);
  }

  let reconciled = 0;
  let skippedAtDetection = 0;
  for (const payment of eligible) {
    if (existingIds.has(payment.id)) continue;
    const row = buildTenantReceiptDeliveryRow({
      payment,
      tenantEmail: tenantEmailById.get(payment.tenant_id),
      sendingEnabled: config.enabled,
      ownerAllowed: true,
      tenantAllowed: true,
    });
    if (row.status === "skipped_disabled") skippedAtDetection += 1;
    else reconciled += 1;
    if (!dryRun) {
      const { error } = await db.from("rental_tenant_receipt_deliveries").upsert(row, {
        onConflict: "owner_id,payment_id",
      });
      if (error) throw error;
    }
  }
  return { reconciled, skippedAtDetection };
}

async function loadDeliveryCandidates(db, config) {
  const candidates = await fetchAllPages((page) =>
    db
      .from("rental_tenant_receipt_deliveries")
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
    .from("rental_tenant_receipt_deliveries")
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
  query = row.last_attempted_at == null ? query.is("last_attempted_at", null) : query.eq("last_attempted_at", row.last_attempted_at);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return data?.length === 1 ? claimToken : null;
}

async function recordOutcome(db, row, outcome, claimToken) {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("rental_tenant_receipt_deliveries")
    .update({
      status: outcome.status,
      claim_token: null,
      provider_message_id: outcome.providerMessageId ?? null,
      failure_reason: outcome.failureReason ?? null,
      last_attempted_at: now,
      sent_at: outcome.status === "sent" ? now : row.sent_at,
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
    .from("rental_tenant_receipt_deliveries")
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

// Email facts re-resolved at send time so the email reflects current data, not
// the detection-time snapshot.
async function resolveReceiptFacts(db, row) {
  const [paymentResult, tenantResult] = await Promise.all([
    db
      .from("rental_payments")
      .select("amount_cents,succeeded_at,provider_payment_id,lease_id")
      .eq("owner_id", row.owner_id)
      .eq("id", row.payment_id)
      .maybeSingle(),
    db
      .from("rental_tenants")
      .select("display_name,email")
      .eq("id", row.tenant_id)
      .maybeSingle(),
  ]);
  if (paymentResult.error) throw paymentResult.error;
  if (tenantResult.error) throw tenantResult.error;
  const payment = paymentResult.data;
  if (!payment) return null;
  const propertyLabel = await resolvePropertyLabel(db, {
    ownerId: row.owner_id,
    leaseId: payment.lease_id || row.lease_id,
  });
  return {
    tenantName: tenantResult.data?.display_name,
    tenantEmail: tenantResult.data?.email,
    amountCents: payment.amount_cents,
    propertyLabel,
    occurredAt: payment.succeeded_at,
    transactionRef: payment.provider_payment_id,
  };
}

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";
  const config = resolveRentalNotificationConfig();

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

        if (!isOwnerNotificationAllowed(config, row.owner_id) || !isTenantNotificationAllowed(config, row.tenant_id)) {
          // Belt-and-braces: a row queued before the allow-lists existed (or for an
          // owner/tenant since removed from them) can never be delivered. Terminally
          // marked, not retried.
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
        const recipient = facts.tenantEmail || row.recipient_email;
        const email = buildTenantReceiptEmail(facts);

        if (!config.enabled) {
          console.log("Tenant payment receipt (sending disabled) would send", {
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
            id: row.idempotency_key || buildTenantReceiptProviderIdempotencyKey(row.id),
            senderName: "FORGE Rental Manager",
            senderEmail: config.senderEmail,
            recipient,
            subject: email.subject,
            bodyText: email.bodyText,
          });
          if (await recordOutcome(db, row, { status: "sent", providerMessageId: result.messageId }, claimToken))
            sent += 1;
        } catch (deliveryError) {
          console.error("Tenant payment receipt delivery failed", {
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
    console.error("Tenant payment receipt cron error", error);
    return NextResponse.json({ error: "Unable to run tenant payment receipts." }, { status: 500 });
  }
}
