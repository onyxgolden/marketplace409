import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({ createStripeBillingProvider: vi.fn() }));

import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { executeAutopayAttempt } from "./executeAutopayAttempt.js";

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node),
    order: vi.fn(() => node), limit: vi.fn(() => node),
    insert: vi.fn(() => node), update: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const ENROLLMENT = { id: "enrollment_1", owner_id: "owner_1", lease_id: "lease_1", tenant_id: "tenant_1",
  provider_customer_id: "cus_1", provider_payment_method_id: "pm_1", provider_mode: "test", consecutive_failures: 0, retry_limit: 1 };
const CHARGE = { id: "charge_1", owner_id: "owner_1", lease_id: "lease_1", amount_cents: 150000, paid_amount_cents: 0, currency_code: "USD", charge_type: "rent" };
const FORGE_SCHEDULE = { data: { collection_mode: "forge", forge_cutover_date: "2020-01-01" }, error: null };
const BILLING_ENABLED = { data: { billing_enabled: true }, error: null };

describe("executeAutopayAttempt", () => {
  it("requires an enrollment and charge id", async () => {
    const db = { from: vi.fn() };
    const result = await executeAutopayAttempt(db, "", "charge_1");
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("refuses a mismatched enrollment and charge", async () => {
    const db = { from: vi.fn() };
    db.from
      .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
      .mockReturnValueOnce(chain({ data: { ...CHARGE, lease_id: "lease_2" }, error: null }));
    const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
    expect(result.httpStatus).toBe(409);
  });

  it("rejects an ad-hoc charge type as not eligible for autopay — automatic collection is fenced to rent/proration/late_fee", async () => {
    const db = { from: vi.fn() };
    db.from
      .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
      .mockReturnValueOnce(chain({ data: { ...CHARGE, charge_type: "damage" }, error: null }));
    const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
    expect(result.httpStatus).toBe(409);
    expect(result.body).toEqual({ error: "This charge type is not eligible for autopay." });
    // No attempt or payment rows must be created for an ineligible type.
    expect(db.from).toHaveBeenCalledTimes(2);
  });

  it("allows a late_fee charge through the autopay gate (still subject to the collection gates below)", async () => {
    const db = { from: vi.fn() };
    db.from
      .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
      .mockReturnValueOnce(chain({ data: { ...CHARGE, charge_type: "late_fee" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "attempt_existing" }, error: null }));
    const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ success: true, duplicate: true, attempt: { id: "attempt_existing" } });
  });

  it("returns the existing attempt instead of double-charging", async () => {
    const db = { from: vi.fn() };
    db.from
      .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
      .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "attempt_existing" }, error: null }));
    const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ success: true, duplicate: true, attempt: { id: "attempt_existing" } });
  });

  it("submits a matching due charge to Stripe and records success", async () => {
    createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: vi.fn(async () => ({ paymentIntentId: "pi_1", status: "succeeded" })) });
    const db = { from: vi.fn() };
    db.from
      .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
      .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain(FORGE_SCHEDULE))
      .mockReturnValueOnce(chain(BILLING_ENABLED))
      .mockReturnValueOnce(chain({ data: { provider_account_id: "acct_1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "rental_payment_1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "rental_autopay_attempt_1" }, error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ error: null }));
    const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual(expect.objectContaining({ success: true, duplicate: false, status: "succeeded" }));
  });

  it("looks up the landlord account scoped to the enrollment's own provider_mode — a sandbox payment method can never be charged against a live account", async () => {
    createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: vi.fn(async () => ({ paymentIntentId: "pi_1", status: "succeeded" })) });
    const db = { from: vi.fn() };
    const accountLookup = chain({ data: { provider_account_id: "acct_1" }, error: null });
    db.from
      .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
      .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain(FORGE_SCHEDULE))
      .mockReturnValueOnce(chain(BILLING_ENABLED))
      .mockReturnValueOnce(accountLookup)
      .mockReturnValueOnce(chain({ data: { id: "rental_payment_1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "rental_autopay_attempt_1" }, error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ error: null }));
    await executeAutopayAttempt(db, "enrollment_1", "charge_1");
    expect(accountLookup.eq).toHaveBeenCalledWith("provider_mode", "test");
  });

  it("tags the created rental_payments and rental_autopay_attempts rows with the enrollment's provider_mode", async () => {
    createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: vi.fn(async () => ({ paymentIntentId: "pi_1", status: "succeeded" })) });
    const db = { from: vi.fn() };
    const paymentInsert = chain({ data: { id: "rental_payment_1" }, error: null });
    const attemptInsert = chain({ data: { id: "rental_autopay_attempt_1" }, error: null });
    db.from
      .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
      .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain(FORGE_SCHEDULE))
      .mockReturnValueOnce(chain(BILLING_ENABLED))
      .mockReturnValueOnce(chain({ data: { provider_account_id: "acct_1" }, error: null }))
      .mockReturnValueOnce(paymentInsert)
      .mockReturnValueOnce(attemptInsert)
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ error: null }));
    await executeAutopayAttempt(db, "enrollment_1", "charge_1");
    expect(paymentInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ provider_mode: "test" }));
    expect(attemptInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ provider_mode: "test" }));
  });

  it("threads the enrollment mandate id through to the off-session payment for ACH debits", async () => {
    const createOffSessionPayment = vi.fn(async () => ({ paymentIntentId: "pi_1", status: "processing" }));
    createStripeBillingProvider.mockReturnValue({ createOffSessionPayment });
    const db = { from: vi.fn() };
    db.from
      .mockReturnValueOnce(chain({ data: { ...ENROLLMENT, provider_mandate_id: "mandate_bank_1" }, error: null }))
      .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain(FORGE_SCHEDULE))
      .mockReturnValueOnce(chain(BILLING_ENABLED))
      .mockReturnValueOnce(chain({ data: { provider_account_id: "acct_1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "rental_payment_1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "rental_autopay_attempt_1" }, error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ error: null }));
    await executeAutopayAttempt(db, "enrollment_1", "charge_1");
    expect(createOffSessionPayment).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ mandateId: "mandate_bank_1" }), expect.anything());
  });

  it("records the real provider error code and message on failure instead of a generic message", async () => {
    const stripeError = Object.assign(new Error("The bank account must be verified before it can be charged."),
      { code: "payment_method_unactivated", type: "invalid_request_error" });
    createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: vi.fn(async () => { throw stripeError; }) });
    const db = { from: vi.fn() };
    const paymentUpdate = chain({ error: null });
    const attemptUpdate = chain({ error: null });
    db.from
      .mockReturnValueOnce(chain({ data: { ...ENROLLMENT, consecutive_failures: 0, retry_limit: 1 }, error: null }))
      .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain(FORGE_SCHEDULE))
      .mockReturnValueOnce(chain(BILLING_ENABLED))
      .mockReturnValueOnce(chain({ data: { provider_account_id: "acct_1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "rental_payment_1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "rental_autopay_attempt_1" }, error: null }))
      .mockReturnValueOnce(paymentUpdate)
      .mockReturnValueOnce(attemptUpdate)
      .mockReturnValueOnce(chain({ error: null }));
    const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
    expect(result.httpStatus).toBe(409);
    expect(paymentUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed", failure_code: "payment_method_unactivated",
      failure_message: "The bank account must be verified before it can be charged.",
    }));
    expect(attemptUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed", failure_code: "payment_method_unactivated",
      failure_message: "The bank account must be verified before it can be charged.",
    }));
  });

  it("pauses the enrollment once the retry limit is exceeded", async () => {
    createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: vi.fn(async () => { throw new Error("card declined"); }) });
    const db = { from: vi.fn() };
    const enrollmentUpdate = chain({ error: null });
    db.from
      .mockReturnValueOnce(chain({ data: { ...ENROLLMENT, consecutive_failures: 0, retry_limit: 0 }, error: null }))
      .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
      .mockReturnValueOnce(chain(FORGE_SCHEDULE))
      .mockReturnValueOnce(chain(BILLING_ENABLED))
      .mockReturnValueOnce(chain({ data: { provider_account_id: "acct_1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "rental_payment_1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "rental_autopay_attempt_1" }, error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(enrollmentUpdate);
    const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
    expect(result.httpStatus).toBe(409);
    expect(result.body).toEqual({ error: "Autopay attempt failed.", paused: true });
    expect(enrollmentUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ status: "paused", consecutive_failures: 1 }));
  });

  // Rental billing cutover containment: this is the central choke point for both the autopay
  // sweep cron and any manual execute endpoint — a lease still collected externally (Rentec) must
  // never be auto-charged, even if an active enrollment and a due charge otherwise look eligible.
  describe("collection-authority containment", () => {
    it("rejects an attempt when the lease's schedule is still collection_mode='external', without ever calling Stripe", async () => {
      const db = { from: vi.fn() };
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: { collection_mode: "external", forge_cutover_date: null }, error: null }));
      const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(result.httpStatus).toBe(409);
      expect(result.body).toEqual({ error: "This lease is not currently collected through FORGE." });
      // Only 5 db.from calls happened (enrollment, charge, existing-attempt, in-flight-payment,
      // schedule) — the gate returned before any account lookup, payment insert, or Stripe call
      // could occur.
      expect(db.from).toHaveBeenCalledTimes(5);
    });

    it("rejects an attempt when the FORGE cutover date has not arrived yet", async () => {
      const db = { from: vi.fn() };
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: { collection_mode: "forge", forge_cutover_date: "2099-01-01" }, error: null }));
      const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(result.httpStatus).toBe(409);
    });

    it("rejects an attempt when the lease has no active schedule at all", async () => {
      const db = { from: vi.fn() };
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }));
      const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(result.httpStatus).toBe(409);
    });
  });

  // Owner-level master pause: must block even an otherwise fully-eligible, individually
  // FORGE-activated enrollment — per-schedule activation alone must never be sufficient.
  describe("rental billing master pause", () => {
    it("rejects an attempt when the owner's rental billing is globally paused, without ever calling Stripe", async () => {
      const db = { from: vi.fn() };
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain(FORGE_SCHEDULE))
        .mockReturnValueOnce(chain({ data: { billing_enabled: false }, error: null }));
      const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(result.httpStatus).toBe(409);
      expect(result.body).toEqual({ error: "Rental online billing is currently paused for this owner." });
      // 6 db.from calls: enrollment, charge, existing-attempt, in-flight-payment, schedule,
      // billing settings — the gate returned before any account lookup, payment insert, or Stripe
      // call could occur.
      expect(db.from).toHaveBeenCalledTimes(6);
    });

    it("rejects an attempt when no rental_billing_settings row exists yet for the owner (defaults to paused)", async () => {
      const db = { from: vi.fn() };
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain(FORGE_SCHEDULE))
        .mockReturnValueOnce(chain({ data: null, error: null }));
      const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(result.httpStatus).toBe(409);
    });
  });

  // Double-charge protection: a tenant who pays early (manually) must never be charged
  // again by autopay for the same charge.
  describe("early/in-flight payment protection", () => {
    it("skips the debit when a payment is already in flight for the charge, without touching Stripe", async () => {
      const offSession = vi.fn(async () => ({ paymentIntentId: "pi_1", status: "succeeded" }));
      createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: offSession });
      const db = { from: vi.fn() };
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: { id: "rental_payment_inflight" }, error: null }));
      const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(result.httpStatus).toBe(200);
      expect(result.body).toEqual({ success: true, skipped: true, chargeId: "charge_1", reason: "payment_pending" });
      expect(offSession).not.toHaveBeenCalled();
      // Only 4 db.from calls happened (enrollment, charge, existing-attempt, in-flight-payment)
      // — the skip returned before any schedule gate, account lookup, or Stripe call.
      expect(db.from).toHaveBeenCalledTimes(4);
    });

    it("scopes the in-flight check to the charge and the enrollment's provider_mode", async () => {
      createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: vi.fn(async () => ({ paymentIntentId: "pi_1", status: "succeeded" })) });
      const inFlightChain = chain({ data: null, error: null });
      const db = { from: vi.fn() };
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(inFlightChain)
        .mockReturnValueOnce(chain(FORGE_SCHEDULE))
        .mockReturnValueOnce(chain(BILLING_ENABLED))
        .mockReturnValueOnce(chain({ data: { provider_account_id: "acct_1" }, error: null }))
        .mockReturnValueOnce(chain({ data: { id: "rental_payment_1" }, error: null }))
        .mockReturnValueOnce(chain({ data: { id: "rental_autopay_attempt_1" }, error: null }))
        .mockReturnValueOnce(chain({ error: null }))
        .mockReturnValueOnce(chain({ error: null }));
      await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(inFlightChain.eq).toHaveBeenCalledWith("charge_id", "charge_1");
      expect(inFlightChain.eq).toHaveBeenCalledWith("provider_mode", "test");
      expect(inFlightChain.in).toHaveBeenCalledWith("status",
        ["created", "requires_payment_method", "requires_action", "processing"]);
    });

    it("skips instead of attempting a $0 debit when the charge ledger already shows it fully paid", async () => {
      const offSession = vi.fn(async () => ({ paymentIntentId: "pi_1", status: "succeeded" }));
      createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: offSession });
      const db = { from: vi.fn() };
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: { ...CHARGE, paid_amount_cents: 150000 }, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }));
      const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(result.httpStatus).toBe(200);
      expect(result.body).toEqual({ success: true, skipped: true, chargeId: "charge_1", reason: "already_paid" });
      expect(offSession).not.toHaveBeenCalled();
    });

    it("debits only the remainder when the charge was partially paid early", async () => {
      const offSession = vi.fn(async () => ({ paymentIntentId: "pi_1", status: "succeeded" }));
      createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: offSession });
      const paymentInsert = chain({ data: { id: "rental_payment_1" }, error: null });
      const db = { from: vi.fn() };
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: { ...CHARGE, paid_amount_cents: 50000 }, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain(FORGE_SCHEDULE))
        .mockReturnValueOnce(chain(BILLING_ENABLED))
        .mockReturnValueOnce(chain({ data: { provider_account_id: "acct_1" }, error: null }))
        .mockReturnValueOnce(paymentInsert)
        .mockReturnValueOnce(chain({ data: { id: "rental_autopay_attempt_1" }, error: null }))
        .mockReturnValueOnce(chain({ error: null }))
        .mockReturnValueOnce(chain({ error: null }));
      const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(result.httpStatus).toBe(200);
      expect(result.body).toEqual(expect.objectContaining({ success: true, duplicate: false }));
      const [, input] = offSession.mock.calls[0];
      expect(input.amountCents).toBe(100000);
      expect(paymentInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ amount_cents: 100000 }));
    });
  });

  // R12: card autopay carries the convenience fee ONLY with the tenant's
  // explicit portal consent, at the consented rate capped at the current
  // workspace rate. ACH autopay never carries a fee.
  describe("card convenience fees on autopay", () => {
    const CARD_CONSENT = { ...ENROLLMENT, payment_method_type: "card", fee_consent_bps: 295, fee_consented_at: "2026-09-01T00:00:00.000Z" };
    function runSweep(enrollment, billingRow) {
      const offSession = vi.fn(async () => ({ paymentIntentId: "pi_1", status: "succeeded" }));
      createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: offSession });
      const db = { from: vi.fn() };
      const paymentInsert = chain({ data: { id: "rental_payment_1" }, error: null });
      db.from
        .mockReturnValueOnce(chain({ data: enrollment, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain(FORGE_SCHEDULE))
        .mockReturnValueOnce(chain({ data: billingRow, error: null }))
        .mockReturnValueOnce(chain({ data: { provider_account_id: "acct_1" }, error: null }))
        .mockReturnValueOnce(paymentInsert)
        .mockReturnValueOnce(chain({ data: { id: "rental_autopay_attempt_1" }, error: null }))
        .mockReturnValueOnce(chain({ error: null }))
        .mockReturnValueOnce(chain({ error: null }));
      return { offSession, paymentInsert, result: executeAutopayAttempt(db, "enrollment_1", "charge_1") };
    }

    it("charges rent + the consented fee on card autopay and stamps the consent", async () => {
      const { offSession, paymentInsert, result } = runSweep(CARD_CONSENT, { billing_enabled: true, card_convenience_fee_bps: 295 });
      expect((await result).httpStatus).toBe(200);
      const [, input] = offSession.mock.calls[0];
      expect(input.amountCents).toBe(154425); // $1500 + 2.95% = $44.25
      expect(paymentInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
        amount_cents: 154425, convenience_fee_cents: 4425, convenience_fee_bps: 295,
        fee_agreed_at: "2026-09-01T00:00:00.000Z",
      }));
    });

    it("keeps charging the consented rate when the owner later raises the fee", async () => {
      const { paymentInsert, result } = runSweep(CARD_CONSENT, { billing_enabled: true, card_convenience_fee_bps: 350 });
      expect((await result).httpStatus).toBe(200);
      expect(paymentInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
        amount_cents: 154425, convenience_fee_cents: 4425, convenience_fee_bps: 295,
      }));
    });

    it("charges the lower current rate when the owner lowers the fee", async () => {
      const { paymentInsert, result } = runSweep(CARD_CONSENT, { billing_enabled: true, card_convenience_fee_bps: 200 });
      expect((await result).httpStatus).toBe(200);
      expect(paymentInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
        amount_cents: 153000, convenience_fee_cents: 3000, convenience_fee_bps: 295,
      }));
    });

    it("charges no fee when the owner turned the fee off after consent", async () => {
      const { offSession, paymentInsert, result } = runSweep(CARD_CONSENT, { billing_enabled: true, card_convenience_fee_bps: 0 });
      expect((await result).httpStatus).toBe(200);
      const [, input] = offSession.mock.calls[0];
      expect(input.amountCents).toBe(150000);
      expect(paymentInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
        amount_cents: 150000, convenience_fee_cents: 0, convenience_fee_bps: null, fee_agreed_at: null,
      }));
    });

    it("charges no fee on card autopay without consent", async () => {
      const { paymentInsert, result } = runSweep(
        { ...ENROLLMENT, payment_method_type: "card" },
        { billing_enabled: true, card_convenience_fee_bps: 295 });
      expect((await result).httpStatus).toBe(200);
      expect(paymentInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
        amount_cents: 150000, convenience_fee_cents: 0, convenience_fee_bps: null, fee_agreed_at: null,
      }));
    });

    it("never charges a fee on ACH autopay, even when the workspace fee is on", async () => {
      const { offSession, paymentInsert, result } = runSweep(
        { ...CARD_CONSENT, payment_method_type: "us_bank_account" },
        { billing_enabled: true, card_convenience_fee_bps: 295 });
      expect((await result).httpStatus).toBe(200);
      const [, input] = offSession.mock.calls[0];
      expect(input.amountCents).toBe(150000);
      expect(paymentInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
        amount_cents: 150000, convenience_fee_cents: 0,
      }));
    });
  });
});
