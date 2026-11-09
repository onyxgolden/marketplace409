import Link from "next/link";

// Workspace switcher (UI-density redesign). Server-rendered links: selecting
// a workspace navigates with ?workspace=<ownerId>, which the page resolves
// through resolveEffectiveOwnerId (validated: the actor's own id or an
// active membership only — a crafted value falls back to the default).
// Renders nothing when the actor can act within exactly one workspace, the
// common case today, so the UI stays clean until a second workspace exists.
// `preserveParams` carries the page's other query params (list filters,
// detail tab) across a switch so switching never drops the user's place.
export default function WorkPackageWorkspaceSwitcher({ workspaces, currentOwnerId, basePath, preserveParams = {} }) {
  if (!workspaces || workspaces.length <= 1) return null;

  const preserved = Object.entries(preserveParams).filter(
    ([, value]) => typeof value === "string" && value.length > 0,
  );

  function hrefFor(ownerId) {
    const params = new URLSearchParams(preserved);
    params.set("workspace", ownerId);
    return `${basePath}?${params.toString()}`;
  }

  return (
    <nav aria-label="Workspace" className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-500">Workspace:</span>
      {workspaces.map((workspace) => {
        const active = workspace.ownerId === currentOwnerId;
        return (
          <Link
            key={workspace.ownerId}
            href={hrefFor(workspace.ownerId)}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white"
                : "rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            }
          >
            {workspace.label}
            {workspace.role !== "owner" ? ` (${workspace.role.replace(/_/g, " ")})` : ""}
          </Link>
        );
      })}
    </nav>
  );
}
