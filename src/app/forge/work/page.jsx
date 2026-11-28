import { redirect } from "next/navigation";
import Link from "next/link";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { listWorkspacesForActor } from "@/lib/supabase/resolveEffectiveOwnerId";
import { listWorkPackages, listPackagePropertyOptions } from "@/application/work-management/workPackages";
import { listPlanningProgressForPackages } from "@/application/work-management/planningProcess";
import { listCostSplitForPackages } from "@/application/work-management/budgetAllocations";
import { BUDGET_CATEGORY_VALUES } from "@/domains/work-management/budgetAllocations";
import {
  parseForgeProjectParam,
  resolvePlannerProjectScope,
  SCOPE_KINDS,
} from "@/application/work-management/projectScope";
import { WP_STATUS, WP_MODES, inferEffectiveMode, matchesPackageStatus } from "@/domains/work-management/workPackage.js";
import { canonicalPropertySlug } from "@/domains/property/propertyAliases.js";
import { SCOPE_BLOCK_DIMENSIONS } from "@/application/work-management/plannerDashboard.js";
import WorkPackageWorkspaceSwitcher from "@/components/work-management/WorkPackageWorkspaceSwitcher";
import WorkPackagePageHeader from "./page-header";
import WorkPackageFilterForm, { GROUP_NONE, PLANNER_UNASSIGNED, UNASSIGNED } from "./WorkPackageFilterForm.jsx";
import PlannerDashboardShell from "@/components/work-management/PlannerDashboardShell.jsx";
import WorkPackageListGrid, { BLANK_ROWS } from "@/components/work-management/WorkPackageListGrid.jsx";

export const dynamic = "force-dynamic";

const STATUS_VALUES = Object.values(WP_STATUS);

// Dense grid columns (UI-density redesign): Package # · Title · Status ·
// Property · Owner team · Budget / Actual · Effective window · % Complete ·
// Scope · Updated. The grid itself lives in WorkPackageListGrid —
// Maximo-style grid edit with blank add-rows — and its columns fit one
// desktop screen (no horizontal scroll at 1919px).
// The filter sentinels live in WorkPackageFilterForm.jsx (single source
// of truth — the form renders them as option values).
const PROGRESS_DIMENSIONS = ["system", "planner", "unit"];
// D3: the one active group filter now spans 5 dimensions, not D2's 3.
// Canonical conflict precedence (brief: "preserve D2's existing relative
// precedence and extend it explicitly") — planner still beats unit beats
// system, with area inserted between planner and unit, and workscopeCode
// appended after system.
const GROUP_FILTER_PRECEDENCE = ["planner", "area", "unit", "system", "workscopeCode"];
const SCOPE_BLOCK_DIMENSION_KEYS = SCOPE_BLOCK_DIMENSIONS.map((d) => d.key);

