import {
  NextResponse,
} from "next/server";

import {
  createForgeApplicationSuite,
} from "@/infrastructure/composition";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  checkForgeAppAccess,
} from "@/lib/supabase/forgeAppAccess";

import {
  resolveEffectiveOwnerId,
} from "@/lib/supabase/resolveEffectiveOwnerId";

// SaaS Auth PR 1: when appKey is given (one of designer / scheduler /
// planner / capture), the request is gated on the workspace being
// active, the app entitlement being active, and the actor holding an
// active membership — enforced by forge_check_app_access, which reads
// auth.uid() server-side. A denial returns { response: 403 }. Callers
// that pass no appKey keep today's behavior (their own permission
// checks still apply); the four app choke points all pass one.
export async function createAuthenticatedForgeApplication({ requestedOwnerId = null, appKey = null } = {}) {
  const supabaseClient =
    await createClient();

  const {
    data: {
      user,
    },
    error: authError,
  } = await supabaseClient.auth.getUser();

  if (authError || !user?.id) {
    return {
      response: NextResponse.json(
        {
          error:
            "Authenticated owner id is required.",
        },
        {
          status: 401,
        },
      ),
    };
  }

  // UI-density redesign: a validated ?workspace= selection overrides the
  // default resolution. resolveEffectiveOwnerId honors it only for the
  // actor's own id or an active membership, so an unvalidated value can
  // never widen access. Callers that pass nothing keep today's behavior.
  const effectiveOwnerId =
    await resolveEffectiveOwnerId({
      supabaseClient,
      actorUserId: user.id,
      requestedOwnerId,
    });

  if (appKey) {
    const gate = await checkForgeAppAccess(supabaseClient, effectiveOwnerId, appKey);
    if (!gate.allowed) {
      return { response: gate.response };
    }
  }

  const currentOwnerId =
    async () => effectiveOwnerId;

  let forgeApplicationSuite;

  async function getForgeApplicationSuite() {
    if (!forgeApplicationSuite) {
      forgeApplicationSuite =
        await createForgeApplicationSuite({
          supabaseClient,
          ownerId:
            effectiveOwnerId,
          currentOwnerId,
        });
    }

    return forgeApplicationSuite;
  }

  return {
    supabaseClient,
    user,
    effectiveOwnerId,
    currentOwnerId,
    getForgeApplicationSuite,
  };
}
