import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveEffectiveOwnerId } from "@/lib/supabase/resolveEffectiveOwnerId";

// Mirrors createAuthenticatedPrivateFinancingApplication.js's shape exactly.
export async function createAuthenticatedBudgetingApplication() {
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
