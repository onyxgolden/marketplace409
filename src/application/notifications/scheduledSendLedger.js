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
//     returned a message id; delivered is reserved for a delivery
//     confirmation;
//   * idempotency/reconciliation before refire: a refire that finds a
//     terminal row for (schedule, slot, recipient) must skip the send;
//   * the sweep watchdog is read-only: it queries, never refires.
//
// RDL-001..RDL-005 hardening (2026-10-12 re-review):
//   * RDL-001: provider_failed is terminal-for-monitoring but is NOT
//     positive send evidence. Only provider_accepted/delivered (or the
//     domain's own already-invited/already-claimed state) may reconcile a
//     refire as "sent" or enable billing. A failed row retries under a
//     bounded attempt policy, or fails closed explicitly.
//   * RDL-002: claims are fenced. Only the run that inserted the claim row
//     (or atomically took over a stale/failed one via takeoverLedgerRow)
//     may send. A losing claimant defers; a missing row fails closed; an
//     old worker's outcome write is refused by run_id fencing.
//     RDL-002A: the attempt bound applies to EVERY takeover that can lead
//     to another provider attempt, stale claims included — stale is never
//     treated as unlimited; exhaustion returns an explicit
//     attempts_exhausted reason (needs reconciliation).
//     RDL-002B: the initial logical provider key and payload digest are
//     persisted on the claim row BEFORE the first provider call. Retries
//     reconcile/retry THAT request under the same key; a changed payload
//     is an explicit separate logical operation, never a silent
//     replacement of an ambiguous send.
//   * RDL-004: a recipient can have MULTIPLE distinct deliveries per slot.
//     Each provider attempt is recorded in scheduled_send_attempts keyed
//     by delivery id (insert-only). The summary row's state is DERIVED from
//     the latest attempt per delivery: any outstanding provider_failed
//     keeps the summary failed; a failure clears only when THAT delivery
//     is retried to provider_accepted.
//     RDL-004A: each attempt row is bound to its claim generation
//     (unguessable claim_token, rotated on every claim/takeover) and a
//     monotonic attempt_ordinal per delivery. Recording verifies the
//     token; derivation orders by ordinal, never by wall-clock time or
//     UUID ordering — a late stale worker can neither append nor
//     supersede newer legitimate evidence.
//     RDL-004B: the summary derive/update runs under a summary_version
//     compare-and-swap with retry, so concurrent derivations converge
//     instead of clobbering each other. The watchdog additionally derives
//     failure state directly from attempt evidence and treats the stored
//     summary as a cache; it never repairs the summary itself.
//
// scheduled_slot is the America/Chicago calendar date (YYYY-MM-DD) of the
// scheduled run, so slot boundaries match the sweep times Jason reads
// (10:00/11:00/13:00 CDT), not UTC dates.

import { randomUUID } from "node:crypto";

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

// Fencing policy.
export const CLAIM_TAKEOVER_STALE_MINUTES = 30;
export const MAX_LEDGER_SEND_ATTEMPTS = 3;
// Synthetic recipient id for run-level evidence rows (see receipt routes).
export const SWEEP_RECIPIENT_ID = "_sweep";

const TERMINAL_STATES = new Set([
  LEDGER_STATES.PROVIDER_ACCEPTED,
  LEDGER_STATES.PROVIDER_FAILED,
  LEDGER_STATES.DELIVERED,
  LEDGER_STATES.NO_OP,
]);

