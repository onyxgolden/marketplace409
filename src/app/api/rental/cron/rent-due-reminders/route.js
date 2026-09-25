import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import {
  addDaysISODate, RENT_REMINDER_LEAD_DAYS, buildDeliveryRowId, buildProviderIdempotencyKey,
  REMINDABLE_CHARGE_STATUSES, nextMonthlyDueDateOnOrAfter, evaluateChargeStillOwed,
  buildReminderEmail, buildPortalUrl,
} from "@/domains/rent-reminders/rentDueReminders";
import { planReminderRun } from "@/domains/rent-reminders/rentReminderRunPlanner";
import { mapRentScheduleRow } from "@/domains/rent-schedule";
import { generateRentCharge, mapRentChargeToRow } from "@/domains/rent-charge";

export const runtime = "nodejs";

// A 'sending' delivery row older than this is treated as abandoned (the cron
// invocation that claimed it crashed) and becomes re-claimable.
const STALE_CLAIM_MINUTES = 30;

// A failed delivery is retried at most this many times, matching the manual
// reminder queue's 1-5 attempt convention.
const MAX_DELIVERY_ATTEMPTS = 5;

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// Charge-generation horizon: the seven-day reminder cannot fire for a charge
// that does not exist yet. The generate-charges cron only creates current-
// period charges, so this run idempotently ensures the next charge for every
// FORGE-collected schedule whose due date falls inside the reminder window.
// generateRentCharge() itself enforces the collection gates (active schedule,
// FORGE cutover, effective range), and the upsert is a no-op when the charge
// already exists — this creates timing, not obligations.
//
// options.dryRun: compute which charges would be generated and return them as
// plan-ready hypothetical charges, but perform zero database writes — a dry
// run must never mutate. The hypotheticals let the dry run plan exactly what
// the live run would plan (wouldSend matches), without persisting anything.
async function ensureChargesForReminderWindow(db, asOfDate, { dryRun = false } = {}) {
  const windowEnd = addDaysISODate(asOfDate, RENT_REMINDER_LEAD_DAYS);
  const { data: enabledSettings, error: settingsError } = await db.from("rental_billing_settings")
    .select("owner_id").eq("billing_enabled", true);
  if (settingsError) throw settingsError;
  const enabledOwnerIds = (enabledSettings || []).map((row) => row.owner_id);
  if (enabledOwnerIds.length === 0) return { ensured: 0, hypotheticalCharges: [] };

  const { data: schedules, error: scheduleError } = await db.from("rent_schedules").select("*")
    .eq("status", "active").eq("collection_mode", "forge").in("owner_id", enabledOwnerIds);
  if (scheduleError) throw scheduleError;

  const candidates = [];
  for (const row of schedules || []) {
    try {
      const dueDate = nextMonthlyDueDateOnOrAfter({ dueDay: row.due_day, asOfDate });
      if (!dueDate || dueDate < asOfDate || dueDate > windowEnd) continue;
      const charge = generateRentCharge({ schedule: mapRentScheduleRow(row), period: dueDate.slice(0, 7) });
      if (!charge) continue;
      const sourceKey = mapRentChargeToRow(charge, row.owner_id).source_key;
      candidates.push({ ownerId: row.owner_id, leaseId: row.lease_id, sourceKey, charge, dueDate });
    } catch (scheduleError) {
      console.error("Reminder-window charge ensure failed for schedule", row.id, scheduleError?.message || scheduleError);
    }
  }

  if (!dryRun) {
    for (const candidate of candidates) {
      const { error: upsertError } = await db.from("rent_charges")
        .upsert(mapRentChargeToRow(candidate.charge, candidate.ownerId), { onConflict: "owner_id,source_key", ignoreDuplicates: true });
      if (upsertError) throw upsertError;
    }
    return { ensured: candidates.length, hypotheticalCharges: [] };
  }

  // Dry run: build plan inputs for the charges the live run would generate but
  // which have no row yet (the loader already covers charges that do).
  const { data: existingCharges, error: existingError } = await db.from("rent_charges")
    .select("owner_id, source_key").in("source_key", candidates.map((candidate) => candidate.sourceKey));
  if (existingError) throw existingError;
  const existingKeys = new Set((existingCharges || []).map((charge) => `${charge.owner_id}|${charge.source_key}`));
  const missing = candidates.filter((candidate) => !existingKeys.has(`${candidate.ownerId}|${candidate.sourceKey}`));
  if (missing.length === 0) return { ensured: candidates.length, hypotheticalCharges: [] };

  // Mirror the loader's active-lease gate: the live run would upsert the
  // charge, but the loader would then filter it out of the plan.
  const missingLeaseIds = [...new Set(missing.map((candidate) => candidate.leaseId))];
  const { data: leases, error: leaseError } = await db.from("rental_leases")
    .select("id, status").in("id", missingLeaseIds);
  if (leaseError) throw leaseError;
  const activeLeaseIds = new Set((leases || []).filter((lease) => lease.status === "active").map((lease) => lease.id));
  const eligible = missing.filter((candidate) => activeLeaseIds.has(candidate.leaseId));
  if (eligible.length === 0) return { ensured: candidates.length, hypotheticalCharges: [] };

  const { data: leaseTenants, error: tenantError } = await db.from("rental_lease_tenants")
    .select("lease_id, tenant_id, rental_tenants!inner(id, display_name, email, status)")
    .in("lease_id", [...new Set(eligible.map((candidate) => candidate.leaseId))]);
  if (tenantError) throw tenantError;
  const tenantsByLease = new Map();
  for (const row of leaseTenants || []) {
    const tenant = row.rental_tenants;
    if (!tenant) continue;
    if (!tenantsByLease.has(row.lease_id)) tenantsByLease.set(row.lease_id, []);
    tenantsByLease.get(row.lease_id).push({
      tenantId: tenant.id, email: tenant.email, fullName: tenant.display_name, tenantStatus: tenant.status,
    });
  }

  const hypotheticalCharges = eligible.map((candidate) => ({
    ownerId: candidate.ownerId, chargeId: candidate.charge.id, leaseId: candidate.leaseId,
    dueDate: candidate.dueDate, amountCents: candidate.charge.amountCents,
    paidAmountCents: 0, status: candidate.charge.status,
    tenants: tenantsByLease.get(candidate.leaseId) || [], existingDeliveries: [],
  }));
  return { ensured: candidates.length, hypotheticalCharges };
}

