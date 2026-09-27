import { describe, expect, it } from "vitest";
import { buildBankLedger } from "./bankLedger";

const event = (overrides = {}) => ({
  id: `evt-${Math.random().toString(36).slice(2, 10)}`,
  event_date: "2026-09-01",
  description: "Test event",
  amount: 100,
  transaction_kind: "income",
  normalized_category: "rental_income",
  status: "active",
  is_deleted: false,
  source_system: "manual",
  ...overrides,
});

describe("buildBankLedger", () => {
  it("posts income to credit and expense to debit with a running balance", () => {
    const ledger = buildBankLedger({
      financialEvents: [
        event({ id: "a", event_date: "2026-09-01", amount: 1600, transaction_kind: "income", description: "Rent received" }),
        event({ id: "b", event_date: "2026-09-02", amount: 250, transaction_kind: "expense", description: "Plumber" }),
        event({ id: "c", event_date: "2026-09-03", amount: 75.5, transaction_kind: "income", description: "Late fee" }),
      ],
    });
    expect(ledger.entryCount).toBe(3);
    expect(ledger.entries[0]).toMatchObject({ creditCents: 160000, debitCents: 0, balanceAfterCents: 160000 });
    expect(ledger.entries[1]).toMatchObject({ creditCents: 0, debitCents: 25000, balanceAfterCents: 135000 });
    expect(ledger.entries[2]).toMatchObject({ creditCents: 7550, debitCents: 0, balanceAfterCents: 142550 });
    expect(ledger.balanceCents).toBe(142550);
  });

  it("sorts by date then id for a stable same-date order", () => {
    const ledger = buildBankLedger({
      financialEvents: [
        event({ id: "z", event_date: "2026-09-05", amount: 10, transaction_kind: "expense" }),
        event({ id: "a", event_date: "2026-09-01", amount: 10, transaction_kind: "expense" }),
        event({ id: "m", event_date: "2026-09-05", amount: 10, transaction_kind: "expense" }),
      ],
    });
    expect(ledger.entries.map((e) => e.sourceId)).toEqual(["a", "m", "z"]);
    // Balance still accumulates in register order.
    expect(ledger.entries[2].balanceAfterCents).toBe(-3000);
  });

  it("skips deleted, inactive, and non income/expense rows", () => {
    const ledger = buildBankLedger({
      financialEvents: [
        event({ id: "ok", amount: 100, transaction_kind: "income" }),
        event({ id: "del", amount: 999, transaction_kind: "income", is_deleted: true }),
        event({ id: "inact", amount: 999, transaction_kind: "income", status: "inactive" }),
        event({ id: "xfer", amount: 999, transaction_kind: "transfer" }),
      ],
    });
    expect(ledger.entryCount).toBe(1);
    expect(ledger.entries[0].sourceId).toBe("ok");
  });

  it("carries cleared state and computes cleared balance and uncleared count", () => {
    const ledger = buildBankLedger({
      financialEvents: [
        event({ id: "a", amount: 1000, transaction_kind: "income", cleared: true, cleared_at: "2026-09-02T10:00:00Z" }),
        event({ id: "b", amount: 200, transaction_kind: "expense", cleared: true }),
        event({ id: "c", amount: 50, transaction_kind: "expense", cleared: false }),
      ],
    });
    expect(ledger.clearedBalanceCents).toBe(80000);
    expect(ledger.unclearedCount).toBe(1);
    expect(ledger.balanceCents).toBe(75000);
    expect(ledger.entries[0]).toMatchObject({ cleared: true, clearedAt: "2026-09-02T10:00:00Z" });
    expect(ledger.entries[2].cleared).toBe(false);
  });

  it("carries payee and check number through to entries", () => {
    const ledger = buildBankLedger({
      financialEvents: [
        event({ id: "a", amount: 300, transaction_kind: "expense", payee: "Acme Plumbing", check_number: "1042" }),
      ],
    });
    expect(ledger.entries[0]).toMatchObject({ payee: "Acme Plumbing", checkNumber: "1042" });
  });

  it("rounds decimal amounts to cents deliberately", () => {
    const ledger = buildBankLedger({
      financialEvents: [event({ id: "a", amount: 10.005, transaction_kind: "income" })],
    });
    expect(ledger.entries[0].creditCents).toBe(1001);
  });

  it("returns an empty frozen ledger for no events", () => {
    const ledger = buildBankLedger();
    expect(ledger.entryCount).toBe(0);
    expect(ledger.balanceCents).toBe(0);
    expect(ledger.clearedBalanceCents).toBe(0);
    expect(ledger.unclearedCount).toBe(0);
    expect(Object.isFrozen(ledger)).toBe(true);
  });

  it("carries transfer linkage and counterpart metadata through to entries", () => {
    const ledger = buildBankLedger({
      financialEvents: [
        event({
          id: "out", amount: 500, transaction_kind: "expense",
          transfer_group_id: "transfer_abc",
          metadata: {
            memo: "Owner draw",
            transfer_direction: "out",
            counterpart_account_id: "acct-2",
            counterpart_account_name: "Business Savings",
            counterpart_event_id: "in",
          },
        }),
      ],
    });
    expect(ledger.entries[0]).toMatchObject({
      transferGroupId: "transfer_abc",
      transferDirection: "out",
      counterpartAccountId: "acct-2",
      counterpartAccountName: "Business Savings",
      counterpartEventId: "in",
      memo: "Owner draw",
    });
  });

  it("carries property and tenant labels through to entries", () => {
    const ledger = buildBankLedger({
      financialEvents: [
        event({
          id: "a", amount: 1600, transaction_kind: "income",
          property_id: "prop-1", property_label: "308 Paula",
          tenant_id: "tenant-1", tenant_label: "Eric Carrillo",
        }),
      ],
    });
    expect(ledger.entries[0]).toMatchObject({
      propertyId: "prop-1",
      propertyLabel: "308 Paula",
      tenantId: "tenant-1",
      tenantLabel: "Eric Carrillo",
    });
  });
});
