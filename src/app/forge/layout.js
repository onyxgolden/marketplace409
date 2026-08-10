import ForgeApplicationRail from "@/components/forge/ForgeApplicationRail";

import {
  loadProgrammerAuthorization,
} from "@/lib/supabase/loadProgrammerAuthorization";

export default async function ForgeLayout({
  children,
}) {
  const authorization =
    await loadProgrammerAuthorization();

  return (
    <ForgeApplicationRail
      showDeveloperTools={
        authorization.ok &&
        authorization.authorized
      }
    >
      {children}
    </ForgeApplicationRail>
  );
}
