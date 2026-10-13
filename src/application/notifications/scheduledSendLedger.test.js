// Unit tests for the scheduled-send ledger contract. Synthetic fixtures
// only: the "db" is an in-memory mock of the supabase-js chainable query
// builder. No network, no real sends.

import { describe, it, expect } from "vitest";
import {
  SCHEDULE_NAMES,
  LEDGER_STATES,
  chicagoSlotFor,
  claimLedgerRow,
  recordLedgerOutcome,
  readLedgerForSlot,
  isTerminalLedgerState,
  isAllowedLedgerTransition,
} from "./scheduledSendLedger.js";

// Deterministic in-memory mock of the supabase-js chainable query builder.
function makeSimpleDb() {
  const rows = [];
  return {
    _rows: rows,
    from(name) {
      if (name !== "scheduled_send_ledger") throw new Error(`unexpected table ${name}`);
      const self = this;
      return {
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
                  const inserted = { id: `ledger_${rows.length + 1}`, ...row };
                  rows.push(inserted);
                  resolve({ data: [inserted], error: null });
                },
              };
            },
          };
        },
        select() {
          const filters = [];
          const chain = {
            eq(col, val) {
              filters.push([col, val]);
              return chain;
            },
            order() {
              return chain;
            },
            async maybeSingle() {
              const found = rows.find((r) => filters.every(([c, v]) => r[c] === v));
              return { data: found ?? null, error: null };
            },
            then(resolve) {
              const found = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
              resolve({ data: found, error: null });
            },
          };
          return chain;
        },
        update(patch) {
          const filters = [];
          const chain = {
            eq(col, val) {
              filters.push([col, val]);
              return chain;
            },
            select() {
              return {
                then(resolve) {
                  const idx = rows.findIndex((r) => filters.every(([c, v]) => r[c] === v));
                  if (idx === -1) {
                    resolve({ data: [], error: null });
                    return;
                  }
                  rows[idx] = { ...rows[idx], ...patch };
                  resolve({ data: [rows[idx]], error: null });
                },
              };
            },
          };
          return chain;
        },
      };
    },
  };
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
    expect(chicagoSlotFor(new Date("2026-10-12T15:00:00.000Z"))).toBe("2026-10-12");
  });
});

describe("claimLedgerRow", () => {
  it("first claim wins; a refire claim loses and returns the existing row", async () => {
    const db = makeSimpleDb();
    const first = await claimLedgerRow(db, ARGS);
    expect(first.claimed).toBe(true);
    expect(first.row.state).toBe(LEDGER_STATES.CLAIMED);

    const second = await claimLedgerRow(db, { ...ARGS, runId: "run_2_refire" });
    expect(second.claimed).toBe(false);
    expect(second.existing.state).toBe(LEDGER_STATES.CLAIMED);
    expect(db._rows).toHaveLength(1);
  });

  it("claims are scoped per (schedule, slot, recipient)", async () => {
    const db = makeSimpleDb();
    await claimLedgerRow(db, ARGS);
    const other = await claimLedgerRow(db, { ...ARGS, recipientAllowlistId: "other" });
    expect(other.claimed).toBe(true);
    expect(db._rows).toHaveLength(2);
  });
});

describe("recordLedgerOutcome", () => {
  it("claimed -> provider_accepted -> delivered is allowed", async () => {
    const db = makeSimpleDb();
    await claimLedgerRow(db, ARGS);
    let r = await recordLedgerOutcome(db, {
      ...ARGS,
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "msg_1",
    });
    expect(r.updated).toBe(true);
    r = await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.DELIVERED });
    expect(r.updated).toBe(true);
    expect(db._rows[0].state).toBe(LEDGER_STATES.DELIVERED);
    expect(db._rows[0].provider_message_id).toBe("msg_1");
  });

  it("claimed -> provider_failed records the failure reason", async () => {
    const db = makeSimpleDb();
    await claimLedgerRow(db, ARGS);
    const r = await recordLedgerOutcome(db, {
      ...ARGS,
      state: LEDGER_STATES.PROVIDER_FAILED,
      failureReason: "Resend rejected email delivery (500).",
    });
    expect(r.updated).toBe(true);
    expect(db._rows[0].state).toBe(LEDGER_STATES.PROVIDER_FAILED);
    expect(db._rows[0].failure_reason).toContain("500");
  });

  it("same run cannot downgrade provider_failed to provider_accepted", async () => {
    const db = makeSimpleDb();
    await claimLedgerRow(db, ARGS);
    await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_FAILED });
    const r = await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_ACCEPTED });
    expect(r.updated).toBe(false);
    expect(r.reason).toContain("illegal_transition");
    expect(db._rows[0].state).toBe(LEDGER_STATES.PROVIDER_FAILED);
  });

  it("a LATER run may recover provider_failed to provider_accepted", async () => {
    const db = makeSimpleDb();
    await claimLedgerRow(db, ARGS);
    await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_FAILED });
    const r = await recordLedgerOutcome(db, {
      ...ARGS,
      runId: "run_2_recovery",
      state: LEDGER_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "msg_2",
    });
    expect(r.updated).toBe(true);
    expect(db._rows[0].state).toBe(LEDGER_STATES.PROVIDER_ACCEPTED);
  });

  it("delivered and no_op are terminal", async () => {
    const db = makeSimpleDb();
    await claimLedgerRow(db, ARGS);
    await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_ACCEPTED });
    await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.DELIVERED });
    const r = await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_FAILED });
    expect(r.updated).toBe(false);
    expect(db._rows[0].state).toBe(LEDGER_STATES.DELIVERED);

    const db2 = makeSimpleDb();
    await claimLedgerRow(db2, ARGS);
    await recordLedgerOutcome(db2, { ...ARGS, state: LEDGER_STATES.NO_OP });
    const r2 = await recordLedgerOutcome(db2, { ...ARGS, state: LEDGER_STATES.CLAIMED });
    expect(r2.updated).toBe(false);
    expect(db2._rows[0].state).toBe(LEDGER_STATES.NO_OP);
  });

  it("refuses outcome for a missing row", async () => {
    const db = makeSimpleDb();
    const r = await recordLedgerOutcome(db, { ...ARGS, state: LEDGER_STATES.PROVIDER_ACCEPTED });
    expect(r.updated).toBe(false);
    expect(r.reason).toBe("no_ledger_row");
  });
});

describe("readLedgerForSlot", () => {
  it("returns only rows for the requested schedule+slot", async () => {
    const db = makeSimpleDb();
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

describe("transition predicates", () => {
  it("isTerminalLedgerState matches the agreed terminal set", () => {
    expect(isTerminalLedgerState("provider_accepted")).toBe(true);
    expect(isTerminalLedgerState("provider_failed")).toBe(true);
    expect(isTerminalLedgerState("delivered")).toBe(true);
    expect(isTerminalLedgerState("no_op")).toBe(true);
    expect(isTerminalLedgerState("claimed")).toBe(false);
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