// RDL-001: positive send evidence is narrower than terminal-for-monitoring.
// provider_failed is terminal (the run finished) but proves nothing was
// sent; only these states may reconcile a refire as "sent" or justify
// enabling billing.
const POSITIVE_SEND_EVIDENCE_STATES = new Set([
  LEDGER_STATES.PROVIDER_ACCEPTED,
  LEDGER_STATES.DELIVERED,
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

export function isPositiveSendEvidence(state) {
  return POSITIVE_SEND_EVIDENCE_STATES.has(state);
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

const LEDGER_ROW_COLUMNS =
  "id,schedule_name,scheduled_slot,recipient_allowlist_id,run_id,state,provider_message_id,failure_reason,send_attempts,claimed_at,updated_at,provider_request_key,payload_digest,claim_token,summary_version";

// Durable pre-send claim. Insert-only with ignoreDuplicates on the unique
// key: returns { claimed: true } when THIS call won the claim, or
// { claimed: false, existing } when a row already exists. A losing
// claimant must NOT send on the invite path — it reconciles or defers
// (see takeoverLedgerRow). The fresh claim counts as send attempt #1.
//
// RDL-002B: the caller persists the initial logical provider request key
// and payload digest HERE, before the first provider call, so every later
// retry reconciles/retries THAT request under the same key. On conflict
// (ignoreDuplicates) the first claim's key wins — a refire never
// overwrites it.
export async function claimLedgerRow(
  db,
  { scheduleName, scheduledSlot, recipientAllowlistId, runId, providerRequestKey = null, payloadDigest = null },
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
        send_attempts: 1,
        provider_request_key: providerRequestKey,
        payload_digest: payloadDigest,
        claim_token: randomUUID(),
        summary_version: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "schedule_name,scheduled_slot,recipient_allowlist_id", ignoreDuplicates: true },
    )
    .select(
      "id,schedule_name,scheduled_slot,recipient_allowlist_id,run_id,state,provider_request_key,payload_digest,claim_token,summary_version",
    );
  if (error) throw error;
  if ((data || []).length === 1) return { claimed: true, row: data[0] };
  const { data: existing, error: readError } = await db
    .from("scheduled_send_ledger")
    .select(LEDGER_ROW_COLUMNS)
    .eq("schedule_name", scheduleName)
    .eq("scheduled_slot", scheduledSlot)
    .eq("recipient_allowlist_id", recipientAllowlistId)
    .maybeSingle();
  if (readError) throw readError;
  return { claimed: false, existing: existing ?? null };
}

// RDL-002: fenced takeover of a claim this run did not win. Atomically
// (compare-and-swap on id + run_id + state) takes ownership of:
//   * a STALE claimed row (claimed_at older than staleMinutes) — the
//     owning run presumably crashed between claim and outcome;
//   * a provider_failed row with send_attempts below maxAttempts — a
//     bounded retry under the stable (schedule, slot, recipient) identity.
//
// RDL-002A: the attempt bound applies to EVERY takeover that can lead to
// another provider attempt, stale claims included. A stale row with
// send_attempts at/over maxAttempts is NOT taken — it returns
// { taken: false, reason: "attempts_exhausted" } (explicit
// exhausted/needs-reconciliation) instead of being treated as unlimited.
// Attempt history is never reset by a takeover: it only increments.
//
// Anything else (fresh claim held by a live run, terminal positive/no-op
// evidence, missing row) returns { taken: false, existing, reason } and
// the caller must NOT send — it defers or fails closed. Reasons:
// "attempts_exhausted" | "claim_held" | "terminal_state" | "no_ledger_row".
// The CAS guards the race: if another run moved the row between our read
// and our write, the update hits 0 rows and we re-read.
export async function takeoverLedgerRow(
  db,
  {
    scheduleName,
    scheduledSlot,
    recipientAllowlistId,
    runId,
    staleMinutes = CLAIM_TAKEOVER_STALE_MINUTES,
    maxAttempts = MAX_LEDGER_SEND_ATTEMPTS,
  },
) {
  const { data: existing, error: readError } = await db
    .from("scheduled_send_ledger")
    .select(LEDGER_ROW_COLUMNS)
    .eq("schedule_name", scheduleName)
    .eq("scheduled_slot", scheduledSlot)
    .eq("recipient_allowlist_id", recipientAllowlistId)
    .maybeSingle();
  if (readError) throw readError;
  if (!existing) return { taken: false, existing: null, reason: "no_ledger_row" };

  const now = new Date();
  const nowIso = now.toISOString();
  const attempts = existing.send_attempts ?? 0;
  const exhausted = attempts >= maxAttempts;
  const isStaleClaimed =
    existing.state === LEDGER_STATES.CLAIMED &&
    new Date(existing.claimed_at).getTime() < now.getTime() - staleMinutes * 60000;
  let patch = null;
  let reason = null;
  if (isStaleClaimed && !exhausted) {
    patch = {
      run_id: runId,
      claimed_at: nowIso,
      updated_at: nowIso,
      claim_token: randomUUID(),
      send_attempts: attempts + 1,
    };
  } else if (existing.state === LEDGER_STATES.PROVIDER_FAILED && !exhausted) {
    patch = {
      run_id: runId,
      state: LEDGER_STATES.CLAIMED,
      claimed_at: nowIso,
      updated_at: nowIso,
      claim_token: randomUUID(),
      send_attempts: attempts + 1,
    };
  } else if (exhausted && (isStaleClaimed || existing.state === LEDGER_STATES.PROVIDER_FAILED)) {
    reason = "attempts_exhausted";
  } else if (existing.state === LEDGER_STATES.CLAIMED) {
    reason = "claim_held";
  } else {
    reason = "terminal_state";
  }
  if (!patch) {
    return { taken: false, existing, reason };
  }

  const { data, error } = await db
    .from("scheduled_send_ledger")
    .update(patch)
    .eq("id", existing.id)
    .eq("run_id", existing.run_id)
    .eq("state", existing.state)
    .select(LEDGER_ROW_COLUMNS);
  if (error) throw error;
  if ((data || []).length !== 1) {
    const { data: current, error: rereadError } = await db
      .from("scheduled_send_ledger")
      .select(LEDGER_ROW_COLUMNS)
      .eq("schedule_name", scheduleName)
      .eq("scheduled_slot", scheduledSlot)
      .eq("recipient_allowlist_id", recipientAllowlistId)
      .maybeSingle();
    if (rereadError) throw rereadError;
    return { taken: false, existing: current ?? null, reason: "claim_held" };
  }
  return { taken: true, row: data[0] };
}

// Record an outcome for a previously claimed row. Enforces the transition
// map AND run ownership: when runId is provided, the update is fenced on
// the row's current run_id, so a stale worker from an older generation
// can never overwrite a newer generation's outcome (returns
// { updated: false, reason: "not_owner" }). Disallowed transitions are
// refused (returned, never thrown) so a sweep cannot silently corrupt
// ledger history.
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
  if (runId != null && current.run_id !== runId) {
    return { updated: false, reason: "not_owner" };
  }
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
  let updateQuery = db
    .from("scheduled_send_ledger")
    .update(patch)
    .eq("id", current.id)
    .eq("state", current.state);
  if (runId != null) updateQuery = updateQuery.eq("run_id", runId);
  const { data, error } = await updateQuery.select("id");
  if (error) throw error;
  return { updated: (data || []).length === 1, reason: (data || []).length === 1 ? null : "concurrent_update" };
}

