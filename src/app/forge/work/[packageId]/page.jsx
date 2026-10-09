import { redirect } from "next/navigation";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { getWorkPackageDetail } from "@/application/work-management/workPackages";
import { listLinks } from "@/application/work-management/workLinks";
import WorkPackageDetailClient from "@/components/work-management/WorkPackageDetailClient";

export const dynamic = "force-dynamic";

export default async function WorkPackagePage({ params }) {
  const forgeApplication = await createAuthenticatedForgeApplication();
  if (forgeApplication.response) redirect("/auth");

  const { packageId } = await params;
  const detail = await getWorkPackageDetail(forgeApplication.supabaseClient, {
    ownerId: forgeApplication.effectiveOwnerId,
    actor: forgeApplication.user.id,
    packageId,
  });
  if (!detail.ok) redirect("/forge/work");

  const links = await listLinks(forgeApplication.supabaseClient, {
    ownerId: forgeApplication.effectiveOwnerId,
    packageId,
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <p className="text-xs font-mono text-slate-400">{detail.package.code}</p>
      <h1 className="text-2xl font-bold">{detail.package.title}</h1>
      <WorkPackageDetailClient initial={detail} initialLinks={links.ok ? links.links : []} />
    </main>
  );
}
