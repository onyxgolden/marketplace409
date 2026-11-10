import { redirect } from "next/navigation";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { listWorkspacesForActor } from "@/lib/supabase/resolveEffectiveOwnerId";
import WorkPackageWorkspaceSwitcher from "@/components/work-management/WorkPackageWorkspaceSwitcher";
import PlannerAdminClient from "@/components/work-management/PlannerAdminClient";

export const dynamic = "force-dynamic";

// Work Package Planner admin permissions, slice 1. Workspace-scoped (not
// per-package), so this is its own page rather than a tab on the package
// detail view -- role assignment and the capability matrix apply to the
// whole workspace, same as Settings in this directory's other apps.
export default async function WorkPackageAdminPage({ searchParams }) {
  const query = (await searchParams) || {};
  const requestedWorkspace = typeof query.workspace === "string" ? query.workspace : null;
  const forgeApplication = await createAuthenticatedForgeApplication({ requestedOwnerId: requestedWorkspace });
  if (forgeApplication.response) redirect("/auth");

  const ownerId = forgeApplication.effectiveOwnerId;
  const workspaces = await listWorkspacesForActor({ supabaseClient: forgeApplication.supabaseClient, actorUserId: forgeApplication.user.id });

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">Planner administration</h1>
      <p className="mt-1 text-sm text-slate-500">
        Manage roles, permissions, and staff assignments for the Work Package Planner.
      </p>
      <WorkPackageWorkspaceSwitcher
        workspaces={workspaces}
        currentOwnerId={ownerId}
        basePath="/forge/work/admin"
        preserveParams={{}}
      />
      <PlannerAdminClient />
    </main>
  );
}
