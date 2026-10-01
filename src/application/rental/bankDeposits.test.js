import { describe, expect, it } from "vitest";
import {
  buildBankDepositId,
  canVoidDeposit,
  depositIsReconciled,
  eventAmountCents,
  serializeBankDeposit,
  validateBankDepositInput,
  validateBankDepositVoid,
} from "./bankDeposits";

const incomeEvent = (overrides = {}) => ({
  id: "event_1",
  amount: 1600.0,
  transaction_kind: "income",
  bank_account_id: null,
  is_deleted: false,
  status: "active",
  metadata: {},
  ...overrides,
});

const goodInput = (overrides = {}) => ({
  id: "rental_bank_deposit_1",
  depositDate: "2026-09-30",
  bankAccountId: "bank_1",
  memo: "September rents",
  items: [{ eventId: "event_1", tender: "check", checkNumber: "4412", receivedFrom: "Eric Carrillo" }],
  ...overrides,
});

describe("validateBankDepositInput", () => {
  it("accepts a well-formed deposit and totals the lines", () => {
    const events = [incomeEvent(), incomeEvent({ id: "event_2", amount: 950.5 })];
    const { valid, errors, value } = validateBankDepositInput(
      goodInput({ items: [{ eventId: "event_1", tender: "cash" }, { eventId: "event_2", tender: "check", checkNumber: "77" }] }),
      { events }
    );
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
    expect(value.totalCents).toBe(160000 + 95050);
    expect(value.itemCount).toBe(2);
    expect(value.items[0]).toMatchObject({ eventId: "event_1", tender: "cash", amountCents: 160000 });
  });

  it("requires at least one receipt", () => {
    const { valid, errors } = validateBankDepositInput(goodInput({ items: [] }), { events: [] });
    expect(valid).toBe(false);
    expect(errors).toContain("Add at least one receipt to the deposit.");
  });

  it("rejects a receipt already recorded against a bank account (no double-banking)", () => {
    const { valid, errors } = validateBankDepositInput(goodInput(), {
      events: [incomeEvent({ bank_account_id: "bank_9" })],
    });
    expect(valid).toBe(false);
    expect(errors).toContain("A receipt already recorded against a bank account cannot be deposited again.");
  });

  it("rejects a receipt already on another deposit", () => {
    const { valid, errors } = validateBankDepositInput(goodInput(), {
      events: [incomeEvent({ metadata: { deposit_id: "rental_bank_deposit_9" } })],
    });
    expect(valid).toBe(false);
    expect(errors).toContain("A receipt on this deposit is already on another deposit.");
  });

  it("rejects non-income and deleted receipts", () => {
    for (const event of [
      incomeEvent({ transaction_kind: "expense" }),
      incomeEvent({ is_deleted: true }),
      incomeEvent({ status: "deleted" }),
    ]) {
      const { valid } = validateBankDepositInput(goodInput(), { events: [event] });
      expect(valid).toBe(false);
    }
  });

  it("rejects a duplicate receipt on the same deposit", () => {
    const { valid, errors } = validateBankDepositInput(
      goodInput({ items: [{ eventId: "event_1", tender: "cash" }, { eventId: "event_1", tender: "cash" }] }),
      { events: [incomeEvent()] }
    );
    expect(valid).toBe(false);
    expect(errors).toContain("The same receipt appears twice on this deposit.");
  });

  it("requires a check number for check-tender lines", () => {
    const { valid, errors } = validateBankDepositInput(
      goodInput({ items: [{ eventId: "event_1", tender: "check" }] }),
      { events: [incomeEvent()] }
    );
    expect(valid).toBe(false);
    expect(errors).toContain("Check lines need a check number.");
  });

  it("requires a valid date and bank account", () => {
    const { valid, errors } = validateBankDepositInput(
      goodInput({ depositDate: "not-a-date", bankAccountId: "" }),
      { events: [incomeEvent()] }
    );
    expect(valid).toBe(false);
    expect(errors).toContain("Enter a valid deposit date (YYYY-MM-DD).");
    expect(errors).toContain("Choose the bank account for this deposit.");
  });

  it("generates an id when none is supplied", () => {
    const { valid, value } = validateBankDepositInput(goodInput({ id: undefined }), { events: [incomeEvent()] });
    expect(valid).toBe(true);
    expect(value.id.startsWith("rental_bank_deposit_")).toBe(true);
  });

  it("buildBankDepositId uses the deposit prefix", () => {
    expect(buildBankDepositId().startsWith("rental_bank_deposit_")).toBe(true);
  });
});

describe("eventAmountCents", () => {
  it("rounds decimal dollars deliberately to cents", () => {
    expect(eventAmountCents({ amount: 950.5 })).toBe(95050);
    expect(eventAmountCents({ amount: 10.005 })).toBe(1001);
    expect(eventAmountCents({ amount: "1600.00" })).toBe(160000);
  });
});

describe("validateBankDepositVoid", () => {
  it("requires an active deposit and a reason", () => {
    expect(validateBankDepositVoid({ reason: "entered wrong account" }, { status: "active" }).valid).toBe(true);
    expect(validateBankDepositVoid({ reason: "" }, { status: "active" }).valid).toBe(false);
    expect(validateBankDepositVoid({ reason: "x" }, { status: "voided" }).valid).toBe(false);
    expect(canVoidDeposit({ status: "active" })).toBe(true);
    expect(canVoidDeposit({ status: "voided" })).toBe(false);
  });
});

describe("depositIsReconciled", () => {
  it("locks the deposit when its lump event is on an active reconciliation", () => {
    const reconciliations = [
      { status: "active", cleared_event_ids: ["event_a", "event_deposit"] },
      { status: "undone", cleared_event_ids: ["event_deposit"] },
    ];
    expect(depositIsReconciled("event_deposit", reconciliations)).toBe(true);
    expect(depositIsReconciled("event_other", reconciliations)).toBe(false);
    expect(depositIsReconciled("event_deposit", [{ status: "undone", cleared_event_ids: ["event_deposit"] }])).toBe(false);
    expect(depositIsReconciled(null, reconciliations)).toBe(false);
  });
});

describe("serializeBankDeposit", () => {
  it("serializes the header with its items", () => {
    const serialized = serializeBankDeposit(
      {
        id: "rental_bank_deposit_1", deposit_date: "2026-09-30", bank_account_id: "bank_1",
        memo: "", total_amount_cents: 160000, item_count: 1, deposit_event_id: "event_d",
        status: "active", void_reason: null, voided_at: null, created_at: "2026-09-30T00:00:00Z", updated_at: null,
      },
      {
        items: [
          { financial_event_id: "event_1", seq: 0, tender: "check", check_number: "4412", received_from: "Eric Carrillo", amount_cents: 160000 },
        ],
      }
    );
    expect(serialized).toMatchObject({
      id: "rental_bank_deposit_1",
      totalAmountCents: 160000,
      itemCount: 1,
      depositEventId: "event_d",
      status: "active",
    });
    expect(serialized.items).toHaveLength(1);
    expect(serialized.items[0]).toMatchObject({ eventId: "event_1", tender: "check", checkNumber: "4412" });
  });
});
