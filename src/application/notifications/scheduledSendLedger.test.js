// Unit tests for the scheduled-send ledger contract. Synthetic fixtures
// only: the "db" is an in-memory mock of the supabase-js chainable query
// builder. The mock's update path enforces ALL eq filters (compare-and-swap
// semantics), so fencing/takeover races are represented faithfully.
// No network, no real sends.

import { describe, it, expect } from "vitest";
import {
  SCHEDULE_NAMES,
  LEDGER_STATES,
  CLAIM_TAKEOVER_STALE_MINUTES,
  MAX_LEDGER_SEND_ATTEMPTS,
  chicagoSlotFor,
  claimLedgerRow,
  takeoverLedgerRow,
  recordLedgerOutcome,
  recordDeliveryAttempt,
  readLedgerForSlot,
  readAttemptsForSlot,
  isTerminalLedgerState,
  isPositiveSendEvidence,
  isAllowedLedgerTransition,
} from "./scheduledSendLedger.js";

// Deterministic in-memory mock of the supabase-js chainable query builder,
// covering both scheduled_send_ledger and scheduled_send_attempts.
function makeDb() {
  const tables = { scheduled_send_ledger: [], scheduled_send_attempts: [] };
  let seq = 0;
  const matches = (filters, inLists) => (r) =>
    filters.every(([c, v]) => r[c] === v) && inLists.every(([c, vs]) => vs.includes(r[c]));

  function chainable(table) {
    const rows = tables[table];
    if (!rows) throw new Error(`unexpected table ${table}`);
    const filters = [];
    const inLists = [];
    const obj = {
      select() {
        return obj;
      },
      eq(col, val) {
        filters.push([col, val]);
        return obj;
      },
      in(col, vals) {
        inLists.push([col, vals]);
        return obj;
      },
      order() {
        return obj;
      },
      insert(row) {
        const inserted = { id: `${table}_${++seq}`, ...row };
        rows.push(inserted);
        return { then: (resolve) => resolve({ data: [inserted], error: null }) };
      },
      upsert(row, { ignoreDuplicates } = {}) {
        return {
          select() {
            return {
              then(resolve) {
                const key = (r) =>
                  `${r.schedule_name}|${r.scheduled_slot}|${r.recipient_allowlist_id}`;
                const existing = rows.find((r) => key(r) === key(row));
                if (existing && ignoreDuplicates) {
                  resolve({ data: [], error: null });
                  return;
                }
                const inserted = { id: `${table}_${++seq}`, ...row };
                rows.push(inserted);
                resolve({ data: [inserted], error: null });
              },
            };
          },
        };
      },
      update(patch) {
        const updFilters = [];
        const apply = (resolve) => {
          // CAS: every eq filter must match, else 0 rows (lost race).
          const idx = rows.findIndex((r) => updFilters.every(([c, v]) => r[c] === v));
          if (idx === -1) {
            resolve({ data: [], error: null });
            return;
          }
          rows[idx] = { ...rows[idx], ...patch };
          resolve({ data: [rows[idx]], error: null });
        };
        const upd = {
          eq(col, val) {
            updFilters.push([col, val]);
            return upd;
          },
          // supabase-js executes the update when awaited, with or without
          // a trailing .select().
          then: apply,
          select() {
            return { then: apply };
          },
        };
        return upd;
      },
      async maybeSingle() {
        return { data: rows.find(matches(filters, inLists)) ?? null, error: null };
      },
      then(resolve) {
        resolve({ data: rows.filter(matches(filters, inLists)), error: null });
      },
    };
    return obj;
  }
  return { _tables: tables, from: chainable };
}

const ARGS = {
  scheduleName: SCHEDULE_NAMES.TENANT_INVITE,
  scheduledSlot: "2026-10-12",
  recipientAllowlistId: "rental_tenant_test_1",
  runId: "run_1",
};

describe("chicagoSlotFor", () => {
  it("formats the America/Chicago calendar date", () => {
    // 2026-10-12T04:30:00Z is 2026-10-11 23:30 CDT -> slot is the 11th.
    expect(chicagoSlotFor(new Date("2026-10-12T04:30:00.000Z"))).toBe("2026-10-11");
    // 2026-10-12T15:00:00Z is 2026-10-12 10:00 CDT -> slot is the 12th.
    expect(chicagoSlotFor(new Date("2026-10-12T15:00:00Z"))).toBe("2026-10-12");
  });
});

