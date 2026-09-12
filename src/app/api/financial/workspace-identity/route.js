import { NextResponse } from "next/server";

import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

// The single authoritative source for the client-side dashboard cache's isolation key (see
// dashboardCache.js) -- deliberately the exact same createAuthenticatedFinancialApplication() /
// resolveEffectiveOwnerId() resolution every other Financial FORGE authorization check already
// uses, never a client-supplied value. A co-owner and the primary owner of the same workspace both
// resolve to the SAME effectiveOwnerId here (that is the whole point of resolveEffectiveOwnerId --
// it is exactly how RLS itself scopes their data identically), which is what makes it correct for
// the dashboard cache to key by (actingUserId, effectiveOwnerId) rather than by raw user id alone:
// the pair identifies both who is looking and which canonical workspace's data they're looking at.
export async function GET() {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  return NextResponse.json({
    success: true,
    userId: authenticated.user.id,
    effectiveOwnerId: authenticated.effectiveOwnerId,
  });
}
