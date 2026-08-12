import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";

function statusOf(value) {
  if (value.chargesEnabled && value.payoutsEnabled) return "enabled";
  if (!value.detailsSubmitted) return "onboarding";
  return "restricted";
}
async function authenticate() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated;
  return { ...authenticated, database: createRentalWebhookClient(), provider: createStripeBillingProvider() };
}
async function syncAccount(database, provider, ownerId, row) {
  if (!row?.provider_account_id) return row;
  const current = await provider.retrieveAccountStatus({ ownerId, connectedAccountId: row.provider_account_id });
  const saved = await database.from("landlord_payment_accounts").update({ status: statusOf(current),
    details_submitted: current.detailsSubmitted, charges_enabled: current.chargesEnabled,
    payouts_enabled: current.payoutsEnabled, ach_debit_enabled: current.achDebitEnabled,
    card_payments_enabled: current.cardPaymentsEnabled, requirements_due: current.requirementsDue,
    updated_at: new Date().toISOString() }).eq("owner_id", ownerId).eq("provider", "stripe").select("*").single();
  if (saved.error) throw saved.error;
  return saved.data;
}
export async function GET() {
  try {
    const authenticated = await authenticate(); if (authenticated.response) return authenticated.response;
    const found = await authenticated.database.from("landlord_payment_accounts").select("*")
      .eq("owner_id", authenticated.user.id).eq("provider", "stripe").maybeSingle();
    if (found.error) throw found.error;
    const account = await syncAccount(authenticated.database, authenticated.provider, authenticated.user.id, found.data);
    return NextResponse.json({ success: true, account });
  } catch (error) { console.error("Stripe account status error", error);
    return NextResponse.json({ error: "Unable to load Stripe account status." }, { status: 500 }); }
}
export async function POST(request) {
  try {
    const authenticated = await authenticate(); if (authenticated.response) return authenticated.response;
    const database = authenticated.database; const provider = authenticated.provider; const ownerId = authenticated.user.id;
    let found = await database.from("landlord_payment_accounts").select("*").eq("owner_id", ownerId).eq("provider", "stripe").maybeSingle();
    if (found.error) throw found.error;
    let account = found.data;
    if (!account?.provider_account_id) {
      const created = await provider.createConnectedAccount(ownerId, `stripe-landlord:v2:${ownerId}`);
      const timestamp = new Date().toISOString();
      const saved = await database.from("landlord_payment_accounts").upsert({ owner_id: ownerId,
        id: account?.id || `landlord_payment_account_${crypto.randomUUID()}`, provider: "stripe",
        provider_account_id: created.connectedAccountId, status: "onboarding", created_at: account?.created_at || timestamp,
        updated_at: timestamp }, { onConflict: "owner_id,provider" }).select("*").single();
      if (saved.error) throw saved.error; account = saved.data;
    }
    const origin = request.nextUrl.origin;
    const link = await provider.createOnboardingLink({ ownerId, connectedAccountId: account.provider_account_id },
      `${origin}/forge/rental?stripe=returned`, `${origin}/forge/rental?stripe=refresh`);
    return NextResponse.json({ success: true, url: link.url });
  } catch (error) { console.error("Stripe onboarding error", error);
    return NextResponse.json({ error: "Unable to start Stripe onboarding." }, { status: 500 }); }
}
