import WorkspaceShell from "@/components/workspace-shell";

// Promoted out of Forge's own ForgeApplicationRail into its own sibling
// workspace (see ForgeApplicationRail.jsx PROMOTED_PREFIXES) -- the Reservations
// tile highlights here, not Forge.
export default function ReservationsWorkspaceLayout({ children }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