function parseFilters(searchParams) {
  const rawStatus = typeof searchParams?.status === "string" ? searchParams.status : "";
  const rawProperty = typeof searchParams?.propertyId === "string" ? searchParams.propertyId : "";
  const rawMode = typeof searchParams?.mode === "string" ? searchParams.mode : "";
  const rawPlanner = typeof searchParams?.planner === "string" ? searchParams.planner : "";
  const rawArea = typeof searchParams?.area === "string" ? searchParams.area : "";
  const rawUnit = typeof searchParams?.unit === "string" ? searchParams.unit : "";
  const rawSystem = typeof searchParams?.system === "string" ? searchParams.system : "";
  const rawWorkscopeCode = typeof searchParams?.workscopeCode === "string" ? searchParams.workscopeCode : "";
  const rawProgressBy = typeof searchParams?.progressBy === "string" ? searchParams.progressBy : "";
  const rawScopeBy = typeof searchParams?.scopeBy === "string" ? searchParams.scopeBy : "";
  const rawScopeView = typeof searchParams?.scopeView === "string" ? searchParams.scopeView : "";
  const rawCostCategory = typeof searchParams?.costCategory === "string" ? searchParams.costCategory : "";
  const rawAllocation = typeof searchParams?.allocation === "string" ? searchParams.allocation : "";
  const rawPackageStatus = typeof searchParams?.packageStatus === "string" ? searchParams.packageStatus : "";

  const status = rawStatus && rawStatus !== "all" && STATUS_VALUES.includes(rawStatus)
    ? rawStatus
    : "all";

  let propertyId = "all";
  if (rawProperty === UNASSIGNED) {
    propertyId = UNASSIGNED;
  } else if (rawProperty && rawProperty !== "all") {
    propertyId = canonicalPropertySlug(rawProperty);
  }

  // Mode filter: "all" shows every package regardless of mode — the
  // mode toggle only narrows the list and sets the default for "New
  // package" when a specific mode is chosen, it never hides packages
  // by default (unlike status/property, which also default to "all").
  const mode = WP_MODES.includes(rawMode) ? rawMode : "all";

  // D2/D3 progress + block-map drill-down: planner / area / unit /
  // system / workscopeCode narrow the grid to the group a dashboard row
  // counts. Any non-empty value filters; the sentinel values match
  // packages with no value in that dimension. progressBy / scopeBy are
  // the two dashboards' own tabs (null = default: the active group
  // filter's dimension if that widget supports it, else each widget's
  // own default).
  //
  // Mutual exclusion (D2 fix round 1, P1; extended for D3): these five
  // are ONE group filter, not five — the first active dimension by
  // GROUP_FILTER_PRECEDENCE wins, the others are cleared. The filter
  // form and either dashboard widget can submit more than one at once,
  // and a bookmarked link can carry several, so without this a widget
  // could highlight one project-wide group row ("currently filtered")
  // while the grid showed the intersection with the other dimensions —
  // the displayed count would not reconcile with the rows. The page also
  // redirects a combined URL to its canonical form (see the component),
  // so the address bar agrees with the filters; this normalization is
  // the safety net that makes the semantics true even if a combined URL
  // ever reaches here.
  const rawGroupValues = { planner: rawPlanner, area: rawArea, unit: rawUnit, system: rawSystem, workscopeCode: rawWorkscopeCode };
  const groupValues = {};
  for (const dim of GROUP_FILTER_PRECEDENCE) groupValues[dim] = rawGroupValues[dim] || "all";
  let winnerSeen = false;
  for (const dim of GROUP_FILTER_PRECEDENCE) {
    if (winnerSeen) {
      groupValues[dim] = "all";
    } else if (groupValues[dim] !== "all") {
      winnerSeen = true;
    }
  }
  const { planner, area, unit, system, workscopeCode } = groupValues;
  const progressBy = PROGRESS_DIMENSIONS.includes(rawProgressBy) ? rawProgressBy : null;
  const scopeBy = SCOPE_BLOCK_DIMENSION_KEYS.includes(rawScopeBy) ? rawScopeBy : null;
  const scopeView = rawScopeView === "table" ? "table" : rawScopeView === "treemap" ? "treemap" : null;
  // D2b cost drill-down: costCategory is one of the five fixed
  // categories (allowlisted — anything else is ignored, never widened
  // into a filter); allocation=unallocated narrows to estimated
  // packages with no reconciled allocation.
  const costCategory = BUDGET_CATEGORY_VALUES.includes(rawCostCategory) ? rawCostCategory : null;
  const allocation = rawAllocation === "unallocated" ? "unallocated" : null;
  // Slice A (control-estimate versioning): the active / canceled / all
  // lens. Default "active" — canceled packages are excluded until the
  // owner asks for them; an invalid value fails closed to "active",
  // never widened into a filter.
  const packageStatus = ["active", "canceled", "all"].includes(rawPackageStatus)
    ? rawPackageStatus
    : "active";

  return {
    status, propertyId, mode, planner, area, unit, system, workscopeCode,
    progressBy, scopeBy, scopeView, costCategory, allocation, packageStatus,
  };
}

