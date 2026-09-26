import WorkspaceShell from "@/components/workspace-shell";

// Promoted out of Forge's own ForgeApplicationRail into its own sibling
// workspace, the same way /forge/rental, /forge/developer, /forge/scheduling,
// /forge/designer, /forge/private-financing, and /forge/reservations were --
// see ForgeApplicationRail.jsx (PROMOTED_PREFIXES), which steps aside for this
// entire subtree. Without this layout the page rendered bare: no rail, no
// workspace chrome, no back/home link, and browser-back was the only way out.
// This layout supplies the shared top-level workspace chrome; auth is still
// gated independently by the page.
export default function ChartsWorkspaceLayout({ children }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
