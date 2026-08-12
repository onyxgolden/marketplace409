import { TenantPortalQueryService } from "@/application/rental";
import { createAuthenticatedForgeApplication } from "./createAuthenticatedForgeApplication";
export async function createAuthenticatedTenantPortalApplication() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated;
  return Object.freeze({ supabaseClient: authenticated.supabaseClient, user: authenticated.user,
    application: new TenantPortalQueryService(authenticated.supabaseClient) });
}
