import {
  NextResponse,
} from "next/server";

import {
  createFinancialApplicationSuite,
} from "@/infrastructure/composition";

import {
  createClient,
} from "@/lib/supabase/server";

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

  const currentOwnerId = async () => user.id;

  let financialApplicationSuite;

  async function getFinancialApplicationSuite() {
    if (!financialApplicationSuite) {
      financialApplicationSuite =
        await createFinancialApplicationSuite({
          supabaseClient,
          currentOwnerId,
        });
    }

    return financialApplicationSuite;
  }

  return {
    supabaseClient,
    user,
    currentOwnerId,
    getFinancialApplicationSuite,
  };
}
