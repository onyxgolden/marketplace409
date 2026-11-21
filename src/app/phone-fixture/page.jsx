"use client";

/**
 * Phone-layout geometry fixture — DEV ONLY.
 *
 * Renders the real components behind Phone Slice 5 (and the Slice 2 rental
 * strip, as a regression guard) with representative fixture data, so the
 * Playwright geometry check measures actual components at real phone
 * viewports instead of copies of their markup. In production this route
 * 404s.
 *
 * Cases (?case=):
 *   designer    — PlanCanvas with the representative 720x360 multi-room
 *                 house plan (the S26+ walkthrough plan's shape: adjacent
 *                 rooms, short divider walls, two wood platforms).
 *   fccu        — PlanCanvas with the REAL FCCU Plot Plan
 *                 (design_mwjvt635_lmexii, 91 pipes / 91 symbols / 21
 *                 equipment), loaded from the provenance-verified
 *                 snapshot (see fccuFixture.js). The design is verified
 *                 on every load; a mismatch renders a provenance-error
 *                 state and the guard fails hard.
 *   room-designs  — the real ProjectsList component (same one
 *                 /forge/designer renders), fed by an intercepted
 *                 /api/forge/designer response in the guard (canned
 *                 project list, no production writes).
 *   work-header — the real WorkPackagePageHeader with the long Rung 1 text.
 *   app-header  — the real WorkspaceShell (command palette on) with a plain
 *                 child, as on Rental / Financing / Marketplace.
 *   forge-header— the real ForgeApplicationRail with a plain child, as on
 *                 the /forge chooser.
 *   rental-23   — the real RentalOverviewPanel for the 23-unit portfolio
 *                 (Slice 2 regression guard — do not change the strip).
 *   health      — the real HealthLabManualEntryForm + HealthSourceDocumentCard
 *                 (Health Labs importer manual-entry build), with fixture
 *                 profiles/documents, no Supabase network calls on render
 *                 (no auth/workspace bootstrap needed — these two
 *                 components take their data as props). The phone-width
 *                 check exercises "Review before saving" too, a pure
 *                 client-side state transition with no network call.
 *   health-dashboard — the real HealthDashboard with a pre-#833 persisted
 *                 snapshot (no `documents` collection) seeded into the
 *                 in-memory SWR cache. Browser-level proof the P1-A
 *                 TypeError fix holds: the exact shape that crashed
 *                 production must render with no throw and no error
 *                 boundary.
 *   rental-performance — the real RentalPropertyPerformancePanel (Rental
 *                 Manager Summary per-property performance section), fed a
 *                 fixture read model built by buildRentalPropertyPerformance
 *                 from fixture units/events — including a very long property
 *                 label and large amounts, so the phone-width check
 *                 measures the stacked cards, the expense detail, and the
 *                 totals at 390/400px. No network calls on render.
 *   projects-list — the real ProjectsScreen (Scheduling Projects list,
 *                 Phone Slice 3), with a fixture project list seeded into
 *                 the in-memory SWR cache — the same long project name and
 *                 September dates the unit tests use, plus a SHARED EXAMPLE
 *                 and an owner project. The guard also intercepts
 *                 /api/forge/scheduling (GET only) as a backstop, so a
 *                 revalidation never touches production. The wrapper
 *                 mirrors WorkspaceShell's production containment
 *                 (min-w-0 flex-1 + min-w-0 content div) — never a bare
 *                 full-width div, which would hide a real containment
 *                 overflow.
 *   work-dashboard — the real PlannerDashboardShell (D1 dashboard
 *                 rebuild: number strip + scope-by-status pivot chart),
 *                 fed 6 wholly synthetic rows created for this test
 *                 (fix round 1 provenance — no production data), inside
 *                 the production page's <main> container.
 *                 No network calls on render.
 *
 * The case comes from window.location.search after mount (no
 * useSearchParams, so no Suspense boundary is needed). The page sets
 * data-fixture-ready once the case has rendered.
 */

