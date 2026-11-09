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
  resolveEffectiveOwnerId,
} from "@/lib/supabase/resolveEffectiveOwnerId";

export async function createAuthenticatedForgeApplication({ requestedOwnerId = null } = {}) {
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
