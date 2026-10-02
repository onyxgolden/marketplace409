import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { AUTOPAY_COLLECTIBLE_CHARGE_TYPES } from "@/application/rental/tenantCharges";
import { resolveRentalNotificationConfig, isOwnerNotificationAllowed, isTenantNotificationAllowed } from "@/domains/owner-notifications/ownerNotificationConfig";
import {
  buildTerminalNotificationFacts,
  buildTerminalPaymentNotificationRow,
  resolvePropertyLabel,
} from "@/application/rental/queueOwnerPaymentNotification";
import {
  OWNER_NOTIFICATION_EVENT_TYPE,
  UPCOMING_CHARGE_STATUSES,
  addDaysISODate,
  buildNotificationId,
  buildOwnerNotificationEmail,
  buildProviderIdempotencyKey,
  computeUpcomingAutopayCandidate,
  isQuietHours,
  resolvePaymentNotificationEvent,
} from "@/domains/owner-notifications/ownerPaymentNotifications";

export const runtime = "nodejs";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
// CRON_SECRET is set in the project env — see vercel.json for the schedule.
//
// Brandy's owner payment notifications. Three jobs in one run:
//   1. Detect upcoming autopay runs (charges due in exactly
//      UPCOMING_AUTOPAY_LEAD_DAYS days on active autopay enrollments) and
//      queue a notification per (enrollment, charge, due date). The queue
//      write is the detection-time disposition: 'queued' when sending is on,
//      terminal 'skipped_disabled' when it is off — a disabled-at-detection
//      event can never be delivered later.
//   2. Reconcile terminal Stripe payments (succeeded/failed) from the last
//      few days, plus initiated autopay debits via the durable initiated_at
//      marker: any payment without its notification row gets one queued.
//      This is the durable healing path for webhook queue writes that were
//      caught and swallowed to protect webhook processing.
//   3. Deliver queued notifications: claim each row BEFORE the provider call
//      with a unique claim token (the claim is the distributed lock), then
//      either send via Resend when sending is enabled, or log what WOULD
//      have been sent and mark the row skipped_disabled when it is not.
//      Quiet hours (23:00-07:00 America/Chicago, Jason's rule): delivery
//      inside the window is deferred wholesale — rows stay queued for the
//      next run after 07:00. The window is checked before the run, rechecked
//      before every claim, and checked a final time immediately before the
//      provider call; a claim interrupted by the final gate is released
//      back to 'queued' without burning a retry attempt.
//
// Terminal payment events are ALSO queued in real time by the Stripe webhook
// hook (queueOwnerPaymentNotificationForWebhookEvent); the reconciler is the
// backstop. The dedup key makes every queue insertion idempotent, so webhook
// redeliveries, reconciliations, and overlapping cron runs can never
// double-notify.

// PostgREST caps a single response at 1000 rows: every scan pages so
// eligible rows can never be silently omitted.
const QUERY_PAGE_SIZE = 1000;
// PostgREST .in() lists stay small: batch large id sets into chunks.
const ID_CHUNK_SIZE = 500;
// How far back the terminal-payment reconciler looks for un-notified
// payments. Covers webhook queue outages within the window.
const TERMINAL_PAYMENT_LOOKBACK_DAYS = 3;

function pageRange(page) {
  return [page * QUERY_PAGE_SIZE, (page + 1) * QUERY_PAGE_SIZE - 1];
}

function chunkArray(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

// Fetches every page of a PostgREST query: the last page is the one that
// returns fewer rows than the page size.
async function fetchAllPages(fetchPage) {
  const rows = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await fetchPage(page);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < QUERY_PAGE_SIZE) break;
  }
  return rows;
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function logWouldSendDisabled(config, eventType, facts) {
  const email = buildOwnerNotificationEmail({ eventType, facts });
  console.log("Owner payment notification (sending disabled) would send", {
    to: config.recipientEmail,
    subject: email.subject,
    bodyText: email.bodyText,
  });
}

