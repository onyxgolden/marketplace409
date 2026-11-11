import { redirect } from "next/navigation";
import Link from "next/link";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { listWorkspacesForActor } from "@/lib/supabase/resolveEffectiveOwnerId";
import { listWorkPackages, listPackagePropertyOptions } from "@/application/work-management/workPackages";
import { WP_STATUS } from "@/domains/work-management/workPackage.js";
import { canonicalPropertySlug } from "@/domains/property/propertyAliases.js";
import WorkPackageWorkspaceSwitcher from "@/components/work-management/WorkPackageWorkspaceSwitcher";
import WorkPackageListGrid, { BLANK_ROWS } from "@/components/work-management/WorkPackageListGrid.jsx";

export const dynamic = "force-dynamic";

const STATUS_VALUES = Object.values(WP_STATUS);

// Dense grid columns (UI-density redesign): Package # · Title · Status ·
// Property · Owner team · Budget / Actual · Effective window · % Complete ·
// Scope · Updated. The grid itself lives in WorkPackageListGrid —
// Maximo-style grid edit with blank add-rows — and its columns fit one
// desktop screen (no horizontal scroll at 1919px).
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
  const clearHref = workspaceQuery ? `/forge/work${workspaceQuery}` : "/forge/work";

  // D7: a blank add-row is an unsaved draft with no property yet — it must
  // follow the same filter rule as a real row with that shape, not render
  // unconditionally regardless of the active Status/Property filter.
  const blankRowsMatchFilters = (filters.status === "all" || filters.status === "draft")
    && (filters.propertyId === "all" || filters.propertyId === UNASSIGNED);
  const blankRowCount = blankRowsMatchFilters ? BLANK_ROWS : 0;

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
          {/* D11: these two links had no dark: overrides at all -- a
             dark-gray border and dark-gray text on the page's dark
             background rendered as near-invisible "grey-on-dark", unlike
             New package's solid dark-pill/white-text style below, which
             stays readable in either theme without an override. */}
          <Link
            href="/forge/work/documents"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Document library
          </Link>
          <Link
            href="/forge/work/admin"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Admin
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
          {/* D11: a bare <select> has no text/background color of its own
             in dark mode; it inherited the page's white text with the
             browser's native (white) control background, rendering a
             selected value as an invisible white-on-white box. Forcing
             both colors explicitly fixes it regardless of browser. */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="filter-status">Status</label>
            <select id="filter-status" name="status" defaultValue={filters.status}
              key={`status-${filters.status}-${filters.propertyId}`}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white">
              <option value="all">All statuses</option>
              {STATUS_VALUES.map((status) => (
                <option key={status} value={status}>{status.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="filter-property">Property</label>
            <select id="filter-property" name="propertyId" defaultValue={filters.propertyId}
              key={`property-${filters.status}-${filters.propertyId}`}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white">
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
            <Link href={clearHref} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              Clear filters
            </Link>
          )}
        </form>
      )}

      {!ok ? (
        <p className="mt-8 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Unable to load work packages.
        </p>
      ) : filtered.length === 0 && hasFilters && blankRowCount === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-6 text-center">
          <p className="text-slate-500">No work packages match these filters.</p>
          <Link href={clearHref} className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline">
            Clear filters
          </Link>
        </div>
      ) : (
        // The editable grid fills the page with blank add-rows even when
        // there are no packages yet — typing in a blank row creates the
        // next package. There is no separate "no packages" empty state.
        <WorkPackageListGrid
          initialPackages={filtered}
          properties={properties}
          workspaceQuery={workspaceQuery}
          blankRowCount={blankRowCount}
        />
      )}
    </main>
  );
}
