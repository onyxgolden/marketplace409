import {
  NextResponse,
} from "next/server";

import {
  createForgeApplicationSuite,
} from "@/infrastructure/composition";

import {
  createClient,
} from "@/lib/supabase/server";

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

  const currentOwnerId =
    async () => user.id;

  let forgeApplicationSuite;

  async function getForgeApplicationSuite() {
    if (!forgeApplicationSuite) {
      forgeApplicationSuite =
        await createForgeApplicationSuite({
          supabaseClient,
          ownerId:
            user.id,
          currentOwnerId,
        });
    }

    return forgeApplicationSuite;
  }

  return {
    supabaseClient,
    user,
    currentOwnerId,
    getForgeApplicationSuite,
  };
}
