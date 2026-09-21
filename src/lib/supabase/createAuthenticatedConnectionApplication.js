import { NextResponse } from "next/server";

// The one static edge to the Plaid SDK in the app's server code. This
// helper backs the /api/connection/* and /api/plaid/* routes -- the only
// entry points that perform real Plaid operations -- so the ~17MB SDK is
// bundled only into those functions instead of every function that
// constructs the connection platform suite.
import * as plaidSdk from "plaid";

// Deliberately NO static edge to the Stripe SDK here: this helper also
// backs the /api/plaid/* routes, which never perform Stripe operations, and
// a static import would bundle the ~9.9MB stripe package into those
// functions. The configured Stripe client is loaded lazily through the
// stripeClientFactory below -- the dynamic import() keeps the stripe
// package out of every function's static bundle, and the import only ever
// executes inside an adapter method that is actually performing a Stripe
// Financial Connections operation.

// Module-level lazy singleton: exactly one configured Stripe SDK instance
// per function instance, no matter how many times the factory runs. The
// provider is constructed on first use only, so this helper stays as safe
// to import and construct unconfigured as before.
let cachedStripeClient;

async function resolveStripeBillingClient() {
  if (cachedStripeClient === undefined) {
    const { createStripeBillingProvider } = await import(
      "@/infrastructure/billing/StripeBillingProvider"
    );
    cachedStripeClient = createStripeBillingProvider().stripe;
  }
  return cachedStripeClient;
}

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
          // Lazy async factory (never an eagerly constructed client) so this
          // helper stays as safe to construct unconfigured as before -- the
          // factory only runs inside an adapter method that's actually
          // performing a Stripe operation. The dynamic import keeps the
          // stripe package out of every route's static bundle (including the
          // /api/plaid/* routes this helper also backs), and the memoized
          // singleton reuses the one configured Stripe SDK instance rather
          // than constructing a second client per call.
          stripeClientFactory: () => resolveStripeBillingClient(),
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
