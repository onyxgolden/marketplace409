import { describe, expect, it } from "vitest";
import {
  TENANT_CHARGE_LABELS,
  TENANT_CHARGE_TYPES,
  createExpenseWithTenantCharge,
  createTenantCharge,
  isAutopayCollectibleChargeType,
  validateTenantChargeInput,
} from "./tenantCharges.js";

// Minimal Supabase-shaped mock: chainable filters with real filter semantics
// so the double-billing guard is exercised, not just stubbed.
function makeDb({ leases = [{ id: "lease-1", owner_id: "owner-1", currency_code: "USD" }], charges = [] } = {}) {
  const inserted = [];
  const rpcCalls = [];
  const applyFilters = (rows, filters) => rows.filter((row) => filters.every((f) => {
    const v = row[f.col];
    if (f.op === "eq") return v === f.val;
    if (f.op === "neq") return v !== f.val;
    if (f.op === "is") return f.val === null ? v === null || v === undefined : v === f.val;
    if (f.op === "not-is") return !(v === null || v === undefined);
    if (f.op === "gte") return v >= f.val;
    if (f.op === "lt") return v < f.val;
    return true;
  }));
  class Builder {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.limitN = null;
      this.insertedRow = null;
    }
    select() { return this; }
    eq(col, val) { this.filters.push({ op: "eq", col, val }); return this; }
    neq(col, val) { this.filters.push({ op: "neq", col, val }); return this; }
    is(col, val) { this.filters.push({ op: "is", col, val }); return this; }
    not(col, op, val) { this.filters.push({ op: `not-${op}`, col, val }); return this; }
    gte(col, val) { this.filters.push({ op: "gte", col, val }); return this; }
    lt(col, val) { this.filters.push({ op: "lt", col, val }); return this; }
    limit(n) { this.limitN = n; return this; }
    insert(row) {
      this.insertedRow = row;
      inserted.push(row);
      return this;
    }
    run() {
      if (this.table === "rental_leases") return applyFilters(leases, this.filters);
      if (this.table === "rent_charges") {
        const rows = applyFilters(charges, this.filters);
        return this.limitN === null ? rows : rows.slice(0, this.limitN);
      }
      return [];
    }
    maybeSingle() {
      const rows = this.run();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }
    single() {
      if (this.insertedRow) return Promise.resolve({ data: this.insertedRow, error: null });
      const rows = this.run();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }
    then(resolve, reject) {
      if (this.insertedRow) return Promise.resolve({ data: this.insertedRow, error: null }).then(resolve, reject);
      return Promise.resolve({ data: this.run(), error: null }).then(resolve, reject);
    }
  }
  const db = {
    from: (table) => new Builder(table),
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return { data: { id: "expense-charge-1" }, error: null };
    },
  };
  return { db, inserted, rpcCalls };
}

const baseCharge = {
  ownerId: "owner-1",
  leaseId: "lease-1",
  amountCents: 110323,
  description: "Prorated rent Oct 13-31",
  dueDate: "2026-10-31",
  chargeDate: "2026-10-13",
};

