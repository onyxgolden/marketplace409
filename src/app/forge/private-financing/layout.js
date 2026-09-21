import WorkspaceShell from "@/components/workspace-shell";

// Promoted out of Forge's own ForgeApplicationRail into its own sibling
// workspace (see ForgeApplicationRail.jsx PROMOTED_PREFIXES) -- the Private
// Financing tile highlights here, not Forge.
//
// Note: this also wraps /forge/private-financing/portal, the borrower-facing
// portal, with owner-oriented workspace chrome. That mirrors the pre-existing
// /forge/rental/portal treatment (see its layout's comment); a
// borrower-specific layout carve-out would be a separate task.
export default function PrivateFinancingWorkspaceLayout({ children }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