function filterValueMatches(rowValue, filter) {
  // A row with no value matches only the sentinel; a row with a value
  // matches only its exact (trimmed) value. Trimming on both sides
  // keeps the grid consistent with the dashboard grouping, which
  // trims display names / units / systems the same way.
  const value = typeof rowValue === "string" ? rowValue.trim() : "";
  if (filter === PLANNER_UNASSIGNED || filter === GROUP_NONE) return value === "";
  return value !== "" && value === filter;
}

function filterPackages(packages, { status, propertyId, mode, planner, area, unit, system, workscopeCode, costCategory, allocation, packageStatus }, costByPackage = null) {
  return packages.filter((pkg) => {
    // Slice A: the active / canceled / all lens applies first, then the
    // existing predicates — they compose as an intersection.
    if (!matchesPackageStatus(pkg, packageStatus)) return false;
    if (status !== "all" && pkg.status !== status) return false;
    if (mode !== "all" && inferEffectiveMode(pkg) !== mode) return false;
    // Guard clauses, never early returns: every active filter narrows
    // the same row (a property filter must not swallow the planner /
    // area / unit / system / workscopeCode filters below it).
    if (propertyId === UNASSIGNED && pkg.property_id != null) return false;
    if (propertyId !== "all" && propertyId !== UNASSIGNED) {
      // Packages store canonical slugs already; comparing canonical forms
      // keeps alias-tagged query params working either way.
      if (canonicalPropertySlug(pkg.property_id || "") !== propertyId) return false;
    }
    if (planner !== "all" && !filterValueMatches(pkg.responsible_party?.display_name, planner)) return false;
    if (area !== "all" && !filterValueMatches(pkg.area, area)) return false;
    if (unit !== "all" && !filterValueMatches(pkg.unit, unit)) return false;
    if (system !== "all" && !filterValueMatches(pkg.system, system)) return false;
    if (workscopeCode !== "all" && !filterValueMatches(pkg.workscope_code, workscopeCode)) return false;
    // D2b cost filters, read against the one bulk cost-split snapshot
    // (never per-package). A package with no cost entry has no category
    // total and no reconciled state, so it matches neither filter.
    if (costCategory != null) {
      const entry = costByPackage?.[pkg.id];
      if (!entry || (entry.allocation?.categoryTotals?.[costCategory] ?? 0) <= 0) return false;
    }
    if (allocation === "unallocated") {
      const entry = costByPackage?.[pkg.id];
      if (!entry || entry.estimate == null || entry.reconciled) return false;
    }
    return true;
  });
}

