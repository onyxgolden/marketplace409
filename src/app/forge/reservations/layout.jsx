import WorkspaceShell from "@/components/workspace-shell";
import { isProgrammerAuthorized } from "@/lib/supabase/loadProgrammerAuthorization";

// Promoted out of Forge's own ForgeApplicationRail into its own sibling
// workspace (see ForgeApplicationRail.jsx PROMOTED_PREFIXES) -- the Reservations
// tile highlights here, not Forge.
export default async function ReservationsWorkspaceLayout({ children }) {
  return <WorkspaceShell forgeCommandPalette isProgrammer={await isProgrammerAuthorized()}>{children}</WorkspaceShell>;
}
