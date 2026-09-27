import { beforeEach, describe, expect, it } from "vitest";
import {
  ReconciliationError,
  listReconciliations,
  saveReconciliation,
  undoReconciliation,
} from "./bankReconciliationService";

// Minimal in-memory stand-in for the Supabase query builder: eq filters,
// order, limit, range, insert/update + select. Enough to exercise the
// service's real read/verify/compute/write sequence.
function fakeDb(tables, { missing = [] } = {}) {
  const from = (name) => {
    let filters = [];
    let op = { kind: "select" };
    let orderBy = null;
    let lim = null;
    let rng = null;
    const q = {
      select() { return q; },
      eq(col, val) { filters.push([col, val]); return q; },
      order(col, { ascending = true } = {}) { orderBy = [col, ascending]; return q; },
      limit(n) { lim = n; return q; },
      range(a, b) { rng = [a, b]; return q; },
      insert(row) { op = { kind: "insert", row }; return q; },
      update(patch) { op = { kind: "update", patch }; return q; },
      then(resolve) {
        if (missing.includes(name)) return resolve({ data: null, error: { code: "42P01", message: `relation "${name}" does not exist` } });
        const rows = tables[name] || (tables[name] = []);
        const match = (r) => filters.every(([c, v]) => r[c] === v);
        if (op.kind === "insert") {
          const row = { id: `rec_${rows.length + 1}`, created_at: "now", ...op.row };
          rows.push(row);
          return resolve({ data: [row], error: null });
        }
        if (op.kind === "update") {
          const hit = rows.filter(match);
          hit.forEach((r) => Object.assign(r, op.patch));
          return resolve({ data: hit.map((r) => ({ ...r })), error: null });
        }
        let out = rows.filter(match).map((r) => ({ ...r }));
        if (orderBy) out.sort((a, b) => (a[orderBy[0]] < b[orderBy[0]] ? -1 : 1) * (orderBy[1] ? 1 : -1));
        if (rng) out = out.slice(rng[0], rng[1] + 1);
        if (lim != null) out = out.slice(0, lim);
        return resolve({ data: out, error: null });
      },
    };
    return q;
  };
  return { from, tables };
}

const OWNER = "owner_1";
const who = { ownerId: OWNER, userId: "user_1" };
const ev = (id, date, kind, amount, cleared = false, clearedAt = null) => ({
  id, owner_id: OWNER, bank_account_id: "acct_1", event_date: date, transaction_kind: kind, amount, description: id,
  cleared, cleared_at: clearedAt, status: "active", is_deleted: false,
});

let db;
beforeEach(() => {
  db = fakeDb({
    financial_accounts: [{ id: "acct_1", owner_id: OWNER, name: "Operating", official_name: null, type: "depository", active: true }],
    financial_events: [
      ev("open", "2026-08-01", "income", 1000, true, "2026-08-05T00:00:00Z"),
      ev("rent1", "2026-09-01", "income", 1500),
      ev("mortgage", "2026-09-05", "expense", 800),
      ev("rent2", "2026-09-30", "income", 1500),
      { ...ev("other", "2026-09-10", "income", 99), bank_account_id: "acct_2" },
    ],
    bank_reconciliations: [],
  });
});

// The client applies its cleared changes (via the existing PATCH) before saving.
const applyCleared = (ids, at = "2026-10-03T00:00:00Z") => {
  for (const e of db.tables.financial_events) if (ids.includes(e.id)) Object.assign(e, { cleared: true, cleared_at: at });
};
const SEPT = { bankAccountId: "acct_1", periodStart: "2026-09-01", periodEnd: "2026-09-30" };
const snapshot = [
  { eventId: "rent1", clearedBefore: false, clearedAtBefore: null, clearedAfter: true },
  { eventId: "mortgage", clearedBefore: false, clearedAtBefore: null, clearedAfter: true },
];

