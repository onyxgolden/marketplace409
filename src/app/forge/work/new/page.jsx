import { redirect } from "next/navigation";
import WorkPackageCreateForm from "@/components/work-management/WorkPackageCreateForm";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

export const dynamic = "force-dynamic";

export default async function NewWorkPackagePage({ searchParams }) {
  const params = (await searchParams) || {};
  const requestedWorkspace = typeof params.workspace === "string" ? params.workspace : null;
  const forgeApplication = await createAuthenticatedForgeApplication({ requestedOwnerId: requestedWorkspace });
  if (forgeApplication.response) redirect("/auth");

  // ?propertyId= preselects the property the owner came from (property
  // page's "New work package" action). The form matches it against the
  // owner's actual properties before selecting anything.
  const initialPropertyId = typeof params.propertyId === "string" ? params.propertyId : "";
  // ?mode= carries the list page's active mode filter/toggle onto "New
  // package", so a package created from an Industrial-filtered list
  // defaults to Industrial (and likewise for Commercial) rather than
  // always landing on the hardcoded default.
  const initialMode = params.mode === "commercial" ? "commercial" : "industrial";

  const workspaceParam = requestedWorkspace && forgeApplication.effectiveOwnerId === requestedWorkspace ? requestedWorkspace : null;
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">New work package</h1>
      <p className="mt-1 text-sm text-slate-500">
        Packages start as drafts and receive the next per-workspace code (WP-0001, …) on creation.
      </p>
      <WorkPackageCreateForm initialPropertyId={initialPropertyId} workspaceParam={workspaceParam} initialMode={initialMode} />
    </main>
  );
}
