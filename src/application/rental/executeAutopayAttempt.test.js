import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({ createStripeBillingProvider: vi.fn() }));

import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { executeAutopayAttempt } from "./executeAutopayAttempt.js";

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node),
    insert: vi.fn(() => node), update: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const ENROLLMENT = { id: "enrollment_1", owner_id: "owner_1", lease_id: "lease_1", tenant_id: "tenant_1",
  provider_customer_id: "cus_1", provider_payment_method_id: "pm_1", provider_mode: "test", consecutive_failures: 0, retry_limit: 1 };
const CHARGE = { id: "charge_1", owner_id: "owner_1", lease_id: "lease_1", amount_cents: 150000, paid_amount_cents: 0, currency_code: "USD" };

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
      .mockReturnValueOnce(chain({ data: { provider_account_id: "acct_1" }, error: null }))
      .mockReturnValueOnce(paymentInsert)
      .mockReturnValueOnce(attemptInsert)
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ error: null }));
    await executeAutopayAttempt(db, "enrollment_1", "charge_1");
    expect(paymentInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ provider_mode: "test" }));
    expect(attemptInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ provider_mode: "test" }));
  });

  it("pauses the enrollment once the retry limit is exceeded", async () => {
    createStripeBillingProvider.mockReturnValue({ createOffSessionPayment: vi.fn(async () => { throw new Error("card declined"); }) });
    const db = { from: vi.fn() };
    const enrollmentUpdate = chain({ error: null });
    db.from
      .mockReturnValueOnce(chain({ data: { ...ENROLLMENT, consecutive_failures: 0, retry_limit: 0 }, error: null }))
      .mockReturnValueOnce(chain({ data: CHARGE, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
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
});
