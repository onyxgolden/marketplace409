import ForgePortfolioSummary from "@/components/forge/ForgePortfolioSummary";
import ForgeWorkspaceTile from "@/components/forge/workspace/ForgeWorkspaceTile";
import { WorkspaceModule } from "@/components/forge/workspace/composition/WorkspaceModule";

function renderPropertyPortfolioWorkspaceTile({
  portfolioSummaryItems,
}) {
  return (
    <ForgeWorkspaceTile
      eyebrow="Property Application"
      title="Property Portfolio"
      detail="Owner-scoped portfolio value and property operations represented by current holdings."
      href="/forge/property"
      actionLabel="Open property application"
      status="Owner scoped"
    >
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <ForgePortfolioSummary
          summaryItems={
            portfolioSummaryItems
          }
          variant="embedded"
        />
      </div>
    </ForgeWorkspaceTile>
  );
}

export const PropertyPortfolioWorkspaceModule =
  new WorkspaceModule({
    moduleIdentity: "property-portfolio",
    displayName: "Property Portfolio",
    category: "property",
    priority: 30,
    renderTile:
      renderPropertyPortfolioWorkspaceTile,
  });