import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import PlanCanvas from "@/components/designer/PlanCanvas";
import ProjectsList from "@/components/designer/ProjectsList";
import { buildSlice5FixtureDesign } from "@/domains/roomDesigner/slice5FixtureDesign";
import { loadVerifiedFccuLevelDesign } from "./fccuFixture";
import WorkPackagePageHeader from "@/app/forge/work/page-header";
import WorkspaceShell from "@/components/workspace-shell";
import ForgeApplicationRail from "@/components/forge/ForgeApplicationRail";
import ProjectsScreen from "@/components/forge/scheduling/ProjectsScreen";
import PlannerDashboardShell from "@/components/work-management/PlannerDashboardShell.jsx";
import RentalOverviewPanel from "@/components/forge/rental/RentalOverviewPanel";
import RentalPropertyPerformancePanel from "@/components/forge/rental/RentalPropertyPerformancePanel";
import { buildRentalPropertyPerformance } from "@/application/rental/buildRentalPropertyPerformance";
import HealthDashboard, { HealthLabManualEntryForm, HealthSourceDocumentCard } from "@/components/forge/health/HealthDashboard";
import { seedCacheEntry } from "@/hooks/swrCache";

function daysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function DesignerCase() {
  const [design] = useState(buildSlice5FixtureDesign);
  const [selection, setSelection] = useState(null);
  const dispatch = (action) => {
    if (action?.type === "SELECT") setSelection(action.selection ?? null);
    else if (action?.type === "CLEAR_SELECTION") setSelection(null);
    // Every other action is a no-op in the fixture: this is a viewing
    // fixture, not an editor. Selection is the only interaction the
    // geometry check exercises (tap a wall -> its label must appear).
  };
  return (
    <div className="flex h-dvh w-full bg-slate-950" data-testid="designer-fixture">
      {/* 60px tool-palette rail, mirroring DesignerScreen's left rail, so
          the 2D pane is viewport-minus-rail — the real visible pane bounds,
          not the window width. */}
      <div className="h-full w-[60px] shrink-0 bg-slate-900" aria-hidden="true" />
      <div className="relative h-full min-w-0 flex-1" data-testid="designer-pane">
        <PlanCanvas
          design={design}
          tool="select"
          selection={selection}
          dispatch={dispatch}
          autoFitKey="slice5-fixture:level1"
        />
      </div>
    </div>
  );
}

function fccuSelectionText(design, selection) {
  if (!selection) return null;
  if (selection.kind === "pipe") {
    const run = (design.pipes || []).find((p) => p.id === selection.id);
    if (!run) return `Pipe ${selection.id}`;
    return `Pipe ${run.id} — ${run.service || "pipe"} · ⌀${run.diameterIn ?? "?"}″ · ${(run.points || []).length} vertices`;
  }
  if (selection.kind === "symbol") {
    const inst = (design.symbols || []).find((s) => s.id === selection.id);
    if (!inst) return `Symbol ${selection.id}`;
    return `Equipment ${inst.tag || inst.symbolId} — ${inst.symbolId} · ${inst.domain} · ${inst.layer}`;
  }
  if (selection.kind === "room") {
    const room = (design.rooms || []).find((r) => r.id === selection.id);
    return `Room ${room?.label || selection.id}`;
  }
  return `${selection.kind} ${selection.id}`;
}

