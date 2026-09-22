import { describe, expect, it } from "vitest";
import { buildTenantPaymentLedger, buildTenantDepositHistory } from "./tenantPaymentLedger";

const TENANT = "tenant_1";
const OTHER = "tenant_2";

function baseInput(overrides = {}) {
  return {
    tenantId: TENANT,
    charges: [],
    payments: [],
    settlements: [],
    leases: [
      { id: "lease_1", unit_id: "unit_a", property_id: "4800-kent-ave", status: "active" },
    ],
    leaseMemberships: [{ lease_id: "lease_1", tenant_id: TENANT, occupancy_role: "primary" }],
    units: [{ id: "unit_a", property_id: "4800-kent-ave", label: "Main residence" }],
    rentecImports: [],
    ...overrides,
  };
}

const charge = (overrides = {}) => ({
  id: "charge_1", lease_id: "lease_1", period: "2026-08", due_date: "2026-08-01",
  amount_cents: 150000, paid_amount_cents: 0, status: "due", charge_type: "rent", ...overrides,
});
const payment = (overrides = {}) => ({
  id: "pay_1", charge_id: "charge_1", lease_id: "lease_1", tenant_id: TENANT,
  provider: "stripe", provider_payment_id: "pi_1", amount_cents: 150000, refunded_amount_cents: 0,
  status: "succeeded", payment_method: "card", received_at: "2026-08-02T12:00:00Z", created_at: "2026-08-02T12:00:00Z",
  ...overrides,
});

