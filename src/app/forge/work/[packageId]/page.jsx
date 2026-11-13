import { redirect, notFound } from "next/navigation";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { listWorkspacesForActor } from "@/lib/supabase/resolveEffectiveOwnerId";
import { getWorkPackageDetail } from "@/application/work-management/workPackages";
import {
  parseForgeProjectParam,
  resolvePlannerProjectScope,
  SCOPE_KINDS,
} from "@/application/work-management/projectScope";
import { listLinks } from "@/application/work-management/workLinks";
import WorkPackageDetailClient from "@/components/work-management/WorkPackageDetailClient";
import WorkPackageWorkspaceSwitcher from "@/components/work-management/WorkPackageWorkspaceSwitcher";

export const dynamic = "force-dynamic";

// UI-density redesign: the detail page is tabbed (9 tabs; the Milestones tab
// is a placeholder until slice 9 builds it). ?tab= deep-links to a tab;
// anything unknown falls back to Overview.
const TABS = ["overview", "steps", "planning", "milestones", "permits", "redlines", "budget", "documents", "activity"];

export default async function WorkPackagePage({ params, searchParams }) {
  const query = (await searchParams) || {};
  // UI-density redesign: ?workspace= selects a workspace the actor can act
  // within. Validated inside resolveEffectiveOwnerId (own id or an active
  // membership only); anything else falls back to the default resolution.
  const requestedWorkspace = typeof query.workspace === "string" ? query.workspace : null;
  const forgeApplication = await createAuthenticatedForgeApplication({ requestedOwnerId: requestedWorkspace });
  if (forgeApplication.response) redirect("/auth");

  const ownerId = forgeApplication.effectiveOwnerId;
  const workspaces = await listWorkspacesForActor({ supabaseClient: forgeApplication.supabaseClient, actorUserId: forgeApplication.user.id });
  const workspaceParam = requestedWorkspace && ownerId === requestedWorkspace ? requestedWorkspace : null;

  const { packageId } = await params;
  // PR B: the detail view is project-scoped like the list. No project
  // selected (or an invalid/archived/cross-owner hint) sends the user
  // to the list, which is the chooser — the detail never renders
  // owner-wide, and a package outside the scope is a 404 (same branch
  // as a nonexistent id, so existence is never leaked).
  const rawForgeProject = typeof query.forgeProject === "string" ? query.forgeProject : null;
  const scopeResult = await resolvePlannerProjectScope(forgeApplication.supabaseClient, {
    ownerId,
    forgeProject: parseForgeProjectParam(rawForgeProject),
  });
  if (!scopeResult.ok || scopeResult.scope.kind === SCOPE_KINDS.NONE) {
    const back = new URLSearchParams();
    if (workspaceParam) back.set("workspace", workspaceParam);
    redirect(back.toString() ? `/forge/work?${back.toString()}` : "/forge/work");
  }
  const scope = scopeResult.scope;
  const detail = await getWorkPackageDetail(forgeApplication.supabaseClient, {
    ownerId,
    actor: forgeApplication.user.id,
    packageId,
    scope,
  });
  // D8(b): a nonexistent id (or a package RLS hides from this actor — same
  // branch for both, so existence is never leaked to an unauthorized
  // viewer) used to silently redirect to the list with no explanation.
  // notFound() renders not-found.jsx inside this segment's own layout, so
  // the Planner nav bar stays visible instead of a bare redirect.
  if (!detail.ok) notFound();

  const links = await listLinks(forgeApplication.supabaseClient, {
    ownerId,
    packageId,
  });

  const rawTab = typeof query.tab === "string" ? query.tab : "";
  const activeTab = TABS.includes(rawTab) ? rawTab : "overview";

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <p className="text-xs font-mono text-slate-400">{detail.package.code}</p>
      <h1 className="text-2xl font-bold">{detail.package.title}</h1>
      <WorkPackageWorkspaceSwitcher
        workspaces={workspaces}
        currentOwnerId={ownerId}
        basePath={`/forge/work/${packageId}`}
        preserveParams={{
          tab: activeTab !== "overview" ? activeTab : "",
          forgeProject: scope.kind === SCOPE_KINDS.PROJECT
            ? scope.projectId
            : scope.kind === SCOPE_KINDS.UNASSIGNED
              ? "unassigned"
              : "",
        }}
      />
      <WorkPackageDetailClient
        key={packageId}
        initial={detail}
        initialLinks={links.ok ? links.links : []}
        initialTab={activeTab}
        workspaceParam={workspaceParam}
      />
    </main>
  );
}
