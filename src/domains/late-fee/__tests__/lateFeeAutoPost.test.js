import { describe, expect, it } from "vitest";
import {
  LATE_FEE_SOURCE_KEY_PREFIX,
  buildLateFeeChargeRow,
  computeLateFeeCents,
  isChargeLateFeeEligible,
  lateFeeSourceKey,
  normalizeLateFeeSettings,
  resolveLateFeePolicy,
} from "../lateFeeAutoPost.js";

const fixedSettings = {
  late_fee_auto_post: true,
  late_fee_grace_days: 5,
  late_fee_calculation_type: "fixed",
  late_fee_fixed_amount_cents: 7500,
  late_fee_percentage_basis_points: null,
  late_fee_maximum_amount_cents: null,
};

const percentSettings = {
  late_fee_auto_post: true,
  late_fee_grace_days: 3,
  late_fee_calculation_type: "percentage",
  late_fee_fixed_amount_cents: null,
  late_fee_percentage_basis_points: 500, // 5%
  late_fee_maximum_amount_cents: 10000,
};

function rentCharge(overrides = {}) {
  return {
    id: "charge_1", leaseId: "lease_1", scheduleId: "schedule_1",
    chargeType: "rent", amountCents: 160000, paidAmountCents: 0,
    dueDate: "2026-09-01", status: "due", currencyCode: "USD", period: "2026-09",
    ...overrides,
  };
}

describe("normalizeLateFeeSettings", () => {
  it("returns null when the auto-post toggle is off", () => {
    expect(normalizeLateFeeSettings({ ...fixedSettings, late_fee_auto_post: false })).toBeNull();
  });
  it("returns null when settings are missing entirely", () => {
    expect(normalizeLateFeeSettings(null)).toBeNull();
    expect(normalizeLateFeeSettings(undefined)).toBeNull();
  });
  it("returns null when the calculation is incomplete", () => {
    expect(normalizeLateFeeSettings({ ...fixedSettings, late_fee_fixed_amount_cents: null })).toBeNull();
    expect(normalizeLateFeeSettings({ ...percentSettings, late_fee_percentage_basis_points: 0 })).toBeNull();
  });
  it("normalizes a fixed policy", () => {
    expect(normalizeLateFeeSettings(fixedSettings)).toEqual({
      graceDays: 5, calculationType: "fixed", fixedAmountCents: 7500, maximumAmountCents: null,
    });
  });
  it("normalizes a percentage policy with a cap", () => {
    expect(normalizeLateFeeSettings(percentSettings)).toEqual({
      graceDays: 3, calculationType: "percentage", percentageBasisPoints: 500, maximumAmountCents: 10000,
    });
  });
});

describe("resolveLateFeePolicy", () => {
  it("exempt override wins over everything", () => {
    expect(resolveLateFeePolicy({ settings: fixedSettings, override: { exempt: true } }))
      .toEqual({ exempt: true });
  });
  it("override grace days replace the portfolio default", () => {
    const policy = resolveLateFeePolicy({ settings: fixedSettings, override: { grace_days: 10 } });
    expect(policy.graceDays).toBe(10);
    expect(policy.fixedAmountCents).toBe(7500);
  });
  it("override calculation type replaces the portfolio default cleanly", () => {
    const policy = resolveLateFeePolicy({
      settings: fixedSettings,
      override: { calculation_type: "percentage", percentage_basis_points: 1000 },
    });
    expect(policy.calculationType).toBe("percentage");
    expect(policy.percentageBasisPoints).toBe(1000);
    expect(policy.fixedAmountCents).toBeUndefined();
  });
  it("an empty override falls back to the portfolio policy", () => {
    expect(resolveLateFeePolicy({ settings: fixedSettings, override: {} }))
      .toEqual(normalizeLateFeeSettings(fixedSettings));
  });
  it("no override returns the portfolio policy", () => {
    expect(resolveLateFeePolicy({ settings: fixedSettings, override: null }))
      .toEqual(normalizeLateFeeSettings(fixedSettings));
  });
  it("override cannot invent a policy when auto-post is off", () => {
    expect(resolveLateFeePolicy({
      settings: { ...fixedSettings, late_fee_auto_post: false },
      override: { grace_days: 2 },
    })).toBeNull();
  });
});

