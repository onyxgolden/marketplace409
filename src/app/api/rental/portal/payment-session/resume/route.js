import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";

function failure(message, status) { return NextResponse.json({ error: message }, { status }); }

const RESUMABLE_STATUSES = ["created", "requires_payment_method", "requires_action"];

export async function POST(request) {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const { paymentId } = await request.json();
    if (typeof paymentId !== "string" || paymentId.trim() === "") return failure("paymentId is required.", 400);
    const database = createRentalWebhookClient();
    const { data: tenant, error: tenantError } = await database.from("rental_tenants").select("*")
      .eq("auth_user_id", authenticated.user.id).maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) return failure("No tenant portal access is linked to this account.", 403);

    const { data: payment, error: paymentError } = await database.from("rental_payments").select("*")
      .eq("owner_id", tenant.owner_id).eq("id", paymentId.trim()).maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment || payment.tenant_id !== tenant.id) return failure("Payment was not found for this tenant.", 404);
    if (!RESUMABLE_STATUSES.includes(payment.status)) return failure("This payment can no longer be resumed.", 409);
    if (!payment.provider_payment_id) return failure("This payment has no associated Stripe payment intent.", 409);

    const { data: charge, error: chargeError } = await database.from("rent_charges").select("*")
      .eq("owner_id", tenant.owner_id).eq("id", payment.charge_id).maybeSingle();
    if (chargeError) throw chargeError;
    if (!charge) return failure("The rent charge for this payment was not found.", 404);

    const { data: account, error: accountError } = await database.from("landlord_payment_accounts").select("*")
      .eq("owner_id", tenant.owner_id).eq("provider", "stripe").maybeSingle();
    if (accountError) throw accountError;
    if (!account?.provider_account_id) return failure("The landlord payment account is not ready.", 409);

    const provider = createStripeBillingProvider();
    const intent = await provider.retrievePaymentIntent({ connectedAccountId: account.provider_account_id }, payment.provider_payment_id);
    if (!intent.clientSecret) return failure("Stripe did not return a payment client secret.", 502);

    return NextResponse.json({ success: true, clientSecret: intent.clientSecret, connectedAccountId: account.provider_account_id,
      paymentId: payment.id, amountCents: Number(payment.amount_cents), currencyCode: payment.currency_code,
      dueDate: charge.due_date, period: charge.period, chargeType: charge.charge_type || "rent",
      returnUrl: `${request.nextUrl.origin}/forge/rental/portal?payment=returned` });
  } catch (error) {
    console.error("Tenant payment resume error", error);
    return failure("Unable to resume the rent payment.", 500);
  }
}
