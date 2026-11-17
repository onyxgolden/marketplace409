import WorkspaceShell from "@/components/workspace-shell";
import { isProgrammerAuthorized } from "@/lib/supabase/loadProgrammerAuthorization";

export default async function MarketLayout({ children }) {
  return <WorkspaceShell isProgrammer={await isProgrammerAuthorized()}>{children}</WorkspaceShell>;
}
