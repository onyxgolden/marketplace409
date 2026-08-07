import ForgeExecutiveBriefing from "@/components/forge/ForgeExecutiveBriefing";
import FinancialExecutiveIntelligence from "@/components/forge/financial/FinancialExecutiveIntelligence";
import FinancialKpiSurface from "@/components/forge/financial/FinancialKpiSurface";
import { buildFinancialTilePresentation } from "@/components/forge/financial/buildFinancialTilePresentation";
import ForgeWorkspaceTile from "@/components/forge/workspace/ForgeWorkspaceTile";
import { WorkspaceModule } from "@/components/forge/workspace/composition/WorkspaceModule";

function renderFinancialWorkspaceTile({
  financialKpiModel,
  financialExecutiveSummary,
  riskSummary = {
    status: "Loading",
    score: 0,
    summary: "Dashboard intelligence is loading.",
  },
  riskAssessment = {
    primaryDrivers: [],
    trendIndicators: [],
    recommendations: [],
  },
  executiveBriefing = {
    headline: "Loading executive briefing",
    overview: "Dashboard intelligence is loading.",
    outlook: "Preparing financial outlook.",
  },
  insightItems = [],
}) {
  const presentation =
    buildFinancialTilePresentation({
      kpiModel: financialKpiModel,
      executiveSummary:
        financialExecutiveSummary,
    });

  return (
    <ForgeWorkspaceTile
      eyebrow="Financial Application"
      title="Financial Position"
      detail="Executive financial intelligence, portfolio position, risk, and recommended actions."
      href="/forge/financial"
      actionLabel="Open financial workspace"
      status={presentation.health.label}
      span="wide"
      expandLabel="Expand financial view"
      collapseLabel="Collapse financial view"
      expandedChildren={
        <div
          data-financial-expanded-tile
          className="space-y-6"
        >
          <FinancialKpiSurface
            kpis={presentation.kpis}
            variant="embedded"
          />

          <FinancialExecutiveIntelligence
            variant="embedded"
            executiveBriefing={executiveBriefing}
            riskSummary={riskSummary}
            riskAssessment={riskAssessment}
            insights={insightItems}
          />
        </div>
      }
    >
      <FinancialKpiSurface
        kpis={presentation.kpis}
        variant="embedded"
      />

      <div className="mt-5">
        <ForgeExecutiveBriefing
          executiveBriefing={executiveBriefing}
          riskAssessment={riskAssessment}
          variant="embedded"
        />
      </div>
    </ForgeWorkspaceTile>
  );
}

export const FinancialWorkspaceModule =
  new WorkspaceModule({
    moduleIdentity: "financial-position",
    displayName: "Financial Position",
    category: "financial",
    priority: 10,
    renderTile: renderFinancialWorkspaceTile,
  });
