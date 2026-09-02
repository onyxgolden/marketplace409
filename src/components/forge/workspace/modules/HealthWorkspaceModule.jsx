import ForgeWorkspaceTile from "@/components/forge/workspace/ForgeWorkspaceTile";
import { WorkspaceModule } from "@/components/forge/workspace/composition/WorkspaceModule";

function renderHealthWorkspaceTile() {
  return (
    <ForgeWorkspaceTile
      eyebrow="Private Application"
      title="Health"
      detail="Shared household health records -- conditions, medications, labs, and clinical history. Visible only to you and your co-owner."
      href="/forge/health"
      actionLabel="Open health workspace"
      status="Private"
    />
  );
}

// No health data is ever fetched into the shared dashboard's read models -- this tile is a bare
// link, and its own visibility is the only gate applied here. The actual records stay behind
// /forge/health's own RLS-enforced access regardless.
export const HealthWorkspaceModule =
  new WorkspaceModule({
    moduleIdentity: "health",
    displayName: "Health",
    category: "health",
    priority: 15,
    renderTile: renderHealthWorkspaceTile,
    isVisible: (context) => context.isOwnerOrCoOwner === true,
  });
