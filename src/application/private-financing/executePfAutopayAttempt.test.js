import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({ createStripeBillingProvider: vi.fn() }));

import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { executePfAutopayAttempt, currentBillingPeriod } from "./executePfAutopayAttempt.js";

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node),
    insert: vi.fn(() => node), update: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const ENROLLMENT = { id: "pf_autopay_1", owner_id: "owner_1", account_id: "acct_1", borrower_id: "brw_1",
  status: "active", payment_method_type: "us_bank_account", provider_customer_id: "cus_1",
  provider_payment_method_id: "pm_bank_1", provider_mode: "test", consecutive_failures: 0, retry_limit: 1 };
const ACCOUNT = { data: { id: "acct_1", status: "active" }, error: null };
const SETTINGS = { data: { enabled: true }, error: null };
const TERMS = { data: { regular_scheduled_payment_amount_cents: 51785 }, error: null };
const NO_PENDING = { data: null, error: null };
const LANDLORD = { data: { provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true }, error: null };

function eligibleDb(overrides = {}) {
  const db = { from: vi.fn() };
  const froms = [
    chain({ data: ENROLLMENT, error: null }),
    chain({ data: null, error: null }),
    chain(overrides.account ?? ACCOUNT),
    chain(overrides.settings ?? SETTINGS),
    chain(overrides.terms ?? TERMS),
    chain(overrides.pending ?? NO_PENDING),
    chain(overrides.landlord ?? LANDLORD),
    chain({ data: { id: "pf_payment_1" }, error: null }),
    chain({ data: { id: "pf_autopay_attempt_1" }, error: null }),
    chain({ error: null }),
    chain({ error: null }),
    chain({ error: null }),
  ];
  froms.forEach((c) => db.from.mockReturnValueOnce(c));
  return db;
}

describe("currentBillingPeriod", () => {
  it("formats YYYY-MM in UTC", () => {
    expect(currentBillingPeriod(new Date("2026-09-23T10:00:00Z"))).toBe("2026-09");
  });
});

