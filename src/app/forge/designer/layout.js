import WorkspaceShell from "@/components/workspace-shell";

// Promoted out of Forge's own ForgeApplicationRail into its own sibling
// workspace, the same way /forge/scheduling, /forge/rental, and
// /forge/developer were -- see ForgeApplicationRail.jsx (PROMOTED_PREFIXES)
// and src/lib/workspaces.js, which steps aside for this entire subtree.
// This layout only supplies the shared top-level workspace chrome
// (Marketplace/Rentals/Forge/Scheduling/Designer/Dev switcher); auth is
// still gated independently by each page. The room designer keeps its own
// domain layer, with summarizeDesignForEstimating() as the clean seam for
// future schedule/cost links.
export default function DesignerWorkspaceLayout({ children }) {
  return <WorkspaceShell forgeCommandPalette>{children}</WorkspaceShell>;
}
