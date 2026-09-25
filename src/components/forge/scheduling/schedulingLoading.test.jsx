// Slice warm-switch contract for the scheduling module: the converted panels
// serve cached data on first paint with no loading flash, and keep last-good
// data on screen while a refresh fails.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import ProjectsScreen from "./ProjectsScreen";
import { DriftAlertsPanel } from "./DriftAlertsPanel";
import { SchedulingBaselinesPanel } from "./SchedulingBaselinesModal";
import { SchedulingCostAccountsPanel } from "./SchedulingCostAccountsModal";
import { SchedulingCostsPanel } from "./SchedulingCostsModal";
import { SchedulingEvmDcmaPanel } from "./SchedulingEvmDcmaModal";
import { SchedulingLevelingPanel } from "./SchedulingLevelingModal";
import { SchedulingResourcesPanel } from "./SchedulingResourcesModal";

const BLOCKS = [{ id: "b1", taskCode: "A1010", label: "Framing" }];

const projectsPayload = [
  { id: "p1", name: "Beaumont Duplex", startDate: "2026-01-05", endDate: "2026-06-30", createdAt: "2026-01-02T10:00:00Z", updatedAt: "2026-02-01T10:00:00Z", isOwner: true, isPublic: false },
];

const driftPayload = {
  success: true, hasBaseline: true, baselineName: "Approved plan", asOf: "2026-09-20", thresholdDays: 2,
  drifted: [{
    taskCode: "A1020", label: "Framing", baselineStart: "2026-01-12", baselineFinish: "2026-01-23",
    currentStart: "2026-01-12", currentFinish: "2026-01-28",
    direction: "late", severity: "major", detail: "Finish +5d",
  }],
  summary: { driftedCount: 1, minorCount: 0, majorCount: 1, projectFinishVarianceDays: 5, completedExcludedCount: 0 },
};

const baselinesPayload = [{ id: "baseline_1", name: "Approved plan", createdAt: "2026-01-01T00:00:00.000Z" }];

const costAccountsPayload = [{ id: "acct_1", code: "PO-4521", name: "Steel supplier" }];

const rollupPayload = {
  success: true, overallocations: [],
  project: { budgeted_cost: 2500, actual_cost: 1100, remaining_cost: 1400 },
  byBlock: [{ block_id: "b1", task_code: "A1010", budgeted_cost: 2500, actual_cost: 1100, remaining_cost: 1400 }],
  byCostAccount: [{ cost_account_id: "acct_1", code: "PO-4521", name: "Steel supplier", budgeted_cost: 2000, actual_cost: 0, remaining_cost: 2000 }],
};

const today = new Date().toISOString().slice(0, 10);
const evmPayload = {
  success: true, baselineId: "baseline_1", asOfDate: today,
  evm: {
    bac: 1000, pv: 500, ev: 500, ac: 400, cv: 100, sv: 0, cpi: 1.25, spi: 1,
    eac: { atypical: 900, typical: 800, cpiSpi: 800 }, etc: 400, vac: 200,
  },
  dcma: {
    logic: { percentMissing: 10, pass: false },
    leadsAndLags: { leads: 1, leadsPass: false, lagPercent: 2, lagsPass: true },
    relationshipTypes: { fsPercent: 95, pass: true },
    hardConstraints: { percent: 0, pass: true },
    float: { highFloatPercent: 0, highFloatPass: true, negativeFloatCount: 0, negativeFloatPass: true },
    duration: { percent: 0, pass: true },
    invalidDates: { invalidCount: 0, pass: true },
    resources: { percent: 80 },
    missedTasks: { missedCount: 1, dueCount: 4 },
    baselineExecutionIndex: { bei: 0.75 },
    cpli: 0.9,
    criticalPathTest: { pass: true, shiftDays: 600, reason: null },
  },
};

const levelingPayload = {
  success: true, projectFinishExtensionDays: 2, unresolvedConflicts: [],
  leveledBlocks: [{ task_code: "A1010", original_start: "2026-01-07", leveled_start: "2026-01-14", delay_days: 7 }],
};

const resourcesPayload = [{ id: "resource_1", name: "Framing Crew", resource_type: "labor", max_units_per_day: 8, std_rate: 50, is_active: true }];

beforeEach(() => { clearSWRCache(); });