describe("executePfAutopayAttempt", () => {
  it("requires an enrollment id and billing period", async () => {
    const db = { from: vi.fn() };
    const result = await executePfAutopayAttempt(db, "", "2026-09");
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rejects a malformed billing period", async () => {
    const db = { from: vi.fn() };
    const result = await executePfAutopayAttempt(db, "pf_autopay_1", "september");
    expect(result.httpStatus).toBe(400);
  });

  it("refuses an enrollment that is not active", async () => {
    const db = { from: vi.fn() };
    db.from.mockReturnValueOnce(chain({ data: null, error: null }));
    const result = await executePfAutopayAttempt(db, "pf_autopay_1", "2026-09");
    expect(result.httpStatus).toBe(409);
  });

  it("refuses an enrollment with no verified bank payment method", async () => {
    const db = { from: vi.fn() };
    db.from.mockReturnValueOnce(chain({ data: { ...ENROLLMENT, provider_payment_method_id: null }, error: null }));
    const result = await executePfAutopayAttempt(db, "pf_autopay_1", "2026-09");
    expect(result.httpStatus).toBe(409);
    expect(result.body.error).toMatch(/verified bank payment method/);
  });

  it("returns the existing attempt instead of double-charging the month", async () => {
    const db = { from: vi.fn() };
    db.from
      .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "attempt_existing" }, error: null }));
    const result = await executePfAutopayAttempt(db, "pf_autopay_1", "2026-09");
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ success: true, duplicate: true, attempt: { id: "attempt_existing" } });
  });

  it("submits the regular scheduled amount to Stripe and records a processing payment", async () => {
    const offSession = vi.fn(async () => ({ paymentIntentId: "pi_pf_1", status: "processing" }));
    createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: offSession });
    const db = eligibleDb();
    const result = await executePfAutopayAttempt(db, "pf_autopay_1", "2026-09");
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual(expect.objectContaining({ success: true, duplicate: false, billingPeriod: "2026-09", status: "processing" }));
    const [, input, idempotencyKey] = offSession.mock.calls[0];
    expect(input.amountCents).toBe(51785);
    expect(input.paymentMethodId).toBe("pm_bank_1");
    expect(input.customerId).toBe("cus_1");
    expect(input.currencyCode).toBe("USD");
    expect(idempotencyKey).toBe("pf-autopay:pf_autopay_1:2026-09");
  });

  it("refuses when the financing account is not active", async () => {
    const db = eligibleDb({ account: { data: { id: "acct_1", status: "closed" }, error: null } });
    const result = await executePfAutopayAttempt(db, "pf_autopay_1", "2026-09");
    expect(result.httpStatus).toBe(409);
    expect(result.body.error).toMatch(/not active/);
  });

  it("refuses when online payments are disabled for the account", async () => {
    const db = eligibleDb({ settings: { data: { enabled: false }, error: null } });
    const result = await executePfAutopayAttempt(db, "pf_autopay_1", "2026-09");
    expect(result.httpStatus).toBe(409);
    expect(result.body.error).toMatch(/not active for this financing account/);
  });

  it("refuses when the account has no scheduled payment amount", async () => {
    const db = eligibleDb({ terms: { data: { regular_scheduled_payment_amount_cents: 0 }, error: null } });
    const result = await executePfAutopayAttempt(db, "pf_autopay_1", "2026-09");
    expect(result.httpStatus).toBe(409);
  });

  it("refuses when another payment is already pending for the account", async () => {
    const db = eligibleDb({ pending: { data: { id: "pf_payment_pending" }, error: null } });
    const result = await executePfAutopayAttempt(db, "pf_autopay_1", "2026-09");
    expect(result.httpStatus).toBe(409);
    expect(result.body.error).toMatch(/already pending/);
  });

  it("scopes the landlord account lookup to the enrollment's own provider_mode — a sandbox bank method can never be charged against a live account", async () => {
    createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: vi.fn(async () => ({ paymentIntentId: "pi_1", status: "processing" })) });
    const landlordChain = chain(LANDLORD);
    const db = { from: vi.fn() };
    db.from
      .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain(ACCOUNT))
      .mockReturnValueOnce(chain(SETTINGS))
      .mockReturnValueOnce(chain(TERMS))
      .mockReturnValueOnce(chain(NO_PENDING))
      .mockReturnValueOnce(landlordChain)
      .mockReturnValueOnce(chain({ data: { id: "pf_payment_1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "pf_autopay_attempt_1" }, error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ error: null }));
    await executePfAutopayAttempt(db, "pf_autopay_1", "2026-09");
    expect(landlordChain.eq).toHaveBeenCalledWith("provider_mode", "test");
  });

  it("pauses the enrollment after failures exceed the retry limit", async () => {
    createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: vi.fn(async () => { throw new Error("card_declined"); }) });
    const db = { from: vi.fn() };
    const enrollmentUpdate = chain({ error: null });
    db.from
      .mockReturnValueOnce(chain({ data: { ...ENROLLMENT, consecutive_failures: 1, retry_limit: 1 }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain(ACCOUNT))
      .mockReturnValueOnce(chain(SETTINGS))
      .mockReturnValueOnce(chain(TERMS))
      .mockReturnValueOnce(chain(NO_PENDING))
      .mockReturnValueOnce(chain(LANDLORD))
      .mockReturnValueOnce(chain({ data: { id: "pf_payment_1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "pf_autopay_attempt_1" }, error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(enrollmentUpdate);
    const result = await executePfAutopayAttempt(db, "pf_autopay_1", "2026-09");
    expect(result.httpStatus).toBe(409);
    expect(result.body.paused).toBe(true);
    expect(enrollmentUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ consecutive_failures: 2, status: "paused" }));
  });

  it("keeps the enrollment active when failures stay within the retry limit", async () => {
    createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: vi.fn(async () => { throw new Error("bank_error"); }) });
    const db = { from: vi.fn() };
    const enrollmentUpdate = chain({ error: null });
    db.from
      .mockReturnValueOnce(chain({ data: { ...ENROLLMENT, consecutive_failures: 0, retry_limit: 2 }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain(ACCOUNT))
      .mockReturnValueOnce(chain(SETTINGS))
      .mockReturnValueOnce(chain(TERMS))
      .mockReturnValueOnce(chain(NO_PENDING))
      .mockReturnValueOnce(chain(LANDLORD))
      .mockReturnValueOnce(chain({ data: { id: "pf_payment_1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "pf_autopay_attempt_1" }, error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(enrollmentUpdate);
    const result = await executePfAutopayAttempt(db, "pf_autopay_1", "2026-09");
    expect(result.httpStatus).toBe(409);
    expect(result.body.paused).toBe(false);
    expect(enrollmentUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ consecutive_failures: 1, status: "active" }));
  });
});