describe("claimLedgerRow", () => {
  it("first claim wins; a refire claim loses and returns the existing row", async () => {
    const db = makeDb();
    const first = await claimLedgerRow(db, ARGS);
    expect(first.claimed).toBe(true);
    expect(first.row.state).toBe(LEDGER_STATES.CLAIMED);

    const second = await claimLedgerRow(db, { ...ARGS, runId: "run_2_refire" });
    expect(second.claimed).toBe(false);
    expect(second.existing.state).toBe(LEDGER_STATES.CLAIMED);
    expect(db._tables.scheduled_send_ledger).toHaveLength(1);
  });

  it("claims are scoped per (schedule, slot, recipient)", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    const other = await claimLedgerRow(db, { ...ARGS, recipientAllowlistId: "other" });
    expect(other.claimed).toBe(true);
    expect(db._tables.scheduled_send_ledger).toHaveLength(2);
  });

  it("a fresh claim counts as send attempt #1", async () => {
    const db = makeDb();
    const { row } = await claimLedgerRow(db, ARGS);
    expect(row.send_attempts).toBe(1);
  });
});

describe("takeoverLedgerRow (RDL-002)", () => {
  it("refuses takeover of a fresh claimed row held by a live run", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    // Fresh: claimed_at is now (mock has no default; set explicitly).
    db._tables.scheduled_send_ledger[0].claimed_at = new Date().toISOString();
    const take = await takeoverLedgerRow(db, { ...ARGS, runId: "run_2" });
    expect(take.taken).toBe(false);
    expect(take.existing.state).toBe(LEDGER_STATES.CLAIMED);
    expect(take.existing.run_id).toBe("run_1");
  });

  it("takes over a stale claimed row and refreshes ownership", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    db._tables.scheduled_send_ledger[0].claimed_at = new Date(
      Date.now() - (CLAIM_TAKEOVER_STALE_MINUTES + 5) * 60000,
    ).toISOString();
    const take = await takeoverLedgerRow(db, { ...ARGS, runId: "run_2" });
    expect(take.taken).toBe(true);
    expect(take.row.run_id).toBe("run_2");
    expect(take.row.state).toBe(LEDGER_STATES.CLAIMED);
    expect(take.row.send_attempts).toBe(2);
  });

  it("a second takeover of the same stale row loses the CAS race", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    db._tables.scheduled_send_ledger[0].claimed_at = new Date(
      Date.now() - (CLAIM_TAKEOVER_STALE_MINUTES + 5) * 60000,
    ).toISOString();
    const first = await takeoverLedgerRow(db, { ...ARGS, runId: "run_2" });
    expect(first.taken).toBe(true);
    // run_3 read the same stale row, but run_2 already moved run_id: the
    // CAS on (id, run_id, state) matches 0 rows.
    const second = await takeoverLedgerRow(db, { ...ARGS, runId: "run_3" });
    expect(second.taken).toBe(false);
    expect(second.existing.run_id).toBe("run_2");
  });

  it("takes over a provider_failed row within the attempt bound", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_FAILED });
    const take = await takeoverLedgerRow(db, { ...ARGS, runId: "run_2" });
    expect(take.taken).toBe(true);
    expect(take.row.state).toBe(LEDGER_STATES.CLAIMED);
    expect(take.row.run_id).toBe("run_2");
    expect(take.row.send_attempts).toBe(2);
  });

  it("refuses takeover of provider_failed once attempts are exhausted", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_FAILED });
    db._tables.scheduled_send_ledger[0].send_attempts = MAX_LEDGER_SEND_ATTEMPTS;
    const take = await takeoverLedgerRow(db, { ...ARGS, runId: "run_2" });
    expect(take.taken).toBe(false);
    expect(take.existing.state).toBe(LEDGER_STATES.PROVIDER_FAILED);
  });

  it("refuses takeover of positive send evidence", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_ACCEPTED });
    const take = await takeoverLedgerRow(db, { ...ARGS, runId: "run_2" });
    expect(take.taken).toBe(false);
    expect(take.existing.state).toBe(LEDGER_STATES.PROVIDER_ACCEPTED);
  });

  it("fails closed when the row is missing", async () => {
    const db = makeDb();
    const take = await takeoverLedgerRow(db, { ...ARGS, runId: "run_2" });
    expect(take.taken).toBe(false);
    expect(take.existing).toBeNull();
  });
});

