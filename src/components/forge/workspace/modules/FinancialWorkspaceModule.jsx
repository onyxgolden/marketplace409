import ForgeExecutiveBriefing from "@/components/forge/ForgeExecutiveBriefing";
import ForgeKpiCards from "@/components/forge/ForgeKpiCards";
import ForgeWorkspaceTile from "@/components/forge/workspace/ForgeWorkspaceTile";
import { WorkspaceModule } from "@/components/forge/workspace/composition/WorkspaceModule";

function renderFinancialWorkspaceTile({
  netWorth,
  riskSummary,
  riskAssessment,
  executiveBriefing,
  auditFindings,
  formatCurrency,
}) {
  return (
    <ForgeWorkspaceTile
      eyebrow="Financial Application"
      title="Financial Position"
      detail="Executive financial intelligence, portfolio position, risk, and recommended actions."
      href="/forge/financial"
      actionLabel="Open financial workspace"
      status={riskSummary?.status ?? "Ready"}
      span="wide"
    >
      <ForgeKpiCards
        netWorth={netWorth}
        riskSummary={riskSummary}
        auditFindings={auditFindings}
        formatCurrency={formatCurrency}
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