// Loads the charges the reminder window covers: unpaid, due within the next
// RENT_REMINDER_LEAD_DAYS days, on active leases with FORGE-collected rent.
// Each charge carries its lease tenants and prior delivery attempts.
async function loadChargesForReminderRun(db, asOfDate) {
  const windowEnd = addDaysISODate(asOfDate, RENT_REMINDER_LEAD_DAYS);
  const { data: charges, error: chargeError } = await db.from("rent_charges")
    .select("owner_id, id, lease_id, schedule_id, due_date, amount_cents, paid_amount_cents, status")
    .in("status", REMINDABLE_CHARGE_STATUSES)
    .gte("due_date", asOfDate)
    .lte("due_date", windowEnd);
  if (chargeError) throw chargeError;
  if (!charges?.length) return [];

  const leaseIds = [...new Set(charges.map((charge) => charge.lease_id))];
  const scheduleIds = [...new Set(charges.map((charge) => charge.schedule_id).filter(Boolean))];
  const [{ data: leases, error: leaseError }, { data: schedules, error: scheduleError }] = await Promise.all([
    db.from("rental_leases").select("id, status").in("id", leaseIds),
    scheduleIds.length
      ? db.from("rent_schedules").select("id, collection_mode").in("id", scheduleIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (leaseError) throw leaseError;
  if (scheduleError) throw scheduleError;
  const activeLeaseIds = new Set((leases || []).filter((lease) => lease.status === "active").map((lease) => lease.id));
  const forgeScheduleIds = new Set((schedules || []).filter((schedule) => schedule.collection_mode === "forge").map((schedule) => schedule.id));

  // FORGE-collected schedules only: a charge with no schedule (or a schedule
  // not cut over to FORGE) must never trigger a reminder.
  const eligible = charges.filter((charge) =>
    activeLeaseIds.has(charge.lease_id) && charge.schedule_id && forgeScheduleIds.has(charge.schedule_id));
  if (!eligible.length) return [];

  const eligibleLeaseIds = [...new Set(eligible.map((charge) => charge.lease_id))];
  const { data: leaseTenants, error: tenantError } = await db.from("rental_lease_tenants")
    .select("lease_id, tenant_id, rental_tenants!inner(id, display_name, email, status)")
    .in("lease_id", eligibleLeaseIds);
  if (tenantError) throw tenantError;
  const tenantsByLease = new Map();
  for (const row of leaseTenants || []) {
    const tenant = row.rental_tenants;
    if (!tenant) continue;
    if (!tenantsByLease.has(row.lease_id)) tenantsByLease.set(row.lease_id, []);
    tenantsByLease.get(row.lease_id).push({
      tenantId: tenant.id, email: tenant.email, fullName: tenant.display_name, tenantStatus: tenant.status,
    });
  }

  const { data: deliveries, error: deliveryError } = await db.from("rental_rent_reminder_deliveries")
    .select("charge_id, tenant_id, due_date, reminder_type, status, last_attempted_at")
    .in("charge_id", eligible.map((charge) => charge.id));
  if (deliveryError) throw deliveryError;
  const staleCutoff = Date.now() - STALE_CLAIM_MINUTES * 60 * 1000;
  const deliveriesByCharge = new Map();
  for (const delivery of deliveries || []) {
    if (!deliveriesByCharge.has(delivery.charge_id)) deliveriesByCharge.set(delivery.charge_id, []);
    deliveriesByCharge.get(delivery.charge_id).push({
      tenantId: delivery.tenant_id, dueDate: delivery.due_date, reminderType: delivery.reminder_type,
      status: delivery.status,
      staleSending: delivery.status === "sending" && new Date(delivery.last_attempted_at).getTime() < staleCutoff,
    });
  }

  return eligible.map((charge) => ({
    ownerId: charge.owner_id, chargeId: charge.id, leaseId: charge.lease_id,
    dueDate: charge.due_date, amountCents: charge.amount_cents,
    paidAmountCents: charge.paid_amount_cents ?? 0, status: charge.status,
    tenants: tenantsByLease.get(charge.lease_id) || [],
    existingDeliveries: deliveriesByCharge.get(charge.id) || [],
  }));
}

// The delivery row is the distributed claim and it happens BEFORE the provider
// call. Only the invocation that wins the claim may send: a fresh INSERT with
// ON CONFLICT DO NOTHING, a re-claim of a stale 'sending' row, or a retry of a
// 'failed' row under the attempt cap.
async function claimDelivery(db, entry) {
  const rowId = buildDeliveryRowId({
    ownerId: entry.ownerId, chargeId: entry.chargeId, tenantId: entry.tenantId,
    dueDate: entry.dueDate, reminderType: entry.reminderType,
  });
  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await db.from("rental_rent_reminder_deliveries")
    .upsert({
      owner_id: entry.ownerId, id: rowId, charge_id: entry.chargeId, tenant_id: entry.tenantId,
      due_date: entry.dueDate, reminder_type: entry.reminderType, status: "sending",
      attempt_count: 1, last_attempted_at: now,
    }, { onConflict: "owner_id,charge_id,tenant_id,due_date,reminder_type", ignoreDuplicates: true })
    .select("id");
  if (insertError) throw insertError;
  if (inserted?.length === 1) return { claimed: true, rowId, attemptCount: 1 };

  // Another invocation won the race (or a prior attempt exists) — inspect it.
  const { data: existing, error: selectError } = await db.from("rental_rent_reminder_deliveries")
    .select("id, status, attempt_count, last_attempted_at")
    .eq("owner_id", entry.ownerId).eq("charge_id", entry.chargeId).eq("tenant_id", entry.tenantId)
    .eq("due_date", entry.dueDate).eq("reminder_type", entry.reminderType).maybeSingle();
  if (selectError) throw selectError;
  if (!existing) return { claimed: false };
  if (existing.status === "sent") return { claimed: false, alreadySent: true };

  // Retry a failed delivery under the attempt cap. The status and attempt-count
  // predicates are the concurrency guards: the loser of a race finds zero rows.
  if (existing.status === "failed" && existing.attempt_count < MAX_DELIVERY_ATTEMPTS) {
    const { data: retried, error: retryError } = await db.from("rental_rent_reminder_deliveries")
      .update({ status: "sending", attempt_count: existing.attempt_count + 1, last_attempted_at: now, failure_reason: null })
      .eq("owner_id", entry.ownerId).eq("id", existing.id).eq("status", "failed")
      .lt("attempt_count", MAX_DELIVERY_ATTEMPTS)
      .select("id");
    if (retryError) throw retryError;
    if (retried?.length === 1) return { claimed: true, rowId: existing.id, attemptCount: existing.attempt_count + 1 };
    return { claimed: false };
  }

  if (existing.status === "sending") {
    const staleCutoff = Date.now() - STALE_CLAIM_MINUTES * 60 * 1000;
    // Stale claims obey the same attempt cap as failed retries: a delivery
    // that crashed five times is dead, not re-claimable forever.
    if (existing.attempt_count < MAX_DELIVERY_ATTEMPTS && new Date(existing.last_attempted_at).getTime() < staleCutoff) {
      // Both predicates are concurrency guards: the first worker to re-claim
      // bumps last_attempted_at to now AND attempt_count by one, so a racing
      // worker's last_attempted_at < cutoff / attempt_count < cap predicates
      // match zero rows.
      const { data: reclaimed, error: reclaimError } = await db.from("rental_rent_reminder_deliveries")
        .update({ status: "sending", attempt_count: existing.attempt_count + 1, last_attempted_at: now, failure_reason: null })
        .eq("owner_id", entry.ownerId).eq("id", existing.id).eq("status", "sending")
        .lt("last_attempted_at", new Date(staleCutoff).toISOString())
        .lt("attempt_count", MAX_DELIVERY_ATTEMPTS)
        .select("id");
      if (reclaimError) throw reclaimError;
      if (reclaimed?.length === 1) return { claimed: true, rowId: existing.id, attemptCount: existing.attempt_count + 1 };
    }
  }
  return { claimed: false };
}

async function recordDeliveryOutcome(db, rowId, entry, outcome) {
  const { error } = await db.from("rental_rent_reminder_deliveries").update({
    status: outcome.status, provider_message_id: outcome.providerMessageId ?? null,
    failure_reason: outcome.failureReason ?? null, last_attempted_at: new Date().toISOString(),
  }).eq("owner_id", entry.ownerId).eq("id", rowId);
  if (error) throw error;
}

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";
  try {
    const db = createRentalWebhookClient();
    const asOfDate = todayISODate();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://marketplace409.vercel.app";
    const { ensured: chargesEnsured, hypotheticalCharges } = await ensureChargesForReminderWindow(db, asOfDate, { dryRun });
    const charges = [...await loadChargesForReminderRun(db, asOfDate), ...hypotheticalCharges];
    const plan = planReminderRun({ asOfDate, charges, siteUrl });

    let sent = 0, failed = 0, alreadySent = 0, skipped = 0, superseded = 0;
    const wouldSend = plan.filter((entry) => entry.action === "send").length;
    if (!dryRun) {
      const emailProvider = createResendRentalEmailProvider();
      for (const entry of plan) {
        if (entry.action !== "send") continue;
        const claim = await claimDelivery(db, entry);
        if (!claim.claimed) {
          if (claim.alreadySent) alreadySent += 1;
          else skipped += 1;
          continue;
        }
        // Live recheck AFTER the claim, immediately before the provider call: a
        // payment landing between plan and send suppresses the email outright,
        // and a partial payment refreshes the remaining amount in the email.
        const { data: liveCharge, error: liveError } = await db.from("rent_charges")
          .select("status, amount_cents, paid_amount_cents")
          .eq("owner_id", entry.ownerId).eq("id", entry.chargeId).maybeSingle();
        if (liveError) throw liveError;
        const owed = evaluateChargeStillOwed({
          charge: liveCharge && {
            status: liveCharge.status,
            amountCents: liveCharge.amount_cents,
            paidAmountCents: liveCharge.paid_amount_cents,
          },
        });
        if (!owed.owed) {
          await recordDeliveryOutcome(db, claim.rowId, entry, { status: "superseded" });
          superseded += 1;
          continue;
        }
        const rendered = buildReminderEmail({
          tenantName: entry.tenantName, tenantEmail: entry.email, reminderType: entry.reminderType,
          dueDate: entry.dueDate, remainingCents: owed.remainingCents, portalUrl: buildPortalUrl(siteUrl),
          asOfDate,
        });
        try {
          const result = await emailProvider.send({
            id: buildProviderIdempotencyKey({
              chargeId: entry.chargeId, tenantId: entry.tenantId,
              dueDate: entry.dueDate, reminderType: entry.reminderType,
            }),
            senderName: "FORGE Rental Manager",
            senderEmail: process.env.RENTAL_EMAIL_SENDER || "rentals@mail.409marketplace.online",
            recipient: entry.email, subject: rendered.subject, bodyText: rendered.bodyText,
          });
          await recordDeliveryOutcome(db, claim.rowId, entry, { status: "sent", providerMessageId: result.messageId });
          sent += 1;
        } catch (deliveryError) {
          console.error("Rent-due reminder delivery failed", {
            chargeId: entry.chargeId, tenantId: entry.tenantId, reminderType: entry.reminderType,
            code: deliveryError?.name || "unknown",
          });
          await recordDeliveryOutcome(db, claim.rowId, entry, {
            status: "failed", failureReason: deliveryError?.message?.slice(0, 500) || "unknown",
          });
          failed += 1;
        }
      }
    }
    for (const entry of plan) {
      if (entry.action === "already_sent") alreadySent += 1;
      else if (entry.action === "skip") skipped += 1;
    }
    return NextResponse.json({
      success: true, dryRun, asOfDate, chargesEnsured, chargesEvaluated: charges.length,
      sent, wouldSend, failed, alreadySent, skipped, superseded,
    });
  } catch (error) {
    console.error("Rent-due reminder cron error", error);
    return NextResponse.json({ error: "Unable to run rent-due reminders." }, { status: 500 });
  }
}
