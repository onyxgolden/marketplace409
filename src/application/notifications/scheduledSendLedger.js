// Receipt-delivery confirmation ledger — shared write/read contract.
//
// AGENT-PROPOSALS.md 2026-10-11 (Muse), three-agent AGREE with conditions
// 2026-10-12. Adopted conditions:
//   * durable PRE-SEND claim/outbox keyed (schedule_name, scheduled_slot,
//     recipient_allowlist_id); the unique key is the distributed lock, so a
//     refire reconciles against the ledger instead of re-sending;
//   * states claimed / provider_accepted / provider_failed / delivered
//     (plus no_op for expected nothing-to-send runs);
//   * no API-acceptance-as-delivery: provider_accepted means the provider
//   returned a message id; delivered is reserved for a delivery confirmation;
//   * idempotency/reconciliation before refire: a refire that finds a terminal
//     row for (schedule, slot, recipient) must skip the send;
//   * the sweep watchdog is read-only: it queries, never refires.
//
// scheduled_slot is the America/Chicago calendar date (YYYY-MM-DD) of the
// scheduled run, so slot boundaries match the sweep times Jason reads
// (10:00/11:00/13:00 CDT), not UTC dates.

export const SCHEDULE_NAMES = Object.freeze({
  TENANT_INVITE: "tenant_invite",
  PF_PAYMENT_RECEIPTS: "pf_payment_receipts",
  TENANT_PAYMENT_RECEIPTS: "tenant_payment_receipts",
});

// Scheduled run times in America/Chicago, matching .github/workflows/
// rental-cron-sweeps.yml (0 15/16/18 * * * UTC).
export const SCHEDULE_RUN_TIMES = Object.freeze({
  [SCHEDULE_NAMES.TENANT_INVITE]: { hour: 10, minute: 0 },
  [SCHEDULE_NAMES.PF_PAYMENT_RECEIPTS]: { hour: 11, minute: 0 },
  [SCHEDULE_NAMES.TENANT_PAYMENT_RECEIPTS]: { hour: 13, minute: 0 },
});

export const LEDGER_STATES = Object.freeze({
  CLAIMED: "claimed",
  PROVIDER_ACCEPTED: "provider_accepted",
  PROVIDER_FAILED: "provider_failed",
  DELIVERED: "delivered",
  NO_OP: "no_op",
});

const TERMINAL_STATES = new Set([
  LEDGER_STATES.PROVIDER_ACCEPTED,
  LEDGER_STATES.PROVIDER_FAILED,
  LEDGER_STATES.DELIVERED,
  LEDGER_STATES.NO_OP,
]);

// Allowed state transitions. provider_failed is sticky within a run: a
// later run_id may record provider_accepted/delivered over it (recovery),
// but the same run never downgrades a failure. delivered and no_op are
// terminal. claimed may only move forward.
const ALLOWED_TRANSITIONS = Object.freeze({
  [LEDGER_STATES.CLAIMED]: new Set([
    LEDGER_STATES.PROVIDER_ACCEPTED,
    LEDGER_STATES.PROVIDER_FAILED,
    LEDGER_STATES.NO_OP,
  ]),
  [LEDGER_STATES.PROVIDER_ACCEPTED]: new Set([
    LEDGER_STATES.DELIVERED,
    LEDGER_STATES.PROVIDER_FAILED,
  ]),
  [LEDGER_STATES.PROVIDER_FAILED]: new Set([
    LEDGER_STATES.PROVIDER_ACCEPTED,
    LEDGER_STATES.DELIVERED,
  ]),
  [LEDGER_STATES.DELIVERED]: new Set(),
  [LEDGER_STATES.NO_OP]: new Set(),
});

export function isTerminalLedgerState(state) {
  return TERMINAL_STATES.has(state);
}

export function isAllowedLedgerTransition(fromState, toState, { fromRunId, toRunId } = {}) {
  const allowed = ALLOWED_TRANSITIONS[fromState];
  if (!allowed || !allowed.has(toState)) return false;
  // provider_failed -> provider_accepted/delivered is recovery: only a
  // LATER run may do it, never the run that recorded the failure.
  if (
    fromState === LEDGER_STATES.PROVIDER_FAILED &&
    (toState === LEDGER_STATES.PROVIDER_ACCEPTED || toState === LEDGER_STATES.DELIVERED) &&
    fromRunId != null &&
    toRunId != null &&
    fromRunId === toRunId
  ) {
    return false;
  }
  return true;
}