describe("recordLedgerOutcome", () => {
  it("claimed -> provider_accepted -> delivered is allowed", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    let r = await recordLedgerOutcome(db, {
      ...ARGS,
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "msg_1",
    });
    expect(r.updated).toBe(true);
    r = await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.DELIVERED });
    expect(r.updated).toBe(true);
    expect(db._tables.scheduled_send_ledger[0].state).toBe(LEDGER_STATES.DELIVERED);
    expect(db._tables.scheduled_send_ledger[0].provider_message_id).toBe("msg_1");
  });

  it("claimed -> provider_failed records the failure reason", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    const r = await recordLedgerOutcome(db, {
      ...ARGS,
      state: LEDGER_STATES.PROVIDER_FAILED,
      failureReason: "Resend rejected email delivery (500).",
    });
    expect(r.updated).toBe(true);
    expect(db._tables.scheduled_send_ledger[0].state).toBe(LEDGER_STATES.PROVIDER_FAILED);
    expect(db._tables.scheduled_send_ledger[0].failure_reason).toContain("500");
  });

  it("same run cannot downgrade provider_failed to provider_accepted", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_FAILED });
    const r = await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_ACCEPTED });
    expect(r.updated).toBe(false);
    expect(r.reason).toContain("illegal_transition");
    expect(db._tables.scheduled_send_ledger[0].state).toBe(LEDGER_STATES.PROVIDER_FAILED);
  });

  it("a LATER run recovers provider_failed via fenced takeover, never direct write", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_FAILED });
    // Direct write by a different run is refused: not the owner.
    const direct = await recordLedgerOutcome(db, {
      ...ARGS,
      runId: "run_2_recovery",
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "msg_2",
    });
    expect(direct.updated).toBe(false);
    expect(direct.reason).toBe("not_owner");
    // The fenced path: atomic takeover, then the outcome as the new owner.
    const take = await takeoverLedgerRow(db, { ...ARGS, runId: "run_2_recovery" });
    expect(take.taken).toBe(true);
    const r = await recordLedgerOutcome(db, {
      ...ARGS,
      runId: "run_2_recovery",
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "msg_2",
    });
    expect(r.updated).toBe(true);
    expect(db._tables.scheduled_send_ledger[0].state).toBe(LEDGER_STATES.PROVIDER_ACCEPTED);
  });

  it("an old worker cannot overwrite a newer generation's outcome", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_FAILED });
    const take = await takeoverLedgerRow(db, { ...ARGS, runId: "run_2" });
    expect(take.taken).toBe(true);
    // The crashed first run wakes up late and tries to record: refused.
    const stale = await recordLedgerOutcome(db, {
      ...ARGS,
      runId: "run_1",
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
    });
    expect(stale.updated).toBe(false);
    expect(stale.reason).toBe("not_owner");
    expect(db._tables.scheduled_send_ledger[0].run_id).toBe("run_2");
  });

  it("delivered and no_op are terminal", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_ACCEPTED });
    await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.DELIVERED });
    const r = await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_FAILED });
    expect(r.updated).toBe(false);
    expect(db._tables.scheduled_send_ledger[0].state).toBe(LEDGER_STATES.DELIVERED);

    const db2 = makeDb();
    await claimLedgerRow(db2, ARGS);
    await recordLedgerOutcome(db2, { ...ARGS, state: LEDGER_STATES.NO_OP });
    const r2 = await recordLedgerOutcome(db2, { ...ARGS, state: LEDGER_STATES.CLAIMED });
    expect(r2.updated).toBe(false);
    expect(db2._tables.scheduled_send_ledger[0].state).toBe(LEDGER_STATES.NO_OP);
  });

  it("refuses outcome for a missing row", async () => {
    const db = makeDb();
    const r = await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_ACCEPTED });
    expect(r.updated).toBe(false);
    expect(r.reason).toBe("no_ledger_row");
  });
});