// FCCU case — the REAL FCCU Plot Plan (design_mwjvt635_lmexii), loaded
// from the provenance-verified snapshot. The design is verified on every
// load (SHA-256 + counts); a mismatch renders a provenance-error state
// and the guard fails hard — never a silent synthetic fallback.
// The selection disclosure is the bounded phone read-only detail the
// whole-plot label policy promises: tapping a crowded exchanger, pipe
// or equipment object shows its full tag/name here.
function FccuCase() {
  const [loaded, setLoaded] = useState(null);
  const [selection, setSelection] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loadedDesign = await loadVerifiedFccuLevelDesign();
        if (!cancelled) setLoaded({ ok: true, ...loadedDesign });
      } catch (err) {
        if (!cancelled) setLoaded({ ok: false, error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const dispatch = (action) => {
    if (action?.type === "SELECT") setSelection(action.selection ?? null);
    else if (action?.type === "CLEAR_SELECTION") setSelection(null);
    // Every other action is a no-op in the fixture: viewing only.
  };
  if (!loaded) return <main data-fccu-state="verifying">Verifying FCCU fixture…</main>;
  if (!loaded.ok) return <main data-fccu-state="error">{loaded.error}</main>;
  const detail = fccuSelectionText(loaded.design, selection);
  return (
    <div className="flex h-dvh w-full bg-slate-950" data-testid="designer-fixture" data-fccu-state="ready" data-fccu-sha={loaded.sha} data-fccu-counts={JSON.stringify(loaded.counts)}>
      <div className="h-full w-[60px] shrink-0 bg-slate-900" aria-hidden="true" />
      <div className="relative h-full min-w-0 flex-1" data-testid="designer-pane">
        <PlanCanvas
          design={loaded.design}
          tool="select"
          selection={selection}
          dispatch={dispatch}
          autoFitKey="fccu-fixture:level_1"
        />
        {detail && (
          <div data-testid="fccu-selection-detail" className="pointer-events-none absolute bottom-2 left-2 right-2 rounded bg-slate-900/90 px-3 py-2 text-sm text-slate-100">
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

// Room designs case — the REAL ProjectsList component (same one
// /forge/designer renders), fed by the guard's intercepted
// /api/forge/designer response (a canned project list, no production
// writes). The guard measures the subtitle wrap, the input and the
// New design button rects, and page scrollWidth at phone widths.
function RoomDesignsCase() {
  return (
    <div className="min-h-dvh w-full bg-slate-950" data-testid="room-designs-fixture">
      <ProjectsList />
    </div>
  );
}

function WorkHeaderCase() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <WorkPackagePageHeader
        heading="Work Packages"
        subheading="Rung 1: the authoritative Work Package core domain. Typed links, readiness, and dashboards arrive in later rungs."
        newPackageHref="/forge/work/new"
      />
    </main>
  );
}

function AppHeaderCase() {
  return (
    <WorkspaceShell forgeCommandPalette isProgrammer={false}>
      <main className="p-4">Fixture content</main>
    </WorkspaceShell>
  );
}

function ForgeHeaderCase() {
  return (
    <ForgeApplicationRail isProgrammer={false}>
      <main className="p-4">Fixture content</main>
    </ForgeApplicationRail>
  );
}

function Rental23Case() {
  const units = Array.from({ length: 23 }, (_, i) => ({ id: `u${i + 1}`, label: `Unit ${i + 1}` }));
  const leases = Array.from({ length: 21 }, (_, i) => ({
    id: `l${i + 1}`,
    unit_id: `u${i + 1}`,
    status: "active",
    end_date: daysFromNow(200),
  }));
  const initialData = {
    billingEnabled: true,
    units,
    leases,
    payments: [
      { status: "succeeded", succeeded_at: new Date().toISOString(), amount_cents: 150000, refunded_amount_cents: 0, deposit_state: "deposited" },
    ],
    maintenanceRequests: [{ status: "open" }],
    workOrders: [{ status: "assigned" }],
  };
  const report = { summary: { openBalanceCents: 87550, overdueBalanceCents: 12000 } };
  return (
    <main className="p-4">
      <RentalOverviewPanel initialData={initialData} initialReport={report} onNavigate={() => {}} />
    </main>
  );
}

// Health case — the real HealthLabManualEntryForm + HealthSourceDocumentCard, fixture
// profiles/documents only. Neither component makes a Supabase call on render (only on
// submit/delete, which this fixture never triggers), so no network interception is needed here.
const HEALTH_FIXTURE_PROFILES = [
  { id: "profile-1", display_name: "jasonmorgan99@gmail.com" },
  { id: "profile-2", display_name: "spouse@example.com" },
];
const HEALTH_FIXTURE_DOCUMENTS = [
  { id: "doc-1", title: "August 2026 lab report", document_date: "2026-08-10", review_status: "confirmed", bucket: "health-documents", object_path: "ws-1/doc-1.pdf" },
  { id: "doc-2", title: "November 6 labs (page 2 duplicate)", document_date: "2026-11-06", review_status: "extraction_failed", bucket: "health-documents", object_path: "ws-1/doc-2.pdf" },
];
function HealthCase() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4" data-testid="health-fixture">
      <HealthLabManualEntryForm
        workspaceId="ws-1"
        profiles={HEALTH_FIXTURE_PROFILES}
        defaultProfileId="profile-1"
        documents={HEALTH_FIXTURE_DOCUMENTS}
        onSaved={async () => {}}
      />
      <div className="space-y-2" data-testid="health-document-list">
        {HEALTH_FIXTURE_DOCUMENTS.map((document) => (
          <HealthSourceDocumentCard key={document.id} document={document} onChanged={async () => {}} />
        ))}
      </div>
    </main>
  );
}

// Health-dashboard case — the real HealthDashboard with a pre-#833 persisted
// snapshot (every collection except `documents`, which PR #833 added). The
// snapshot is seeded into the in-memory SWR cache synchronously during
// render, so the dashboard renders it on first paint; a missing
// `documents` collection must NOT throw (normalizeHealthSnapshot fills it
// with []). This is the browser-level proof for the P1-A TypeError fix:
// the exact shape that crashed production with
// `Cannot read properties of undefined (reading 'filter')`.
// No Supabase call happens on render (the seeded entry is fresh, so the
// hook does not refetch); auth.getUser only drives the default profile.
const HEALTH_DASHBOARD_PRE833_SNAPSHOT = {
  profiles: [{ id: "profile-1", display_name: "jasonmorgan99@gmail.com", profile_type: "self" }],
  conditions: [{ id: "cond-1", profile_id: "profile-1", name: "High cholesterol", status: "active" }],
  careTeam: [],
  labs: [
    { id: "lab-1", profile_id: "profile-1", marker_name: "LDL cholesterol", collected_on: "2026-08-10", value_numeric: 200, unit: "mg/dL", flag: "high", reference_low: null, reference_high: 100 },
  ],
  regimen: [],
  measurements: [],
  workouts: [],
  timeline: [],
  programs: [],
  programDays: [],
  // NOTE: no `documents` key — the pre-#833 shape.
};
function HealthDashboardCase() {
  // Seed synchronously during render (SSR-safe: memory-only, no localStorage)
  // so the dashboard's first render — server and client alike — reads it.
  seedCacheEntry("health:dashboard:ws-1", HEALTH_DASHBOARD_PRE833_SNAPSHOT);
  return (
    <main data-testid="health-dashboard-fixture">
      <HealthDashboard initialMembership={{ workspace_id: "ws-1" }} />
    </main>
  );
}

// Rental-performance case — the real RentalPropertyPerformancePanel with a
// fixture read model built by the real helper. The long label and the large
// amounts are deliberate: the phone-width check must prove the stacked cards,
// the expense detail, and the totals never overflow at 390/400px. The
// unmatched event proves the reconciliation card renders too. No network
// calls on render (the panel takes its read model as a prop).
const RENTAL_PERFORMANCE_FIXTURE_TODAY = "2026-11-18";
function RentalPerformanceCase() {
  const performance = buildRentalPropertyPerformance({
    today: RENTAL_PERFORMANCE_FIXTURE_TODAY,
    units: [
      { id: "unit_1", property_id: "17706-hwy-62-s", label: "17706 Highway 62 South, Orange, Texas 77630 — Display Lot B (Graceland Dealer Lot)", status: "preparing" },
      { id: "unit_2", property_id: "1218-wagner", label: "1218 Wagner", status: "occupied" },
    ],
    financialEvents: [
      { status: "active", is_deleted: false, event_date: "2026-11-05", amount: "1234567.89", transaction_kind: "income", source_system: "rentec", property_id: "17706-hwy-62-s" },
      { status: "active", is_deleted: false, event_date: "2026-11-06", amount: "98765.43", transaction_kind: "expense", source_system: "rentec", property_id: "17706-hwy-62-s", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false },
      { status: "active", is_deleted: false, event_date: "2026-11-07", amount: "12345.67", transaction_kind: "expense", source_system: "rentec", property_id: "17706-hwy-62-s", normalized_category: "property_tax", affects_noi: true, capitalized: false },
      { status: "active", is_deleted: false, event_date: "2020-05-01", amount: "112500.00", transaction_kind: "asset_purchase", source_system: "rentec", property_id: "17706-hwy-62-s", normalized_category: "capital_improvement", affects_noi: false, capitalized: true },
      { status: "active", is_deleted: false, event_date: "2026-11-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" },
      { status: "active", is_deleted: false, event_date: "2026-11-06", amount: "200.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false },
      { status: "active", is_deleted: false, event_date: "2026-11-05", amount: "900.00", transaction_kind: "income", source_system: "rentec", property_id: "unmatched-house" },
    ],
    propertyFinancialSetups: [],
  });
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4" data-testid="rental-performance-fixture">
      <RentalPropertyPerformancePanel performance={performance} onNavigate={() => {}} />
    </main>
  );
}

// Projects-list case — the real ProjectsScreen (Phone Slice 3). The
// fixture list is seeded into the in-memory SWR cache synchronously
// during render (same pattern as HealthDashboardCase), so the list
// renders on first paint; the guard also intercepts
// /api/forge/scheduling (GET only) as a backstop. Longest-month
// September dates + a long name exercise the card's full-date rendering;
// one SHARED EXAMPLE and one owner project exercise the badge and the
// owner-only delete. The wrapper mirrors WorkspaceShell's production
// containment (min-w-0 flex-1 + min-w-0 content div).
const PROJECTS_LIST_FIXTURE = [
  {
    id: "p-long-name",
    name: "FCCU Turnaround — Fall 2026 Shutdown and Revamp",
    startDate: "2026-09-30",
    endDate: "2026-12-31",
    createdAt: "2026-08-01T12:00:00Z",
    updatedAt: "2026-11-10T14:00:00Z",
    isPublic: true,
    isOwner: false,
  },
  {
    id: "p-owner",
    name: "Crude Unit Revamp",
    startDate: "2026-11-02",
    endDate: "2026-11-20",
    createdAt: "2026-09-15T12:00:00Z",
    updatedAt: "2026-11-12T08:00:00Z",
    isPublic: false,
    isOwner: true,
  },
  {
    id: "p-plain",
    name: "Hydrocracker Catalyst Change",
    startDate: "2026-09-15",
    endDate: "2026-10-02",
    createdAt: "2026-07-20T12:00:00Z",
    updatedAt: "2026-09-01T12:00:00Z",
    isPublic: false,
    isOwner: false,
  },
];
function SchedulingProjectsCase() {
  // Seed synchronously during render (SSR-safe: memory-only, no localStorage)
  // so the list's first render reads it; see HealthDashboardCase above.
  seedCacheEntry("scheduling:projects", PROJECTS_LIST_FIXTURE);
  return (
    <div className="flex min-h-dvh w-full">
      <div className="min-w-0 flex-1">
        <div data-workspace-content className="min-w-0">
          <ProjectsScreen />
        </div>
      </div>
    </div>
  );
}

// D1 dashboard rebuild: the REAL PlannerDashboardShell (number strip +
// scope-by-status pivot chart) rendered inside the production page's
// <main> container, fed 6 wholly synthetic rows created for this test
// (fix round 1 provenance — NO production data): deterministic synthetic
// IDs (forge_project_synth_d1_dashboard / forge_wp_synth_d1_01..06),
// invented codes, titles, and unit/area/system mappings, fixed synthetic
// timestamp 2026-01-01. The rows are shaped exactly like
// listWorkPackages output; only shape-filler fields the shell never
// renders (planned dates, updated_at) are set to null/a fixed date.
// All 6 are draft, all industrial, no planned cost yet (so the strip
// shows "—", never a false $0.00). The donut is a single segment here
// (all 6 draft); the multi-status donut is covered by the shell's unit
// tests, which render a 2-status mix.
const WORK_DASHBOARD_FIXTURE_PACKAGES = [
  { id: "forge_wp_synth_d1_01", code: "SYN-01", title: "Synthetic exchanger inspection [SYNTHETIC]", package_type: "industrial", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: null, unit: "Unit A", area: "Process", system: "Exchanger", property_id: null, mode: "industrial", planned_cost_cents: null, responsible_party: { domain: "contractor", type: "contractor", display_name: "Synthetic Crew Alpha" }, updated_at: "2026-01-01T00:00:00Z", forge_project_id: "forge_project_synth_d1_dashboard" },
  { id: "forge_wp_synth_d1_02", code: "SYN-02", title: "Synthetic pump overhaul [SYNTHETIC]", package_type: "industrial", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: null, unit: "Unit B", area: "Utilities", system: "Pumping", property_id: null, mode: "industrial", planned_cost_cents: null, responsible_party: { domain: "contractor", type: "contractor", display_name: "Synthetic Crew Beta" }, updated_at: "2026-01-01T00:00:00Z", forge_project_id: "forge_project_synth_d1_dashboard" },
  { id: "forge_wp_synth_d1_03", code: "SYN-03", title: "Synthetic valve replacement [SYNTHETIC]", package_type: "industrial", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: null, unit: "Unit A", area: "Process", system: "Piping", property_id: null, mode: "industrial", planned_cost_cents: null, responsible_party: { domain: "contractor", type: "contractor", display_name: "Synthetic Crew Alpha" }, updated_at: "2026-01-01T00:00:00Z", forge_project_id: "forge_project_synth_d1_dashboard" },
  { id: "forge_wp_synth_d1_04", code: "SYN-04", title: "Synthetic spool fabrication [SYNTHETIC]", package_type: "industrial", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: null, unit: "Unit C", area: "Offsites", system: "Piping", property_id: null, mode: "industrial", planned_cost_cents: null, responsible_party: null, updated_at: "2026-01-01T00:00:00Z", forge_project_id: "forge_project_synth_d1_dashboard" },
  { id: "forge_wp_synth_d1_05", code: "SYN-05", title: "Synthetic MCC maintenance [SYNTHETIC]", package_type: "industrial", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: null, unit: "Unit B", area: "Electrical", system: "Power distribution", property_id: null, mode: "industrial", planned_cost_cents: null, responsible_party: null, updated_at: "2026-01-01T00:00:00Z", forge_project_id: "forge_project_synth_d1_dashboard" },
  { id: "forge_wp_synth_d1_06", code: "SYN-06", title: "Synthetic loop checkout [SYNTHETIC]", package_type: "industrial", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: null, unit: "Unit A", area: "Process", system: "Instrumentation", property_id: null, mode: "industrial", planned_cost_cents: null, responsible_party: null, updated_at: "2026-01-01T00:00:00Z", forge_project_id: "forge_project_synth_d1_dashboard" },
];

// D2: synthetic planning-% map for the fixture packages — 100/75/50/25/0
// across the first five, and no entry for SYN-06 (no checklist yet, the
// without-planning case). Total: 1 of 6 complete, mean 50.0% over the 5
// with planning. Wholly synthetic values, same invented IDs as above.
const WORK_DASHBOARD_FIXTURE_PLANNING = {
  forge_wp_synth_d1_01: { percentComplete: 100, initialized: true },
  forge_wp_synth_d1_02: { percentComplete: 75, initialized: true },
  forge_wp_synth_d1_03: { percentComplete: 50, initialized: true },
  forge_wp_synth_d1_04: { percentComplete: 25, initialized: true },
  forge_wp_synth_d1_05: { percentComplete: 0, initialized: false },
};

function WorkDashboardCase() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8" data-testid="work-dashboard-fixture">
      <PlannerDashboardShell
        projectLabel="Synthetic Dashboard Test Project"
        projectSublabel="Synthetic Client › Synthetic Site"
        packages={WORK_DASHBOARD_FIXTURE_PACKAGES}
        baseHref="/forge/work?forgeProject=forge_project_synth_d1_dashboard"
        activeStatus={null}
        planningByPackage={WORK_DASHBOARD_FIXTURE_PLANNING}
      />
    </main>
  );
}

