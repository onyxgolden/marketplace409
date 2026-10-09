import { redirect } from "next/navigation";
import Link from "next/link";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { listWorkPackages, listPackagePropertyOptions } from "@/application/work-management/workPackages";
import { WP_STATUS } from "@/domains/work-management/workPackage.js";
import { canonicalPropertySlug } from "@/domains/property/propertyAliases.js";

export const dynamic = "force-dynamic";

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-700",
  planned: "bg-slate-100 text-slate-700",
  readiness_review: "bg-indigo-100 text-indigo-800",
  ready: "bg-blue-100 text-blue-800",
  in_progress: "bg-amber-100 text-amber-800",
  blocked: "bg-red-100 text-red-800",
  complete: "bg-teal-100 text-teal-800",
  in_verification: "bg-purple-100 text-purple-800",
  in_readiness_review: "bg-indigo-100 text-indigo-800",
  verified_closed: "bg-green-100 text-green-800",
  cancelled: "bg-slate-200 text-slate-500",
};

const STATUS_VALUES = Object.values(WP_STATUS);

// Sentinel for "packages with no property assigned". Real property slugs
// are lowercase hyphenated tokens derived from addresses (e.g.
// "4800-kent-ave"), so a double-underscore token can never collide with
// one; it is also never a value canonicalPropertySlug would produce.
const UNASSIGNED = "__unassigned__";

function parseFilters(searchParams) {
  const rawStatus = typeof searchParams?.status === "string" ? searchParams.status : "";
  const rawProperty = typeof searchParams?.propertyId === "string" ? searchParams.propertyId : "";

  const status = rawStatus && rawStatus !== "all" && STATUS_VALUES.includes(rawStatus)
    ? rawStatus
    : "all";

  let propertyId = "all";
  if (rawProperty === UNASSIGNED) {
    propertyId = UNASSIGNED;
  } else if (rawProperty && rawProperty !== "all") {
    propertyId = canonicalPropertySlug(rawProperty);
  }

  return { status, propertyId };
}

function filterPackages(packages, { status, propertyId }) {
  return packages.filter((pkg) => {
    if (status !== "all" && pkg.status !== status) return false;
    if (propertyId === UNASSIGNED) return pkg.property_id == null;
    if (propertyId !== "all") {
      // Packages store canonical slugs already; comparing canonical forms
      // keeps alias-tagged query params working either way.
      return canonicalPropertySlug(pkg.property_id || "") === propertyId;
    }
    return true;
  });
}

export default async function WorkPackagesPage({ searchParams }) {
  const forgeApplication = await createAuthenticatedForgeApplication();
  if (forgeApplication.response) redirect("/auth");

  const ownerId = forgeApplication.effectiveOwnerId;
  const db = forgeApplication.supabaseClient;

  // Same owner-scoped read as before — no new endpoint or query. Filters
  // are applied to the already-loaded array in memory (D5), so a filter
  // can never widen the result beyond this owner's packages.
  const [{ ok, packages }, propertyResult] = await Promise.all([
    listWorkPackages(db, { ownerId }),
    listPackagePropertyOptions(db, { ownerId }).catch(() => ({ ok: false, properties: [] })),
  ]);

  const params = (await searchParams) || {};
  const filters = parseFilters(params);
  const filtered = ok ? filterPackages(packages, filters) : [];
  const hasFilters = filters.status !== "all" || filters.propertyId !== "all";
  const properties = propertyResult.ok ? propertyResult.properties : [];

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

      {ok && packages.length > 0 && (
        <form method="get" action="/forge/work" className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="filter-status">Status</label>
            <select id="filter-status" name="status" defaultValue={filters.status}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="all">All statuses</option>
              {STATUS_VALUES.map((status) => (
                <option key={status} value={status}>{status.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="filter-property">Property</label>
            <select id="filter-property" name="propertyId" defaultValue={filters.propertyId}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="all">All properties</option>
              <option value={UNASSIGNED}>No property assigned</option>
              {properties.map((property) => (
                <option key={property.slug} value={property.slug}>{property.label}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Apply filters
          </button>
          {hasFilters && (
            <Link href="/forge/work" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Clear filters
            </Link>
          )}
        </form>
      )}

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
      ) : filtered.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500">No work packages match these filters.</p>
          <Link href="/forge/work" className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline">
            Clear filters
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {filtered.map((pkg) => (
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
