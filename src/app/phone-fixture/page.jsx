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
import RentalOverviewPanel from "@/components/forge/rental/RentalOverviewPanel";

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

const CASES = {
  designer: DesignerCase,
  fccu: FccuCase,
  "room-designs": RoomDesignsCase,
  "work-header": WorkHeaderCase,
  "app-header": AppHeaderCase,
  "forge-header": ForgeHeaderCase,
  "rental-23": Rental23Case,
};

export default function PhoneFixturePage() {
  // The case comes from window.location.search — read it in the state
  // initializer, not in an effect (setState-in-effect is a lint error
  // and a cascading render). On the server window is absent, so the
  // first render is the not-ready main and the client hydrates with
  // the real case.
  const [fixtureCase] = useState(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("case") || "designer";
  });
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
