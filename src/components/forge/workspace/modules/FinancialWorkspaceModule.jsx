import ForgeExecutiveBriefing from "@/components/forge/ForgeExecutiveBriefing";
import FinancialKpiSurface from "@/components/forge/financial/FinancialKpiSurface";
import { buildFinancialTilePresentation } from "@/components/forge/financial/buildFinancialTilePresentation";
import ForgeWorkspaceTile from "@/components/forge/workspace/ForgeWorkspaceTile";
import { WorkspaceModule } from "@/components/forge/workspace/composition/WorkspaceModule";

function renderFinancialWorkspaceTile({
  financialKpiModel,
  financialExecutiveSummary,
  riskAssessment,
  executiveBriefing,
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
