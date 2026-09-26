import { describe, expect, it } from "vitest";
import {
  DEPOSIT_STATE_DEPOSITED,
  DEPOSIT_STATE_RECEIVED,
  MONEY_MOVED_STATUSES,
  depositStateLabel,
  isAwaitingDeposit,
  normalizeDepositState,
  paymentNetCents,
  resolveDepositState,
} from "./paymentDepositState";

describe("resolveDepositState", () => {
  it("honors an explicit deposit state captured at record time", () => {
    expect(resolveDepositState({ deposit_state: "received" })).toBe(DEPOSIT_STATE_RECEIVED);
    expect(resolveDepositState({ deposit_state: "deposited" })).toBe(DEPOSIT_STATE_DEPOSITED);
  });

  it("defaults rows without the field to received — never silently deposited", () => {
    expect(resolveDepositState({})).toBe(DEPOSIT_STATE_RECEIVED);
    expect(resolveDepositState({ deposit_state: null })).toBe(DEPOSIT_STATE_RECEIVED);
    expect(resolveDepositState({ deposit_state: "bogus" })).toBe(DEPOSIT_STATE_RECEIVED);
  });

  it("treats a paid-out settlement as deposited for pre-migration rows", () => {
    expect(resolveDepositState({}, { status: "paid_out" })).toBe(DEPOSIT_STATE_DEPOSITED);
    expect(resolveDepositState({ deposit_state: null }, { status: "paid_out" })).toBe(DEPOSIT_STATE_DEPOSITED);
  });

  it("does not infer deposited from a pending or available settlement", () => {
    expect(resolveDepositState({}, { status: "pending" })).toBe(DEPOSIT_STATE_RECEIVED);
    expect(resolveDepositState({}, { status: "available" })).toBe(DEPOSIT_STATE_RECEIVED);
    expect(resolveDepositState({}, null)).toBe(DEPOSIT_STATE_RECEIVED);
  });

  it("an explicit state always wins over settlement evidence", () => {
    expect(resolveDepositState({ deposit_state: "received" }, { status: "paid_out" }))
      .toBe(DEPOSIT_STATE_RECEIVED);
  });
});

describe("normalizeDepositState", () => {
  it("coerces unknown values to received", () => {
    expect(normalizeDepositState("deposited")).toBe(DEPOSIT_STATE_DEPOSITED);
    expect(normalizeDepositState("received")).toBe(DEPOSIT_STATE_RECEIVED);
    expect(normalizeDepositState(undefined)).toBe(DEPOSIT_STATE_RECEIVED);
    expect(normalizeDepositState("succeeded")).toBe(DEPOSIT_STATE_RECEIVED);
  });
});

describe("depositStateLabel", () => {
  it("uses plain industry wording for both states", () => {
    expect(depositStateLabel({ deposit_state: "received" })).toBe("Awaiting deposit");
    expect(depositStateLabel({ deposit_state: "deposited" })).toBe("Deposited");
    expect(depositStateLabel({})).toBe("Awaiting deposit");
  });
});

describe("isAwaitingDeposit", () => {
  it("flags succeeded payments that are still received", () => {
    expect(isAwaitingDeposit({ status: "succeeded", deposit_state: "received" })).toBe(true);
    expect(isAwaitingDeposit({ status: "succeeded", deposit_state: "deposited" })).toBe(false);
  });

  it("never flags payments that moved no money", () => {
    for (const status of ["failed", "cancelled", "processing", "created"]) {
      expect(isAwaitingDeposit({ status, deposit_state: "received" })).toBe(false);
    }
  });

  it("flags refunded payments still awaiting deposit on the remaining portion", () => {
    expect(isAwaitingDeposit({ status: "partially_refunded", deposit_state: "received" })).toBe(true);
  });

  it("uses the settlement fallback for rows without the column", () => {
    expect(isAwaitingDeposit({ status: "succeeded" }, { status: "paid_out" })).toBe(false);
    expect(isAwaitingDeposit({ status: "succeeded" }, { status: "pending" })).toBe(true);
  });
});

describe("MONEY_MOVED_STATUSES", () => {
  it("includes the completed and refunded statuses, excludes the rest", () => {
    expect(MONEY_MOVED_STATUSES.has("succeeded")).toBe(true);
    expect(MONEY_MOVED_STATUSES.has("refunded")).toBe(true);
    expect(MONEY_MOVED_STATUSES.has("failed")).toBe(false);
    expect(MONEY_MOVED_STATUSES.has("disputed")).toBe(false);
  });
});

describe("paymentNetCents", () => {
  it("nets refunds out of the moved amount", () => {
    expect(paymentNetCents({ amount_cents: 160000, refunded_amount_cents: 0 })).toBe(160000);
    expect(paymentNetCents({ amount_cents: 160000, refunded_amount_cents: 40000 })).toBe(120000);
    expect(paymentNetCents({})).toBe(0);
  });
});
