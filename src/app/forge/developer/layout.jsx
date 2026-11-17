import WorkspaceShell from "@/components/workspace-shell";
import { isProgrammerAuthorized } from "@/lib/supabase/loadProgrammerAuthorization";

// Promoted out of Forge's own ForgeApplicationRail into its own sibling
// workspace. Access is still gated independently by the page itself
// (loadProgrammerAuthorization + notFound()), not by this layout — this
// layout only supplies the shared chrome.
export default async function DevWorkspaceLayout({ children }) {
  return <WorkspaceShell forgeCommandPalette isProgrammer={await isProgrammerAuthorized()}>{children}</WorkspaceShell>;
}
