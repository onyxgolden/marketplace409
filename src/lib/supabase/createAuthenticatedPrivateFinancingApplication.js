import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveEffectiveOwnerId } from "@/lib/supabase/resolveEffectiveOwnerId";

// Mirrors createAuthenticatedForgeApplication.js's shape exactly. Private Financing's SF-2A reads are
// simple RLS-scoped selects against private_financing_* tables/views (matching /api/workspace/members'
// own precedent of relying on RLS rather than an explicit .eq("owner_id", ...) filter) plus one guarded
// RPC-backed detail lookup -- there is no multi-repository "application suite" to compose yet, so this
// factory stops at auth + effectiveOwnerId rather than also building a getXApplicationSuite() like the
// Forge/Financial factories do for their much larger operation surfaces.
export async function createAuthenticatedPrivateFinancingApplication() {
  const supabaseClient = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabaseClient.auth.getUser();

  if (authError || !user?.id) {
    return {
      response: NextResponse.json({ error: "Authenticated owner id is required." }, { status: 401 }),
    };
  }

  const effectiveOwnerId = await resolveEffectiveOwnerId({ supabaseClient, actorUserId: user.id });

  return { supabaseClient, user, effectiveOwnerId };
}