// YYYY-MM-DD in America/Chicago for the given instant (default now).
export function chicagoSlotFor(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts;
}

// Durable pre-send claim. Insert-only with ignoreDuplicates on the unique
// key: returns { claimed: true } when THIS call won the claim, or
// { claimed: false, existing } when a row already exists (a refire must
// reconcile against `existing` instead of sending).
export async function claimLedgerRow(
  db,
  { scheduleName, scheduledSlot, recipientAllowlistId, runId },
) {
  const { data, error } = await db
    .from("scheduled_send_ledger")
    .upsert(
      {
        schedule_name: scheduleName,
        scheduled_slot: scheduledSlot,
        recipient_allowlist_id: recipientAllowlistId,
        run_id: runId,
        state: LEDGER_STATES.CLAIMED,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "schedule_name,scheduled_slot,recipient_allowlist_id", ignoreDuplicates: true },
    )
    .select("id,schedule_name,scheduled_slot,recipient_allowlist_id,run_id,state");
  if (error) throw error;
  if ((data || []).length === 1) return { claimed: true, row: data[0] };
  const { data: existing, error: readError } = await db
    .from("scheduled_send_ledger")
    .select("id,schedule_name,scheduled_slot,recipient_allowlist_id,run_id,state,provider_message_id,failure_reason")
    .eq("schedule_name", scheduleName)
    .eq("scheduled_slot", scheduledSlot)
    .eq("recipient_allowlist_id", recipientAllowlistId)
    .maybeSingle();
  if (readError) throw readError;
  return { claimed: false, existing: existing ?? null };
}

// Record an outcome for a previously claimed row. Enforces the transition
// map; disallowed transitions are refused (returned, never thrown) so a
// sweep cannot silently corrupt ledger history.
export async function recordLedgerOutcome(
  db,
  { scheduleName, scheduledSlot, recipientAllowlistId, state, providerMessageId = null, failureReason = null, runId = null },
) {
  const { data: current, error: readError } = await db
    .from("scheduled_send_ledger")
    .select("id,state,run_id")
    .eq("schedule_name", scheduleName)
    .eq("scheduled_slot", scheduledSlot)
    .eq("recipient_allowlist_id", recipientAllowlistId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return { updated: false, reason: "no_ledger_row" };
  if (
    !isAllowedLedgerTransition(current.state, state, { fromRunId: current.run_id, toRunId: runId })
  ) {
    return { updated: false, reason: `illegal_transition_${current.state}_to_${state}` };
  }
  const patch = {
    state,
    run_id: runId ?? current.run_id,
    updated_at: new Date().toISOString(),
  };
  // Never clobber evidence fields that this outcome does not provide: a
  // later state update (e.g. delivered) must not erase the provider message
  // id recorded at provider_accepted time.
  if (providerMessageId !== null && providerMessageId !== undefined) {
    patch.provider_message_id = providerMessageId;
  }
  if (failureReason !== null && failureReason !== undefined) {
    patch.failure_reason = failureReason;
  }
  const { data, error } = await db
    .from("scheduled_send_ledger")
    .update(patch)
    .eq("id", current.id)
    .eq("state", current.state)
    .select("id");
  if (error) throw error;
  return { updated: (data || []).length === 1, reason: (data || []).length === 1 ? null : "concurrent_update" };
}

// All ledger rows for one (schedule, slot) — the watchdog's observed set.
export async function readLedgerForSlot(db, { scheduleName, scheduledSlot }) {
  const { data, error } = await db
    .from("scheduled_send_ledger")
    .select(
      "id,schedule_name,scheduled_slot,recipient_allowlist_id,run_id,state,provider_message_id,failure_reason,claimed_at,updated_at",
    )
    .eq("schedule_name", scheduleName)
    .eq("scheduled_slot", scheduledSlot)
    .order("updated_at", { ascending: true });
  if (error) throw error;
  return data || [];
}
