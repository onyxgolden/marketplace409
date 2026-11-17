import ForgeApplicationRail from "@/components/forge/ForgeApplicationRail";

import {
  loadProgrammerAuthorization,
} from "@/lib/supabase/loadProgrammerAuthorization";

// The developer page itself is still gated independently at the page level
// (src/app/forge/developer/page.jsx calls loadProgrammerAuthorization()
// and notFound()s if unauthorized) — that gate no longer needs plumbing
// through this layout now that /forge/developer is its own promoted
// workspace with its own nested layout. What IS plumbed here is only a
// boolean: whether the signed-in user is an authorized programmer, so the
// rail can hide the Dev link from everyone else instead of advertising a
// page they cannot open (the owner is deliberately not a programmer).
// Fail closed: any authorization failure hides the link; it never grants
// access, and the registry itself never leaves the server.
export default async function ForgeLayout({
  children,
}) {
  let isProgrammer = false;
  try {
    const authorization = await loadProgrammerAuthorization();
    isProgrammer = authorization?.ok === true && authorization?.authorized === true;
  } catch {
    isProgrammer = false;
  }

  return (
    <ForgeApplicationRail isProgrammer={isProgrammer}>
      {children}
    </ForgeApplicationRail>
  );
}