export default async function WorkPackagesPage({ searchParams }) {
  const params = (await searchParams) || {};
  // D2 fix round 1 (P1): a combined group-filter URL — the filter form
  // submits all three selects at once, a bookmark can carry several — is
  // redirected to its canonical form (the kept dimension only) so the
  // address bar, the selects, the grid, and the highlighted widget row
  // all describe the same filter. This runs before any read, so a
  // combined load never pays for data it will not render.
  const filters = parseFilters(params);
  const droppedGroupDimensions = GROUP_FILTER_PRECEDENCE.filter((dim) => {
    const raw = typeof params[dim] === "string" ? params[dim] : "";
    return raw && raw !== "all" && filters[dim] === "all";
  });
  if (droppedGroupDimensions.length > 0) {
    const canonicalParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (droppedGroupDimensions.includes(key)) continue;
      if (typeof value === "string") canonicalParams.set(key, value);
    }
    redirect(`/forge/work?${canonicalParams.toString()}`);
  }
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
  // The validated selected workspace — the ?workspace= value, only
  // when it equals the effective owner (the detail page's rule) — so
  // the dashboard's export provenance names the workspace actually
  // selected, never the raw owner id.
  const workspaceParam = requestedWorkspace && ownerId === requestedWorkspace ? requestedWorkspace : null;

  // PR B: the list is project-scoped. ?forgeProject= is parsed and
  // validated server-side on every load (unknown / archived /
  // cross-owner ids fail non-disclosing — never a silent substitute);
  // no hint means the chooser state, never an all-projects aggregate.
  const rawForgeProject = typeof params.forgeProject === "string" ? params.forgeProject : null;
  const scopeResult = await resolvePlannerProjectScope(db, {
    ownerId,
    forgeProject: parseForgeProjectParam(rawForgeProject),
  });
  const scope = scopeResult.ok ? scopeResult.scope : { kind: SCOPE_KINDS.NONE };
  const scopeError = scopeResult.ok ? null : scopeResult.error;
  const forgeProjectParam = scope.kind === SCOPE_KINDS.PROJECT
    ? scope.projectId
    : scope.kind === SCOPE_KINDS.UNASSIGNED
      ? "unassigned"
      : "";
  // Detail links (and the filter form) carry the active scope so a
  // row click never drops the user back to the chooser.
  const scopeQuery = forgeProjectParam ? `forgeProject=${encodeURIComponent(forgeProjectParam)}` : "";
  const pageQuery = [workspaceQuery.replace(/^\?/, ""), scopeQuery].filter(Boolean).join("&");
  const pageQueryString = pageQuery ? `?${pageQuery}` : "";

  // Same owner-scoped read as before — no new endpoint or query. Filters
  // are applied to the already-loaded array in memory (D5), so a filter
  // can never widen the result beyond this owner's packages. Slice A
  // asks the loader to attach each cancelled package's cancel transition
  // (one bounded query, never N+1) so the grid can show when and by whom
  // it was cancelled.
  const [{ ok, packages, unassignedCount }, propertyResult] = await Promise.all([
    listWorkPackages(db, { ownerId, scope, includeCancellation: true }),
    listPackagePropertyOptions(db, { ownerId }).catch(() => ({ ok: false, properties: [] })),
  ]);

  // Filters were parsed (and combined group filters redirected) at the
  // top of the component, before any read — see above. The grid filter
  // runs after the bulk dashboard reads below: the D2b cost filters
  // need the cost-split snapshot.
  const hasFilters = filters.status !== "all" || filters.propertyId !== "all" || filters.mode !== "all"
    || filters.planner !== "all" || filters.area !== "all" || filters.unit !== "all" || filters.system !== "all" || filters.workscopeCode !== "all"
    || filters.costCategory != null || filters.allocation != null
    || filters.packageStatus !== "active";
  const properties = propertyResult.ok ? propertyResult.properties : [];

  // D2 dashboard: one bulk planning-% read for the whole in-scope
  // project (never per-package — a 399-package project would need
  // ~800 queries). The widget describes the whole project, so it reads
  // the unfiltered array. A failure (or the planning data not being set
  // up yet) hides the widget's numbers behind its not-available note
  // instead of breaking the page — the same discipline as
  // getPlanningSummary on the detail page.
  let planningByPackage = null;
  let planningNotApplied = false;
  if (ok && scope.kind !== SCOPE_KINDS.NONE && packages.length > 0) {
    const planningResult = await listPlanningProgressForPackages(db, { ownerId, packages }).catch(() => null);
    planningNotApplied = planningResult?.notApplied === true;
    if (planningResult && !planningResult.notApplied) planningByPackage = planningResult.byPackage;
  }

  // D2b dashboard: one bounded bulk cost-split read for the whole
  // in-scope project (never per-package). The widget and the strip's
  // control-estimate total describe the whole project; the grid filter
  // below narrows against the same snapshot. A failure (or the budget
  // tables not being set up yet) hides the widget's numbers behind its
  // not-available note instead of breaking the page.
  let costByPackage = null;
  let costSummary = null;
  let costNotApplied = false;
  if (ok && scope.kind !== SCOPE_KINDS.NONE && packages.length > 0) {
    const costResult = await listCostSplitForPackages(db, { ownerId, packages }).catch(() => null);
    costNotApplied = costResult?.notApplied === true;
    if (costResult && !costResult.notApplied) {
      costByPackage = costResult.byPackage;
      costSummary = costResult.summary;
    }
  }
  const filtered = ok ? filterPackages(packages, filters, costByPackage) : [];
  // D2b active-state rule (D1/D2 P1 lesson): a cost row claims
  // "currently filtered" only when its filter is set AND no other
  // narrowing filter is active — a combined URL shows the intersection
  // in the grid, so the widget must not advertise a row the grid does
  // not hold.
  const costWidgetCanClaimActive = filters.status === "all"
    && filters.propertyId === "all" && filters.mode === "all"
    && filters.planner === "all" && filters.area === "all" && filters.unit === "all"
    && filters.system === "all" && filters.workscopeCode === "all"
    && filters.packageStatus === "active";
  // The one active group filter, in canonical precedence order (see
  // GROUP_FILTER_PRECEDENCE above — parseFilters already enforced that
  // at most one of these five is non-"all").
  const activeGroup = filters.planner !== "all" ? { dimension: "planner", key: filters.planner }
    : filters.area !== "all" ? { dimension: "area", key: filters.area }
    : filters.unit !== "all" ? { dimension: "unit", key: filters.unit }
    : filters.system !== "all" ? { dimension: "system", key: filters.system }
    : filters.workscopeCode !== "all" ? { dimension: "workscopeCode", key: filters.workscopeCode }
    : null;
  // D2's progress tab: the explicit progressBy param wins; otherwise the
  // active group's dimension IF D2 has a tab for it (D2 only groups by
  // system/planner/unit — an active area or workscopeCode group leaves
  // D2 on its own default, System, which ProgressWidget already falls
  // back to for an unrecognized dimension key); otherwise System.
  const activeDimension = filters.progressBy
    || (activeGroup && PROGRESS_DIMENSIONS.includes(activeGroup.dimension) ? activeGroup.dimension : null)
    || "system";

  // D2 filter selects: distinct in-scope values, so the dropdowns only
  // ever offer planners / units / systems the project actually has.
  // The sentinel options appear only when a package actually lacks
  // that value — no dead "No unit" choice on a fully-unit project.
  // (packages || []) — a failed load returns no array; the selects
  // never render then, but these consts run before the return.
  const scopePackages = packages || [];
  const plannerOptions = [...new Set(scopePackages.map((pkg) => (pkg.responsible_party?.display_name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const unitOptions = [...new Set(scopePackages.map((pkg) => (pkg.unit || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const systemOptions = [...new Set(scopePackages.map((pkg) => (pkg.system || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const hasUnassignedPlanner = scopePackages.some((pkg) => !(pkg.responsible_party?.display_name || "").trim());
  const hasNoUnit = scopePackages.some((pkg) => !(pkg.unit || "").trim());
  const hasNoSystem = scopePackages.some((pkg) => !(pkg.system || "").trim());
  const clearHref = pageQueryString ? `/forge/work${pageQueryString}` : "/forge/work";
  // "New package" carries the active mode filter so a package created
  // while viewing Industrial defaults to Industrial (and likewise for
  // Commercial); "all" carries nothing, leaving the form's own default.
  const newPackageModeQuery = filters.mode !== "all" ? `${pageQueryString ? "&" : "?"}mode=${filters.mode}` : "";
  const newPackageHref = `/forge/work/new${pageQueryString}${newPackageModeQuery}`;
  const selection = scope.kind === SCOPE_KINDS.PROJECT ? scope.selection : null;
  const heading = scope.kind === SCOPE_KINDS.UNASSIGNED
    ? "Unassigned packages"
    : scope.kind === SCOPE_KINDS.PROJECT
      ? selection?.project?.name || "Work Packages"
      : "Work Packages";
  const subheading = scope.kind === SCOPE_KINDS.UNASSIGNED
    ? "Packages not assigned to a project yet — assign one from its detail page."
    : scope.kind === SCOPE_KINDS.PROJECT
      ? [selection?.client?.name, selection?.site?.name].filter(Boolean).join(" › ")
        || "Rung 1: the authoritative Work Package core domain. Typed links and readiness arrive in later rungs."
      : "Rung 1: the authoritative Work Package core domain. Typed links and readiness arrive in later rungs.";

  // D1 dashboard: the strip's Project block shows the client › site
  // context when the scope has one; the unassigned inbox gets a plain
  // one-line explanation instead.
  const projectContext = scope.kind === SCOPE_KINDS.PROJECT
    ? [selection?.client?.name, selection?.site?.name].filter(Boolean).join(" › ") || null
    : scope.kind === SCOPE_KINDS.UNASSIGNED
      ? "Packages not assigned to a project yet"
      : null;

  // D1 dashboard (fix round 1 — project-wide semantic): the strip +
  // scope chart describe the whole in-scope project, and every drill-down
  // link must land on exactly the rows the displayed count describes.
  // The base href therefore carries ONLY the scope (workspace + project)
  // — never the property/mode narrowing filters and never the status
  // (the chart appends ?status= / &status= itself). Preserving
  // property/mode here used to advertise a project-wide count ("draft:
  // 2 of 2") while the link landed on the filtered intersection (1 row).
  const dashboardBaseHref = pageQueryString ? `/forge/work${pageQueryString}` : "/forge/work";

  // D7: a blank add-row is an unsaved draft with no property yet — it must
  // follow the same filter rule as a real row with that shape, not render
  // unconditionally regardless of the active Status/Property filter.
  // D2: the same rule extends to the group filters — a blank row has no
  // planner / unit / system, so it matches only "all" or the sentinel.
  // D3: same for the two it adds, area / workscopeCode.
  // D2b: a blank row has no cost data either, so it matches only when
  // no cost filter is active.
  const blankRowsMatchFilters = (filters.status === "all" || filters.status === "draft")
    && (filters.propertyId === "all" || filters.propertyId === UNASSIGNED)
    && (filters.planner === "all" || filters.planner === PLANNER_UNASSIGNED)
    && (filters.area === "all" || filters.area === GROUP_NONE)
    && (filters.unit === "all" || filters.unit === GROUP_NONE)
    && (filters.system === "all" || filters.system === GROUP_NONE)
    && (filters.workscopeCode === "all" || filters.workscopeCode === GROUP_NONE)
    && filters.costCategory == null && filters.allocation == null
    // Slice A: a blank row is a draft — it matches the active / all
    // lens, never the canceled-only lens.
    && filters.packageStatus !== "canceled";
  const blankRowCount = blankRowsMatchFilters ? BLANK_ROWS : 0;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <WorkPackagePageHeader heading={heading} subheading={subheading} newPackageHref={newPackageHref} />

      <WorkPackageWorkspaceSwitcher
        workspaces={workspaces}
        currentOwnerId={ownerId}
        basePath="/forge/work"
        preserveParams={{
          status: filters.status !== "all" ? filters.status : "",
          propertyId: filters.propertyId !== "all" ? filters.propertyId : "",
          mode: filters.mode !== "all" ? filters.mode : "",
          planner: filters.planner !== "all" ? filters.planner : "",
          area: filters.area !== "all" ? filters.area : "",
          unit: filters.unit !== "all" ? filters.unit : "",
          system: filters.system !== "all" ? filters.system : "",
          workscopeCode: filters.workscopeCode !== "all" ? filters.workscopeCode : "",
          progressBy: filters.progressBy || "",
          scopeBy: filters.scopeBy || "",
          scopeView: filters.scopeView || "",
          costCategory: filters.costCategory || "",
          allocation: filters.allocation || "",
          packageStatus: filters.packageStatus !== "active" ? filters.packageStatus : "",
          forgeProject: forgeProjectParam,
        }}
      />

      {/* D1/D3 dashboard shell — number strip + scope-by-status chart +
         the D3 scope block map. It describes the whole in-scope project
         (the unfiltered package array), never the chooser state and
         never a failed load; the grid below is the filtered view it
         drills into. */}
      {ok && scope.kind !== SCOPE_KINDS.NONE && (
        <div className="mt-6">
          <PlannerDashboardShell
            projectLabel={heading}
            projectSublabel={projectContext}
            packages={packages}
            baseHref={dashboardBaseHref}
            activeStatus={filters.status !== "all" ? filters.status : null}
            planningByPackage={planningByPackage}
            activeDimension={activeDimension}
            activeGroup={activeGroup}
            costSummary={costSummary}
            activeCostCategory={filters.costCategory}
            activeAllocationFilter={filters.allocation}
            costWidgetCanClaimActive={costWidgetCanClaimActive}
            scopeByParam={filters.scopeBy}
            scopeViewParam={filters.scopeView}
            ownerId={ownerId}
            workspaceParam={workspaceParam}
            planningNotApplied={planningNotApplied}
            costNotApplied={costNotApplied}
            forgeProjectKey={forgeProjectParam || "none"}
            scopeFilters={filters}
          />
        </div>
      )}

      {scope.kind === SCOPE_KINDS.NONE && (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-6">
          <p className="font-medium text-slate-900 dark:text-slate-100">
            {scopeError
              ? "That project could not be found, is archived, or belongs to another workspace — choose a project to see its work packages."
              : "Choose a project to see its work packages."}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Pick a client, then a site, then a project in the selector above
            {unassignedCount > 0 && (
              <>
                {" "}— or open the{" "}
                <Link href={`/forge/work?forgeProject=unassigned${workspaceQuery ? `&${workspaceQuery.slice(1)}` : ""}`} className="font-medium text-blue-700 hover:underline">
                  Unassigned packages inbox ({unassignedCount} {unassignedCount === 1 ? "package" : "packages"})
                </Link>
                {" "}to assign packages that do not belong to a project yet.
              </>
            )}
            .
          </p>
        </div>
      )}

      {ok && packages.length > 0 && scope.kind !== SCOPE_KINDS.NONE && (
        <WorkPackageFilterForm
          key={`filters-${filters.status}-${filters.propertyId}-${filters.mode}-${filters.planner}-${filters.unit}-${filters.system}-${filters.costCategory}-${filters.allocation}-${filters.packageStatus}`}
          filters={filters}
          statusOptions={STATUS_VALUES}
          properties={properties}
          modeOptions={WP_MODES}
          plannerOptions={plannerOptions}
          unitOptions={unitOptions}
          systemOptions={systemOptions}
          hasUnassignedPlanner={hasUnassignedPlanner}
          hasNoUnit={hasNoUnit}
          hasNoSystem={hasNoSystem}
          requestedWorkspace={requestedWorkspace}
          ownerId={ownerId}
          forgeProjectParam={forgeProjectParam}
          hasFilters={hasFilters}
          clearHref={clearHref}
        />
      )}

      {/* Slice A: the count line states what the grid holds — the
         filtered count against the loaded total — and whether canceled
         packages are in or out, so the totals surface never silently
         disagrees with the rows. */}
      {ok && packages.length > 0 && scope.kind !== SCOPE_KINDS.NONE && (
        <p className="mt-4 text-sm text-slate-500">
          Showing {filtered.length} of {packages.length} {packages.length === 1 ? "package" : "packages"}
          {filters.packageStatus === "active"
            ? " · canceled packages excluded"
            : filters.packageStatus === "canceled"
              ? " · canceled packages only"
              : " · including canceled packages"}
        </p>
      )}

      {scope.kind === SCOPE_KINDS.NONE ? null : !ok ? (
        <p className="mt-8 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Unable to load work packages.
        </p>
      ) : filtered.length === 0 && !hasFilters && scope.kind === SCOPE_KINDS.UNASSIGNED ? (
        <>
          <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-6 text-center">
            <p className="text-slate-500">No unassigned packages — every package belongs to a project.</p>
            <p className="mt-1 text-sm text-slate-500">New packages created here start unassigned and appear in this inbox.</p>
          </div>
          <WorkPackageListGrid
            initialPackages={filtered}
            properties={properties}
            workspaceQuery={pageQueryString}
            activeMode={filters.mode !== "all" ? filters.mode : "industrial"}
            blankRowCount={blankRowCount}
            ownerId={ownerId}
          />
        </>
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
          workspaceQuery={pageQueryString}
          activeMode={filters.mode !== "all" ? filters.mode : "industrial"}
          blankRowCount={blankRowCount}
          ownerId={ownerId}
        />
      )}
    </main>
  );
}
