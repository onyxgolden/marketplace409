import {
  notFound,
} from "next/navigation";

import {
  listProgrammerCommands,
} from "@/application/developer/ProgrammerCommandRegistry";

import ProgrammerDashboard from "@/components/forge/developer/ProgrammerDashboard";

import {
  loadProgrammerAuthorization,
} from "@/lib/supabase/loadProgrammerAuthorization";

export const dynamic =
  "force-dynamic";

export default async function ForgeDeveloperPage() {
  const authorization =
    await loadProgrammerAuthorization();

  if (
    !authorization.ok ||
    !authorization.authorized
  ) {
    notFound();
  }

  return (
    <ProgrammerDashboard
      commands={
        listProgrammerCommands()
      }
      programmerEmail={
        authorization.user.email
      }
    />
  );
}
