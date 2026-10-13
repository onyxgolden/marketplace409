import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import {
  readLedgerForSlot,
  chicagoSlotFor,
  SCHEDULE_NAMES,
  SCHEDULE_RUN_TIMES,
  LEDGER_STATES,
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
//
// Query params: ?dryRun is not supported -- this endpoint never writes.
// Env: LEDGER_WATCHDOG_GRACE_MINUTES (default 90).
const DEFAULT_GRACE_MINUTES = 90;
const STUCK_CLAIM_GRACE_MULTIPLE = 2;

// Delivery-table cross-check config per schedule: the watchdog's
// "expected" set is the recipients with actual provider attempts
// (sent/failed) during the slot; the "observed" set is the ledger rows.
const DELIVERY_TABLES = {
  [SCHEDULE_NAMES.PF_PAYMENT_RECEIPTS]: {
    table: "private_financing_payment_receipt_deliveries",
    recipientOf: (row) => (row.recipient_type === "owner" ? row.owner_id : row.borrower_id),
  },
  [SCHEDULE_NAMES.TENANT_PAYMENT_RECEIPTS]: {
    table: "rental_tenant_receipt_deliveries",
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
    if (row.recipient_allowlist_id === "_sweep") continue;
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
        reason: `Ledger claim for ${row.recipient_allowlist_id} never reached an outcome (claimed at ${row.claimed_at}); the sweep likely crashed between claim and provider call.`,
      });
    }
  }

  // Expected-vs-observed: recipients with actual provider attempts in the
  // delivery table during this slot must have a ledger row.
  const delivery = DELIVERY_TABLES[scheduleName];
  if (delivery) {
    const slotStartUTC = chicagoTimeToUTC(slot, 0, 0).toISOString();
    const { data, error } = await db
      .from(delivery.table)
      .select("owner_id,borrower_id,tenant_id,recipient_type,last_attempted_at")
      .in("status", ["sent", "failed"])
      .gte("last_attempted_at", slotStartUTC);
    if (error) throw error;
    const attemptedRecipients = new Set(
      (data || []).map(delivery.recipientOf).filter(Boolean),
    );
    const recordedRecipients = new Set(rows.map((r) => r.recipient_allowlist_id));
    for (const recipient of attemptedRecipients) {
      if (!recordedRecipients.has(recipient)) {
        alerts.push({
          schedule: scheduleName,
          slot,
          recipient,
          state: "unrecorded_attempt",
          reason: `Delivery table shows provider attempts for ${recipient} during ${slot} but no ledger row exists: confirmation evidence is missing.`,
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