describe("saveReconciliation", () => {
  it("records figures computed from the database, not the client", async () => {
    applyCleared(["rent1", "mortgage"]);
    const { reconciliation, result } = await saveReconciliation(db, who, { ...SEPT, statementEndingBalanceCents: 170000, snapshot });
    expect(result.balanced).toBe(true);
    expect(reconciliation).toMatchObject({
      owner_id: OWNER, bank_account_id: "acct_1", status: "active", created_by: "user_1",
      statement_ending_balance_cents: 170000, cleared_balance_cents: 170000, difference_cents: 0,
      outstanding_count: 1, outstanding_deposits_cents: 150000, outstanding_payments_cents: 0,
      cleared_event_ids: ["rent1", "mortgage"], outstanding_event_ids: ["rent2"],
    });
    expect(reconciliation.cleared_snapshot).toEqual(snapshot);
  });

  it("refuses to record when the cleared changes didn't actually land", async () => {
    applyCleared(["rent1"]); // mortgage PATCH "failed"
    await expect(saveReconciliation(db, who, { ...SEPT, statementEndingBalanceCents: 170000, snapshot })).rejects.toMatchObject({ status: 409 });
    expect(db.tables.bank_reconciliations).toHaveLength(0);
  });

  it("rejects snapshots naming another account's transactions", async () => {
    await expect(
      saveReconciliation(db, who, { ...SEPT, statementEndingBalanceCents: 0, snapshot: [{ eventId: "other", clearedBefore: false, clearedAtBefore: null, clearedAfter: true }] }),
    ).rejects.toThrow(/isn't on this account/);
  });

  it("refuses a statement that isn't after the latest active reconciliation", async () => {
    applyCleared(["rent1", "mortgage"]);
    await saveReconciliation(db, who, { ...SEPT, statementEndingBalanceCents: 170000, snapshot });
    await expect(saveReconciliation(db, who, { ...SEPT, statementEndingBalanceCents: 170000, snapshot: [] })).rejects.toThrow(/already reconciled through 2026-09-30/);
  });

  it("validates the statement and reports a missing table plainly", async () => {
    await expect(saveReconciliation(db, who, { ...SEPT, periodEnd: "", statementEndingBalanceCents: 1, snapshot: [] })).rejects.toBeInstanceOf(ReconciliationError);
    const noTable = fakeDb(db.tables, { missing: ["bank_reconciliations"] });
    expect(await listReconciliations(noTable, OWNER, "acct_1")).toEqual({ available: false, reconciliations: [] });
    await expect(saveReconciliation(noTable, who, { ...SEPT, statementEndingBalanceCents: 0, snapshot: [] })).rejects.toMatchObject({ status: 503 });
  });
});

describe("undoReconciliation", () => {
  it("restores each item's exact prior state and marks the record undone (never deletes)", async () => {
    // This reconciliation also UN-cleared 'open' (cleared 2026-08-05).
    applyCleared(["rent1", "mortgage"]);
    Object.assign(db.tables.financial_events.find((e) => e.id === "open"), { cleared: false, cleared_at: null });
    const snap = [...snapshot, { eventId: "open", clearedBefore: true, clearedAtBefore: "2026-08-05T00:00:00Z", clearedAfter: false }];
    const { reconciliation } = await saveReconciliation(db, who, { ...SEPT, statementEndingBalanceCents: 70000, snapshot: snap });

    const { reconciliation: undone, restored } = await undoReconciliation(db, who, { id: reconciliation.id, reason: "wrong statement" });
    expect(restored).toBe(3);
    const byId = Object.fromEntries(db.tables.financial_events.map((e) => [e.id, e]));
    expect([byId.rent1.cleared, byId.rent1.cleared_at]).toEqual([false, null]);
    expect([byId.mortgage.cleared, byId.mortgage.cleared_at]).toEqual([false, null]);
    expect([byId.open.cleared, byId.open.cleared_at]).toEqual([true, "2026-08-05T00:00:00Z"]); // exact original timestamp
    expect(undone).toMatchObject({ status: "undone", undone_by: "user_1", undo_reason: "wrong statement" });
    expect(db.tables.bank_reconciliations).toHaveLength(1); // still there
  });

  it("won't undo an older reconciliation while a later one is active", async () => {
    applyCleared(["rent1", "mortgage"]);
    const { reconciliation: sept } = await saveReconciliation(db, who, { ...SEPT, statementEndingBalanceCents: 170000, snapshot });
    applyCleared(["rent2"]);
    await saveReconciliation(db, who, { bankAccountId: "acct_1", periodStart: "2026-10-01", periodEnd: "2026-10-31", statementEndingBalanceCents: 320000,
      snapshot: [{ eventId: "rent2", clearedBefore: false, clearedAtBefore: null, clearedAfter: true }] });
    await expect(undoReconciliation(db, who, { id: sept.id })).rejects.toThrow(/Undo the later reconciliation/);
  });
});
