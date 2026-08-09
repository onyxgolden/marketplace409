import { redirect } from "next/navigation";

import ForgeDashboardClient from "@/components/forge/ForgeDashboardClient";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

export const dynamic = "force-dynamic";

export default async function ForgePage() {
  const forgeApplication = await createAuthenticatedForgeApplication();

  if (forgeApplication.response) {
    redirect("/auth");
  }

  const forgeApplicationSuite =
    await forgeApplication.getForgeApplicationSuite();

  const canonicalIntelligenceContext =
    await forgeApplicationSuite.canonicalIntelligenceContextBuilder.build({
      ownerId: forgeApplication.user.id,
    });

  const initialDashboardIntelligence =
    forgeApplicationSuite.forgeDashboardApplication.normalizeDashboardIntelligence(
      typeof canonicalIntelligenceContext?.toJSON === "function"
        ? canonicalIntelligenceContext.toJSON()
        : canonicalIntelligenceContext,
    );

  const readModelApplication =
    forgeApplicationSuite.financialReadModelApplication;

  const [
    businessDashboard,
    investorDashboard,
    kpiModel,
    executiveSummary,
    workspace,
    transactionReview,
  ] = await Promise.all([
    readModelApplication.buildBusinessDashboard(),
    readModelApplication.buildInvestorDashboard(),
    readModelApplication.buildKPIModel(),
    readModelApplication.buildExecutiveSummary(),
    readModelApplication.buildWorkspace(
      forgeApplication.user.id,
    ),
    forgeApplicationSuite.transactionReviewQueryService
      ? forgeApplicationSuite.transactionReviewReadModelAdapter.buildQueue(
          await forgeApplicationSuite.transactionReviewQueryService.buildReviewQueue(
            forgeApplication.user.id,
          ),
        )
      : null,
  ]);

  const initialReadModels = {
    financial: null,
    businessDashboard,
    investorDashboard,
    kpiModel,
    executiveSummary,
    workspace,
    transactionReview,
    ownerId: forgeApplication.user.id,
    decisionOutcome: null,
  };

  return (
    <ForgeDashboardClient
      initialDashboardIntelligence={JSON.parse(
        JSON.stringify(initialDashboardIntelligence),
      )}
      initialReadModels={JSON.parse(
        JSON.stringify(initialReadModels),
      )}
    />
  );
}
