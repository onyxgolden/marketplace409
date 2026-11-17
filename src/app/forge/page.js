import { redirect } from "next/navigation";

import ForgeDashboardClient from "@/components/forge/ForgeDashboardClient";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";

export const dynamic = "force-dynamic";

export default async function ForgePage() {
  const forgeApplication = await createAuthenticatedForgeApplication();

  if (forgeApplication.response) {
    redirect("/auth");
  }

  const forgeApplicationSuite =
    await forgeApplication.getForgeApplicationSuite();

  const readModelApplication =
    forgeApplicationSuite.financialReadModelApplication;

  // Slice 3 (load-times): the dashboard reads its headline totals from
  // the SQL summary RPC (one call per request) instead of transferring
  // the owner's full financial-event history. The summary dashboard is
  // built FIRST and handed to the canonical-intelligence builder, so
  // neither it nor the intelligence build can silently trigger the
  // legacy full-history path. Every other page keeps the legacy path.
  const dashboardSummary =
    await readModelApplication.buildDashboardSummary();

  const canonicalIntelligenceContext =
    await forgeApplicationSuite.canonicalIntelligenceContextBuilder.build({
      ownerId: forgeApplication.user.id,
      dashboard: dashboardSummary,
    });

  const initialDashboardIntelligence =
    forgeApplicationSuite.forgeDashboardApplication.normalizeDashboardIntelligence(
      typeof canonicalIntelligenceContext?.toJSON === "function"
        ? canonicalIntelligenceContext.toJSON()
        : canonicalIntelligenceContext,
    );

  const [
    businessDashboard,
    investorDashboard,
    kpiModel,
    executiveSummary,
    workspace,
    transactionReview,
    isOwnerOrCoOwner,
  ] = await Promise.all([
    readModelApplication.buildBusinessDashboardSummary(),
    readModelApplication.buildInvestorDashboardSummary(),
    readModelApplication.buildKPIModelSummary(),
    readModelApplication.buildExecutiveSummarySummary(),
    readModelApplication.buildDashboardSummaryWorkspace(
      forgeApplication.user.id,
    ),
    forgeApplicationSuite.transactionReviewQueryService
      ? forgeApplicationSuite.transactionReviewReadModelAdapter.buildQueue(
          await forgeApplicationSuite.transactionReviewQueryService.buildReviewQueue(
            forgeApplication.user.id,
          ),
        )
      : null,
    // Gates the private Health tile to the owner or their active co-owner (spouse) only -- staff
    // roles (manager, bookkeeper, read_only) must never see it on this shared dashboard.
    isOwnerOrActiveCoOwner({
      supabaseClient: forgeApplication.supabaseClient,
      actorUserId: forgeApplication.user.id,
    }),
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
    isOwnerOrCoOwner,
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
