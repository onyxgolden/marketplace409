import {
  PropertyOperatingObligationApplication,
} from "@/application/property-operating-obligation";

import {
  createPropertyOperatingObligationRepository,
} from "@/infrastructure/composition/createPropertyOperatingObligationRepository.js";

import {
  createAuthenticatedForgeApplication,
} from "./createAuthenticatedForgeApplication";

export async function createAuthenticatedPropertyOperatingObligationApplication() {
  const authenticated =
    await createAuthenticatedForgeApplication();

  if (authenticated.response) {
    return authenticated;
  }

  const repository =
    await createPropertyOperatingObligationRepository({
      storage: "supabase",
      supabaseClient:
        authenticated.supabaseClient,
    });

  const application =
    new PropertyOperatingObligationApplication({
      repository,
    });

  async function loadImportContext() {
    const forgeSuite =
      await authenticated
        .getForgeApplicationSuite();

    const financialSuite =
      forgeSuite
        .financialApplicationSuite;

    const [
      workspace,
      financialEvents,
    ] = await Promise.all([
      financialSuite
        .financialWorkspaceQueryService
        .buildWorkspace(
          authenticated.user.id,
        ),

      financialSuite
        .financialEventRepository
        .findByOwnerId(
          authenticated.user.id,
        ),
    ]);

    const properties =
      (
        workspace?.properties ||
        []
      )
        .map((property) => {
          const id =
            String(
              property?.propertyId ??
              property?.property_id ??
              property?.id ??
              "",
            ).trim();

          if (!id) {
            return null;
          }

          return Object.freeze({
            id,
            propertyId: id,
            name:
              String(
                property?.propertyName ??
                property?.name ??
                id,
              ).trim(),
          });
        })
        .filter(Boolean);

    return Object.freeze({
      properties:
        Object.freeze(properties),
      financialEvents:
        Object.freeze([
          ...(
            financialEvents ||
            []
          ),
        ]),
    });
  }

  return Object.freeze({
    supabaseClient:
      authenticated.supabaseClient,
    user:
      authenticated.user,
    application,
    loadImportContext,
  });
}
