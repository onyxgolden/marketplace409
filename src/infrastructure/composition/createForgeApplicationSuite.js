import {
  CanonicalIntelligenceContextBuilder,
} from "@/application";

import {
  createConnectionPlatformSuite,
  createFinancialApplicationSuite,
} from "@/infrastructure/composition";

export async function createForgeApplicationSuite(
  deps = {},
) {
  const connectionPlatformSuite =
    deps.connectionPlatformSuite ||
    await createConnectionPlatformSuite({
      supabaseClient:
        deps.supabaseClient,
      ownerId:
        deps.ownerId,
      currentOwnerId:
        deps.currentOwnerId,
    });

  const financialApplicationSuite =
    deps.financialApplicationSuite ||
    await createFinancialApplicationSuite({
      supabaseClient:
        deps.supabaseClient,
      ownerId:
        deps.ownerId,
      currentOwnerId:
        deps.currentOwnerId,
    });

  const canonicalIntelligenceContextBuilder =
    deps.canonicalIntelligenceContextBuilder ||
    new CanonicalIntelligenceContextBuilder({
      financialReadModelApplication:
        financialApplicationSuite.readModelApplication,

      connectionOperationsApplication:
        connectionPlatformSuite.connectionOperationsApplication,
    });

  return Object.freeze({
    connectionPlatformSuite,
    financialApplicationSuite,

    connectionOperationsApplication:
      connectionPlatformSuite.connectionOperationsApplication,

    connectionReadModelApplication:
      connectionPlatformSuite.connectionReadModelApplication,

    financialReadModelApplication:
      financialApplicationSuite.readModelApplication,

    canonicalIntelligenceContextBuilder,

    forgeDashboardApplication:
      financialApplicationSuite.forgeDashboardApplication,
  });
}
