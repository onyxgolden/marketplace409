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

export async function createAuthenticatedForgeApplication() {
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

  const effectiveOwnerId =
    await resolveEffectiveOwnerId({
      supabaseClient,
      actorUserId: user.id,
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