describe("scheduling warm-switch behavior", () => {
  it("renders the cached project list instantly with no loading flash", async () => {
    await fetchWithDedupe("scheduling:projects", () => Promise.resolve(projectsPayload));
    const html = renderToStaticMarkup(<ProjectsScreen />);
    expect(html).toContain("Beaumont Duplex");
    expect(html).not.toContain("Loading projects");
  });

  it("shows the project skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<ProjectsScreen />);
    expect(html).toContain("Loading projects…");
    expect(html).not.toContain("Beaumont Duplex");
  });

  it("renders the cached drift report instantly with no loading flash", async () => {
    await fetchWithDedupe("scheduling:drift:p1:2", () => Promise.resolve(driftPayload));
    const html = renderToStaticMarkup(<DriftAlertsPanel projectId="p1" />);
    expect(html).toContain("A1020");
    expect(html).toContain("Framing");
    expect(html).not.toContain("Computing drift");
  });

  it("shows the drift skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<DriftAlertsPanel projectId="p1" />);
    expect(html).toContain("Computing drift…");
  });

  it("renders the cached baselines instantly with no loading flash", async () => {
    await fetchWithDedupe("scheduling:baselines:p1", () => Promise.resolve(baselinesPayload));
    const html = renderToStaticMarkup(
      <SchedulingBaselinesPanel projectId="p1" isOwner blocks={BLOCKS} onClose={() => {}} />,
    );
    expect(html).toContain("Approved plan");
    expect(html).not.toContain("Loading baselines");
  });

  it("shows the baselines skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(
      <SchedulingBaselinesPanel projectId="p1" isOwner blocks={BLOCKS} onClose={() => {}} />,
    );
    expect(html).toContain("Loading baselines…");
  });

  it("renders the cached cost codes instantly with no loading flash", async () => {
    await fetchWithDedupe("scheduling:cost-accounts", () => Promise.resolve(costAccountsPayload));
    const html = renderToStaticMarkup(
      <SchedulingCostAccountsPanel isOwner onClose={() => {}} />,
    );
    expect(html).toContain("PO-4521");
    expect(html).not.toContain("Loading cost codes");
  });

  it("renders the cached cost rollup instantly with no loading flash", async () => {
    await fetchWithDedupe("scheduling:cost-rollup:p1:all", () => Promise.resolve(rollupPayload));
    const html = renderToStaticMarkup(
      <SchedulingCostsPanel projectId="p1" blocks={BLOCKS} onClose={() => {}} />,
    );
    expect(html).toContain("$2,500.00");
    expect(html).toContain("$1,100.00");
    expect(html).not.toContain("Loading cost data");
  });

  it("shows the cost skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(
      <SchedulingCostsPanel projectId="p1" blocks={BLOCKS} onClose={() => {}} />,
    );
    expect(html).toContain("Loading cost data…");
  });

  it("keeps the last good cost rollup visible when a refresh fails", async () => {
    await fetchWithDedupe("scheduling:cost-rollup:p1:all", () => Promise.resolve(rollupPayload));
    await fetchWithDedupe("scheduling:cost-rollup:p1:all", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(
      <SchedulingCostsPanel projectId="p1" blocks={BLOCKS} onClose={() => {}} />,
    );
    expect(html).toContain("$2,500.00");
    expect(html).not.toContain("Loading cost data");
    expect(html).toContain("Could not refresh");
  });

  it("shows the cost error state when the first load fails", async () => {
    await fetchWithDedupe("scheduling:cost-rollup:p1:all", () => Promise.reject(new Error("boom"))).catch(() => {});
    const html = renderToStaticMarkup(
      <SchedulingCostsPanel projectId="p1" blocks={BLOCKS} onClose={() => {}} />,
    );
    expect(html).toContain("Unable to load cost data for this project");
    expect(html).toContain("boom");
  });

  it("renders the cached EVM/DCMA report instantly with no loading flash", async () => {
    await fetchWithDedupe(`scheduling:evm-dcma:p1:auto:${today}`, () => Promise.resolve(evmPayload));
    const html = renderToStaticMarkup(
      <SchedulingEvmDcmaPanel projectId="p1" onClose={() => {}} />,
    );
    expect(html).toContain("$1,000.00");
    expect(html).toContain("DCMA 14-point assessment");
    expect(html).not.toContain("Loading EVM/DCMA");
  });

  it("renders the cached leveling preview instantly with no loading flash", async () => {
    await fetchWithDedupe("scheduling:leveling:p1:false", () => Promise.resolve(levelingPayload));
    const html = renderToStaticMarkup(
      <SchedulingLevelingPanel projectId="p1" blocks={BLOCKS} onClose={() => {}} />,
    );
    expect(html).toContain("A1010 Framing");
    expect(html).not.toContain("Computing leveling preview");
  });

  it("renders the cached resources instantly with no loading flash", async () => {
    await fetchWithDedupe("scheduling:resources", () => Promise.resolve(resourcesPayload));
    const html = renderToStaticMarkup(
      <SchedulingResourcesPanel isOwner onClose={() => {}} />,
    );
    expect(html).toContain("Framing Crew");
    expect(html).not.toContain("Loading resources");
  });

  it("shows the resources skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(
      <SchedulingResourcesPanel isOwner onClose={() => {}} />,
    );
    expect(html).toContain("Loading resources…");
  });
});