// RDL-004A: authoritative per-delivery attempt ordering. Each attempt row
// carries a monotonic attempt_ordinal per (ledger_id, delivery_id),
// assigned at insert time. "Latest" is the highest ordinal — never the
// wall-clock attempted_at (outcome-record time, not attempt-start time)
// and never UUID ordering. A late stale worker's row, even if it somehow
// landed, can never supersede a newer legitimate attempt.
export function authoritativeLatestAttempts(attempts) {
  const latest = new Map();
  for (const a of attempts || []) {
    const key = `${a.ledger_id}|${a.delivery_id}`;
    const cur = latest.get(key);
    if (!cur || (a.attempt_ordinal ?? 0) > (cur.attempt_ordinal ?? 0)) {
      latest.set(key, a);
    }
  }
  return latest;
}

// RDL-004: derive the per-(schedule, slot, recipient) summary state from
// the latest attempt per delivery_id. Any delivery whose latest attempt is
// provider_failed keeps the summary failed — a failure clears only when
// THAT delivery_id is retried to provider_accepted, never because a
// different delivery to the same recipient succeeded.
function deriveSummaryFromAttempts(attempts) {
  const latestByDelivery = new Map();
  for (const [, a] of authoritativeLatestAttempts(attempts)) {
    latestByDelivery.set(a.delivery_id, a);
  }
  const latest = [...latestByDelivery.values()];
  const byOrdinalDesc = (x, y) => (y.attempt_ordinal ?? 0) - (x.attempt_ordinal ?? 0);
  const failed = latest
    .filter((a) => a.state === LEDGER_STATES.PROVIDER_FAILED)
    .sort(byOrdinalDesc);
  if (failed.length > 0) {
    return {
      state: LEDGER_STATES.PROVIDER_FAILED,
      providerMessageId: failed[0].provider_message_id ?? null,
      failureReason: failed[0].failure_reason ?? null,
    };
  }
  const accepted = latest
    .filter((a) => a.state === LEDGER_STATES.PROVIDER_ACCEPTED)
    .sort(byOrdinalDesc);
  if (accepted.length > 0) {
    return {
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: accepted[0].provider_message_id ?? null,
      failureReason: null,
    };
  }
  return null;
}

