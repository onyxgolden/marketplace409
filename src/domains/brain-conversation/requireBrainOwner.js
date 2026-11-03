// FORGE Brain conversation harness — owner resolution for API routes.
//
// Returns { supabase, user, ownerId } for a signed-in caller, or
// { response } holding a plain-words 401 when signed out. Routes check
// `authed.response` first, mirroring the favorite-workspace route pattern.
//
// Deliberately NOT exported from the domain barrel (index.js): it imports
// next/server, which must never be dragged into unit tests of pure modules.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveEffectiveOwnerId } from "@/lib/supabase/resolveEffectiveOwnerId";
import { createSupabaseBrainStore } from "./supabaseStore.js";

export async function requireBrainOwner() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) {
    return {
      response: NextResponse.json(
        { error: "Please sign in to use the Brain." },
        { status: 401 },
      ),
    };
  }
  const ownerId = await resolveEffectiveOwnerId({
    supabaseClient: supabase,
    actorUserId: user.id,
  });
  return { supabase, user, ownerId, store: createSupabaseBrainStore(supabase) };
}
