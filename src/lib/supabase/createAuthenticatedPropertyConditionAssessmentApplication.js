import {
  PropertyConditionAssessmentApplication,
} from "@/application/property-condition-assessment";

import {
  createPropertyConditionAssessmentRepository,
} from "@/infrastructure/composition";

import {
  createAuthenticatedForgeApplication,
} from "./createAuthenticatedForgeApplication";

export async function createAuthenticatedPropertyConditionAssessmentApplication() {
  const authenticatedApplication =
    await createAuthenticatedForgeApplication();

  if (
    authenticatedApplication.response
  ) {
    return authenticatedApplication;
  }

  const repository =
    await createPropertyConditionAssessmentRepository({
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
      new PropertyConditionAssessmentApplication(
        repository,
      ),
  });
}
