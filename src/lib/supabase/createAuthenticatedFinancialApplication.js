import {
  NextResponse,
} from "next/server";

import {
  createFinancialApplicationSuite,
} from "@/infrastructure/composition";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  resolveEffectiveOwnerId,
} from "@/lib/supabase/resolveEffectiveOwnerId";

export async function createAuthenticatedFinancialApplication() {
  const supabaseClient = await createClient();

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

  const effectiveOwnerId = await resolveEffectiveOwnerId({
    supabaseClient,
    actorUserId: user.id,
  });

  const currentOwnerId = async () => effectiveOwnerId;

  let financialApplicationSuite;

  async function getFinancialApplicationSuite() {
    if (!financialApplicationSuite) {
      financialApplicationSuite =
        await createFinancialApplicationSuite({
          supabaseClient,
          ownerId: effectiveOwnerId,
          currentOwnerId,
        });
    }

    return financialApplicationSuite;
  }

  return {
    supabaseClient,
    user,
    effectiveOwnerId,
    currentOwnerId,
    getFinancialApplicationSuite,
  };
}
