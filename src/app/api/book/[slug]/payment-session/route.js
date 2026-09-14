import { NextResponse } from "next/server";
import { createPublicReservationClient } from "@/lib/supabase/createPublicReservationClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { validatePublishableKeyMode } from "@/infrastructure/billing/stripeMode";

const failure = (message, status) => NextResponse.json({ error: message }, { status });

export async function POST(request, { params }) {
  let attemptId = null;
  let database = null;
  try {
    const { slug } = await params;
    const body = await request.json();
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token) return failure("A private reservation access credential is required.", 400);

    const provider = createStripeBillingProvider();
    if (provider.mode !== "test") {
      return failure("Reservation payment initiation is not enabled in live mode.", 409);
    }
    validatePublishableKeyMode(provider.mode);

    database = createPublicReservationClient();
    const begun = await database.rpc("begin_public_reservation_payment_attempt", {
      p_booking_slug: String(slug || "").trim(),
      p_access_token: token,
    });
    if (begun.error) {
      if (/not found/i.test(begun.error.message || "")) {
        return failure("Reservation access was not found.", 404);
      }
      if (/not payable|not ready|no longer matches/i.test(begun.error.message || "")) {
        return failure(begun.error.message, 409);
      }
      throw begun.error;
    }

    const attempt = begun.data;
    attemptId = attempt.paymentAttemptId;
    let session;
    if (attempt.providerPaymentId) {
      const resumed = await provider.retrievePaymentIntent(
        { connectedAccountId: attempt.connectedAccountId },
        attempt.providerPaymentId,
      );
      if (!resumed.clientSecret) throw new Error("Stripe did not return a resumable client secret.");
      session = {
        paymentIntentId: resumed.id,
        clientSecret: resumed.clientSecret,
        connectedAccountId: attempt.connectedAccountId,
      };
    } else {
      try {
        session = await provider.createReservationPaymentSession(
          {
            ownerId: attempt.ownerId,
            connectedAccountId: attempt.connectedAccountId,
          },
          {
            paymentAttemptId: attempt.paymentAttemptId,
            reservationId: attempt.reservationId,
            amountCents: Number(attempt.amountCents),
            currencyCode: attempt.currencyCode,
            idempotencyKey: attempt.idempotencyKey,
          },
        );
      } catch (providerError) {
        await database.rpc("fail_public_reservation_payment_attempt", {
          p_owner_id: attempt.ownerId,
          p_payment_attempt_id: attempt.paymentAttemptId,
        });
        throw providerError;
      }

      const recorded = await database.rpc("record_public_reservation_payment_intent", {
        p_owner_id: attempt.ownerId,
        p_payment_attempt_id: attempt.paymentAttemptId,
        p_provider_payment_id: session.paymentIntentId,
      });
      if (recorded.error) throw recorded.error;
    }

    return NextResponse.json({
      success: true,
      mode: "test",
      purpose: "booking_balance",
      paymentAttemptId: attempt.paymentAttemptId,
      clientSecret: session.clientSecret,
      connectedAccountId: session.connectedAccountId,
      amountCents: Number(attempt.amountCents),
      currencyCode: attempt.currencyCode,
      returnUrl: `${request.nextUrl.origin}/book/${encodeURIComponent(String(slug || "").trim())}/access?token=${encodeURIComponent(token)}`,
      notice: "This is a Stripe test-mode payment session. No payment has been collected.",
    });
  } catch (error) {
    console.error("Reservation payment initiation failed", {
      name: error?.name || "Error",
      attemptId,
    });
    return failure("Unable to start the reservation payment.", 500);
  }
}
