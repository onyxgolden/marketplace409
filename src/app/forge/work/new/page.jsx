import { redirect } from "next/navigation";
import WorkPackageCreateForm from "@/components/work-management/WorkPackageCreateForm";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

export const dynamic = "force-dynamic";

export default async function NewWorkPackagePage({ searchParams }) {
  const forgeApplication = await createAuthenticatedForgeApplication();
  if (forgeApplication.response) redirect("/auth");

  // ?propertyId= preselects the property the owner came from (property
  // page's "New work package" action). The form matches it against the
  // owner's actual properties before selecting anything.
  const params = (await searchParams) || {};
  const initialPropertyId = typeof params.propertyId === "string" ? params.propertyId : "";

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">New work package</h1>
      <p className="mt-1 text-sm text-slate-500">
        Packages start as drafts and receive the next per-workspace code (WP-0001, …) on creation.
      </p>
      <WorkPackageCreateForm initialPropertyId={initialPropertyId} />
    </main>
  );
}
