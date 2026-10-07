import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({ createStripeBillingProvider: vi.fn() }));

import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { executeAutopayAttempt } from "./executeAutopayAttempt.js";

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), is: vi.fn(() => node), in: vi.fn(() => node),
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

  // Failed-attempt retry (2026-10-02 sweep fix): a failed/cancelled attempt
  // that never reached Stripe (provider_payment_id null — no money moved) is
  // transitioned in place and retried. Anything that reached Stripe or is
  // still in flight is never auto-retried.
  describe("failed-attempt retry", () => {
    const FAILED_NO_PI = { id: "attempt_1", status: "failed", provider_payment_id: null,
      failure_code: "StripeInvalidRequestError",
      failure_message: "The PaymentMethod provided (us_bank_account) is not allowed for this PaymentIntent." };

    // db.from call order on the retry path: enrollment, charge, existing
    // attempt, in-flight payment, schedule, billing settings, landlord
    // account, payment insert, attempt transition update, then the
    // success-path (payment update, attempt update) or failure-path
    // (payment update, attempt update, enrollment update) writes.
    function runRetry(existingAttempt, transitionResult = { data: [{ id: "attempt_1" }], error: null }, stripeImpl) {
      const offSession = vi.fn(stripeImpl || (async () => ({ paymentIntentId: "pi_retry_1", status: "processing" })));
      createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: offSession });
      const db = { from: vi.fn() };
      const paymentInsert = chain({ data: { id: "rental_payment_retry" }, error: null });
      const transition = chain(transitionResult);
      const paymentUpdate = chain({ error: null });
      const attemptUpdate = chain({ error: null });
      const enrollmentUpdate = chain({ error: null });
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: existingAttempt, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain(FORGE_SCHEDULE))
        .mockReturnValueOnce(chain(BILLING_ENABLED))
        .mockReturnValueOnce(chain({ data: { provider_account_id: "acct_1" }, error: null }))
        .mockReturnValueOnce(paymentInsert)
        .mockReturnValueOnce(transition)
        .mockReturnValueOnce(paymentUpdate)
        .mockReturnValueOnce(attemptUpdate)
        .mockReturnValueOnce(enrollmentUpdate);
      return { db, offSession, paymentInsert, transition, paymentUpdate, attemptUpdate, enrollmentUpdate,
        result: executeAutopayAttempt(db, "enrollment_1", "charge_1") };
    }

    it("retries a failed attempt that never reached Stripe, transitioning the row in place", async () => {
      const { db, offSession, paymentInsert, transition, attemptUpdate, result } = runRetry(FAILED_NO_PI);
      const out = await result;
      expect(out.httpStatus).toBe(200);
      expect(out.body).toEqual(expect.objectContaining({ success: true, duplicate: false, retried: true }));
      // A fresh payment row is inserted; the attempt row is transitioned in
      // place — never inserted again (unique(owner_id,enrollment_id,charge_id)).
      expect(paymentInsert.insert).toHaveBeenCalledTimes(1);
      expect(transition.insert).not.toHaveBeenCalled();
      const [transitionPayload] = transition.update.mock.calls[0];
      expect(transitionPayload).toEqual(expect.objectContaining({
        status: "created", failure_code: null, failure_message: null,
      }));
      expect(transitionPayload.idempotency_key).toMatch(/^autopay:enrollment_1:charge_1:retry:[0-9a-f]{8}$/);
      expect(transitionPayload.payment_id).toMatch(/^rental_payment_/);
      // Payment row and attempt row share the fresh retry key, and Stripe is
      // called exactly once with it — the dead attempt can never be replayed.
      const paymentPayload = paymentInsert.insert.mock.calls[0][0];
      expect(paymentPayload.idempotency_key).toBe(transitionPayload.idempotency_key);
      expect(offSession).toHaveBeenCalledTimes(1);
      expect(offSession.mock.calls[0][2]).toBe(transitionPayload.idempotency_key);
      // Post-Stripe bookkeeping lands on the same transitioned row.
      expect(attemptUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
        provider_payment_id: "pi_retry_1", status: "submitted",
      }));
      // Exactly three attempt-table touches: select existing, transition
      // update, post-Stripe update — no second row.
      expect(db.from.mock.calls.filter(([t]) => t === "rental_autopay_attempts")).toHaveLength(3);
    });

    it("never retries a failed attempt that already created a PaymentIntent", async () => {
      const offSession = vi.fn(async () => ({ paymentIntentId: "pi_x", status: "succeeded" }));
      createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: offSession });
      const db = { from: vi.fn() };
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: { ...FAILED_NO_PI, provider_payment_id: "pi_deadbeef" }, error: null }));
      const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(result.httpStatus).toBe(200);
      expect(result.body.duplicate).toBe(true);
      expect(offSession).not.toHaveBeenCalled();
      expect(db.from).toHaveBeenCalledTimes(3);
    });

    it("retries a cancelled attempt that never reached Stripe", async () => {
      const { offSession, result } = runRetry({ ...FAILED_NO_PI, status: "cancelled" });
      const out = await result;
      expect(out.httpStatus).toBe(200);
      expect(out.body).toEqual(expect.objectContaining({ success: true, duplicate: false, retried: true }));
      expect(offSession).toHaveBeenCalledTimes(1);
    });

    it.each(["created", "submitted", "processing", "succeeded", "requires_action"])(
      "still treats a %s attempt as a duplicate and never retries it", async (status) => {
        const offSession = vi.fn(async () => ({ paymentIntentId: "pi_x", status: "succeeded" }));
        createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: offSession });
        const db = { from: vi.fn() };
        const attemptRow = { id: "attempt_1", status, provider_payment_id: "pi_1" };
        db.from
          .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
          .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
          .mockReturnValueOnce(chain({ data: attemptRow, error: null }));
        const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
        expect(result.httpStatus).toBe(200);
        expect(result.body).toEqual({ success: true, duplicate: true, attempt: attemptRow });
        expect(offSession).not.toHaveBeenCalled();
        expect(db.from).toHaveBeenCalledTimes(3);
      });

    it("bails out — voiding its own payment row — when the attempt changed concurrently", async () => {
      const offSession = vi.fn(async () => ({ paymentIntentId: "pi_x", status: "succeeded" }));
      createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: offSession });
      const db = { from: vi.fn() };
      const paymentInsert = chain({ data: { id: "rental_payment_retry" }, error: null });
      const paymentVoid = chain({ error: null });
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: FAILED_NO_PI, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain(FORGE_SCHEDULE))
        .mockReturnValueOnce(chain(BILLING_ENABLED))
        .mockReturnValueOnce(chain({ data: { provider_account_id: "acct_1" }, error: null }))
        .mockReturnValueOnce(paymentInsert)
        .mockReturnValueOnce(chain({ data: [], error: null }))
        .mockReturnValueOnce(paymentVoid);
      const out = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(out.httpStatus).toBe(409);
      expect(out.body).toEqual({ error: "Autopay attempt changed concurrently; not retried." });
      expect(offSession).not.toHaveBeenCalled();
      // The just-created payment row is voided so the in-flight guard never
      // mistakes it for a live payment on the next sweep.
      expect(paymentVoid.update).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
    });

    // ChatGPT re-review 2026-10-02 (NO-GO) regression: overlapping workers.
    // Worker A reads a safe failed attempt (generation 1) and pauses. Worker B
    // runs a full cycle — claims gen1, Stripe accepts but the response is
    // lost — leaving the attempt failed/ambiguous (generation 2: new payment
    // row, new key, StripeConnectionError, null provider ID). Worker A
    // resumes with a stale retryable flag. The atomic generation claim must
    // match no rows (A's predicates name gen1's payment_id/idempotency_key/
    // failure_code), so A voids its own payment and makes NO Stripe call —
    // exactly one external debit (B's) exists for the charge.
    it("does not start a second debit when a stale worker claims after an intervening retry cycle", async () => {
      const intents = new Map();
      const offSession = vi.fn(async (_ctx, _payload, key) => {
        intents.set(key, "pi_external");
        return { paymentIntentId: "pi_external", status: "processing" };
      });
      createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: offSession });
      const gen1 = { ...FAILED_NO_PI, id: "attempt_1", status: "failed",
        provider_payment_id: null, failure_code: "StripeInvalidRequestError",
        payment_id: "rental_payment_gen1", idempotency_key: "autopay:enrollment_1:charge_1" };
      const db = { from: vi.fn() };
      const paymentInsert = chain({ data: { id: "rental_payment_workerA" }, error: null });
      const transition = chain({ data: [], error: null });
      const paymentVoid = chain({ error: null });
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: gen1, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain(FORGE_SCHEDULE))
        .mockReturnValueOnce(chain(BILLING_ENABLED))
        .mockReturnValueOnce(chain({ data: { provider_account_id: "acct_1" }, error: null }))
        .mockReturnValueOnce(paymentInsert)
        .mockReturnValueOnce(transition)
        .mockReturnValueOnce(paymentVoid);
      const out = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(out.httpStatus).toBe(409);
      expect(out.body).toEqual({ error: "Autopay attempt changed concurrently; not retried." });
      // The claim re-validates the exact generation read: payment_id,
      // idempotency_key, and the safe failure classification, plus null
      // provider_payment_id. A stale worker naming gen1 cannot match gen2.
      const eqCalls = transition.eq.mock.calls;
      expect(eqCalls).toContainEqual(["payment_id", "rental_payment_gen1"]);
      expect(eqCalls).toContainEqual(["idempotency_key", "autopay:enrollment_1:charge_1"]);
      expect(eqCalls).toContainEqual(["failure_code", "StripeInvalidRequestError"]);
      expect(transition.is.mock.calls).toContainEqual(["provider_payment_id", null]);
      // No Stripe call from the stale worker; its own payment row is voided.
      expect(offSession).not.toHaveBeenCalled();
      expect(intents.size).toBe(0);
      expect(paymentVoid.update).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
    });

    it("keeps a failed retry retryable when the retry dies before any PaymentIntent", async () => {
      const stripeError = Object.assign(new Error("us_bank_account is not allowed for this PaymentIntent."),
        { code: "payment_method_not_allowed", type: "StripeInvalidRequestError" });
      const { attemptUpdate, enrollmentUpdate, result } =
        runRetry({ ...FAILED_NO_PI, status: "failed" }, undefined, async () => { throw stripeError; });
      const out = await result;
      expect(out.httpStatus).toBe(409);
      expect(out.body).toEqual(expect.objectContaining({ error: "Autopay attempt failed.", retried: true }));
      const [attemptPayload] = attemptUpdate.update.mock.calls[0];
      expect(attemptPayload).toEqual(expect.objectContaining({
        status: "failed", failure_code: "StripeInvalidRequestError",
        failure_message: "us_bank_account is not allowed for this PaymentIntent.",
      }));
      // provider_payment_id stays null (no intent survived the error): the
      // next sweep may try again, and the enrollment's failure count keeps
      // climbing toward pause.
      expect(attemptPayload.provider_payment_id).toBeNull();
      expect(enrollmentUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ consecutive_failures: 1 }));
    });

    // ChatGPT exact-head review 2026-10-02 (NO-GO) regression: Stripe accepts
    // the create+confirm request but the response is lost (network drop). The
    // local row lands failed with provider_payment_id null; a null-ID-only
    // gate would fire a SECOND debit with a fresh key while the first is
    // still processing. The narrowed gate must refuse the retry.
    it("does not start a second debit after an accepted request loses its response", async () => {
      const intents = new Map();
      const first = runRetry(FAILED_NO_PI, undefined, async (_ctx, _payload, key) => {
        intents.set(key, "pi_already_processing");
        throw Object.assign(new Error("Connection closed after request was accepted"), {
          type: "StripeConnectionError",
        });
      });
      const failed = await first.result;
      expect(failed.httpStatus).toBe(409);
      expect(failed.body.paused).toBe(false);
      expect(first.paymentUpdate.update.mock.calls[0][0].status).toBe("failed");
      const persistedAttempt = {
        ...FAILED_NO_PI,
        ...first.transition.update.mock.calls[0][0],
        ...first.attemptUpdate.update.mock.calls[0][0],
      };
      expect(persistedAttempt.status).toBe("failed");
      expect(persistedAttempt.provider_payment_id).toBe(null);
      expect(persistedAttempt.failure_code).toBe("StripeConnectionError");
      const second = runRetry(persistedAttempt, undefined, async (_ctx, _payload, key) => {
        intents.set(key, "pi_second_processing");
        return { paymentIntentId: "pi_second_processing", status: "processing" };
      });
      const out = await second.result;
      expect(out.body.duplicate).toBe(true);
      expect(second.offSession).not.toHaveBeenCalled();
      expect(intents.size).toBe(1);
    });

    it.each([
      "StripeConnectionError", "StripeAPIError", "StripeCardError", "StripeIdempotencyError",
      "autopay_failed", "payment_method_not_allowed", null, undefined,
    ])("never auto-retries an ambiguous failure (%s) — stays blocked for manual reconciliation", async (failureCode) => {
      const offSession = vi.fn(async () => ({ paymentIntentId: "pi_x", status: "succeeded" }));
      createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: offSession });
      const db = { from: vi.fn() };
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: { ...FAILED_NO_PI, failure_code: failureCode }, error: null }));
      const result = await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(result.httpStatus).toBe(200);
      expect(result.body.duplicate).toBe(true);
      expect(offSession).not.toHaveBeenCalled();
      expect(db.from).toHaveBeenCalledTimes(3);
    });

    it.each([
      "StripeInvalidRequestError", "StripeAuthenticationError",
      "StripePermissionError", "StripeRateLimitError",
    ])("retries a definitive pre-creation rejection (%s) with a fresh key", async (failureCode) => {
      const { offSession, result } = runRetry({ ...FAILED_NO_PI, failure_code: failureCode });
      const out = await result;
      expect(out.httpStatus).toBe(200);
      expect(out.body).toEqual(expect.objectContaining({ success: true, duplicate: false, retried: true }));
      expect(offSession).toHaveBeenCalledTimes(1);
    });

    it("persists the PaymentIntent id carried by an error so the row can never look never-reached-Stripe", async () => {
      const stripeError = Object.assign(new Error("Your card was declined."),
        { type: "StripeCardError", code: "card_declined", payment_intent: { id: "pi_declined_1" } });
      createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: vi.fn(async () => { throw stripeError; }) });
      const db = { from: vi.fn() };
      const paymentUpdate = chain({ error: null });
      const attemptUpdate = chain({ error: null });
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
        .mockReturnValueOnce(paymentUpdate)
        .mockReturnValueOnce(attemptUpdate)
        .mockReturnValueOnce(chain({ error: null }));
      await executeAutopayAttempt(db, "enrollment_1", "charge_1");
      expect(paymentUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
        status: "failed", provider_payment_id: "pi_declined_1",
      }));
      expect(attemptUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
        status: "failed", failure_code: "StripeCardError", provider_payment_id: "pi_declined_1",
      }));
    });
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
      { code: "payment_method_unactivated", type: "StripeInvalidRequestError" });
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
      status: "failed", failure_code: "StripeInvalidRequestError",
      failure_message: "The bank account must be verified before it can be charged.",
    }));
    expect(attemptUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed", failure_code: "StripeInvalidRequestError",
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
    expect(result.body).toEqual({ error: "Autopay attempt failed.", paused: true, retried: false });
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

  // Verify-before-fail (2026-10-06 double-debit incident): a Stripe error
  // does not prove the payment died. When the error carries a PaymentIntent
  // ID, the intent's actual Stripe status decides the row's status.
  describe("verify-before-fail", () => {
    // db.from call order on the fresh-attempt failure path: enrollment,
    // charge, existing attempt (null), in-flight payment (null), schedule,
    // billing settings, landlord account, payment insert, attempt insert,
    // then the failure-path writes (payment update, attempt update,
    // enrollment update).
    function runFailingAttempt(stripeError, retrieveImpl) {
      const offSession = vi.fn(async () => { throw stripeError; });
      const retrievePaymentIntent = vi.fn(retrieveImpl || (async () => { throw new Error("retrieve not stubbed"); }));
      createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: offSession, retrievePaymentIntent });
      const db = { from: vi.fn() };
      const paymentUpdate = chain({ error: null });
      const attemptUpdate = chain({ error: null });
      const enrollmentUpdate = chain({ error: null });
      db.from
        .mockReturnValueOnce(chain({ data: ENROLLMENT, error: null }))
        .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain({ data: null, error: null }))
        .mockReturnValueOnce(chain(FORGE_SCHEDULE))
        .mockReturnValueOnce(chain(BILLING_ENABLED))
        .mockReturnValueOnce(chain({ data: { provider_account_id: "acct_1" }, error: null }))
        .mockReturnValueOnce(chain({ data: { id: "rental_payment_1" }, error: null }))
        .mockReturnValueOnce(chain({ data: { id: "attempt_1" }, error: null }))
        .mockReturnValueOnce(paymentUpdate)
        .mockReturnValueOnce(attemptUpdate)
        .mockReturnValueOnce(enrollmentUpdate);
      return { db, offSession, retrievePaymentIntent, paymentUpdate, attemptUpdate, enrollmentUpdate,
        result: executeAutopayAttempt(db, "enrollment_1", "charge_1") };
    }

    function stripeErrorWithIntent() {
      const err = new Error("ACH debit not enabled on the connected account.");
      err.type = "StripeInvalidRequestError";
      err.code = "ach_debit_not_enabled";
      err.payment_intent = { id: "pi_live_1" };
      return err;
    }

    it("records the intent's true status instead of failed when Stripe keeps it alive (Oct 3 regression)", async () => {
      const { retrievePaymentIntent, paymentUpdate, attemptUpdate, enrollmentUpdate, result } =
        runFailingAttempt(stripeErrorWithIntent(), async () => ({ id: "pi_live_1", status: "processing" }));
      const out = await result;
      expect(retrievePaymentIntent).toHaveBeenCalledWith({ connectedAccountId: "acct_1" }, "pi_live_1");
      expect(out.httpStatus).toBe(200);
      expect(out.body).toEqual(expect.objectContaining({
        success: true, status: "processing", stripeStatus: "processing",
      }));
      expect(out.body.warning).toMatch(/not marked failed/);
      expect(paymentUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
        status: "processing", provider_payment_id: "pi_live_1", failure_code: null,
      }));
      expect(attemptUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
        status: "submitted", provider_payment_id: "pi_live_1", failure_code: null,
      }));
      // The money is in flight: the enrollment's failure count and pause
      // state must not move.
      const [enrollmentPayload] = enrollmentUpdate.update.mock.calls[0];
      expect(enrollmentPayload).not.toHaveProperty("consecutive_failures");
      expect(enrollmentPayload).not.toHaveProperty("status");
      expect(enrollmentPayload).toEqual(expect.objectContaining({ last_attempt_at: expect.any(String) }));
    });

    it("marks succeeded when the verified intent already succeeded", async () => {
      const { paymentUpdate, attemptUpdate, result } =
        runFailingAttempt(stripeErrorWithIntent(), async () => ({ id: "pi_live_1", status: "succeeded" }));
      const out = await result;
      expect(out.httpStatus).toBe(200);
      expect(out.body).toEqual(expect.objectContaining({ success: true, status: "succeeded" }));
      expect(paymentUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
      expect(attemptUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
    });

    it("marks failed when Stripe confirms the intent is canceled", async () => {
      const { retrievePaymentIntent, paymentUpdate, enrollmentUpdate, result } =
        runFailingAttempt(stripeErrorWithIntent(), async () => ({ id: "pi_live_1", status: "canceled" }));
      const out = await result;
      expect(retrievePaymentIntent).toHaveBeenCalledTimes(1);
      expect(out.httpStatus).toBe(409);
      expect(out.body).toEqual(expect.objectContaining({ error: "Autopay attempt failed." }));
      expect(paymentUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
        status: "failed", provider_payment_id: "pi_live_1", failure_code: "StripeInvalidRequestError",
      }));
      const [enrollmentPayload] = enrollmentUpdate.update.mock.calls[0];
      expect(enrollmentPayload).toEqual(expect.objectContaining({ consecutive_failures: 1 }));
    });

    it("fails closed when the intent status cannot be verified", async () => {
      const { paymentUpdate, enrollmentUpdate, result } =
        runFailingAttempt(stripeErrorWithIntent(), async () => { throw new Error("network down"); });
      const out = await result;
      expect(out.httpStatus).toBe(409);
      expect(paymentUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
        status: "failed", provider_payment_id: "pi_live_1",
      }));
      const [paymentPayload] = paymentUpdate.update.mock.calls[0];
      expect(paymentPayload.failure_message).toMatch(/failing closed/);
      const [enrollmentPayload] = enrollmentUpdate.update.mock.calls[0];
      expect(enrollmentPayload).toEqual(expect.objectContaining({ consecutive_failures: 1 }));
    });

    it("never calls Stripe to verify when the error carries no PaymentIntent", async () => {
      const err = new Error("Invalid request.");
      err.type = "StripeInvalidRequestError";
      const { retrievePaymentIntent, paymentUpdate, result } = runFailingAttempt(err);
      const out = await result;
      expect(retrievePaymentIntent).not.toHaveBeenCalled();
      expect(out.httpStatus).toBe(409);
      expect(paymentUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
        status: "failed", provider_payment_id: null,
      }));
    });
  });