describe("isChargeLateFeeEligible", () => {
  const policy = normalizeLateFeeSettings(fixedSettings);
  it("is eligible once grace has fully expired", () => {
    // due 2026-09-01 + 5 grace days = 2026-09-06; eligible from 2026-09-07
    expect(isChargeLateFeeEligible({ charge: rentCharge(), policy, asOfDate: "2026-09-07" })).toBe(true);
  });
  it("is not eligible on the grace-expiry day itself (matches the manual RPC boundary)", () => {
    expect(isChargeLateFeeEligible({ charge: rentCharge(), policy, asOfDate: "2026-09-06" })).toBe(false);
  });
  it("is not eligible before grace expires", () => {
    expect(isChargeLateFeeEligible({ charge: rentCharge(), policy, asOfDate: "2026-09-03" })).toBe(false);
  });
  it("is not eligible when the charge is paid or void", () => {
    expect(isChargeLateFeeEligible({ charge: rentCharge({ status: "paid", paidAmountCents: 160000 }), policy, asOfDate: "2026-09-07" })).toBe(false);
    expect(isChargeLateFeeEligible({ charge: rentCharge({ status: "void" }), policy, asOfDate: "2026-09-07" })).toBe(false);
  });
  it("is not eligible when nothing is unpaid", () => {
    expect(isChargeLateFeeEligible({ charge: rentCharge({ paidAmountCents: 160000, status: "partially_paid" }), policy, asOfDate: "2026-09-07" })).toBe(false);
  });
  it("never compounds: late_fee charges are not eligible", () => {
    expect(isChargeLateFeeEligible({ charge: rentCharge({ chargeType: "late_fee" }), policy, asOfDate: "2026-09-07" })).toBe(false);
  });
  it("never touches ad-hoc charge types", () => {
    expect(isChargeLateFeeEligible({ charge: rentCharge({ chargeType: "utility" }), policy, asOfDate: "2026-09-07" })).toBe(false);
  });
  it("an exempt tenant is never eligible", () => {
    expect(isChargeLateFeeEligible({ charge: rentCharge(), policy: { exempt: true }, asOfDate: "2026-09-07" })).toBe(false);
  });
  it("a partially paid charge is eligible on its remaining balance", () => {
    expect(isChargeLateFeeEligible({ charge: rentCharge({ status: "partially_paid", paidAmountCents: 60000 }), policy, asOfDate: "2026-09-07" })).toBe(true);
  });
});

describe("computeLateFeeCents", () => {
  it("returns the fixed amount", () => {
    expect(computeLateFeeCents({ unpaidCents: 160000, policy: normalizeLateFeeSettings(fixedSettings) })).toBe(7500);
  });
  it("computes percentage on the unpaid balance with ceil", () => {
    // 5% of 100001 = 5000.05 → ceil 5001
    expect(computeLateFeeCents({ unpaidCents: 100001, policy: normalizeLateFeeSettings(percentSettings) })).toBe(5001);
  });
  it("honors the maximum cap", () => {
    // 5% of 160000 = 8000 → under the 10000 cap
    expect(computeLateFeeCents({ unpaidCents: 160000, policy: normalizeLateFeeSettings(percentSettings) })).toBe(8000);
    // 5% of 400000 = 20000 → capped at 10000
    expect(computeLateFeeCents({ unpaidCents: 400000, policy: normalizeLateFeeSettings(percentSettings) })).toBe(10000);
  });
  it("returns zero for exempt or missing policy", () => {
    expect(computeLateFeeCents({ unpaidCents: 160000, policy: { exempt: true } })).toBe(0);
    expect(computeLateFeeCents({ unpaidCents: 160000, policy: null })).toBe(0);
  });
});

describe("lateFeeSourceKey", () => {
  it("is stable per charge — the idempotency key", () => {
    expect(lateFeeSourceKey("charge_1")).toBe(lateFeeSourceKey("charge_1"));
    expect(lateFeeSourceKey("charge_1")).toBe(`${LATE_FEE_SOURCE_KEY_PREFIX}charge_1`);
    expect(lateFeeSourceKey("charge_2")).not.toBe(lateFeeSourceKey("charge_1"));
  });
});

describe("buildLateFeeChargeRow", () => {
  const policy = normalizeLateFeeSettings(fixedSettings);
  it("builds a complete late_fee charge row linked to its source charge", () => {
    const row = buildLateFeeChargeRow({
      ownerId: "owner_1", charge: rentCharge(), policy,
      asOfDate: "2026-09-07", now: "2026-09-07T11:00:00.000Z",
    });
    expect(row.owner_id).toBe("owner_1");
    expect(row.lease_id).toBe("lease_1");
    expect(row.charge_type).toBe("late_fee");
    expect(row.amount_cents).toBe(7500);
    expect(row.paid_amount_cents).toBe(0);
    expect(row.status).toBe("due");
    expect(row.due_date).toBe("2026-09-07");
    expect(row.source_key).toBe("latefee:auto:charge_1");
    expect(row.related_charge_id).toBe("charge_1");
    expect(row.notes).toContain("5-day grace");
  });
  it("uses the percentage policy when the override switches calculation", () => {
    const overridePolicy = resolveLateFeePolicy({
      settings: fixedSettings,
      override: { calculation_type: "percentage", percentage_basis_points: 1000 },
    });
    const row = buildLateFeeChargeRow({
      ownerId: "owner_1", charge: rentCharge(), policy: overridePolicy,
      asOfDate: "2026-09-07", now: "2026-09-07T11:00:00.000Z",
    });
    expect(row.amount_cents).toBe(16000); // 10% of 160000
  });
  it("refuses to build for an ineligible charge", () => {
    expect(() => buildLateFeeChargeRow({
      ownerId: "owner_1", charge: rentCharge(), policy, asOfDate: "2026-09-03",
    })).toThrow("not eligible");
  });
});