async function loadUpcomingAutopayPairs(db, providerMode, asOfDate, leadDays) {
  const targetDate = addDaysISODate(asOfDate, leadDays);
  const [enrollments, charges] = await Promise.all([
    fetchAllPages((page) =>
      db.from("rental_autopay_enrollments").select("id, owner_id, lease_id")
        .eq("status", "active").eq("provider_mode", providerMode)
        .order("id", { ascending: true })
        .range(...pageRange(page)),
    ),
    fetchAllPages((page) =>
      // Automatic collection is fenced to rent/proration/late_fee: ad-hoc
      // charge types are payable voluntarily through the portal but never
      // swept by autopay, so they never produce an upcoming-autopay notice.
      db.from("rent_charges")
        .select("id, owner_id, lease_id, due_date, amount_cents, paid_amount_cents, status, charge_type")
        .eq("due_date", targetDate)
        .in("charge_type", AUTOPAY_COLLECTIBLE_CHARGE_TYPES)
        .order("id", { ascending: true })
        .range(...pageRange(page)),
    ),
  ]);

  const chargesByOwnerLease = new Map();
  for (const charge of charges) {
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
  for (const enrollment of enrollments) {
    for (const { charge, remainingCents } of chargesByOwnerLease.get(`${enrollment.owner_id}:${enrollment.lease_id}`) || []) {
      pairs.push({ enrollment, charge, remainingCents });
    }
  }
  if (pairs.length === 0) return [];

  const tenantNameByLease = new Map();
  const tenantIdByLease = new Map();
  const leaseIds = [...new Set(pairs.map((pair) => pair.enrollment.lease_id))];
  for (const chunk of chunkArray(leaseIds, ID_CHUNK_SIZE)) {
    const { data: leaseTenants, error: tenantError } = await db.from("rental_lease_tenants")
      .select("lease_id, rental_tenants!inner(id, display_name)")
      .in("lease_id", chunk);
    if (tenantError) throw tenantError;
    for (const row of leaseTenants || []) {
      if (!tenantNameByLease.has(row.lease_id)) tenantNameByLease.set(row.lease_id, row.rental_tenants?.display_name ?? null);
      if (!tenantIdByLease.has(row.lease_id) && row.rental_tenants?.id) tenantIdByLease.set(row.lease_id, row.rental_tenants.id);
    }
  }
  return pairs.map((pair) => ({
    ...pair,
    tenantName: tenantNameByLease.get(pair.enrollment.lease_id) ?? null,
    tenantId: tenantIdByLease.get(pair.enrollment.lease_id) ?? null,
  }));
}

async function queueUpcomingNotifications(db, pairs, asOfDate, config) {
  let queued = 0, alreadyQueued = 0, skippedAtDetection = 0, skippedNotAllowlisted = 0;
  for (const pair of pairs) {
    // Owner allow-list: fail closed — nothing is written for an owner who
    // is not explicitly allow-listed.
    if (!isOwnerNotificationAllowed(config, pair.enrollment.owner_id)) {
      skippedNotAllowlisted += 1;
      continue;
    }
    // Tenant allow-list (recipient-level rollout restriction): fail closed —
    // upcoming-autopay notices go only to explicitly listed tenants.
    if (!isTenantNotificationAllowed(config, pair.tenantId)) {
      skippedNotAllowlisted += 1;
      continue;
    }
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
      tenant_id: pair.tenantId,
      payload: {
        tenant_name: pair.tenantName,
        amount_cents: pair.remainingCents,
        due_date: pair.charge.due_date,
        charge_type: pair.charge.charge_type,
        is_autopay: true,
        enrollment_id: pair.enrollment.id,
        detected_at: asOfDate,
      },
      // Detection-time disposition: a notice detected while sending is off is
      // terminal 'skipped_disabled' — it can never become deliverable later.
      status: config.enabled ? "queued" : "skipped_disabled",
    }, { onConflict: "owner_id,id", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    if ((data || []).length !== 1) {
      alreadyQueued += 1;
      continue;
    }
    if (config.enabled) {
      queued += 1;
    } else {
      skippedAtDetection += 1;
      logWouldSendDisabled(config, OWNER_NOTIFICATION_EVENT_TYPE.UPCOMING_AUTOPAY, {
        tenantName: pair.tenantName,
        amountCents: pair.remainingCents,
        dueDate: pair.charge.due_date,
        chargeType: pair.charge.charge_type,
        isAutopay: true,
      });
    }
  }
  return { queued, alreadyQueued, skippedAtDetection, skippedNotAllowlisted };
}

// Durable reconciler: heals owner payment notifications lost when a webhook
// queue write failed (caught and swallowed to protect webhook processing).
// Two healing passes over ONE payment scan:
//
//   Terminal pass (pre-existing): payments that reached succeeded/failed
//   inside the lookback window — by success/failure transition time, not
//   creation time.
//
//   Initiated pass (ChatGPT NO-GO fix on PR #535): payments whose projection
//   RPC stamped initiated_at on the first payment_intent.processing event.
//   The marker is written in the RPC's own transaction, so it cannot be lost
//   independently of the projection, and it is independent of the mutable
//   status column — so this pass also finds payments that have already
//   advanced to succeeded/failed. Scanning current processing rows alone
//   would miss that case. Initiated is autopay-only: only payments with a
//   matching autopay-attempt row qualify, mirroring the webhook path's
//   resolvePaymentNotificationEvent.
//
// Both passes share the owner/tenant allow-lists, provider mode, activation
// cutoff, and detection-time disabled disposition, and both use the stable
// event-specific notification id — so webhook redeliveries, reconciliations,
// and overlapping cron runs can never double-notify.
//
// Activation cutoff (release-safety): payments whose healed transition (or
// initiation) happened BEFORE the explicit PAYMENT_RECEIPTS_ACTIVATED_AT
// timestamp are never healed — the first post-activation run must not dig up
// old payments and send stale notifications. When the cutoff is unset, the
// reconciler heals nothing (fail-closed).
async function reconcilePaymentNotifications(db, providerMode, config) {
  if (!config.activatedAt) {
    console.log("Owner payment notification reconciler skipped: PAYMENT_RECEIPTS_ACTIVATED_AT is not set.");
    return { reconciled: 0, alreadyQueued: 0, reconciledInitiated: 0, alreadyReconciledInitiated: 0, skippedAtDetection: 0, skippedNotAllowlisted: 0, skippedTenantNotAllowlisted: 0, reconcileSkipped: true };
  }
  const since = new Date(Date.now() - TERMINAL_PAYMENT_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const payments = await fetchAllPages((page) =>
    db.from("rental_payments")
      .select("id, owner_id, charge_id, lease_id, tenant_id, amount_cents, failure_code, status, succeeded_at, initiated_at, updated_at")
      .eq("provider", "stripe")
      .eq("provider_mode", providerMode)
      // Terminal-transition filter, NOT creation time: a Stripe payment created
      // days ago (e.g. delayed ACH) can succeed or fail inside the window, and
      // the reconciler exists to heal exactly those missed terminal
      // notifications. succeeded_at is always set for succeeded rows (DB check
      // constraint); failures stamp updated_at at transition time. Each branch
      // additionally requires the transition at/after the activation cutoff.
      // The initiated branch needs no lookback: initiated_at is durable
      // evidence written by the projection RPC, and the healed payment may
      // have completed arbitrarily long after initiation.
      .or(`and(status.eq.succeeded,succeeded_at.gte.${since},succeeded_at.gte.${config.activatedAt}),and(status.eq.failed,updated_at.gte.${since},updated_at.gte.${config.activatedAt}),and(initiated_at.gte.${config.activatedAt})`)
      .order("updated_at", { ascending: true })
      .range(...pageRange(page)),
  );
  if (payments.length === 0) return { reconciled: 0, alreadyQueued: 0, reconciledInitiated: 0, alreadyReconciledInitiated: 0, skippedAtDetection: 0, skippedNotAllowlisted: 0, skippedTenantNotAllowlisted: 0, reconcileSkipped: false };

  // Owner allow-list: fail closed — payments for non-allow-listed owners are
  // never turned into notifications.
  const allowlisted = payments.filter((payment) =>
    isOwnerNotificationAllowed(config, payment.owner_id),
  );
  const skippedNotAllowlisted = payments.length - allowlisted.length;

  // Tenant allow-list (recipient-level rollout restriction, Jason's
  // 2026-09-29 instruction): fail closed — only explicitly listed tenants
  // (initial rollout: Eric Carrillo, 308 Paula) generate notifications.
  const tenantAllowlisted = allowlisted.filter((payment) =>
    isTenantNotificationAllowed(config, payment.tenant_id),
  );
  const skippedTenantNotAllowlisted = allowlisted.length - tenantAllowlisted.length;
  if (tenantAllowlisted.length === 0) {
    return { reconciled: 0, alreadyQueued: 0, reconciledInitiated: 0, alreadyReconciledInitiated: 0, skippedAtDetection: 0, skippedNotAllowlisted, skippedTenantNotAllowlisted, reconcileSkipped: false };
  }

  const attemptPaymentIds = new Set();
  for (const chunk of chunkArray(tenantAllowlisted.map((payment) => payment.id), ID_CHUNK_SIZE)) {
    const { data, error } = await db.from("rental_autopay_attempts")
      .select("payment_id").in("payment_id", chunk);
    if (error) throw error;
    for (const row of data || []) attemptPaymentIds.add(row.payment_id);
  }

  const tenantNameById = new Map();
  const tenantIds = [...new Set(tenantAllowlisted.map((payment) => payment.tenant_id).filter(Boolean))];
  for (const chunk of chunkArray(tenantIds, ID_CHUNK_SIZE)) {
    const { data, error } = await db.from("rental_tenants")
      .select("id, display_name").in("id", chunk);
    if (error) throw error;
    for (const row of data || []) {
      if (row.display_name) tenantNameById.set(row.id, row.display_name);
    }
  }

  // Property labels, resolved once per lease for the batch.
  const propertyLabelByLease = new Map();
  const leaseKeys = [...new Set(tenantAllowlisted.map((payment) => `${payment.owner_id}:${payment.lease_id}`).filter((key) => !key.endsWith(":null") && !key.endsWith(":undefined")))];
  for (const key of leaseKeys) {
    const [ownerId, leaseId] = key.split(":");
    const label = await resolvePropertyLabel(db, { ownerId, leaseId });
    if (label) propertyLabelByLease.set(key, label);
  }

  const buildRow = (payment, eventType, stripeEventType, occurredAt, isAutopay) =>
    buildTerminalPaymentNotificationRow({
      payment,
      tenantName: tenantNameById.get(payment.tenant_id) ?? null,
      propertyLabel: propertyLabelByLease.get(`${payment.owner_id}:${payment.lease_id}`) ?? null,
      eventType,
      isAutopay,
      stripeEventType,
      occurredAt,
      sendingEnabled: config.enabled,
    });

  // Terminal pass: only payments in a terminal state. The scan's OR filter
  // can now also return processing payments (via the initiated branch), so
  // the status partition here is load-bearing, not redundant.
  const terminalRows = tenantAllowlisted
    .filter((payment) => payment.status === "succeeded" || payment.status === "failed")
    .map((payment) => {
      const hasAutopayAttempt = attemptPaymentIds.has(payment.id);
      return buildRow(
        payment,
        resolvePaymentNotificationEvent({
          stripeOutcome: payment.status === "failed" ? "failed" : "succeeded",
          hasAutopayAttempt,
        }),
        payment.status === "failed" ? "payment_intent.payment_failed" : "payment_intent.succeeded",
        payment.succeeded_at || payment.updated_at,
        hasAutopayAttempt,
      );
    });

  // Initiated pass: durable initiated_at marker, autopay-only, any current
  // status — including payments that already completed. The DB filter already
  // requires initiated_at at/after the activation cutoff; the Date comparison
  // below is belt-and-braces against driver timestamp formatting.
  const activationMs = new Date(config.activatedAt).getTime();
  const initiatedRows = tenantAllowlisted
    .filter((payment) => {
      if (!payment.initiated_at || !attemptPaymentIds.has(payment.id)) return false;
      const initiatedMs = new Date(payment.initiated_at).getTime();
      return Number.isFinite(initiatedMs) && initiatedMs >= activationMs;
    })
    .map((payment) => buildRow(
      payment,
      resolvePaymentNotificationEvent({ stripeOutcome: "initiated", hasAutopayAttempt: true }),
      "payment_intent.processing",
      payment.initiated_at,
      true,
    ))
    // The resolver returns null only if the autopay-only rule ever changes;
    // a null row must never reach the outbox.
    .filter(Boolean);

  const rows = [...terminalRows, ...initiatedRows];
  const initiatedIds = new Set(initiatedRows.map((row) => row.id));

  const existingIds = new Set();
  for (const chunk of chunkArray(rows.map((row) => row.id), ID_CHUNK_SIZE)) {
    const { data, error } = await db.from("rental_owner_notifications")
      .select("id").in("id", chunk);
    if (error) throw error;
    for (const row of data || []) existingIds.add(row.id);
  }
  const missing = rows.filter((row) => !existingIds.has(row.id));
  const missingInitiated = missing.filter((row) => initiatedIds.has(row.id));
  const missingTerminal = missing.length - missingInitiated.length;
  if (missing.length === 0) return { reconciled: 0, alreadyQueued: terminalRows.length, reconciledInitiated: 0, alreadyReconciledInitiated: initiatedRows.length, skippedAtDetection: 0, skippedNotAllowlisted, skippedTenantNotAllowlisted, reconcileSkipped: false };

  let reconciled = 0, reconciledInitiated = 0, skippedAtDetection = 0;
  for (const chunk of chunkArray(missing, ID_CHUNK_SIZE)) {
    const { data, error } = await db.from("rental_owner_notifications")
      .upsert(chunk, { onConflict: "owner_id,id", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    const insertedIds = new Set((data || []).map((row) => row.id));
    for (const row of chunk) {
      if (!insertedIds.has(row.id)) continue;
      if (row.status === "queued") {
        if (initiatedIds.has(row.id)) reconciledInitiated += 1;
        else reconciled += 1;
      } else {
        skippedAtDetection += 1;
        logWouldSendDisabled(config, row.event_type, buildTerminalNotificationFacts(row.payload));
      }
    }
  }
  return { reconciled, alreadyQueued: terminalRows.length - missingTerminal, reconciledInitiated, alreadyReconciledInitiated: initiatedRows.length - missingInitiated.length, skippedAtDetection, skippedNotAllowlisted, skippedTenantNotAllowlisted, reconcileSkipped: false };
}

// Delivery candidates: fresh queue rows, failed rows under the attempt cap,
// and stale 'sending' rows whose claimant crashed.
async function loadDeliveryCandidates(db, config) {
  const candidates = await fetchAllPages((page) =>
    db.from("rental_owner_notifications")
      .select("*").in("status", ["queued", "failed", "sending"])
      .order("created_at", { ascending: true })
      .range(...pageRange(page)),
  );
  const staleCutoff = Date.now() - config.staleClaimMinutes * 60 * 1000;
  return candidates.filter((row) => {
    if (row.status === "queued") return true;
    if (row.status === "failed") return row.attempt_count < config.maxAttempts;
    if (row.status === "sending") {
      return row.attempt_count < config.maxAttempts
        && row.last_attempted_at && new Date(row.last_attempted_at).getTime() < staleCutoff;
    }
    return false;
  });
}

// Claim-before-send: the run writes a unique claim token while atomically
// flipping the row to 'sending'. The predicate (owner, id, status,
// attempt_count, last_attempted_at) is the concurrency guard — two workers
// racing on the same stale row can only match the same pre-claim state once,
// so the loser matches zero rows. Returns the token for the winner, or null
// for the loser.
async function claimRow(db, row) {
  const now = new Date().toISOString();
  const claimToken = `claim_${randomUUID()}`;
  let query = db.from("rental_owner_notifications")
    .update({
      status: "sending",
      claim_token: claimToken,
      attempt_count: row.attempt_count + 1,
      first_attempted_at: row.first_attempted_at || now,
      last_attempted_at: now,
      failure_reason: null,
    })
    .eq("owner_id", row.owner_id).eq("id", row.id).eq("status", row.status)
    .eq("attempt_count", row.attempt_count);
  // NULL never equals NULL in SQL: a queued row's untouched
  // last_attempted_at needs IS NULL, not = NULL.
  query = row.last_attempted_at == null
    ? query.is("last_attempted_at", null)
    : query.eq("last_attempted_at", row.last_attempted_at);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return data?.length === 1 ? claimToken : null;
}

// Fenced outcome: the update only lands when the row still carries this
// run's claim token. A slow worker whose row was reclaimed can never
// overwrite the newer worker's outcome; the token clears with the outcome.
async function recordOutcome(db, row, outcome, claimToken) {
  const now = new Date().toISOString();
  const { data, error } = await db.from("rental_owner_notifications").update({
    status: outcome.status,
    claim_token: null,
    provider_message_id: outcome.providerMessageId ?? null,
    failure_reason: outcome.failureReason ?? null,
    last_attempted_at: now,
    sent_at: outcome.status === "sent" ? now : null,
  }).eq("owner_id", row.owner_id).eq("id", row.id).eq("claim_token", claimToken)
    .select("id");
  if (error) throw error;
  return data?.length === 1;
}

// Quiet-hours release: returns a claimed row to 'queued' as if the claim
// never happened — status, claim token, attempt count, and attempt
// timestamps are all restored to their pre-claim values, so a deferral
// never burns one of the row's retry attempts. Fenced to this run's claim
// token, mirroring recordOutcome: a row reclaimed by a newer worker keeps
// the newer worker's state.
async function releaseClaimToQueue(db, row, claimToken) {
  const { data, error } = await db.from("rental_owner_notifications").update({
    status: "queued",
    claim_token: null,
    attempt_count: row.attempt_count,
    failure_reason: null,
    first_attempted_at: row.first_attempted_at,
    last_attempted_at: row.last_attempted_at,
  }).eq("owner_id", row.owner_id).eq("id", row.id).eq("claim_token", claimToken)
    .select("id");
  if (error) throw error;
  return data?.length === 1;
}

// Live recheck for the upcoming-autopay notice, run after the claim and
// before the provider call. The world may have moved between detection and
// delivery: the charge may be gone, no longer collectible, a different type,
// moved to another due date, or the enrollment may have been deactivated.
// Any of those supersedes the notice outright.
async function upcomingChargeStillOwed(db, row) {
  if (!row.charge_id) return { owed: true };
  const { data: charge, error } = await db.from("rent_charges")
    .select("status, amount_cents, paid_amount_cents, charge_type, due_date")
    .eq("owner_id", row.owner_id).eq("id", row.charge_id).maybeSingle();
  if (error) throw error;
  if (!charge) return { owed: false, reason: "charge_gone" };
  if (!UPCOMING_CHARGE_STATUSES.includes(charge.status)) {
    return { owed: false, reason: "charge_not_collectible" };
  }
  if (!AUTOPAY_COLLECTIBLE_CHARGE_TYPES.includes(charge.charge_type)) {
    return { owed: false, reason: "charge_type_not_collectible" };
  }
  if (row.payload?.due_date && charge.due_date !== row.payload.due_date) {
    return { owed: false, reason: "due_date_changed" };
  }
  const enrollmentId = row.payload?.enrollment_id;
  if (enrollmentId) {
    const { data: enrollment, error: enrollmentError } = await db.from("rental_autopay_enrollments")
      .select("status").eq("owner_id", row.owner_id).eq("id", enrollmentId).maybeSingle();
    if (enrollmentError) throw enrollmentError;
    if (!enrollment || enrollment.status !== "active") {
      return { owed: false, reason: "enrollment_inactive" };
    }
  }
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
  const config = resolveRentalNotificationConfig();
  try {
    const db = createRentalWebhookClient();
    const provider = createStripeBillingProvider();
    const asOfDate = todayISODate();

    // 1. Detect upcoming autopay runs.
    const pairs = await loadUpcomingAutopayPairs(db, provider.mode, asOfDate, config.upcomingLeadDays);
    let queued = 0, alreadyQueued = 0, skippedDisabled = 0, wouldSend = 0, skippedNotAllowlisted = 0;
    if (!dryRun) {
      const detection = await queueUpcomingNotifications(db, pairs, asOfDate, config);
      queued = detection.queued;
      alreadyQueued = detection.alreadyQueued;
      skippedDisabled += detection.skippedAtDetection;
      skippedNotAllowlisted += detection.skippedNotAllowlisted;
      wouldSend += detection.skippedAtDetection;
    }

    // 2. Reconcile terminal + initiated payments the webhook queue may have lost.
    let reconciled = 0, alreadyReconciled = 0, reconciledInitiated = 0, alreadyReconciledInitiated = 0, skippedTenantNotAllowlistedReconciled = 0, reconcileSkipped = false;
    if (!dryRun) {
      const healing = await reconcilePaymentNotifications(db, provider.mode, config);
      reconciled = healing.reconciled;
      alreadyReconciled = healing.alreadyQueued;
      reconciledInitiated = healing.reconciledInitiated;
      alreadyReconciledInitiated = healing.alreadyReconciledInitiated;
      reconcileSkipped = Boolean(healing.reconcileSkipped);
      skippedDisabled += healing.skippedAtDetection;
      skippedNotAllowlisted += healing.skippedNotAllowlisted;
      skippedTenantNotAllowlistedReconciled = healing.skippedTenantNotAllowlisted;
      wouldSend += healing.skippedAtDetection;
    }

    // 3. Deliver.
    // Quiet hours (Jason's rule): between 23:00 and 07:00 America/Chicago no
    // email goes out. The window is checked once up front AND rechecked
    // before every single email: a run that starts at 22:59 but runs past
    // 23:00 must stop. The recheck sits before the claim, so the quiet path
    // never leaves a row claimed-but-unsent — unclaimed rows stay 'queued'
    // for the next run after 07:00.
    const quietNow = () => isQuietHours({
      at: new Date(),
      startHour: config.quietStartHour,
      endHour: config.quietEndHour,
      timeZone: config.quietTimeZone,
    });
    const logQuietDeferral = (deferred) => {
      if (deferred > 0) {
        console.log("Owner payment notification delivery deferred by quiet hours", {
          deferred,
          timeZone: config.quietTimeZone,
          window: `${config.quietStartHour}:00-${config.quietEndHour}:00`,
        });
      }
    };
    let sent = 0, failed = 0, superseded = 0, skippedNotAllowlistedDelivery = 0, deferredQuietHours = 0;
    if (!dryRun) {
      const candidates = await loadDeliveryCandidates(db, config);
      if (quietNow()) {
        deferredQuietHours = candidates.length;
        logQuietDeferral(deferredQuietHours);
      } else {
      for (const [index, row] of candidates.entries()) {
        if (quietNow()) {
          // The window opened mid-run: stop here. This row and the rest
          // were never claimed, so they remain safely queued.
          deferredQuietHours = candidates.length - index;
          logQuietDeferral(deferredQuietHours);
          break;
        }
        const claimToken = await claimRow(db, row);
        if (!claimToken) continue;
        if (!isOwnerNotificationAllowed(config, row.owner_id)) {
          // Belt-and-braces: a row queued before the allow-list existed (or
          // for an owner since removed from it) can never be delivered.
          // Terminally marked so it is not retried.
          if (await recordOutcome(db, row, { status: "skipped_not_allowlisted" }, claimToken)) {
            skippedNotAllowlistedDelivery += 1;
          }
          continue;
        }
        if (!isTenantNotificationAllowed(config, row.tenant_id)) {
          // Belt-and-braces: a row queued for a tenant who is not (or is no
          // longer) on the tenant allow-list can never be delivered.
          // Terminally marked so it is not retried. Fail-closed: a row with
          // no recorded tenant cannot be verified and is never sent.
          if (await recordOutcome(db, row, { status: "skipped_not_allowlisted" }, claimToken)) {
            skippedNotAllowlistedDelivery += 1;
          }
          continue;
        }
        if (row.event_type === OWNER_NOTIFICATION_EVENT_TYPE.UPCOMING_AUTOPAY) {
          const live = await upcomingChargeStillOwed(db, row);
          if (!live.owed) {
            if (await recordOutcome(db, row, { status: "superseded" }, claimToken)) superseded += 1;
            continue;
          }
        }
        if (!config.enabled) {
          // The flag flipped off after detection: log what would have been
          // sent and terminally mark the row. Never delivered later.
          logWouldSendDisabled(config, row.event_type, factsFromPayload(row.payload));
          if (await recordOutcome(db, row, { status: "skipped_disabled" }, claimToken)) {
            skippedDisabled += 1;
            wouldSend += 1;
          }
          continue;
        }
        const email = buildOwnerNotificationEmail({ eventType: row.event_type, facts: factsFromPayload(row.payload) });
        // Final gate: the clock may have crossed into quiet hours during the
        // claim and the live rechecks above. Check once more immediately
        // before the provider call; on quiet, release the claim back to
        // 'queued' (the attempt is not burned) and stop the run.
        if (quietNow()) {
          await releaseClaimToQueue(db, row, claimToken);
          deferredQuietHours = candidates.length - index;
          logQuietDeferral(deferredQuietHours);
          break;
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
          if (await recordOutcome(db, row, { status: "sent", providerMessageId: result.messageId }, claimToken)) sent += 1;
        } catch (deliveryError) {
          console.error("Owner payment notification delivery failed", {
            notificationId: row.id, eventType: row.event_type, name: deliveryError?.name || "Error",
          });
          if (await recordOutcome(db, row, {
            status: "failed",
            failureReason: deliveryError?.message?.slice(0, 500) || "unknown",
          }, claimToken)) failed += 1;
        }
      }
      }
    }

    return NextResponse.json({
      success: true, dryRun, asOfDate,
      sendingEnabled: config.enabled,
      upcomingDetected: pairs.length, queued, alreadyQueued,
      reconciled, alreadyReconciled,
      reconciledInitiated, alreadyReconciledInitiated,
      reconcileSkipped,
      sent, wouldSend, failed, skippedDisabled, superseded,
      deferredQuietHours,
      skippedNotAllowlisted: skippedNotAllowlisted + skippedNotAllowlistedDelivery,
      skippedTenantNotAllowlisted: skippedTenantNotAllowlistedReconciled,
    });
  } catch (error) {
    console.error("Owner payment notification cron error", error);
    return NextResponse.json({ error: "Unable to run owner payment notifications." }, { status: 500 });
  }
}
