import {
  PropertyHVACApplication,
} from "@/application/property-hvac";

import {
  createPropertyHVACRepository,
} from "@/infrastructure/composition";

import {
  createAuthenticatedForgeApplication,
} from "./createAuthenticatedForgeApplication";

export async function createAuthenticatedPropertyHVACApplication() {
  const authenticatedApplication =
    await createAuthenticatedForgeApplication();

  if (
    authenticatedApplication.response
  ) {
    return authenticatedApplication;
  }

  const repository =
    await createPropertyHVACRepository({
      storage:
        "supabase",
      supabaseClient:
        authenticatedApplication.supabaseClient,
    });

  return Object.freeze({
    supabaseClient:
      authenticatedApplication.supabaseClient,
    user:
      authenticatedApplication.user,
    application:
      new PropertyHVACApplication(
        repository,
      ),
  });
}
