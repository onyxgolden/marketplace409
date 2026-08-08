import {
  PropertyEvidenceApplication,
} from "@/application/property-evidence";

import {
  createPropertyEvidenceRepository,
  PropertyEvidenceRepositoryStorage,
} from "@/infrastructure/composition";

import {
  createAuthenticatedForgeApplication,
} from "./createAuthenticatedForgeApplication";

export async function createAuthenticatedPropertyEvidenceApplication() {
  const authenticatedApplication =
    await createAuthenticatedForgeApplication();

  if (
    authenticatedApplication.response
  ) {
    return authenticatedApplication;
  }

  const repository =
    await createPropertyEvidenceRepository({
      storage:
        PropertyEvidenceRepositoryStorage
          .SUPABASE,
      supabaseClient:
        authenticatedApplication
          .supabaseClient,
    });

  return Object.freeze({
    supabaseClient:
      authenticatedApplication
        .supabaseClient,
    user:
      authenticatedApplication.user,
    application:
      new PropertyEvidenceApplication({
        repository,
        storage:
          authenticatedApplication
            .supabaseClient
            .storage,
      }),
  });
}
