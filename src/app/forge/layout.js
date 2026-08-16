import ForgeApplicationRail from "@/components/forge/ForgeApplicationRail";

// Programmer-tools access is still gated independently at the page level
// (src/app/forge/developer/page.jsx calls loadProgrammerAuthorization()
// and notFound()s if unauthorized) — that gate no longer needs plumbing
// through this layout now that /forge/developer is its own promoted
// workspace with its own nested layout.
export default function ForgeLayout({
  children,
}) {
  return (
    <ForgeApplicationRail>
      {children}
    </ForgeApplicationRail>
  );
}
