import { describe, expect, it } from "vitest";
import { planOverpaymentCreditApplications } from "../credit-auto-apply";

describe("planOverpaymentCreditApplications", () => {
  it("applies the Barnhill credit in full: $1,850 charge, $666.13 open", () => {
    const plan = planOverpaymentCreditApplications({ chargeAmountCents: 185000,
      credits: [{ id: "credit_1", remainingCents: 66613, createdAt: "2026-10-13T00:00:00.000Z" }] });
    expect(plan.applications).toEqual([{ creditId: "credit_1", amountCents: 66613 }]);
    expect(plan.totalAppliedCents).toBe(66613);
  });
  it("caps at the charge amount when the credit is larger, leaving the remainder open", () => {
    const plan = planOverpaymentCreditApplications({ chargeAmountCents: 100000,
      credits: [{ id: "credit_1", remainingCents: 150000, createdAt: "2026-10-13T00:00:00.000Z" }] });
    expect(plan.applications).toEqual([{ creditId: "credit_1", amountCents: 100000 }]);
    expect(plan.totalAppliedCents).toBe(100000);
  });
  it("drains oldest-first across multiple credits", () => {
    const plan = planOverpaymentCreditApplications({ chargeAmountCents: 60000, credits: [
      { id: "credit_2", remainingCents: 50000, createdAt: "2026-10-20T00:00:00.000Z" },
      { id: "credit_1", remainingCents: 30000, createdAt: "2026-10-13T00:00:00.000Z" },
    ] });
    expect(plan.applications).toEqual([
      { creditId: "credit_1", amountCents: 30000 },
      { creditId: "credit_2", amountCents: 30000 },
    ]);
    expect(plan.totalAppliedCents).toBe(60000);
  });
  it("breaks created-at ties by id for a stable order", () => {
    const plan = planOverpaymentCreditApplications({ chargeAmountCents: 10000, credits: [
      { id: "credit_b", remainingCents: 10000, createdAt: "2026-10-13T00:00:00.000Z" },
      { id: "credit_a", remainingCents: 10000, createdAt: "2026-10-13T00:00:00.000Z" },
    ] });
    expect(plan.applications).toEqual([{ creditId: "credit_a", amountCents: 10000 }]);
  });
  it("emits nothing when no credits are open", () => {
    const plan = planOverpaymentCreditApplications({ chargeAmountCents: 185000, credits: [] });
    expect(plan.applications).toEqual([]);
    expect(plan.totalAppliedCents).toBe(0);
  });
  it("skips exhausted credits instead of emitting zero applications", () => {
    const plan = planOverpaymentCreditApplications({ chargeAmountCents: 185000, credits: [
      { id: "credit_0", remainingCents: 0, createdAt: "2026-10-01T00:00:00.000Z" },
      { id: "credit_1", remainingCents: 5000, createdAt: "2026-10-13T00:00:00.000Z" },
    ] });
    expect(plan.applications).toEqual([{ creditId: "credit_1", amountCents: 5000 }]);
  });
  it("rejects a non-positive charge amount", () => {
    expect(() => planOverpaymentCreditApplications({ chargeAmountCents: 0, credits: [] })).toThrow();
  });
});
