import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { validatePublishableKeyMode } from "@/infrastructure/billing/stripeMode";

function failure(message, status) { return NextResponse.json({ error: message }, { status }); }

export async function POST(request) {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const { chargeId } = await request.json();
    if (typeof chargeId !== "string" || chargeId.trim() === "") return failure("chargeId is required.", 400);
    const database = createRentalWebhookClient();
    const provider = createStripeBillingProvider();
    // Fails before any database or Stripe work — a mismatched publishable key would otherwise
    // only surface once the tenant's browser tries to confirm the Payment Element, with a
    // confusing error, and by then a rental_payments row may already exist.
    validatePublishableKeyMode(provider.mode);
    const { data: tenant, error: tenantError } = await database.from("rental_tenants").select("*")
      .eq("auth_user_id", authenticated.user.id).maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) return failure("No tenant portal access is linked to this account.", 403);

    const { data: charge, error: chargeError } = await database.from("rent_charges").select("*")
      .eq("owner_id", tenant.owner_id).eq("id", chargeId.trim()).maybeSingle();
    if (chargeError) throw chargeError;
    if (!charge || ["paid", "void"].includes(charge.status)) return failure("This rent charge is not payable.", 404);
    const { data: membership, error: membershipError } = await database.from("rental_lease_tenants").select("lease_id")
      .eq("owner_id", tenant.owner_id).eq("tenant_id", tenant.id).eq("lease_id", charge.lease_id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return failure("This rent charge is not available to this tenant.", 403);

    const pending = await database.from("rental_payments").select("id, status").eq("owner_id", tenant.owner_id)
      .eq("charge_id", charge.id).in("status", ["created", "requires_payment_method", "requires_action", "processing"]).maybeSingle();
    if (pending.error) throw pending.error;
    if (pending.data) return failure("A payment for this charge is already pending.", 409);

    // Scoped by provider_mode: a live tenant payment must only ever find the landlord's live
    // connected account and live customer reference — a preserved sandbox row for the same
    // owner/tenant must never be selected here, in either direction.
    const { data: account, error: accountError } = await database.from("landlord_payment_accounts").select("*")
      .eq("owner_id", tenant.owner_id).eq("provider", "stripe").eq("provider_mode", provider.mode).maybeSingle();
    if (accountError) throw accountError;
    if (!account?.provider_account_id || account.status !== "enabled" || !account.charges_enabled || !account.payouts_enabled)
      return failure("The landlord payment account is not ready.", 409);

    let { data: customer, error: customerError } = await database.from("billing_customer_references").select("*")
      .eq("owner_id", tenant.owner_id).eq("tenant_id", tenant.id).eq("provider", "stripe").eq("provider_mode", provider.mode).maybeSingle();
    if (customerError) throw customerError;
    if (!customer) {
      const created = await provider.createCustomer({ ownerId: tenant.owner_id, connectedAccountId: account.provider_account_id },
        { tenantId: tenant.id, email: tenant.email, displayName: tenant.display_name },
        `billing-customer:${provider.mode}:${tenant.owner_id}:${tenant.id}:stripe`);
      const saved = await database.from("billing_customer_references").upsert({ owner_id: tenant.owner_id,
        tenant_id: tenant.id, provider: "stripe", provider_mode: provider.mode, connected_account_id: account.provider_account_id,
        customer_id: created.customerId }, { onConflict: "owner_id,tenant_id,provider,provider_mode" }).select("*").single();
      if (saved.error) throw saved.error;
      customer = saved.data;
    }

    const remainingCents = Number(charge.amount_cents) - Number(charge.paid_amount_cents);
    const paymentId = `rental_payment_${crypto.randomUUID()}`;
    const idempotencyKey = `rent:${charge.id}:${paymentId}`;
    const timestamp = new Date().toISOString();
    const inserted = await database.from("rental_payments").insert({ owner_id: tenant.owner_id, id: paymentId,
      charge_id: charge.id, lease_id: charge.lease_id, tenant_id: tenant.id, provider: "stripe", provider_mode: provider.mode,
      provider_customer_id: customer.customer_id, amount_cents: remainingCents, refunded_amount_cents: 0,
      currency_code: charge.currency_code, status: "created", idempotency_key: idempotencyKey,
      created_at: timestamp, updated_at: timestamp }).select("*").single();
    if (inserted.error) throw inserted.error;

    let session;
    try {
      session = await provider.createPaymentSession({ ownerId: tenant.owner_id, connectedAccountId: account.provider_account_id }, {
        paymentId, chargeId: charge.id, leaseId: charge.lease_id, tenantId: tenant.id, customerId: customer.customer_id,
        amountCents: remainingCents, currencyCode: charge.currency_code,
        paymentMethods: account.card_payments_enabled ? ["us_bank_account", "card"] : ["us_bank_account"],
        successUrl: `${request.nextUrl.origin}/forge/rental/portal?payment=returned`,
        cancelUrl: `${request.nextUrl.origin}/forge/rental/portal`, applicationFeeCents: 0, idempotencyKey,
      });
    } catch (providerError) {
      await database.from("rental_payments").update({ status: "failed", failure_code: "session_creation_failed",
        failure_message: "Payment session could not be created.", updated_at: new Date().toISOString() })
        .eq("owner_id", tenant.owner_id).eq("id", paymentId);
      throw providerError;
    }
    const updated = await database.from("rental_payments").update({ provider_payment_id: session.paymentIntentId,
      status: "requires_payment_method", updated_at: new Date().toISOString() }).eq("owner_id", tenant.owner_id).eq("id", paymentId);
    if (updated.error) throw updated.error;
    return NextResponse.json({ success: true, clientSecret: session.clientSecret,
      connectedAccountId: session.connectedAccountId, paymentId, amountCents: remainingCents,
      currencyCode: charge.currency_code, dueDate: charge.due_date, period: charge.period,
      chargeType: charge.charge_type || "rent",
      returnUrl: `${request.nextUrl.origin}/forge/rental/portal?payment=returned` });
  } catch (error) {
    console.error("Tenant payment session error", error);
    return failure("Unable to start the rent payment.", 500);
  }
}