describe("buildTenantPaymentLedger", () => {
  it("builds a chronological ledger with a running balance and correct signs", () => {
    const ledger = buildTenantPaymentLedger(baseInput({
      charges: [charge()],
      payments: [payment()],
    }));
    expect(ledger.entries.map((e) => e.kind)).toEqual(["charge", "payment"]);
    expect(ledger.entries[0].balanceAfterCents).toBe(150000);
    expect(ledger.entries[0].balanceEffectCents).toBe(150000);
    expect(ledger.entries[1].balanceEffectCents).toBe(-150000);
    expect(ledger.entries[1].balanceAfterCents).toBe(0);
    expect(ledger.balanceCents).toBe(0);
    expect(ledger.totals).toEqual({ chargedCents: 150000, paidCents: 150000, refundedCents: 0 });
  });

  it("labels rent, proration, and late fees distinctly", () => {
    const ledger = buildTenantPaymentLedger(baseInput({
      charges: [charge({ id: "c1", charge_type: "rent" }), charge({ id: "c2", charge_type: "proration", amount_cents: 50000 }), charge({ id: "c3", charge_type: "late_fee", amount_cents: 7500 })],
    }));
    const labels = Object.fromEntries(ledger.entries.map((e) => [e.sourceId, e.label]));
    expect(labels.c1).toBe("Rent charge");
    expect(labels.c2).toBe("Prorated rent");
    expect(labels.c3).toBe("Late fee");
  });

  it("failed payments appear but do not reduce tenant balance", () => {
    const ledger = buildTenantPaymentLedger(baseInput({
      charges: [charge({ amount_cents: 100000 })],
      payments: [payment({ status: "failed", amount_cents: 100000 })],
    }));
    const pay = ledger.entries.find((e) => e.kind === "payment");
    expect(pay).toBeTruthy();
    expect(pay.status).toBe("failed");
    expect(pay.balanceEffectCents).toBe(0);
    expect(ledger.totals.paidCents).toBe(0);
    expect(ledger.balanceCents).toBe(100000);
  });

  it("gives failed payments their status and zero balance effect", () => {
    const ledger = buildTenantPaymentLedger(baseInput({
      charges: [charge()],
      payments: [payment({ status: "failed" })],
    }));
    const pay = ledger.entries.find((e) => e.kind === "payment");
    expect(pay.status).toBe("failed");
    expect(pay.balanceEffectCents).toBe(0);
    expect(ledger.balanceCents).toBe(150000);
    expect(ledger.totals.paidCents).toBe(0);
  });

  it("turns refunds into compensating entries linked to their payment", () => {
    const ledger = buildTenantPaymentLedger(baseInput({
      charges: [charge()],
      payments: [payment({ status: "partially_refunded", refunded_amount_cents: 50000 })],
    }));
    const refund = ledger.entries.find((e) => e.kind === "refund");
    expect(refund).toBeTruthy();
    expect(refund.label).toBe("Refund (partial)");
    expect(refund.balanceEffectCents).toBe(50000);
    expect(refund.refundOfPaymentId).toBe("pay_1");
    // 150000 owed - 150000 paid + 50000 refunded = 50000 owed
    expect(ledger.balanceCents).toBe(50000);
    expect(ledger.totals.refundedCents).toBe(50000);
  });

  it("shows each tenant only their own records", () => {
    const ledger = buildTenantPaymentLedger(baseInput({
      charges: [charge()],
      payments: [payment(), payment({ id: "pay_2", tenant_id: OTHER, provider_payment_id: "pi_2" })],
      leaseMemberships: [
        { lease_id: "lease_1", tenant_id: TENANT, occupancy_role: "primary" },
        { lease_id: "lease_1", tenant_id: OTHER, occupancy_role: "co_tenant" },
      ],
    }));
    expect(ledger.entries.filter((e) => e.kind === "payment")).toHaveLength(1);
    expect(ledger.entries.every((e) => e.sourceId !== "pay_2")).toBe(true);
  });

  it("displays duplicate provider rows once, keeping the most final record", () => {
    const ledger = buildTenantPaymentLedger(baseInput({
      payments: [
        payment({ id: "pay_old", status: "processing", created_at: "2026-08-01T12:00:00Z" }),
        payment({ id: "pay_new", status: "succeeded", created_at: "2026-08-02T12:00:00Z" }),
      ],
    }));
    const pays = ledger.entries.filter((e) => e.kind === "payment");
    expect(pays).toHaveLength(1);
    expect(pays[0].sourceId).toBe("pay_new");
    expect(pays[0].status).toBe("succeeded");
  });

  it("attaches settlements as evidence on their payment, never as rows", () => {
    const ledger = buildTenantPaymentLedger(baseInput({
      payments: [payment()],
      settlements: [{ id: "set_1", payment_id: "pay_1", status: "paid_out", net_amount_cents: 145000, provider_payout_id: "po_1" }],
    }));
    expect(ledger.entries.some((e) => e.kind === "settlement")).toBe(false);
    const pay = ledger.entries.find((e) => e.kind === "payment");
    expect(pay.settlement).toEqual({ status: "paid_out", netAmountCents: 145000, providerPayoutId: "po_1" });
  });

  it("retains history for moved-out tenants and keeps original unit context after a unit change", () => {
    const ledger = buildTenantPaymentLedger(baseInput({
      leases: [
        { id: "lease_old", unit_id: "unit_a", property_id: "4800-kent-ave", status: "ended" },
        { id: "lease_new", unit_id: "unit_b", property_id: "145-laxon", status: "active" },
      ],
      leaseMemberships: [
        { lease_id: "lease_old", tenant_id: TENANT, occupancy_role: "primary" },
        { lease_id: "lease_new", tenant_id: TENANT, occupancy_role: "primary" },
      ],
      units: [
        { id: "unit_a", property_id: "4800-kent-ave", label: "Main residence" },
        { id: "unit_b", property_id: "145-laxon", label: "145 Laxon" },
      ],
      charges: [
        charge({ id: "c_old", lease_id: "lease_old", period: "2026-06" }),
        charge({ id: "c_new", lease_id: "lease_new", period: "2026-08" }),
      ],
    }));
    const byId = Object.fromEntries(ledger.entries.map((e) => [e.sourceId, e]));
    expect(byId.c_old.propertyLabel).toBe("4800-kent-ave");
    expect(byId.c_old.unitLabel).toBe("Main residence");
    expect(byId.c_new.propertyLabel).toBe("145-laxon");
    expect(byId.c_new.unitLabel).toBe("145 Laxon");
  });

  it("links applied Rentec imports as evidence and never guesses unlinked ones onto the tenant", () => {
    const ledger = buildTenantPaymentLedger(baseInput({
      charges: [charge({ id: "c1" })],
      payments: [payment({ id: "p1" })],
      rentecImports: [
        { id: "r1", rentec_transaction_id: "rtx_1", lease_id: "lease_1", charge_id: "c1", payment_id: null, amount_cents: 150000, transaction_date: "2026-08-01", category_name: "Rent", status: "applied", rentec_renter_id: "WRONG_GUESS" },
        { id: "r2", rentec_transaction_id: "rtx_2", lease_id: "lease_1", charge_id: null, payment_id: "p1", amount_cents: 150000, transaction_date: "2026-08-02", category_name: "Rent", status: "applied" },
        { id: "r3", rentec_transaction_id: "rtx_3", lease_id: "lease_1", charge_id: null, payment_id: null, amount_cents: 90000, transaction_date: "2026-07-01", category_name: "Rent", status: "applied", rentec_renter_id: "SOME_RENTER" },
        { id: "r4", rentec_transaction_id: "rtx_4", lease_id: "lease_1", charge_id: null, payment_id: null, amount_cents: 100, transaction_date: "2026-07-01", category_name: "Fee", status: "rejected" },
      ],
    }));
    const chargeEntry = ledger.entries.find((e) => e.sourceId === "c1");
    const paymentEntry = ledger.entries.find((e) => e.sourceId === "p1");
    expect(chargeEntry.rentecEvidence).toHaveLength(1);
    expect(chargeEntry.rentecEvidence[0].rentecTransactionId).toBe("rtx_1");
    expect(paymentEntry.rentecEvidence).toHaveLength(1);
    // Unlinked-but-lease-linked applied row is unassigned — never attributed via rentec_renter_id.
    expect(ledger.unassigned).toHaveLength(1);
    expect(ledger.unassigned[0].rentecTransactionId).toBe("rtx_3");
    expect(ledger.unassigned[0].reason).toMatch(/needs review/i);
    // Rejected rows are excluded entirely.
    expect(ledger.rejectedRentecCount).toBe(1);
    expect(ledger.entries.some((e) => e.rentecEvidence?.some((ev) => ev.rentecTransactionId === "rtx_4"))).toBe(false);
  });

  it("ignores Rentec imports linked elsewhere — nothing is redundant on every tenant ledger", () => {
    const ledger = buildTenantPaymentLedger(baseInput({
      charges: [charge({ id: "c1" })],
      payments: [payment({ id: "p1" })],
      rentecImports: [
        // Linked to another tenant's charge: belongs on that tenant's ledger, not this one.
        { id: "r_other", rentec_transaction_id: "rtx_other", lease_id: "lease_9", charge_id: "c_other", payment_id: null, amount_cents: 150000, transaction_date: "2026-08-01", category_name: "Rent", status: "applied" },
        // Fully unlinked workspace row: belongs to the property ledger / import queue.
        { id: "r_orphan", rentec_transaction_id: "rtx_orphan", lease_id: null, charge_id: null, payment_id: null, amount_cents: 5000, transaction_date: "2026-08-01", category_name: "Supplies", status: "applied" },
      ],
    }));
    expect(ledger.unassigned).toHaveLength(0);
    expect(ledger.entries.every((e) => (e.rentecEvidence || []).length === 0)).toBe(true);
  });

  it("exposes the last 3 payments most-recent-first", () => {
    const ledger = buildTenantPaymentLedger(baseInput({
      payments: [1, 2, 3, 4, 5].map((n) => payment({
        id: `pay_${n}`, provider_payment_id: `pi_${n}`,
        received_at: `2026-0${n}-15T12:00:00Z`, created_at: `2026-0${n}-15T12:00:00Z`,
      })),
    }));
    expect(ledger.last3.map((e) => e.sourceId)).toEqual(["pay_5", "pay_4", "pay_3"]);
  });

  it("carries method, status, period, property/unit, and reference on every entry", () => {
    const ledger = buildTenantPaymentLedger(baseInput({
      charges: [charge()],
      payments: [payment({ receipt_reference: "RCPT-9" })],
    }));
    for (const entry of ledger.entries) {
      expect(entry.date).toBeTruthy();
      expect(entry.propertyLabel).toBeTruthy();
      expect(entry.unitLabel).toBeTruthy();
      expect(entry.reference).toBeTruthy();
    }
    const pay = ledger.entries.find((e) => e.kind === "payment");
    expect(pay.method).toBe("card");
    expect(pay.reference).toBe("RCPT-9");
    const chg = ledger.entries.find((e) => e.kind === "charge");
    expect(chg.period).toBe("2026-08");
  });
});

