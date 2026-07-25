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

  return Object.freeze({
    connectionPlatformSuite,
    financialApplicationSuite,

    connectionOperationsApplication:
      connectionPlatformSuite.connectionOperationsApplication,

    connectionReadModelApplication:
      connectionPlatformSuite.connectionReadModelApplication,

    financialReadModelApplication:
      financialApplicationSuite.readModelApplication,
  });
}