describe("recordDeliveryAttempt (RDL-004)", () => {
  async function claimedDb() {
    const db = makeDb();
    const { row } = await claimLedgerRow(db, ARGS);
    return { db, ledgerId: row.id };
  }

  it("records two successful deliveries to one recipient without clobbering", async () => {
    const { db, ledgerId } = await claimedDb();
    await recordDeliveryAttempt(db, {
      ledgerId,
      deliveryId: "del_1",
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "msg_1",
      runId: "run_1",
    });
    const second = await recordDeliveryAttempt(db, {
      ledgerId,
      deliveryId: "del_2",
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "msg_2",
      runId: "run_1",
    });
    expect(second.recorded).toBe(true);
    expect(second.summaryState).toBe(LEDGER_STATES.PROVIDER_ACCEPTED);
    expect(db._tables.scheduled_send_attempts).toHaveLength(2);
    const summary = db._tables.scheduled_send_ledger[0];
    expect(summary.state).toBe(LEDGER_STATES.PROVIDER_ACCEPTED);
  });

  it("a failed delivery keeps the summary failed despite a later success to the same recipient", async () => {
    const { db, ledgerId } = await claimedDb();
    await recordDeliveryAttempt(db, {
      ledgerId,
      deliveryId: "del_1",
      state: LEDGER_STATES.PROVIDER_FAILED,
      failureReason: "Resend 500",
      runId: "run_1",
    });
    const second = await recordDeliveryAttempt(db, {
      ledgerId,
      deliveryId: "del_2",
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "msg_2",
      runId: "run_1",
    });
    // Failure first, success second: summary stays failed.
    expect(second.summaryState).toBe(LEDGER_STATES.PROVIDER_FAILED);
    expect(db._tables.scheduled_send_ledger[0].state).toBe(LEDGER_STATES.PROVIDER_FAILED);
    expect(db._tables.scheduled_send_ledger[0].failure_reason).toContain("500");
    // Success first, failure second: same result (order-independent).
    const { db: db2, ledgerId: ledger2 } = await claimedDb();
    await recordDeliveryAttempt(db2, {
      ledgerId: ledger2,
      deliveryId: "del_1",
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "msg_1",
      runId: "run_1",
    });
    const r = await recordDeliveryAttempt(db2, {
      ledgerId: ledger2,
      deliveryId: "del_2",
      state: LEDGER_STATES.PROVIDER_FAILED,
      failureReason: "timeout",
      runId: "run_1",
    });
    expect(r.summaryState).toBe(LEDGER_STATES.PROVIDER_FAILED);
  });

  it("a failure clears only when THAT delivery is retried to accepted", async () => {
    const { db, ledgerId } = await claimedDb();
    await recordDeliveryAttempt(db, {
      ledgerId,
      deliveryId: "del_1",
      state: LEDGER_STATES.PROVIDER_FAILED,
      failureReason: "Resend 500",
      runId: "run_1",
    });
    await recordDeliveryAttempt(db, {
      ledgerId,
      deliveryId: "del_2",
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "msg_2",
      runId: "run_1",
    });
    expect(db._tables.scheduled_send_ledger[0].state).toBe(LEDGER_STATES.PROVIDER_FAILED);
    // A later run retries del_1 successfully: now the summary flips.
    const recovered = await recordDeliveryAttempt(db, {
      ledgerId,
      deliveryId: "del_1",
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "msg_1_retry",
      runId: "run_2",
    });
    expect(recovered.summaryState).toBe(LEDGER_STATES.PROVIDER_ACCEPTED);
    expect(db._tables.scheduled_send_ledger[0].state).toBe(LEDGER_STATES.PROVIDER_ACCEPTED);
    expect(db._tables.scheduled_send_ledger[0].provider_message_id).toBe("msg_1_retry");
    expect(db._tables.scheduled_send_ledger[0].failure_reason).toBeNull();
  });

  it("a stale worker's older attempt does not clobber a newer one", async () => {
    const { db, ledgerId } = await claimedDb();
    await recordDeliveryAttempt(db, {
      ledgerId,
      deliveryId: "del_1",
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "msg_new",
      runId: "run_2",
    });
    // Simulate the stale worker's late write landing with an older timestamp.
    const attempts = db._tables.scheduled_send_attempts;
    attempts.push({
      id: "stale",
      ledger_id: ledgerId,
      delivery_id: "del_1",
      state: LEDGER_STATES.PROVIDER_FAILED,
      failure_reason: "late duplicate",
      attempted_at: "2000-01-01T00:00:00.000Z",
    });
    // A subsequent derivation (triggered by any new attempt) still uses the
    // newest attempt per delivery.
    const r = await recordDeliveryAttempt(db, {
      ledgerId,
      deliveryId: "del_2",
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "msg_2",
      runId: "run_2",
    });
    expect(r.summaryState).toBe(LEDGER_STATES.PROVIDER_ACCEPTED);
  });

  it("rejects invalid attempt states", async () => {
    const { db, ledgerId } = await claimedDb();
    await expect(
      recordDeliveryAttempt(db, { ledgerId, deliveryId: "del_1", state: "claimed", runId: "run_1" }),
    ).rejects.toThrow(/invalid attempt state/);
  });
});

