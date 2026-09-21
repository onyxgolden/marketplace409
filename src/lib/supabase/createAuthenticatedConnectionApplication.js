import { NextResponse } from "next/server";

// The one static edge to the Plaid SDK in the app's server code. This
// helper backs the /api/connection/* and /api/plaid/* routes -- the only
// entry points that perform real Plaid operations -- so the ~17MB SDK is
// bundled only into those functions instead of every function that
// constructs the connection platform suite.
import * as plaidSdk from "plaid";

// The one static edge to the Stripe SDK in the app's server code. This
// helper backs the /api/connection/*, /api/plaid/*, and
// /api/stripe/financial-connections/* routes -- the entry points that perform
// real Stripe Financial Connections operations -- so the ~9.9MB SDK is
// bundled only into those functions instead of every function that
// constructs the connection platform suite.
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";

import {
  ConnectionRepositoryStorage,
  CredentialReferenceRepositoryStorage,
  InstitutionReferenceRepositoryStorage,
  createConnectionPlatformSuite,
} from "@/infrastructure/composition";

import { createClient } from "@/lib/supabase/server";

import { resolveEffectiveOwnerId } from "@/lib/supabase/resolveEffectiveOwnerId";

export async function createAuthenticatedConnectionApplication() {
  const supabaseClient = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabaseClient.auth.getUser();

  if (authError || !user?.id) {
    return {
      response: NextResponse.json(
        {
          error: "Authenticated owner id is required.",
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

  let connectionPlatformSuite;

  async function getConnectionPlatformSuite() {
    if (!connectionPlatformSuite) {
      connectionPlatformSuite =
        await createConnectionPlatformSuite({
          supabaseClient,
          ownerId: effectiveOwnerId,
          currentOwnerId,
          plaidSdk,
          // Lazy factory (never an eagerly constructed client) so this helper
          // stays as safe to construct unconfigured as before -- the factory
          // only runs inside an adapter method that's actually performing a
          // Stripe operation. Reuses StripeBillingProvider's already-configured
          // SDK instance rather than constructing a second one.
          stripeClientFactory: () => createStripeBillingProvider().stripe,
          connectionRepositoryStorage:
            ConnectionRepositoryStorage.SUPABASE,
          credentialReferenceRepositoryStorage:
            CredentialReferenceRepositoryStorage.SUPABASE,
          institutionReferenceRepositoryStorage:
            InstitutionReferenceRepositoryStorage.SUPABASE,
        });
    }

    return connectionPlatformSuite;
  }

  return {
    supabaseClient,
    user,
    effectiveOwnerId,
    currentOwnerId,
    getConnectionPlatformSuite,
  };
}
