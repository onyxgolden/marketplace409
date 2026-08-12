import { NextResponse } from "next/server";
import { createAuthenticatedTenantPortalApplication } from "@/lib/supabase/createAuthenticatedTenantPortalApplication";
export async function GET() {
  try {
    const authenticated = await createAuthenticatedTenantPortalApplication();
    if (authenticated.response) return authenticated.response;
    let portal = await authenticated.application.load(authenticated.user.id);
    if (!portal) {
      const claim = await authenticated.supabaseClient.rpc("claim_rental_tenant_portal");
      if (claim.error) throw claim.error;
      if (claim.data) portal = await authenticated.application.load(authenticated.user.id);
    }
    if (!portal) return NextResponse.json({ error: "No tenant portal access is linked to this account." }, { status: 404 });
    return NextResponse.json({ success: true, portal });
  } catch (error) {
    console.error("Tenant portal query error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load the tenant portal." }, { status: 500 });
  }
}
