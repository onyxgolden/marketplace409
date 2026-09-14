import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPublicReservationClient: vi.fn(),
  createStripeBillingProvider: vi.fn(),
  validatePublishableKeyMode: vi.fn(),
}));

vi.mock("@/lib/supabase/createPublicReservationClient", () => ({
  createPublicReservationClient: mocks.createPublicReservationClient,
}));
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: mocks.createStripeBillingProvider,
}));
vi.mock("@/infrastructure/billing/stripeMode", () => ({
  validatePublishableKeyMode: mocks.validatePublishableKeyMode,
}));

import { POST } from "./route";

const request = (body = {}) => new NextRequest(
  "https://test.example/api/book/pine-cabin/payment-session",
  { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } },
);
const context = { params: Promise.resolve({ slug: "pine-cabin" }) };
const attempt = {
  ownerId: "owner_1",
  reservationId: "reservation_1",
  paymentAttemptId: "reservation_payment_1",
  amountCents: 42500,
  currencyCode: "USD",
  idempotencyKey: "reservation:test:owner_1:reservation_1:nonce",
  providerPaymentId: null,
  paymentStatus: "created",
  connectedAccountId: "acct_test_owner_1",
};

describe("private guest reservation payment initiation", () => {
  let rpc;
  let provider;

  beforeEach(() => {
    vi.clearAllMocks();
    rpc = vi.fn()
      .mockResolvedValueOnce({ data: attempt, error: null })
      .mockResolvedValueOnce({ data: { paymentStatus: "pending" }, error: null });
    provider = {
      mode: "test",
      createReservationPaymentSession: vi.fn().mockResolvedValue({
        paymentIntentId: "pi_test_reservation_1",
        clientSecret: "pi_test_reservation_1_secret",
        connectedAccountId: "acct_test_owner_1",
      }),
      retrievePaymentIntent: vi.fn(),
    };
    mocks.createPublicReservationClient.mockReturnValue({ rpc });
    mocks.createStripeBillingProvider.mockReturnValue(provider);
  });

  it("requires the private reservation access token", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(400);
    expect(mocks.createStripeBillingProvider).not.toHaveBeenCalled();
  });

  it("fails closed in live mode before database or Stripe work", async () => {
    provider.mode = "live";
    const response = await POST(request({ token: "private-token" }), context);
    expect(response.status).toBe(409);
    expect(mocks.createPublicReservationClient).not.toHaveBeenCalled();
    expect(provider.createReservationPaymentSession).not.toHaveBeenCalled();
  });

  it("creates exactly the server-resolved booking-balance PaymentIntent in test mode", async () => {
    const response = await POST(request({ token: "private-token", amountCents: 1 }), context);
    expect(response.status).toBe(200);
    expect(mocks.validatePublishableKeyMode).toHaveBeenCalledWith("test");
    expect(rpc).toHaveBeenNthCalledWith(1, "begin_public_reservation_payment_attempt", {
      p_booking_slug: "pine-cabin",
      p_access_token: "private-token",
    });
    expect(provider.createReservationPaymentSession).toHaveBeenCalledWith(
      { ownerId: "owner_1", connectedAccountId: "acct_test_owner_1" },
      {
        paymentAttemptId: "reservation_payment_1",
        reservationId: "reservation_1",
        amountCents: 42500,
        currencyCode: "USD",
        idempotencyKey: "reservation:test:owner_1:reservation_1:nonce",
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(2, "record_public_reservation_payment_intent", {
      p_owner_id: "owner_1",
      p_payment_attempt_id: "reservation_payment_1",
      p_provider_payment_id: "pi_test_reservation_1",
    });
    expect(await response.json()).toMatchObject({
      mode: "test",
      purpose: "booking_balance",
      amountCents: 42500,
      notice: "This is a Stripe test-mode payment session. No payment has been collected.",
    });
  });

  it("resumes the same Stripe intent instead of creating a duplicate", async () => {
    rpc = vi.fn().mockResolvedValue({
      data: { ...attempt, providerPaymentId: "pi_test_existing", paymentStatus: "pending" },
      error: null,
    });
    mocks.createPublicReservationClient.mockReturnValue({ rpc });
    provider.retrievePaymentIntent.mockResolvedValue({
      id: "pi_test_existing",
      clientSecret: "pi_test_existing_secret",
      status: "requires_payment_method",
    });

    const response = await POST(request({ token: "private-token" }), context);
    expect(response.status).toBe(200);
    expect(provider.createReservationPaymentSession).not.toHaveBeenCalled();
    expect(provider.retrievePaymentIntent).toHaveBeenCalledWith(
      { connectedAccountId: "acct_test_owner_1" },
      "pi_test_existing",
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("marks only an unbound created attempt failed when Stripe creation fails", async () => {
    provider.createReservationPaymentSession.mockRejectedValue(new Error("provider unavailable"));
    rpc = vi.fn()
      .mockResolvedValueOnce({ data: attempt, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    mocks.createPublicReservationClient.mockReturnValue({ rpc });

    const response = await POST(request({ token: "private-token" }), context);
    expect(response.status).toBe(500);
    expect(rpc).toHaveBeenNthCalledWith(2, "fail_public_reservation_payment_attempt", {
      p_owner_id: "owner_1",
      p_payment_attempt_id: "reservation_payment_1",
    });
  });

  it("does not reveal whether an unrelated token belongs to another reservation", async () => {
    rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Reservation access was not found." },
    });
    mocks.createPublicReservationClient.mockReturnValue({ rpc });

    const response = await POST(request({ token: "wrong-token" }), context);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Reservation access was not found." });
    expect(provider.createReservationPaymentSession).not.toHaveBeenCalled();
  });
});
