import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { AUTOPAY_COLLECTIBLE_CHARGE_TYPES } from "@/application/rental/tenantCharges";
import { resolveOwnerNotificationConfig } from "@/domains/owner-notifications/ownerNotificationConfig";
import {
  OWNER_NOTIFICATION_EVENT_TYPE,
  addDaysISODate,
  buildNotificationId,
  buildOwnerNotificationEmail,
  buildProviderIdempotencyKey,
  computeUpcomingAutopayCandidate,
} from "@/domains/owner-notifications/ownerPaymentNotifications";

export const runtime = "nodejs";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
// CRON_SECRET is set in the project env — see vercel.json for the schedule.
//
// Brandy's owner payment notifications. Two jobs in one run:
//   1. Detect upcoming autopay runs (charges due in exactly
//      UPCOMING_AUTOPAY_LEAD_DAYS days on active autopay enrollments) and
//      queue a notification per (enrollment, charge, due date).
//   2. Deliver queued notifications: claim each row BEFORE the provider call
//      (the row is the distributed claim), then either send via Resend when
//      sending is enabled, or log what WOULD have been sent and mark the row
//      skipped_disabled when it is not.
//
// Terminal payment events (manual payment received, autopay completed,
// failed/bounced) are queued in real time by the Stripe webhook hook
// (queueOwnerPaymentNotificationForWebhookEvent); this cron only delivers
// them. The dedup key makes every queue insertion idempotent, so webhook
// redeliveries and overlapping cron runs can never double-notify.

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

async function loadUpcomingAutopayPairs(db, providerMode, asOfDate, leadDays) {
  const targetDate = addDaysISODate(asOfDate, leadDays);
  const [{ data: enrollments, error: enrollmentError }, { data: charges, error: chargeError }] = await Promise.all([
    db.from("rental_autopay_enrollments").select("id, owner_id, lease_id")
      .eq("status", "active").eq("provider_mode", providerMode),
    // Automatic collection is fenced to rent/proration/late_fee: ad-hoc
    // charge types are payable voluntarily through the portal but never
    // swept by autopay, so they never produce an upcoming-autopay notice.
    db.from("rent_charges")
      .select("id, owner_id, lease_id, due_date, amount_cents, paid_amount_cents, status, charge_type")
      .eq("due_date", targetDate)
      .in("charge_type", AUTOPAY_COLLECTIBLE_CHARGE_TYPES),
  ]);
  if (enrollmentError) throw enrollmentError;
  if (chargeError) throw chargeError;

  const chargesByOwnerLease = new Map();
  for (const charge of charges || []) {
    const candidate = computeUpcomingAutopayCandidate({
      charge: {
        status: charge.status,
        amountCents: charge.amount_cents,
        paidAmountCents: charge.paid_amount_cents ?? 0,
        dueDate: charge.due_date,
      },
      asOfDate,
      leadDays,
    });
    if (!candidate.eligible) continue;
    const key = `${charge.owner_id}:${charge.lease_id}`;
    if (!chargesByOwnerLease.has(key)) chargesByOwnerLease.set(key, []);
    chargesByOwnerLease.get(key).push({ charge, remainingCents: candidate.remainingCents });
  }

  const pairs = [];
  for (const enrollment of enrollments || []) {
    for (const { charge, remainingCents } of chargesByOwnerLease.get(`${enrollment.owner_id}:${enrollment.lease_id}`) || []) {
      pairs.push({ enrollment, charge, remainingCents });
    }
  }
  if (pairs.length === 0) return [];

  const leaseIds = [...new Set(pairs.map((pair) => pair.enrollment.lease_id))];
  const { data: leaseTenants, error: tenantError } = await db.from("rental_lease_tenants")
    .select("lease_id, rental_tenants!inner(id, display_name)")
    .in("lease_id", leaseIds);
  if (tenantError) throw tenantError;
  const tenantNameByLease = new Map();
  for (const row of leaseTenants || []) {
    if (!tenantNameByLease.has(row.lease_id)) tenantNameByLease.set(row.lease_id, row.rental_tenants?.display_name ?? null);
  }
  return pairs.map((pair) => ({
    ...pair,
    tenantName: tenantNameByLease.get(pair.enrollment.lease_id) ?? null,
  }));
}

