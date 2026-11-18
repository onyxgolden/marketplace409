import { redirect } from "next/navigation";

import ForgeDashboardClient from "@/components/forge/ForgeDashboardClient";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { isHealthWorkspaceMember } from "@/lib/supabase/isHealthWorkspaceMember";
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
  // The workspace below reuses dashboardSummary.workspace -- the
  // summary built from the validated effective owner -- instead of a
  // second buildDashboardSummaryWorkspace call: passing the actor's
  // user id there issued a second RPC under a different owner for a
  // co-owner viewing a shared workspace, so the page could render a
  // 200 mixing owners' data (fix round 1, ChatGPT NEEDS CHANGES).
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

  // The workspace IS the summary built above: same object, same
  // effective owner, same single RPC. The actor id stays out of the
  // read-model path entirely -- it is passed separately below only
  // where an action is actor-specific (isOwnerOrActiveCoOwner).
  const workspace = dashboardSummary.workspace;

  const [
    businessDashboard,
    investorDashboard,
    kpiModel,
    executiveSummary,
    transactionReview,
    isOwnerOrCoOwner,
    isHealthWorkspaceMemberResult,
  ] = await Promise.all([
    readModelApplication.buildBusinessDashboardSummary(),
    readModelApplication.buildInvestorDashboardSummary(),
    readModelApplication.buildKPIModelSummary(),
    readModelApplication.buildExecutiveSummarySummary(),
    forgeApplicationSuite.transactionReviewQueryService
      ? forgeApplicationSuite.transactionReviewReadModelAdapter.buildQueue(
          await forgeApplicationSuite.transactionReviewQueryService.buildReviewQueue(
            forgeApplication.user.id,
          ),
        )
      : null,
    // Gates the External Accounts tile to the owner or their active co-owner (spouse) only -- staff
    // roles (manager, bookkeeper, read_only) must never see it on this shared dashboard.
    isOwnerOrActiveCoOwner({
      supabaseClient: forgeApplication.supabaseClient,
      actorUserId: forgeApplication.user.id,
    }),
    // Gates the private Health tile to health-workspace members only (Jason + Brandy) -- the
    // membership table is the gate, never a hardcoded email list. Fails closed (false) on a
    // query error so a broken check hides the tile instead of breaking the dashboard.
    isHealthWorkspaceMember({
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
    isHealthWorkspaceMember: isHealthWorkspaceMemberResult,
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
