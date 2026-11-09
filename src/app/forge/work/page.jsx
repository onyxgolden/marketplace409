import { redirect } from "next/navigation";
import Link from "next/link";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { listWorkspacesForActor } from "@/lib/supabase/resolveEffectiveOwnerId";
import { listWorkPackages, listPackagePropertyOptions } from "@/application/work-management/workPackages";
import { WP_STATUS } from "@/domains/work-management/workPackage.js";
import { formatCents } from "@/domains/work-management/packageCosts.js";
import { canonicalPropertySlug } from "@/domains/property/propertyAliases.js";
import WorkPackageWorkspaceSwitcher from "@/components/work-management/WorkPackageWorkspaceSwitcher";

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

// Dense grid columns (UI-density redesign): Package # · Title · Status ·
// Property · Owner team · Budget / Actual · Effective window · % Complete ·
// Scope · Updated. Fixed columns stay single-line (truncated); only the
// Scope column may wrap, per the density bar.
const GRID_COLS = "grid-cols-[5rem_minmax(12rem,2fr)_7.5rem_9rem_8rem_8rem_10.5rem_4.5rem_minmax(9rem,1.5fr)_6rem]";

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

function shortDate(value) {
  return value ? String(value).slice(0, 10) : "—";
}

export default async function WorkPackagesPage({ searchParams }) {
  const params = (await searchParams) || {};
  // UI-density redesign: ?workspace= selects a workspace the actor can act
  // within. Validated inside resolveEffectiveOwnerId (own id or an active
  // membership only); anything else falls back to the default resolution.
  const requestedWorkspace = typeof params.workspace === "string" ? params.workspace : null;
  const forgeApplication = await createAuthenticatedForgeApplication({ requestedOwnerId: requestedWorkspace });
  if (forgeApplication.response) redirect("/auth");

  const ownerId = forgeApplication.effectiveOwnerId;
  const db = forgeApplication.supabaseClient;
  const workspaces = await listWorkspacesForActor({ supabaseClient: db, actorUserId: forgeApplication.user.id });
  const workspaceQuery = requestedWorkspace && ownerId === requestedWorkspace
    ? `?workspace=${encodeURIComponent(requestedWorkspace)}`
    : "";

  // Same owner-scoped read as before — no new endpoint or query. Filters
  // are applied to the already-loaded array in memory (D5), so a filter
  // can never widen the result beyond this owner's packages.
  const [{ ok, packages }, propertyResult] = await Promise.all([
    listWorkPackages(db, { ownerId }),
    listPackagePropertyOptions(db, { ownerId }).catch(() => ({ ok: false, properties: [] })),
  ]);

  const filters = parseFilters(params);
  const filtered = ok ? filterPackages(packages, filters) : [];
  const hasFilters = filters.status !== "all" || filters.propertyId !== "all";
  const properties = propertyResult.ok ? propertyResult.properties : [];
  const propertyLabelBySlug = new Map(properties.map((property) => [property.slug, property.label]));
  const clearHref = workspaceQuery ? `/forge/work${workspaceQuery}` : "/forge/work";

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
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
            href={`/forge/work/new${workspaceQuery}`}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            New package
          </Link>
        </div>
      </div>

      <WorkPackageWorkspaceSwitcher
        workspaces={workspaces}
        currentOwnerId={ownerId}
        basePath="/forge/work"
        preserveParams={{
          status: filters.status !== "all" ? filters.status : "",
          propertyId: filters.propertyId !== "all" ? filters.propertyId : "",
        }}
      />

      {ok && packages.length > 0 && (
        <form method="get" action="/forge/work" className="mt-6 flex flex-wrap items-center gap-3">
          {requestedWorkspace && ownerId === requestedWorkspace && (
            <input type="hidden" name="workspace" value={requestedWorkspace} />
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600" htmlFor="filter-status">Status</label>
            <select id="filter-status" name="status" defaultValue={filters.status}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="all">All statuses</option>
              {STATUS_VALUES.map((status) => (
                <option key={status} value={status}>{status.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600" htmlFor="filter-property">Property</label>
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
            <Link href={clearHref} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
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
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-6 text-center">
          <p className="text-slate-500">No work packages yet.</p>
          <Link href={`/forge/work/new${workspaceQuery}`} className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline">
            Create the first one
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-6 text-center">
          <p className="text-slate-500">No work packages match these filters.</p>
          <Link href={clearHref} className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline">
            Clear filters
          </Link>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <p className="mb-2 text-xs text-slate-500">
            Budget shows the planned estimate only — actuals arrive with the Change Orders Log (slice 8).
          </p>
          <div role="table" aria-label="Work packages" className="min-w-[80rem] border-t border-slate-300">
            <div role="row" className={`sticky top-0 z-10 grid ${GRID_COLS} items-center gap-x-3 border-b-2 border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500`}>
              <div role="columnheader">Package #</div>
              <div role="columnheader">Title</div>
              <div role="columnheader">Status</div>
              <div role="columnheader">Property</div>
              <div role="columnheader">Owner team</div>
              <div role="columnheader">Budget / Actual</div>
              <div role="columnheader">Effective window</div>
              <div role="columnheader">% Complete</div>
              <div role="columnheader">Scope</div>
              <div role="columnheader">Updated</div>
            </div>
            {filtered.map((pkg) => (
              <div key={pkg.id} role="row" className={`relative grid ${GRID_COLS} items-center gap-x-3 border-b border-slate-200 px-3 py-2 text-sm hover:bg-slate-50`}>
                <div role="cell" className="min-w-0 truncate font-mono text-xs text-slate-400">{pkg.code}</div>
                <div role="cell" className="min-w-0 truncate font-medium text-slate-900">
                  <Link
                    href={`/forge/work/${pkg.id}${workspaceQuery}`}
                    className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-blue-700"
                  >
                    {pkg.title}
                  </Link>
                </div>
                <div role="cell" className="min-w-0 truncate">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[pkg.status] || "bg-slate-100"}`}>
                    {pkg.status.replace(/_/g, " ")}
                  </span>
                </div>
                <div role="cell" className="min-w-0 truncate text-slate-700">
                  {pkg.property_id ? (propertyLabelBySlug.get(pkg.property_id) || pkg.property_id) : "—"}
                </div>
                <div role="cell" className="min-w-0 truncate text-slate-700">
                  {pkg.responsible_party?.display_name || "—"}
                </div>
                <div role="cell" className="min-w-0 truncate text-slate-700">
                  {pkg.planned_cost_cents != null ? formatCents(pkg.planned_cost_cents) : "—"} / —
                </div>
                <div role="cell" className="min-w-0 truncate text-slate-700">
                  {shortDate(pkg.planned_start)} – {shortDate(pkg.planned_finish)}
                </div>
                <div role="cell" className="min-w-0 truncate text-slate-700">
                  {pkg.percent_complete != null ? `${pkg.percent_complete}%` : "—"}
                </div>
                <div role="cell" className="text-xs leading-snug text-slate-500">
                  {[pkg.package_type, pkg.unit, pkg.area, pkg.system].filter(Boolean).join(" · ") || "—"}
                </div>
                <div role="cell" className="min-w-0 truncate text-xs text-slate-500">
                  {shortDate(pkg.updated_at)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