async function queueUpcomingNotifications(db, pairs, asOfDate) {
  let queued = 0, alreadyQueued = 0;
  for (const pair of pairs) {
    const notificationId = buildNotificationId({
      ownerId: pair.enrollment.owner_id,
      eventType: OWNER_NOTIFICATION_EVENT_TYPE.UPCOMING_AUTOPAY,
      subjectId: `${pair.enrollment.id}_${pair.charge.id}_${pair.charge.due_date}`,
    });
    const { data, error } = await db.from("rental_owner_notifications").upsert({
      owner_id: pair.enrollment.owner_id,
      id: notificationId,
      event_type: OWNER_NOTIFICATION_EVENT_TYPE.UPCOMING_AUTOPAY,
      charge_id: pair.charge.id,
      lease_id: pair.enrollment.lease_id,
      payload: {
        tenant_name: pair.tenantName,
        amount_cents: pair.remainingCents,
        due_date: pair.charge.due_date,
        charge_type: pair.charge.charge_type,
        is_autopay: true,
        enrollment_id: pair.enrollment.id,
        detected_at: asOfDate,
      },
      status: "queued",
    }, { onConflict: "owner_id,id", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    if (data?.length === 1) queued += 1;
    else alreadyQueued += 1;
  }
  return { queued, alreadyQueued };
}

// Delivery candidates: fresh queue rows, failed rows under the attempt cap,
// and stale 'sending' rows whose claimant crashed.
async function loadDeliveryCandidates(db, config) {
  const { data, error } = await db.from("rental_owner_notifications")
    .select("*").in("status", ["queued", "failed", "sending"]).order("created_at", { ascending: true });
  if (error) throw error;
  const staleCutoff = Date.now() - config.staleClaimMinutes * 60 * 1000;
  return (data || []).filter((row) => {
    if (row.status === "queued") return true;
    if (row.status === "failed") return row.attempt_count < config.maxAttempts;
    if (row.status === "sending") {
      return row.attempt_count < config.maxAttempts
        && row.last_attempted_at && new Date(row.last_attempted_at).getTime() < staleCutoff;
    }
    return false;
  });
}

// Claim-before-send: only the run that flips queued/failed/stale-sending to
// 'sending' may deliver. The status predicate is the concurrency guard — the
// loser of a race matches zero rows.
async function claimRow(db, row) {
  const now = new Date().toISOString();
  const { data, error } = await db.from("rental_owner_notifications")
    .update({
      status: "sending",
      attempt_count: row.attempt_count + 1,
      first_attempted_at: row.first_attempted_at || now,
      last_attempted_at: now,
      failure_reason: null,
    })
    .eq("owner_id", row.owner_id).eq("id", row.id).eq("status", row.status)
    .select("id");
  if (error) throw error;
  return data?.length === 1;
}

async function recordOutcome(db, row, outcome) {
  const now = new Date().toISOString();
  const { error } = await db.from("rental_owner_notifications").update({
    status: outcome.status,
    provider_message_id: outcome.providerMessageId ?? null,
    failure_reason: outcome.failureReason ?? null,
    last_attempted_at: now,
    sent_at: outcome.status === "sent" ? now : null,
  }).eq("owner_id", row.owner_id).eq("id", row.id);
  if (error) throw error;
}

// Live recheck for the upcoming-autopay notice: a payment landing between
// detection and delivery suppresses the email outright.
async function upcomingChargeStillOwed(db, row) {
  if (!row.charge_id) return { owed: true };
  const { data: charge, error } = await db.from("rent_charges")
    .select("status, amount_cents, paid_amount_cents")
    .eq("owner_id", row.owner_id).eq("id", row.charge_id).maybeSingle();
  if (error) throw error;
  if (!charge) return { owed: false, reason: "charge_gone" };
  const remaining = (charge.amount_cents ?? 0) - (charge.paid_amount_cents ?? 0);
  if (remaining <= 0) return { owed: false, reason: "charge_satisfied" };
  return { owed: true, remainingCents: remaining };
}

function factsFromPayload(payload = {}) {
  return {
    tenantName: payload.tenant_name,
    amountCents: payload.amount_cents,
    dueDate: payload.due_date,
    chargeType: payload.charge_type,
    failureCode: payload.failure_code,
    isAutopay: payload.is_autopay,
  };
}

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";
  const config = resolveOwnerNotificationConfig();
  try {
    const db = createRentalWebhookClient();
    const provider = createStripeBillingProvider();
    const asOfDate = todayISODate();

    // 1. Detect upcoming autopay runs.
    const pairs = await loadUpcomingAutopayPairs(db, provider.mode, asOfDate, config.upcomingLeadDays);
    let queued = 0, alreadyQueued = 0;
    if (!dryRun) ({ queued, alreadyQueued } = await queueUpcomingNotifications(db, pairs, asOfDate));

    // 2. Deliver.
    let sent = 0, failed = 0, skippedDisabled = 0, superseded = 0, wouldSend = 0;
    if (!dryRun) {
      const candidates = await loadDeliveryCandidates(db, config);
      for (const row of candidates) {
        const claimed = await claimRow(db, row);
        if (!claimed) continue;
        if (row.event_type === OWNER_NOTIFICATION_EVENT_TYPE.UPCOMING_AUTOPAY) {
          const live = await upcomingChargeStillOwed(db, row);
          if (!live.owed) {
            await recordOutcome(db, row, { status: "superseded" });
            superseded += 1;
            continue;
          }
        }
        const email = buildOwnerNotificationEmail({ eventType: row.event_type, facts: factsFromPayload(row.payload) });
        if (!config.enabled) {
          // Sending is off: log exactly what would have been sent. The row
          // is terminal — it is the audit log, never retried.
          console.log("Owner payment notification (sending disabled) would send", {
            to: config.recipientEmail,
            subject: email.subject,
            bodyText: email.bodyText,
          });
          await recordOutcome(db, row, { status: "skipped_disabled" });
          skippedDisabled += 1;
          wouldSend += 1;
          continue;
        }
        try {
          const result = await createResendRentalEmailProvider().send({
            id: buildProviderIdempotencyKey(row.id),
            senderName: config.senderName,
            senderEmail: config.senderEmail,
            recipient: config.recipientEmail,
            subject: email.subject,
            bodyText: email.bodyText,
          });
          await recordOutcome(db, row, { status: "sent", providerMessageId: result.messageId });
          sent += 1;
        } catch (deliveryError) {
          console.error("Owner payment notification delivery failed", {
            notificationId: row.id, eventType: row.event_type, name: deliveryError?.name || "Error",
          });
          await recordOutcome(db, row, {
            status: "failed",
            failureReason: deliveryError?.message?.slice(0, 500) || "unknown",
          });
          failed += 1;
        }
      }
    }

    return NextResponse.json({
      success: true, dryRun, asOfDate,
      sendingEnabled: config.enabled,
      upcomingDetected: pairs.length, queued, alreadyQueued,
      sent, wouldSend, failed, skippedDisabled, superseded,
    });
  } catch (error) {
    console.error("Owner payment notification cron error", error);
    return NextResponse.json({ error: "Unable to run owner payment notifications." }, { status: 500 });
  }
}