describe("buildTenantDepositHistory", () => {
  it("keeps deposits in their own ledger with custody-style running balances, never labeled rent", () => {
    const history = buildTenantDepositHistory({
      tenantId: TENANT,
      deposits: [{ id: "dep_1", tenant_id: TENANT, lease_id: "lease_1", required_amount_cents: 150000 }],
      depositTransactions: [
        { id: "t1", deposit_id: "dep_1", transaction_type: "received", amount_cents: 150000, occurred_at: "2026-08-01" },
        { id: "t2", deposit_id: "dep_1", transaction_type: "deduction", amount_cents: 20000, occurred_at: "2026-09-01", description: "Carpet repair" },
        { id: "t3", deposit_id: "dep_1", transaction_type: "refunded", amount_cents: 130000, occurred_at: "2026-09-15" },
      ],
    });
    expect(history.entries.map((e) => e.label)).toEqual(["Deposit received", "Deposit deduction", "Deposit refunded"]);
    expect(history.entries.map((e) => e.balanceAfterCents)).toEqual([150000, 130000, 0]);
    expect(history.heldCents).toBe(0);
    expect(history.requiredCents).toBe(150000);
    expect(history.entries.every((e) => !/rent/i.test(e.label))).toBe(true);
  });

  it("scopes deposit transactions to the tenant's own deposits", () => {
    const history = buildTenantDepositHistory({
      tenantId: TENANT,
      deposits: [
        { id: "dep_1", tenant_id: TENANT, lease_id: "lease_1", required_amount_cents: 100 },
        { id: "dep_2", tenant_id: OTHER, lease_id: "lease_2", required_amount_cents: 100 },
      ],
      depositTransactions: [
        { id: "t1", deposit_id: "dep_1", transaction_type: "received", amount_cents: 100, occurred_at: "2026-08-01" },
        { id: "t2", deposit_id: "dep_2", transaction_type: "received", amount_cents: 100, occurred_at: "2026-08-01" },
      ],
    });
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].depositId).toBe("dep_1");
  });
});
