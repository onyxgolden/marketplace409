import { describe, expect, it } from "vitest";
import { buildLandlordPaymentAccountUpdate, resolveLandlordPaymentAccountStatus } from "./landlordPaymentAccountStatus.js";

const base = Object.freeze({
  accountClosed: false, chargesEnabled: false, payoutsEnabled: false, achDebitEnabled: false,
  cardPaymentsEnabled: false, onboardingStarted: false, requirementsDue: [],
});

describe("resolveLandlordPaymentAccountStatus", () => {
  it("is ready/enabled only when charges and payouts are both genuinely active", () => {
    expect(resolveLandlordPaymentAccountStatus({ ...base, chargesEnabled: true, payoutsEnabled: true })).toBe("enabled");
  });
  it("is not enabled merely because charges are active while payouts are not", () => {
    expect(resolveLandlordPaymentAccountStatus({ ...base, chargesEnabled: true, payoutsEnabled: false })).not.toBe("enabled");
  });
  it("is not enabled merely because payouts are active while charges are not", () => {
    expect(resolveLandlordPaymentAccountStatus({ ...base, chargesEnabled: false, payoutsEnabled: true })).not.toBe("enabled");
  });
  it("is onboarding when nothing has been reported yet (fresh account, no requirements, no active capability)", () => {
    expect(resolveLandlordPaymentAccountStatus({ ...base, onboardingStarted: false })).toBe("onboarding");
  });
  it("is restricted when requirements are currently due but capabilities aren't fully active", () => {
    expect(resolveLandlordPaymentAccountStatus({
      ...base, onboardingStarted: true, requirementsDue: [{ description: "individual.dob", dueBy: "currently_due" }],
    })).toBe("restricted");
  });
  it("is restricted (not silently enabled) when requirements are past due", () => {
    expect(resolveLandlordPaymentAccountStatus({
      ...base, onboardingStarted: true, requirementsDue: [{ description: "individual.dob", dueBy: "past_due" }],
    })).toBe("restricted");
  });
  it("is disabled when Stripe reports the account closed, even if capabilities look active", () => {
    expect(resolveLandlordPaymentAccountStatus({ ...base, accountClosed: true, chargesEnabled: true, payoutsEnabled: true })).toBe("disabled");
  });
  it("never returns 'enabled' merely because an account id/context exists — every input here has no signal of readiness", () => {
    expect(resolveLandlordPaymentAccountStatus(base)).not.toBe("enabled");
  });
});

describe("buildLandlordPaymentAccountUpdate", () => {
  it("maps every landlord_payment_accounts column from the account status", () => {
    const update = buildLandlordPaymentAccountUpdate({
      ...base, mode: "test", chargesEnabled: true, payoutsEnabled: true, achDebitEnabled: true, cardPaymentsEnabled: true,
      onboardingStarted: true, requirementsDue: [],
    });
    expect(update).toMatchObject({
      status: "enabled", provider_mode: "test", details_submitted: true, charges_enabled: true, payouts_enabled: true,
      ach_debit_enabled: true, card_payments_enabled: true, requirements_due: [],
    });
    expect(typeof update.updated_at).toBe("string");
  });

  it("carries the resolved live/test mode through untouched — never inferred or defaulted", () => {
    expect(buildLandlordPaymentAccountUpdate({ ...base, mode: "live" }).provider_mode).toBe("live");
    expect(buildLandlordPaymentAccountUpdate({ ...base, mode: "test" }).provider_mode).toBe("test");
  });
});
