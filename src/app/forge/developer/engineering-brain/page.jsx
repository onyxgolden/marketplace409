import {
  notFound,
} from "next/navigation";

import EngineeringBrainPanel from "@/components/forge/developer/EngineeringBrainPanel";

import {
  loadProgrammerAuthorization,
} from "@/lib/supabase/loadProgrammerAuthorization";

export const dynamic =
  "force-dynamic";

export default async function ForgeEngineeringBrainPage() {
  const authorization =
    await loadProgrammerAuthorization();

  if (
    !authorization.ok ||
    !authorization.authorized
  ) {
    notFound();
  }

  return (
    <EngineeringBrainPanel />
  );
}