describe("readAttemptsForSlot", () => {
  it("returns attempts for the slot's ledger rows", async () => {
    const db = makeDb();
    const { row } = await claimLedgerRow(db, ARGS);
    await recordDeliveryAttempt(db, {
      ledgerId: row.id,
      deliveryId: "del_1",
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      runId: "run_1",
    });
    const attempts = await readAttemptsForSlot(db, {
      scheduleName: ARGS.scheduleName,
      scheduledSlot: ARGS.scheduledSlot,
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ delivery_id: "del_1", state: "provider_accepted" });
    const other = await readAttemptsForSlot(db, {
      scheduleName: ARGS.scheduleName,
      scheduledSlot: "2026-10-13",
    });
    expect(other).toEqual([]);
  });
});

describe("readLedgerForSlot", () => {
  it("returns only rows for the requested schedule+slot", async () => {
    const db = makeDb();
    await claimLedgerRow(db, ARGS);
    await claimLedgerRow(db, { ...ARGS, scheduleName: SCHEDULE_NAMES.PF_PAYMENT_RECEIPTS });
    const rows = await readLedgerForSlot(db, {
      scheduleName: SCHEDULE_NAMES.TENANT_INVITE,
      scheduledSlot: "2026-10-12",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_allowlist_id).toBe("rental_tenant_test_1");
  });
});

describe("predicates", () => {
  it("isTerminalLedgerState matches the agreed terminal set", () => {
    expect(isTerminalLedgerState("provider_accepted")).toBe(true);
    expect(isTerminalLedgerState("provider_failed")).toBe(true);
    expect(isTerminalLedgerState("delivered")).toBe(true);
    expect(isTerminalLedgerState("no_op")).toBe(true);
    expect(isTerminalLedgerState("claimed")).toBe(false);
  });

  it("isPositiveSendEvidence is narrower than terminal (RDL-001)", () => {
    expect(isPositiveSendEvidence("provider_accepted")).toBe(true);
    expect(isPositiveSendEvidence("delivered")).toBe(true);
    // provider_failed is terminal-for-monitoring but NEVER send evidence.
    expect(isPositiveSendEvidence("provider_failed")).toBe(false);
    expect(isPositiveSendEvidence("no_op")).toBe(false);
    expect(isPositiveSendEvidence("claimed")).toBe(false);
  });

  it("isAllowedLedgerTransition enforces the map", () => {
    expect(isAllowedLedgerTransition("claimed", "provider_accepted")).toBe(true);
    expect(isAllowedLedgerTransition("claimed", "delivered")).toBe(false);
    expect(isAllowedLedgerTransition("no_op", "claimed")).toBe(false);
    expect(
      isAllowedLedgerTransition("provider_failed", "provider_accepted", {
        fromRunId: "a",
        toRunId: "a",
      }),
    ).toBe(false);
    expect(
      isAllowedLedgerTransition("provider_failed", "provider_accepted", {
        fromRunId: "a",
        toRunId: "b",
      }),
    ).toBe(true);
  });
});
