import { redirect } from "next/navigation";
import Link from "next/link";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { listWorkPackages } from "@/application/work-management/workPackages";

export const dynamic = "force-dynamic";

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-700",
  ready: "bg-blue-100 text-blue-800",
  in_progress: "bg-amber-100 text-amber-800",
  blocked: "bg-red-100 text-red-800",
  in_verification: "bg-purple-100 text-purple-800",
  in_readiness_review: "bg-indigo-100 text-indigo-800",
  verified_closed: "bg-green-100 text-green-800",
  cancelled: "bg-slate-200 text-slate-500",
};

export default async function WorkPackagesPage() {
  const forgeApplication = await createAuthenticatedForgeApplication();
  if (forgeApplication.response) redirect("/auth");

  const { ok, packages } = await listWorkPackages(forgeApplication.supabaseClient, {
    ownerId: forgeApplication.effectiveOwnerId,
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Work Packages</h1>
          <p className="mt-1 text-sm text-slate-500">
            Rung 1: the authoritative Work Package core domain. Typed links, readiness, and
            dashboards arrive in later rungs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/forge/work/documents"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Document library
          </Link>
          <Link
            href="/forge/work/new"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            New package
          </Link>
        </div>
      </div>

      {!ok ? (
        <p className="mt-8 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Unable to load work packages.
        </p>
      ) : packages.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500">No work packages yet.</p>
          <Link href="/forge/work/new" className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline">
            Create the first one
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {packages.map((pkg) => (
            <li key={pkg.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <Link href={`/forge/work/${pkg.id}`} className="block">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-mono text-slate-400">{pkg.code}</span>
                    <h2 className="font-semibold text-slate-900">{pkg.title}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[pkg.package_type, pkg.unit, pkg.area, pkg.system].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[pkg.status] || "bg-slate-100"}`}>
                      {pkg.status.replace(/_/g, " ")}
                    </span>
                    {pkg.percent_complete != null && (
                      <span className="text-xs text-slate-500">{pkg.percent_complete}% complete</span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
