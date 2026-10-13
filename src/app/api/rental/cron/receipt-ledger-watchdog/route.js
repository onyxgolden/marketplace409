import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import {
  readLedgerForSlot,
  readAttemptsForSlot,
  authoritativeLatestAttempts,
  chicagoSlotFor,
  SCHEDULE_NAMES,
  SCHEDULE_RUN_TIMES,
  LEDGER_STATES,
  SWEEP_RECIPIENT_ID,
} from "@/application/notifications/scheduledSendLedger";

export const runtime = "nodejs";

// Read-only watchdog for the receipt-delivery confirmation ledger.
//
// For each of the three scheduled-send sweeps (tenant invites 10:00,
// PF payment receipts 11:00, tenant payment receipts 13:00 America/Chicago),
// once the scheduled run time + grace window has passed, this checks the
// ledger's expected-vs-observed state for today's Chicago slot and reports
// alerts. It NEVER refires, retries, or triggers any endpoint --
// read-only by design (agreed condition). Alerting is via the response:
// `failed` counts the alerts, so a scheduler step can fail the run on
// failed > 0 exactly like rental-cron-sweeps.yml does.
//
// Checks per schedule (past grace only):
//   * missing_sweep -- zero ledger rows for (schedule, slot): the sweep did
//     not run, or crashed before writing its first claim. (Every sweep
//     writes at least a '_sweep' no_op row when it runs, so zero rows is
//     unambiguous.)
//   * send_failed -- a ledger row in provider_failed: the provider rejected
//     a send. Includes the failure reason for triage.
//   * stuck_claim -- a row still in claimed older than 2x the grace window:
//     the sweep crashed between claim and outcome.
//   * unrecorded_attempt -- a delivery-table row in sent/failed attempted
//     during the slot whose recipient has no ledger row: the sweep sent
//     without writing confirmation evidence.
//   * delivery_evidence_mismatch -- a delivery-table attempt whose
//     per-delivery ledger attempt evidence is missing or disagrees
//     (RDL-004): a failed individual delivery must not be hidden behind
//     another delivery's success to the same recipient.
// Run markers ('_sweep'): a healthy no_op marker is legitimate run
// evidence and stays silent; a claimed marker older than the stuck cutoff
// alerts stuck_claim (RDL-005) — missing/partial run evidence is not proof
// the sweep completed.
//
// Query params: ?dryRun is not supported -- this endpoint never writes.
// Env: LEDGER_WATCHDOG_GRACE_MINUTES (default 90).
const DEFAULT_GRACE_MINUTES = 90;
const STUCK_CLAIM_GRACE_MULTIPLE = 2;

// Delivery-table cross-check config per schedule. RDL-003: each table gets
// its OWN projection — the columns below are verified against the actual
// migration schemas (see the schema-backed test):
//   * private_financing_payment_receipt_deliveries has borrower_id and
//     recipient_type, but NO tenant_id;
//   * rental_tenant_receipt_deliveries has tenant_id, but NO borrower_id
//     and NO recipient_type.
// Selecting a nonexistent column is a 42703 that used to 500 the whole
// endpoint past grace; the per-table projection fixes it.
export const DELIVERY_TABLES = {
  [SCHEDULE_NAMES.PF_PAYMENT_RECEIPTS]: {
    table: "private_financing_payment_receipt_deliveries",
    columns:
      "id,payment_id,owner_id,borrower_id,recipient_type,status,provider_message_id,failure_reason,last_attempted_at",
    recipientOf: (row) => (row.recipient_type === "owner" ? row.owner_id : row.borrower_id),
  },
  [SCHEDULE_NAMES.TENANT_PAYMENT_RECEIPTS]: {
    table: "rental_tenant_receipt_deliveries",
    columns:
      "id,payment_id,owner_id,tenant_id,status,provider_message_id,failure_reason,last_attempted_at",
    recipientOf: (row) => row.tenant_id,
  },
};

function chicagoOffsetMinutes(instant) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
  const wallAsUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return (wallAsUTC - instant.getTime()) / 60000;
}

