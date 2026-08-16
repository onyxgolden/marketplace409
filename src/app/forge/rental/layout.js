import WorkspaceShell from "@/components/workspace-shell";

// Promoted out of Forge's own ForgeApplicationRail into its own sibling
// workspace — see ForgeApplicationRail.jsx, which steps aside (renders
// children directly, no chrome of its own) for this entire subtree.
//
// Note: this also wraps /forge/rental/portal, the tenant-facing portal,
// with owner-oriented workspace chrome (Marketplace/Rentals/Forge/Dev
// switcher). That mismatch already existed before this change — the portal
// had no layout of its own and simply inherited ForgeApplicationRail's
// owner chrome the same way. Flagging it as pre-existing, not introduced
// here; a tenant-specific layout carve-out would be a separate task.
export default function RentalWorkspaceLayout({ children }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