describe("tenantCharges proration type", () => {
  it("accepts proration in validation and labels it Prorated rent", () => {
    expect(TENANT_CHARGE_TYPES).toContain("proration");
    expect(TENANT_CHARGE_LABELS.proration).toBe("Prorated rent");
    const check = validateTenantChargeInput({ ...baseCharge, chargeType: "proration" });
    expect(check.valid).toBe(true);
    expect(check.value.chargeType).toBe("proration");
  });

  it("keeps the existing types valid and rejects unknown types", () => {
    for (const type of ["damage", "fee", "utility", "other"]) {
      expect(validateTenantChargeInput({ ...baseCharge, chargeType: type }).valid).toBe(true);
    }
    expect(validateTenantChargeInput({ ...baseCharge, chargeType: "rent" }).valid).toBe(false);
    expect(validateTenantChargeInput({ ...baseCharge, chargeType: "bogus" }).valid).toBe(false);
  });

  it("keeps proration autopay-collectible like rent", () => {
    expect(isAutopayCollectibleChargeType("proration")).toBe(true);
  });

  it("posts a proration charge schedule-less when no schedule rent exists for the month", async () => {
    const { db, inserted } = makeDb({ charges: [] });
    const row = await createTenantCharge(db, { ...baseCharge, chargeType: "proration" });
    expect(inserted).toHaveLength(1);
    expect(row.schedule_id).toBeNull();
    expect(row.charge_type).toBe("proration");
    expect(row.amount_cents).toBe(110323);
    expect(row.due_date).toBe("2026-10-31");
  });

  it("refuses a proration charge when the schedule already billed rent that month", async () => {
    const { db, inserted } = makeDb({
      charges: [{
        id: "rent-charge-1", owner_id: "owner-1", lease_id: "lease-1", schedule_id: "schedule-1",
        charge_type: "rent", due_date: "2026-10-01", status: "due", voided_at: null,
      }],
    });
    await expect(createTenantCharge(db, { ...baseCharge, chargeType: "proration" }))
      .rejects.toThrow("Rent for October 2026 is already billed by the schedule");
    expect(inserted).toHaveLength(0);
  });

  it("passes when the schedule rent is for a different month", async () => {
    const { db, inserted } = makeDb({
      charges: [{
        id: "rent-charge-1", owner_id: "owner-1", lease_id: "lease-1", schedule_id: "schedule-1",
        charge_type: "rent", due_date: "2026-11-01", status: "due", voided_at: null,
      }],
    });
    await createTenantCharge(db, { ...baseCharge, chargeType: "proration" });
    expect(inserted).toHaveLength(1);
  });

  it("passes when the same-month schedule rent row is voided", async () => {
    const { db, inserted } = makeDb({
      charges: [{
        id: "rent-charge-1", owner_id: "owner-1", lease_id: "lease-1", schedule_id: "schedule-1",
        charge_type: "rent", due_date: "2026-10-01", status: "void", voided_at: "2026-10-20T00:00:00.000Z",
      }],
    });
    await createTenantCharge(db, { ...baseCharge, chargeType: "proration" });
    expect(inserted).toHaveLength(1);
  });

  it("passes when the same-month row is a schedule-less ad-hoc charge, not schedule rent", async () => {
    const { db, inserted } = makeDb({
      charges: [{
        id: "charge-1", owner_id: "owner-1", lease_id: "lease-1", schedule_id: null,
        charge_type: "other", due_date: "2026-10-15", status: "due", voided_at: null,
      }],
    });
    await createTenantCharge(db, { ...baseCharge, chargeType: "proration" });
    expect(inserted).toHaveLength(1);
  });

  it("does not guard the existing types against same-month schedule rent", async () => {
    const { db, inserted } = makeDb({
      charges: [{
        id: "rent-charge-1", owner_id: "owner-1", lease_id: "lease-1", schedule_id: "schedule-1",
        charge_type: "rent", due_date: "2026-10-01", status: "due", voided_at: null,
      }],
    });
    await createTenantCharge(db, { ...baseCharge, chargeType: "fee", description: "Pet fee" });
    expect(inserted).toHaveLength(1);
  });

  it("guards the expense-linked path too: refuses before the RPC fires", async () => {
    const { db, rpcCalls } = makeDb({
      charges: [{
        id: "rent-charge-1", owner_id: "owner-1", lease_id: "lease-1", schedule_id: "schedule-1",
        charge_type: "rent", due_date: "2026-10-01", status: "due", voided_at: null,
      }],
    });
    await expect(createExpenseWithTenantCharge(db, {
      ownerId: "owner-1",
      event: { eventDate: "2026-10-13", description: "Stub", amount: 1103.23 },
      charge: { ...baseCharge, chargeType: "proration" },
    })).rejects.toThrow("already billed by the schedule");
    expect(rpcCalls).toHaveLength(0);
  });

  it("lets the expense-linked proration through when no schedule rent blocks it", async () => {
    const { db, rpcCalls } = makeDb({ charges: [] });
    await createExpenseWithTenantCharge(db, {
      ownerId: "owner-1",
      event: { eventDate: "2026-10-13", description: "Stub", amount: 1103.23 },
      charge: { ...baseCharge, chargeType: "proration" },
    });
    expect(rpcCalls).toHaveLength(1);
  });
});
