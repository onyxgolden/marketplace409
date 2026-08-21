import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { buildLandlordPaymentAccountUpdate } from "@/application/rental/landlordPaymentAccountStatus";

async function authenticate() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated;
  return { ...authenticated, database: createRentalWebhookClient(), provider: createStripeBillingProvider() };
}
async function syncAccount(database, provider, ownerId, row) {
  if (!row?.provider_account_id) return row;
  const current = await provider.retrieveAccountStatus({ ownerId, connectedAccountId: row.provider_account_id });
  // Scoped by provider_mode too: once a live row can coexist with a preserved sandbox row for the
  // same owner, `owner_id + provider` alone is no longer guaranteed to match exactly one row.
  const saved = await database.from("landlord_payment_accounts").update(buildLandlordPaymentAccountUpdate(current))
    .eq("owner_id", ownerId).eq("provider", "stripe").eq("provider_mode", provider.mode).select("*").single();
  if (saved.error) throw saved.error;
  return saved.data;
}
export async function GET() {
  try {
    const authenticated = await authenticate(); if (authenticated.response) return authenticated.response;
    // The server's own configured mode is the only thing this lookup trusts — a landlord viewing
    // status while Production runs on live keys must only ever see (and sync) their live row,
    // even if a preserved sandbox row for the same owner still exists.
    const found = await authenticated.database.from("landlord_payment_accounts").select("*")
      .eq("owner_id", authenticated.user.id).eq("provider", "stripe").eq("provider_mode", authenticated.provider.mode).maybeSingle();
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
    if (typeof authenticated.user.email !== "string" || authenticated.user.email.trim() === "") {
      // The only trustworthy contact email FORGE has for a landlord is their authenticated
      // account email — never guess or leave it silently blank.
      return NextResponse.json({ error: "A verified account email is required before starting Stripe onboarding." }, { status: 409 });
    }
    let found = await database.from("landlord_payment_accounts").select("*")
      .eq("owner_id", ownerId).eq("provider", "stripe").eq("provider_mode", provider.mode).maybeSingle();
    if (found.error) throw found.error;
    let account = found.data;
    if (!account?.provider_account_id) {
      // v4: the account shape changed from Accounts v1 to V2 Core Accounts — bumping the
      // idempotency-key namespace avoids Stripe ever returning a cached v1-shaped response for
      // a key that may have been used against the old call shape. The mode is folded into the
      // key too, so a landlord's test and live onboarding attempts can never collide.
      const created = await provider.createConnectedAccount(ownerId, `stripe-landlord:v4:${provider.mode}:${ownerId}`, { contactEmail: authenticated.user.email });
      const timestamp = new Date().toISOString();
      const saved = await database.from("landlord_payment_accounts").upsert({ owner_id: ownerId,
        id: account?.id || `landlord_payment_account_${crypto.randomUUID()}`, provider: "stripe", provider_mode: provider.mode,
        provider_account_id: created.connectedAccountId, status: "onboarding", created_at: account?.created_at || timestamp,
        updated_at: timestamp }, { onConflict: "owner_id,provider,provider_mode" }).select("*").single();
      if (saved.error) throw saved.error; account = saved.data;
    }
    const origin = request.nextUrl.origin;
    const link = await provider.createOnboardingLink({ ownerId, connectedAccountId: account.provider_account_id },
      `${origin}/forge/rental?stripe=returned`, `${origin}/forge/rental?stripe=refresh`);
    return NextResponse.json({ success: true, url: link.url });
  } catch (error) { console.error("Stripe onboarding error", error);
    return NextResponse.json({ error: "Unable to start Stripe onboarding." }, { status: 500 }); }
}