const CASES = {
  designer: DesignerCase,
  fccu: FccuCase,
  "room-designs": RoomDesignsCase,
  "work-header": WorkHeaderCase,
  "app-header": AppHeaderCase,
  "forge-header": ForgeHeaderCase,
  "rental-23": Rental23Case,
  "rental-performance": RentalPerformanceCase,
  "projects-list": SchedulingProjectsCase,
  "work-dashboard": WorkDashboardCase,
  health: HealthCase,
  "health-dashboard": HealthDashboardCase,
};

export default function PhoneFixturePage() {
  // The case comes from window.location.search — read it in an effect after
  // mount, NOT in the state initializer. Reading it during render makes the
  // server render the "not ready" main while the client renders the real
  // case — a hydration mismatch (React #418) on every fixture load, which
  // forces a client re-render of the whole subtree and masks any real
  // hydration issue inside the case under test. Rendering the same
  // "not ready" main on server and client first render, then setting the
  // case after mount, keeps the shell hydration-clean so the case's own
  // hydration is genuinely exercised.
  const [fixtureCase, setFixtureCase] = useState(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate mount-only read of client-only data (window.location.search); the first render intentionally matches the server.
    setFixtureCase(new URLSearchParams(window.location.search).get("case") || "designer");
  }, []);
  if (process.env.NODE_ENV === "production") notFound();
  if (!fixtureCase) return <main data-fixture-ready="false" />;
  const Case = CASES[fixtureCase];
  if (!Case) return <main data-fixture-ready="missing">Unknown case: {fixtureCase}</main>;
  return (
    <div data-fixture-ready="true" data-fixture-case={fixtureCase}>
      <Case />
    </div>
  );
}
