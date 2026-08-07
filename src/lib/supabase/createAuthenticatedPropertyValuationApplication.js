import {
  PropertyValuationApplication,
} from "@/application/property-valuation";
import {
  createPropertyValuationRepository,
} from "@/infrastructure/composition";
import {
  createAuthenticatedForgeApplication,
} from "./createAuthenticatedForgeApplication";

export async function createAuthenticatedPropertyValuationApplication() {
  const authenticatedApplication =
    await createAuthenticatedForgeApplication();

  if (authenticatedApplication.response) {
    return authenticatedApplication;
  }

  const repository =
    createPropertyValuationRepository({
      supabaseClient:
        authenticatedApplication.supabaseClient,
    });

  return Object.freeze({
    supabaseClient:
      authenticatedApplication.supabaseClient,
    user:
      authenticatedApplication.user,
    application:
      new PropertyValuationApplication(
        repository,
      ),
  });
}