const ATTEMPT_ROW_COLUMNS =
  "id,ledger_id,delivery_id,state,provider_message_id,failure_reason,run_id,attempted_at,claim_token,attempt_ordinal";

// RDL-004A: insert one provider-attempt evidence row, fenced on the
// ledger row's claim generation. The claim_token is an unguessable secret
// minted at claim time and rotated on every takeover; a writer must
// present the row's CURRENT token. A stale worker from a superseded
// generation presents an old token and its write is REFUSED
// ({ recorded: false, reason: "stale_claim_token" }) — it can neither
// append late evidence nor supersede the newer generation. Rows for
// legacy (pre-token) ledger rows, whose claim_token is null, skip the
// check. The attempt gets the next monotonic attempt_ordinal for its
// delivery, which is the authoritative order — not attempted_at.
export async function insertDeliveryAttempt(
  db,
  { ledgerId, deliveryId, state, providerMessageId = null, failureReason = null, runId = null, claimToken = null },
) {
  if (state !== LEDGER_STATES.PROVIDER_ACCEPTED && state !== LEDGER_STATES.PROVIDER_FAILED) {
    throw new Error(`insertDeliveryAttempt: invalid attempt state ${state}`);
  }
  const { data: ledgerRow, error: rowError } = await db
    .from("scheduled_send_ledger")
    .select("id,claim_token")
    .eq("id", ledgerId)
    .maybeSingle();
  if (rowError) throw rowError;
  if (!ledgerRow) return { recorded: false, reason: "no_ledger_row" };
  if (ledgerRow.claim_token != null && claimToken !== ledgerRow.claim_token) {
    return { recorded: false, reason: "stale_claim_token" };
  }
  const { data: prior, error: priorError } = await db
    .from("scheduled_send_attempts")
    .select("attempt_ordinal")
    .eq("ledger_id", ledgerId)
    .eq("delivery_id", deliveryId);
  if (priorError) throw priorError;
  const ordinal = Math.max(0, ...(prior || []).map((a) => a.attempt_ordinal ?? 0)) + 1;
  const { data, error: insertError } = await db.from("scheduled_send_attempts").insert({
    ledger_id: ledgerId,
    delivery_id: deliveryId,
    state,
    provider_message_id: providerMessageId,
    failure_reason: failureReason,
    run_id: runId,
    claim_token: ledgerRow.claim_token,
    attempt_ordinal: ordinal,
    attempted_at: new Date().toISOString(),
  });
  if (insertError) throw insertError;
  return { recorded: true, attempt: (data || [])[0] ?? null };
}