// UTC instant of a Chicago wall-clock time on the given slot date.
function chicagoTimeToUTC(slot, hour, minute) {
  const wallAsUTC = Date.parse(
    `${slot}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
  );
  const offsetMin = chicagoOffsetMinutes(new Date(wallAsUTC));
  return new Date(wallAsUTC - offsetMin * 60000);
}

async function evaluateSchedule(db, scheduleName, slot, now, graceMinutes) {
  const alerts = [];
  const runTimeUTC = chicagoTimeToUTC(slot, ...Object.values(SCHEDULE_RUN_TIMES[scheduleName]));
  const graceCutoff = runTimeUTC.getTime() + graceMinutes * 60000;
  if (now.getTime() < graceCutoff) {
    return { evaluated: false, alerts };
  }

  const rows = await readLedgerForSlot(db, { scheduleName, scheduledSlot: slot });
  if (rows.length === 0) {
    alerts.push({
      schedule: scheduleName,
      slot,
      state: "missing_sweep",
      reason: `No ledger rows for ${scheduleName} on ${slot} past the ${graceMinutes}-minute grace window: the sweep did not run or crashed before its first claim.`,
    });
    return { evaluated: true, alerts };
  }

  const stuckCutoff = now.getTime() - STUCK_CLAIM_GRACE_MULTIPLE * graceMinutes * 60000;
  for (const row of rows) {
    const isSweepMarker = row.recipient_allowlist_id === SWEEP_RECIPIENT_ID;
    // RDL-005: run markers are NOT skipped unconditionally. A healthy
    // no_op sweep marker is legitimate run evidence and stays silent; a
    // claimed marker older than the stuck cutoff means the sweep crashed
    // between the marker claim and its outcome write (the old code skipped
    // it, hiding the crash). provider_failed on a marker is impossible in
    // the current routes — alert loudly if it ever appears.
    if (isSweepMarker && row.state === LEDGER_STATES.NO_OP) continue;
    if (row.state === LEDGER_STATES.PROVIDER_FAILED) {
      alerts.push({
        schedule: scheduleName,
        slot,
        recipient: row.recipient_allowlist_id,
        state: "send_failed",
        reason: `Provider rejected a send for ${row.recipient_allowlist_id}: ${row.failure_reason || "no reason recorded"}.`,
      });
    } else if (
      row.state === LEDGER_STATES.CLAIMED &&
      new Date(row.claimed_at).getTime() < stuckCutoff
    ) {
      alerts.push({
        schedule: scheduleName,
        slot,
        recipient: row.recipient_allowlist_id,
        state: "stuck_claim",
        reason: isSweepMarker
          ? `Run-marker claim for ${scheduleName} never reached an outcome (claimed at ${row.claimed_at}); the sweep likely crashed between the marker claim and its outcome write — run completion is unknown, not proven.`
          : `Ledger claim for ${row.recipient_allowlist_id} never reached an outcome (claimed at ${row.claimed_at}); the sweep likely crashed between claim and provider call.`,
      });
    }
  }

  // RDL-004B: flag individual current failed outcomes from authoritative
  // attempt evidence, INDEPENDENTLY of the (cached) summary row. A stale
  // healthy summary must not hide an outstanding failed delivery — the
  // summary is a cache, and the watchdog never repairs it (read-only).
  // Rows already in provider_failed alert via send_failed above, so this
  // fires only when the summary disagrees with the evidence.
  const attempts = await readAttemptsForSlot(db, { scheduleName, scheduledSlot: slot });
  const latestByAttemptKey = authoritativeLatestAttempts(attempts);
  const ledgerById = new Map(rows.map((r) => [r.id, r]));
  for (const [, attempt] of latestByAttemptKey) {
    if (attempt.state !== LEDGER_STATES.PROVIDER_FAILED) continue;
    const parent = ledgerById.get(attempt.ledger_id);
    if (!parent || parent.state === LEDGER_STATES.PROVIDER_FAILED) continue;
    alerts.push({
      schedule: scheduleName,
      slot,
      recipient: parent.recipient_allowlist_id,
      deliveryId: attempt.delivery_id,
      state: "delivery_failed",
      reason:
        `Delivery ${attempt.delivery_id} (${parent.recipient_allowlist_id}) has a current failed ` +
        `attempt in the ledger evidence (${attempt.failure_reason || "no reason recorded"}) while ` +
        `the summary row reads ${parent.state} — the summary is stale; the failed delivery is ` +
        `still outstanding.`,
    });
  }

  // Expected-vs-observed, per DELIVERY (RDL-004): every delivery-table row
  // with a provider attempt during this slot must have matching
  // per-delivery attempt evidence in the ledger. Comparing only recipient
  // presence let a later success to the same recipient hide an earlier
  // failed delivery — now each delivery id is checked individually.
  const delivery = DELIVERY_TABLES[scheduleName];
  if (delivery) {
    const slotStartUTC = chicagoTimeToUTC(slot, 0, 0).toISOString();
    const { data, error } = await db
      .from(delivery.table)
      .select(delivery.columns)
      .in("status", ["sent", "failed"])
      .gte("last_attempted_at", slotStartUTC);
    if (error) throw error;
    const attemptsByLedger = new Map();
    for (const a of attempts) {
      if (!attemptsByLedger.has(a.ledger_id)) attemptsByLedger.set(a.ledger_id, []);
      attemptsByLedger.get(a.ledger_id).push(a);
    }
    const latestAttemptFor = (ledgerId, deliveryId) =>
      latestByAttemptKey.get(`${ledgerId}|${deliveryId}`) ?? null;
    const ledgerByRecipient = new Map(rows.map((r) => [r.recipient_allowlist_id, r]));
    for (const attemptRow of data || []) {
      const recipient = delivery.recipientOf(attemptRow);
      if (!recipient) continue;
      const ledgerRow = ledgerByRecipient.get(recipient);
      if (!ledgerRow) {
        alerts.push({
          schedule: scheduleName,
          slot,
          recipient,
          deliveryId: attemptRow.id,
          state: "unrecorded_attempt",
          reason: `Delivery table shows a ${attemptRow.status} provider attempt for delivery ${attemptRow.id} (${recipient}) during ${slot} but no ledger row exists: confirmation evidence is missing.`,
        });
        continue;
      }
      const evidence = latestAttemptFor(ledgerRow.id, attemptRow.id);
      const expectedLedgerState =
        attemptRow.status === "sent" ? LEDGER_STATES.PROVIDER_ACCEPTED : LEDGER_STATES.PROVIDER_FAILED;
      if (!evidence || evidence.state !== expectedLedgerState) {
        alerts.push({
          schedule: scheduleName,
          slot,
          recipient,
          deliveryId: attemptRow.id,
          state: "delivery_evidence_mismatch",
          reason:
            `Delivery ${attemptRow.id} (${recipient}) is ${attemptRow.status} in the delivery table ` +
            `but the ledger's latest attempt evidence is ` +
            `${evidence ? evidence.state : "missing"} — a failed individual delivery must not be ` +
            `hidden behind another delivery's success.`,
        });
      }
    }
  }

  return { evaluated: true, alerts };
}

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const graceMinutes = Math.max(
    1,
    Number.parseInt(process.env.LEDGER_WATCHDOG_GRACE_MINUTES || "", 10) || DEFAULT_GRACE_MINUTES,
  );
  const now = new Date();
  const slot = chicagoSlotFor(now);

  try {
    const db = createRentalWebhookClient();
    const alerts = [];
    const schedules = {};
    for (const scheduleName of Object.keys(SCHEDULE_RUN_TIMES)) {
      const { evaluated, alerts: scheduleAlerts } = await evaluateSchedule(
        db,
        scheduleName,
        slot,
        now,
        graceMinutes,
      );
      schedules[scheduleName] = { evaluated, alertCount: scheduleAlerts.length };
      alerts.push(...scheduleAlerts);
    }
    return NextResponse.json({
      success: true,
      checkedAt: now.toISOString(),
      slot,
      graceMinutes,
      schedules,
      alerts,
      failed: alerts.length,
    });
  } catch (error) {
    console.error("Receipt ledger watchdog error", error);
    return NextResponse.json({ error: "Unable to run receipt ledger watchdog." }, { status: 500 });
  }
}