// RDL-004B: recompute the summary row from authoritative attempt evidence
// and write it under a summary_version compare-and-swap, retrying on
// conflict. Concurrent derivations therefore converge instead of the
// last writer silently winning with a stale snapshot: a CAS loser
// re-reads the (now newer) attempt set and re-derives. If the CAS keeps
// losing, the summary is left for a later refresh — it is a cache; the
// watchdog derives failure state directly from attempt evidence and never
// repairs the summary itself.
export async function refreshDeliverySummary(db, { ledgerId, maxRetries = 5 }) {
  let derived = null;
  for (let i = 0; i < maxRetries; i += 1) {
    const { data: row, error: rowError } = await db
      .from("scheduled_send_ledger")
      .select("id,summary_version")
      .eq("id", ledgerId)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) return { refreshed: false, summaryState: null, reason: "no_ledger_row" };
    const { data: attempts, error: readError } = await db
      .from("scheduled_send_attempts")
      .select(ATTEMPT_ROW_COLUMNS)
      .eq("ledger_id", ledgerId);
    if (readError) throw readError;
    derived = deriveSummaryFromAttempts(attempts || []);
    if (!derived) return { refreshed: false, summaryState: null, reason: "no_attempts" };
    const version = row.summary_version ?? 0;
    const { data, error: updateError } = await db
      .from("scheduled_send_ledger")
      .update({
        state: derived.state,
        provider_message_id: derived.providerMessageId,
        failure_reason: derived.failureReason,
        summary_version: version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ledgerId)
      .eq("summary_version", version)
      .select("id");
    if (updateError) throw updateError;
    if ((data || []).length === 1) {
      return { refreshed: true, summaryState: derived.state };
    }
    // CAS lost: another derivation moved the version — re-read and retry.
  }
  return { refreshed: false, summaryState: derived ? derived.state : null, reason: "cas_retry_exhausted" };
}

// RDL-004: record one provider attempt for one delivery-table row.
// Insert-only (append): concurrent writers never clobber each other, and
// the summary row is recomputed deterministically from the full attempt
// set under a version CAS, so concurrent derivations converge. Returns
// { recorded: true, summaryState, summaryRefreshed }.
export async function recordDeliveryAttempt(
  db,
  { ledgerId, deliveryId, state, providerMessageId = null, failureReason = null, runId = null, claimToken = null },
) {
  const inserted = await insertDeliveryAttempt(db, {
    ledgerId,
    deliveryId,
    state,
    providerMessageId,
    failureReason,
    runId,
    claimToken,
  });
  if (!inserted.recorded) return inserted;
  const refreshed = await refreshDeliverySummary(db, { ledgerId });
  return {
    recorded: true,
    summaryState: refreshed.summaryState,
    summaryRefreshed: refreshed.refreshed,
  };
}

// All ledger rows for one (schedule, slot) — the watchdog's observed set.
export async function readLedgerForSlot(db, { scheduleName, scheduledSlot }) {
  const { data, error } = await db
    .from("scheduled_send_ledger")
    .select(
      "id,schedule_name,scheduled_slot,recipient_allowlist_id,run_id,state,provider_message_id,failure_reason,send_attempts,claimed_at,updated_at",
    )
    .eq("schedule_name", scheduleName)
    .eq("scheduled_slot", scheduledSlot)
    .order("updated_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Per-delivery attempt evidence for one (schedule, slot) — the watchdog's
// RDL-004 cross-check input.
export async function readAttemptsForSlot(db, { scheduleName, scheduledSlot }) {
  const rows = await readLedgerForSlot(db, { scheduleName, scheduledSlot });
  if (rows.length === 0) return [];
  const { data, error } = await db
    .from("scheduled_send_attempts")
    .select(ATTEMPT_ROW_COLUMNS)
    .in(
      "ledger_id",
      rows.map((r) => r.id),
    );
  if (error) throw error;
  return data || [];
}
