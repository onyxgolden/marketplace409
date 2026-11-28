// D5 export — pure CSV builder tests (fail-before: the module does not exist yet).
import { describe, expect, it } from "vitest";
import {
  MAX_EXPORT_ROWS,
  WIDGET_IDS,
  buildExportFilename,
  buildWidgetExport,
  serializeCsv,
  slugifyFilenamePart,
} from "./plannerDashboardExport.js";
import { summarizeCostSplit } from "@/domains/work-management/budgetAllocations";
import { computeLaborVariance } from "@/domains/work-management/budgetAllocations";
import {
  summarizePlannerDashboard,
  summarizePlannerProgress,
  summarizeScopeBlockMap,
} from "./plannerDashboard.js";
import {
  summarizeChangeOrderStrip,
  summarizePackageCostSplit,
  summarizeWorkPlanByCraft,
} from "./packageDashboard.js";

const NOW = new Date("2026-11-27T16:30:00.000Z");

const SCOPE = {
  workspaceId: "owner_1",
  forgeProjectId: "forge_project_1",
  packageId: null,
  scopeFilters: { status: "all", forgeProject: "forge_project_1" },
};

const PACKAGES = [
  { id: "wp_1", status: "draft", planned_cost_cents: 150000, unit: "A", system: "Piping", responsible_party: null },
  { id: "wp_2", status: "in_progress", planned_cost_cents: null, unit: null, system: null, responsible_party: { display_name: "Crew Alpha" } },
  { id: "wp_3", status: "draft", planned_cost_cents: 25000, unit: "A", system: "Piping", responsible_party: null },
];

const PLANNING = {
  wp_1: { percentComplete: 100, initialized: true },
  wp_2: { percentComplete: 50, initialized: true },
  wp_3: { percentComplete: null, initialized: false },
};

function reconciledEntry(estimateCents, categoryTotals, estimateId = "est_1") {
  return {
    estimate: { id: estimateId, version: 1, currentEstimateCents: estimateCents },
    allocation: { id: `alloc_${estimateId}`, version: 1, estimateId, estimateVersion: 1, categoryTotals },
    reconciled: true,
    reason: null,
  };
}

const COST_SUMMARY = summarizeCostSplit({
  packages: PACKAGES,
  costByPackage: {
    wp_1: reconciledEntry(150000, { labor: 60000, material: 40000, equipment: 30000, external_services: 15000, rental: 5000 }),
    wp_2: { estimate: null, allocation: null, reconciled: false, reason: "no_estimate" },
    wp_3: reconciledEntry(25000, { labor: 10000, material: 5000, equipment: 5000, external_services: 3000, rental: 2000 }, "est_3"),
  },
});

function parseCsv(text) {
  // Minimal RFC 4180 reader for assertions (handles quoted fields + doubled quotes).
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i += 1; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

describe("serializeCsv — RFC 4180", () => {
  it("quotes commas, quotes, CR/LF and doubles embedded quotes", () => {
    const text = serializeCsv(["a", "b"], [["plain", "with,comma"], ["with\"quote", "line1\nline2"], ["cr\r\nlf", ""]]);
    const rows = parseCsv(text);
    expect(rows[1]).toEqual(["plain", "with,comma"]);
    expect(rows[2]).toEqual(["with\"quote", "line1\nline2"]);
    expect(rows[3]).toEqual(["cr\r\nlf", ""]);
    expect(text).not.toContain("\uFEFF");
  });

  it("keeps unicode, empty vs numeric zero, signed negatives, and large exact integers", () => {
    const text = serializeCsv(["label", "cents", "count"], [["café ☃", -50000, 0], ["", 9007199254740991, 1]]);
    const rows = parseCsv(text);
    expect(rows[1]).toEqual(["café ☃", "-50000", "0"]);
    expect(rows[2]).toEqual(["", "9007199254740991", "1"]);
  });

  it("neutralizes formula injection in string cells but leaves trusted numerics alone", () => {
    const text = serializeCsv(["label", "cents"], [
      ["=2+2", -100],
      ["+2+2", 0],
      ["-2+2", 0],
      ["@SUM(A1:A2)", 0],
      ["  =cmd", 0],
      ["\t@x", 0],
      ["normal -5 label", -5],
    ]);
    const rows = parseCsv(text);
    expect(rows[1][0]).toBe("'=2+2");
    expect(rows[2][0]).toBe("'+2+2");
    expect(rows[3][0]).toBe("'-2+2");
    expect(rows[4][0]).toBe("'@SUM(A1:A2)");
    expect(rows[5][0]).toBe("'  =cmd");
    expect(rows[6][0]).toBe("'\t@x");
    expect(rows[7][0]).toBe("normal -5 label");
    expect(rows[1][1]).toBe("-100");
    expect(rows[7][1]).toBe("-5");
  });

  it("uses CRLF line endings and a stable header", () => {
    const text = serializeCsv(["a"], [["1"], ["2"]]);
    expect(text.split("\r\n")).toEqual(["a", "1", "2"]);
  });
});

describe("filenames", () => {
  it("slugifies project/package parts, bounds length, and formats the UTC timestamp", () => {
    expect(buildExportFilename({ projectSlug: "Fictional FCCU Sample Project", packageCode: null, widgetId: "landing-number-strip", now: NOW }))
      .toBe("forge-planner-fictional-fccu-sample-project-landing-number-strip-20261127-163000Z.csv");
    expect(buildExportFilename({ projectSlug: "Fictional FCCU Sample Project", packageCode: "0001", widgetId: "package-number-strip", now: NOW }))
      .toBe("forge-planner-fictional-fccu-sample-project-0001-package-number-strip-20261127-163000Z.csv");
  });

  it("falls back to project/package when the slug is empty and caps each part at 48 chars", () => {
    const long = "a".repeat(100);
    const name = buildExportFilename({ projectSlug: "", packageCode: "", widgetId: "landing-cost-split", now: NOW });
    expect(name).toBe("forge-planner-project-landing-cost-split-20261127-163000Z.csv");
    expect(buildExportFilename({ projectSlug: long, packageCode: null, widgetId: "landing-cost-split", now: NOW }).split("-")[2].length).toBeLessThanOrEqual(48);
    expect(slugifyFilenamePart("  Weird__Title!!  ", "project")).toBe("weird-title");
    expect(slugifyFilenamePart("", "project")).toBe("project");
  });

  it("rejects an unknown widget id", () => {
    expect(() => buildExportFilename({ projectSlug: "p", packageCode: null, widgetId: "nope", now: NOW })).toThrow();
  });

  it("exposes the nine-widget allowlist", () => {
    expect(Object.keys(WIDGET_IDS)).toHaveLength(9);
    expect(WIDGET_IDS["landing-scope-block-map"].dashboard).toBe("landing");
    expect(WIDGET_IDS["package-change-orders"].dashboard).toBe("package-detail");
  });
});

describe("landing number strip", () => {
  it("exports the three visible blocks with exact values and no invented metrics", () => {
    const { filename, csvText } = buildWidgetExport("landing-number-strip", {
      scope: SCOPE,
      now: NOW,
      projectLabel: "Fictional FCCU Sample Project",
      projectSublabel: "Fictional Test Client › Fictional Test Site",
      totalControlEstimateCents: COST_SUMMARY.totalControlEstimateCents,
      hasControlEstimate: true,
      costSummaryAvailable: true,
      totalPackages: 3,
      baseHref: "/forge/work?forgeProject=forge_project_1",
    });
    expect(filename).toContain("number-strip-20261127-163000Z.csv");
    const rows = parseCsv(csvText);
    expect(rows[0][0]).toBe("record_type");
    const data = rows.slice(1);
    expect(data).toHaveLength(3);
    expect(data[0][13]).toBe("Fictional FCCU Sample Project");
    expect(data[1][14]).toBe("175000");
    expect(data[1][17]).toBe("$1,750.00");
    expect(data[2][15]).toBe("3");
    expect(data[2][17]).toBe("3");
    expect(data.every((r) => r[3] === "landing")).toBe(true);
    expect(data.every((r) => JSON.parse(r[7]).grid_filters.forgeProject === "forge_project_1")).toBe(true);
  });

  it("marks the estimate block unavailable when the cost read is missing, never $0", () => {
    const { csvText } = buildWidgetExport("landing-number-strip", {
      scope: SCOPE,
      now: NOW,
      projectLabel: "P",
      projectSublabel: null,
      totalControlEstimateCents: 0,
      hasControlEstimate: false,
      costSummaryAvailable: false,
      totalPackages: 0,
      baseHref: "/forge/work",
    });
    const rows = parseCsv(csvText);
    expect(rows[2][11]).toBe("unavailable");
    expect(rows[2][14]).toBe("");
    expect(rows[2][17]).toBe("—");
  });
});

describe("landing scope by status", () => {
  it("exports one row per status plus a total row that reconciles", () => {
    const summary = summarizePlannerDashboard(PACKAGES);
    const { csvText } = buildWidgetExport("landing-scope-by-status", {
      scope: SCOPE, now: NOW, summary, baseHref: "/forge/work?forgeProject=forge_project_1", pivot: "donut",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    expect(header).toContain("status_key");
    const data = rows.slice(1).filter((r) => r[0] === "data");
    expect(data).toHaveLength(2);
    expect(data[0][header.indexOf("status_key")]).toBe("draft");
    expect(data[0][header.indexOf("value_count")]).toBe("2");
    expect(data[1][header.indexOf("status_key")]).toBe("in_progress");
    const total = rows.slice(1).find((r) => r[0] === "total");
    expect(total[header.indexOf("value_count")]).toBe("3");
    expect(total[header.indexOf("value_percent")]).toBe("100");
  });

  it("fails and emits nothing when status counts cannot reconcile", () => {
    const summary = summarizePlannerDashboard(PACKAGES);
    expect(() => buildWidgetExport("landing-scope-by-status", {
      scope: SCOPE, now: NOW,
      summary: { ...summary, totalPackages: 99 },
      baseHref: "/forge/work", pivot: "donut",
    })).toThrow(/reconcile/i);
  });
});

describe("landing scope block map", () => {
  it("flattens group → status tiles with group totals, and the label threshold drops no rows", () => {
    const summary = summarizeScopeBlockMap(PACKAGES, "system");
    const { csvText } = buildWidgetExport("landing-scope-block-map", {
      scope: SCOPE, now: NOW, summary, totalPackages: 3,
      dimension: { key: "system", label: "Equipment type", param: "system" },
      baseHref: "/forge/work?forgeProject=forge_project_1",
      prefs: { visible: true, title: "Scope block map", grouping: "system", minLabelPercent: 25, pivot: "treemap" },
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const tiles = rows.slice(1).filter((r) => r[0] === "data");
    // Piping 2 (draft 2), null-system bucket 1 (in_progress 1): 2 tiles + 2 group totals
    expect(tiles).toHaveLength(2);
    const totals = rows.slice(1).filter((r) => r[0] === "total");
    expect(totals).toHaveLength(2);
    expect(totals.find((r) => r[header.indexOf("group_key")] === "Piping")[header.indexOf("value_count")]).toBe("2");
    expect(rows.slice(1).every((r) => r[header.indexOf("group_key")] !== "")).toBe(true);
  });

  it("records visible=false in config for a hidden widget and still exports", () => {
    const summary = summarizeScopeBlockMap(PACKAGES, "system");
    const { csvText } = buildWidgetExport("landing-scope-block-map", {
      scope: SCOPE, now: NOW, summary, totalPackages: 3,
      dimension: { key: "system", label: "Equipment type", param: "system" },
      baseHref: "/forge/work",
      prefs: { visible: false, title: "Scope block map", grouping: "system", minLabelPercent: 4, pivot: "treemap" },
    });
    const rows = parseCsv(csvText);
    expect(JSON.parse(rows[1][8]).visible).toBe(false);
  });
});

describe("landing planning progress", () => {
  it("exports the total plus grouped rows with canonical credit-weighted percent", () => {
    const progress = summarizePlannerProgress(PACKAGES, PLANNING);
    const { csvText } = buildWidgetExport("landing-planning-progress", {
      scope: SCOPE, now: NOW, progress, planningAvailable: true,
      activeDimension: "system", activeGroup: null, baseHref: "/forge/work", pivot: "table",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const total = rows.slice(1).find((r) => r[0] === "total");
    expect(total[header.indexOf("group_label")]).toBe("All packages");
    expect(total[header.indexOf("value_count")]).toBe("3");
    expect(total[header.indexOf("complete_count")]).toBe("1");
    expect(total[header.indexOf("value_percent")]).toBe("75");
    expect(total[header.indexOf("packages_without_planning")]).toBe("1");
    const groups = rows.slice(1).filter((r) => r[0] === "data");
    expect(groups).toHaveLength(2);
    expect(groups[0][header.indexOf("group_label")]).toBe("Piping");
  });

  it("emits an unavailable state row when planning data is missing", () => {
    const { csvText } = buildWidgetExport("landing-planning-progress", {
      scope: SCOPE, now: NOW, progress: null, planningAvailable: false,
      activeDimension: "system", activeGroup: null, baseHref: "/forge/work", pivot: "table",
    });
    const rows = parseCsv(csvText);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("state");
    expect(rows[1][11]).toBe("unavailable");
  });

  it("fails when group counts cannot reconcile to the total", () => {
    const progress = summarizePlannerProgress(PACKAGES, PLANNING);
    expect(() => buildWidgetExport("landing-planning-progress", {
      scope: SCOPE, now: NOW,
      progress: { ...progress, total: { ...progress.total, packageCount: 99 } },
      planningAvailable: true, activeDimension: "system", activeGroup: null, baseHref: "/forge/work", pivot: "table",
    })).toThrow(/reconcile/i);
  });
});

describe("landing cost split", () => {
  it("exports five categories plus a reconciling total row when complete", () => {
    const { csvText } = buildWidgetExport("landing-cost-split", {
      scope: SCOPE, now: NOW, costSummary: COST_SUMMARY, baseHref: "/forge/work", pivot: "donut",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const data = rows.slice(1).filter((r) => r[0] === "data");
    expect(data).toHaveLength(5);
    expect(data[0][header.indexOf("category_key")]).toBe("labor");
    expect(data[0][header.indexOf("value_cents")]).toBe("70000");
    expect(data[0][header.indexOf("value_count")]).toBe("2");
    const total = rows.slice(1).find((r) => r[0] === "total");
    expect(total[header.indexOf("value_cents")]).toBe("175000");
    expect(total[header.indexOf("complete_flag")]).toBe("true");
  });

  it("tags partial rows and adds a state row when allocation is incomplete", () => {
    const partial = summarizeCostSplit({
      packages: PACKAGES,
      costByPackage: {
        wp_1: reconciledEntry(150000, { labor: 60000, material: 40000, equipment: 30000, external_services: 15000, rental: 5000 }),
        wp_2: { estimate: null, allocation: null, reconciled: false, reason: "no_estimate" },
        wp_3: { estimate: { id: "est_3", version: 2, currentEstimateCents: 25000 }, allocation: { id: "alloc_3", version: 1, estimateId: "est_3", estimateVersion: 1, categoryTotals: { labor: 10000, material: 5000, equipment: 5000, external_services: 3000, rental: 2000 } }, reconciled: false, reason: "stale" },
      },
    });
    const { csvText } = buildWidgetExport("landing-cost-split", {
      scope: SCOPE, now: NOW, costSummary: partial, baseHref: "/forge/work", pivot: "donut",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const data = rows.slice(1).filter((r) => r[0] === "data");
    expect(data.every((r) => r[11] === "partial")).toBe(true);
    const state = rows.slice(1).find((r) => r[0] === "state");
    expect(state).toBeDefined();
    expect(state[header.indexOf("unallocated_cents")]).toBe("25000");
  });

  it("emits only a state row when no control estimate exists, never five zero lines", () => {
    const empty = summarizeCostSplit({ packages: PACKAGES, costByPackage: {
      wp_1: { estimate: null, allocation: null, reconciled: false, reason: "no_estimate" },
      wp_2: { estimate: null, allocation: null, reconciled: false, reason: "no_estimate" },
      wp_3: { estimate: null, allocation: null, reconciled: false, reason: "no_estimate" },
    } });
    const { csvText } = buildWidgetExport("landing-cost-split", {
      scope: SCOPE, now: NOW, costSummary: empty, baseHref: "/forge/work", pivot: "donut",
    });
    const rows = parseCsv(csvText);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("state");
    expect(rows[1][11]).toBe("empty");
  });

  it("fails when the five categories plus unallocated cannot reconcile to the strip total", () => {
    expect(() => buildWidgetExport("landing-cost-split", {
      scope: SCOPE, now: NOW,
      costSummary: { ...COST_SUMMARY, totalControlEstimateCents: 999999 },
      baseHref: "/forge/work", pivot: "donut",
    })).toThrow(/reconcile/i);
  });
});

const DETAIL_SCOPE = {
  workspaceId: "owner_1",
  forgeProjectId: "forge_project_1",
  packageId: "pkg_1",
  scopeFilters: { forgeProject: "forge_project_1", package: "pkg_1" },
};

const PKG = {
  id: "pkg_1",
  code: "WP-0001",
  title: "Turnover",
  status: "in_progress",
  planned_cost_cents: 125000,
};

const PLANNING_SUMMARY = {
  progress: { percentComplete: 45, earnedMhrs: 18, totalMhrs: 40, stepsTotal: 22, stepsEarned: 10, initialized: true },
};

const STEPS = [
  { id: "s1", craftKey: "pipefitter", craftLabel: "Pipefitter", plannedPersonHours: 10, retiredAt: null },
  { id: "s2", craftKey: "pipefitter", craftLabel: "Pipefitter", plannedPersonHours: 4.5, retiredAt: null },
  { id: "s3", craftKey: "welder", craftLabel: "Welder", plannedPersonHours: null, retiredAt: null },
  { id: "s4", craftKey: null, craftLabel: null, plannedPersonHours: 2, retiredAt: null },
  { id: "s5", craftKey: "pipefitter", craftLabel: "Pipefitter", plannedPersonHours: 8, retiredAt: "2026-11-01T00:00:00Z" },
];

const ALLOCATION_DATA = {
  notApplied: false,
  estimate: { id: "est_1", workPackageId: "pkg_1", originalControlEstimateCents: 250000, currentControlEstimateCents: 250000, contingencyCents: 50000, version: 2 },
  allocation: { id: "alloc_1", workPackageId: "pkg_1", controlEstimateId: "est_1", controlEstimateVersion: 2, allocatedTotalCents: 250000, version: 1, lines: [
    { id: "l1", category: "labor", description: "Crew", amountCents: 150000, sortOrder: 0 },
    { id: "l2", category: "material", description: "Pipe", amountCents: 100000, sortOrder: 1 },
  ] },
  plannedLaborForecastCents: 90000,
};

const CHANGE_SUMMARY = {
  hasEstimate: true,
  currentEstimateCents: 250000,
  contingencyCents: 50000,
  runningContractPriceCents: 265000,
  contingencyRemainingCents: -5000,
  countsByStatus: { estimated: 1, approved: 1, material_ordered: 1, denied: 2 },
  countedChangeOrderCount: 2,
  countedNonDeviationCents: 15000,
  countedDeviationCents: 55000,
  warnings: [{ code: "contingency_overdrawn", message: "Contingency is overdrawn by $50.00 — counted Deviations exceed the pool." }],
};

describe("package number strip", () => {
  it("exports the six visible fields, distinguishing no-budget and unavailable milestones", () => {
    const { csvText } = buildWidgetExport("package-number-strip", {
      scope: DETAIL_SCOPE, now: NOW, pkg: PKG, planningSummary: PLANNING_SUMMARY,
      projectLabel: "Fictional FCCU Sample Project", pivot: "cards", title: "Package",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const data = rows.slice(1);
    expect(data).toHaveLength(6);
    expect(data[0][header.indexOf("field_id")]).toBe("code");
    expect(data[0][header.indexOf("display_value")]).toBe("WP-0001");
    const budget = data.find((r) => r[header.indexOf("field_id")] === "budget");
    expect(budget[header.indexOf("value_cents")]).toBe("125000");
    const milestones = data.find((r) => r[header.indexOf("field_id")] === "milestones");
    expect(milestones[11]).toBe("unavailable");
    expect(milestones[header.indexOf("display_value")]).toContain("Not available");
    const percent = data.find((r) => r[header.indexOf("field_id")] === "percent");
    expect(percent[header.indexOf("value_percent")]).toBe("45");
  });

  it("marks a missing budget as empty, never $0", () => {
    const { csvText } = buildWidgetExport("package-number-strip", {
      scope: DETAIL_SCOPE, now: NOW,
      pkg: { ...PKG, planned_cost_cents: null }, planningSummary: PLANNING_SUMMARY,
      projectLabel: "P", pivot: "cards", title: "Package",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const budget = rows.slice(1).find((r) => r[header.indexOf("field_id")] === "budget");
    expect(budget[11]).toBe("empty");
    expect(budget[header.indexOf("value_cents")]).toBe("");
    expect(budget[header.indexOf("display_value")]).toBe("No budget set");
  });
});

describe("package planning and work plan", () => {
  it("exports the planning summary first, then one row per craft, then the unavailable-completion state", () => {
    const workPlan = summarizeWorkPlanByCraft(STEPS);
    const { csvText } = buildWidgetExport("package-planning-work-plan", {
      scope: DETAIL_SCOPE, now: NOW, planningSummary: PLANNING_SUMMARY, workPlan,
      pivot: "bars", title: "Planning and work plan",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const body = rows.slice(1);
    expect(body[0][0]).toBe("total");
    expect(body[0][header.indexOf("value_percent")]).toBe("45");
    const crafts = body.filter((r) => r[0] === "data");
    expect(crafts).toHaveLength(3);
    const pipefitter = crafts.find((r) => r[header.indexOf("craft_key")] === "pipefitter");
    expect(pipefitter[header.indexOf("step_count")]).toBe("2");
    expect(pipefitter[header.indexOf("planned_hours")]).toBe("14.5");
    const state = body.find((r) => r[header.indexOf("craft_completion_state")] === "unavailable_no_crosswalk");
    expect(state[0]).toBe("state");
    expect(state[header.indexOf("craft_completion_state")]).toBe("unavailable_no_crosswalk");
    expect(state[header.indexOf("display_value")]).toContain("not available");
  });

  it("fails when craft step counts cannot reconcile to the plan total", () => {
    const workPlan = summarizeWorkPlanByCraft(STEPS);
    expect(() => buildWidgetExport("package-planning-work-plan", {
      scope: DETAIL_SCOPE, now: NOW, planningSummary: PLANNING_SUMMARY,
      workPlan: { ...workPlan, totalSteps: 99 },
      pivot: "bars", title: "Planning and work plan",
    })).toThrow(/reconcile/i);
  });
});

describe("package cost split", () => {
  it("exports five categories plus total and a separately-labelled labor forecast when reconciled", () => {
    const cost = summarizePackageCostSplit(ALLOCATION_DATA);
    const laborVariance = computeLaborVariance({ laborBudgetCents: cost.categoryTotals.labor, plannedLaborForecastCents: cost.plannedLaborForecastCents });
    const { csvText } = buildWidgetExport("package-cost-split", {
      scope: DETAIL_SCOPE, now: NOW, cost, laborVariance, pivot: "donut", title: "Cost split",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const data = rows.slice(1).filter((r) => r[0] === "data");
    expect(data).toHaveLength(6);
    const labor = data.find((r) => r[header.indexOf("category_key")] === "labor");
    expect(labor[header.indexOf("value_cents")]).toBe("150000");
    const forecast = data.find((r) => r[header.indexOf("category_key")] === "labor_forecast_comparison");
    expect(forecast[header.indexOf("value_cents")]).toBe("90000");
    expect(forecast[header.indexOf("display_value")]).toContain("Comparison only");
    const total = rows.slice(1).find((r) => r[0] === "total");
    expect(total[header.indexOf("value_cents")]).toBe("250000");
  });

  it("emits only a state row for stale/mismatch, never five fabricated lines", () => {
    const cost = summarizePackageCostSplit({
      ...ALLOCATION_DATA,
      estimate: { ...ALLOCATION_DATA.estimate, version: 3 },
    });
    expect(cost.state).toBe("stale");
    const { csvText } = buildWidgetExport("package-cost-split", {
      scope: DETAIL_SCOPE, now: NOW, cost, pivot: "donut", title: "Cost split",
    });
    const rows = parseCsv(csvText);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("state");
    expect(rows[1][11]).toBe("stale");
    expect(rows[1][12]).toContain("stale");
  });

  it("fails when reconciled category totals do not equal the estimate", () => {
    const cost = summarizePackageCostSplit(ALLOCATION_DATA);
    expect(() => buildWidgetExport("package-cost-split", {
      scope: DETAIL_SCOPE, now: NOW,
      cost: { ...cost, estimateCents: 999999 },
      pivot: "donut", title: "Cost split",
    })).toThrow(/reconcile/i);
  });
});

describe("package change orders", () => {
  it("exports strip metrics and warnings with negative contingency intact, and no status rows in strip pivot", () => {
    const changeStrip = summarizeChangeOrderStrip(CHANGE_SUMMARY);
    const { csvText } = buildWidgetExport("package-change-orders", {
      scope: DETAIL_SCOPE, now: NOW, changeStrip,
      countsByStatus: CHANGE_SUMMARY.countsByStatus, pivot: "strip", title: "Change orders and contingency",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const body = rows.slice(1);
    const remaining = body.find((r) => r[header.indexOf("metric_id")] === "contingency_remaining");
    expect(remaining[header.indexOf("value_cents")]).toBe("-5000");
    // The numeric column stays a bare -5000; the string display column
    // "-$50.00" correctly carries the formula-injection prefix.
    expect(remaining[header.indexOf("display_value")]).toBe("'-$50.00");
    const approved = body.find((r) => r[header.indexOf("metric_id")] === "approved_value");
    expect(approved[header.indexOf("value_cents")]).toBe("70000");
    // The strip pivot shows no status paragraph on the screen, so it
    // exports no status subgroup rows either.
    expect(body.filter((r) => r[header.indexOf("status_key")] !== "")).toHaveLength(0);
    const warning = body.find((r) => r[0] === "state");
    expect(warning[header.indexOf("warning_code")]).toBe("contingency_overdrawn");
  });

  it("exports status subgroups in lifecycle order in table pivot only", () => {
    const changeStrip = summarizeChangeOrderStrip(CHANGE_SUMMARY);
    const { csvText } = buildWidgetExport("package-change-orders", {
      scope: DETAIL_SCOPE, now: NOW, changeStrip,
      countsByStatus: CHANGE_SUMMARY.countsByStatus, pivot: "table", title: "Change orders and contingency",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const body = rows.slice(1);
    const statusRows = body.filter((r) => r[header.indexOf("status_key")] !== "");
    expect(statusRows.map((r) => r[header.indexOf("status_key")])).toEqual(
      ["estimated", "approved", "material_ordered", "denied"],
    );
    const denied = statusRows.find((r) => r[header.indexOf("status_key")] === "denied");
    expect(denied[header.indexOf("value_count")]).toBe("2");
    // Status rows are plain text on the screen — no fabricated drill.
    expect(statusRows.every((r) => r[header.indexOf("drill_target")] === "")).toBe(true);
  });

  it("fails when approved value cannot reconcile to non-Deviation plus Deviation", () => {
    const changeStrip = summarizeChangeOrderStrip(CHANGE_SUMMARY);
    expect(() => buildWidgetExport("package-change-orders", {
      scope: DETAIL_SCOPE, now: NOW,
      changeStrip: { ...changeStrip, approvedValueCents: 12345 },
      countsByStatus: CHANGE_SUMMARY.countsByStatus, pivot: "strip", title: "Change orders and contingency",
    })).toThrow(/reconcile/i);
  });
});

describe("determinism, metadata, and scope isolation", () => {
  it("produces identical data rows for identical inputs apart from the generation timestamp", () => {
    const first = buildWidgetExport("landing-scope-by-status", {
      scope: SCOPE, now: NOW, summary: summarizePlannerDashboard(PACKAGES), baseHref: "/forge/work", pivot: "donut",
    });
    const second = buildWidgetExport("landing-scope-by-status", {
      scope: SCOPE, now: new Date("2026-11-27T16:31:00.000Z"), summary: summarizePlannerDashboard(PACKAGES), baseHref: "/forge/work", pivot: "donut",
    });
    const stripTimestamp = (text) => parseCsv(text).map((r) => { const c = [...r]; c[10] = ""; return c; });
    expect(stripTimestamp(first.csvText)).toEqual(stripTimestamp(second.csvText));
    expect(first.filename).not.toBe(second.filename);
  });

  it("records pivot and grouping in config and drops unknown config keys", () => {
    const { csvText } = buildWidgetExport("landing-scope-block-map", {
      scope: SCOPE, now: NOW, summary: summarizeScopeBlockMap(PACKAGES, "system"), totalPackages: 3,
      dimension: { key: "system", label: "Equipment type", param: "system" },
      baseHref: "/forge/work",
      prefs: { visible: true, title: "My map", grouping: "system", minLabelPercent: 4, pivot: "table", injected: "nope" },
    });
    const rows = parseCsv(csvText);
    const config = JSON.parse(rows[1][8]);
    expect(config.pivot).toBe("table");
    expect(config.title).toBe("My map");
    expect(config.injected).toBeUndefined();
  });

  it("never leaks another package's id into a package export", () => {
    const { csvText } = buildWidgetExport("package-number-strip", {
      scope: DETAIL_SCOPE, now: NOW, pkg: PKG, planningSummary: PLANNING_SUMMARY,
      projectLabel: "P", pivot: "cards", title: "Package",
    });
    expect(csvText).not.toContain("pkg_2");
    expect(csvText).toContain("pkg_1");
  });

  it("enforces the maximum row count", () => {
    expect(MAX_EXPORT_ROWS).toBeGreaterThan(0);
    const many = Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, i) => ({
      id: `wp_${i}`, status: "draft", planned_cost_cents: null, unit: `U${i}`, system: "Piping", responsible_party: null,
    }));
    expect(() => buildWidgetExport("landing-scope-block-map", {
      scope: SCOPE, now: NOW, summary: summarizeScopeBlockMap(many, "unit"), totalPackages: many.length,
      dimension: { key: "unit", label: "Unit", param: "unit" },
      baseHref: "/forge/work",
      prefs: { visible: true, title: "Scope block map", grouping: "unit", minLabelPercent: 0, pivot: "table" },
    })).toThrow(/exceeding the 5000 row limit/i);
  });
});

describe("fix round 1 — ChatGPT verdict P1s (red-before fixtures)", () => {
  it("P1.1: a not-applied change-order strip exports a state-only row, never complete zero money/counts", () => {
    const changeStrip = summarizeChangeOrderStrip({ ...CHANGE_SUMMARY, notApplied: true });
    expect(changeStrip.state).toBe("not-applied");
    const { csvText } = buildWidgetExport("package-change-orders", {
      scope: DETAIL_SCOPE, now: NOW, changeStrip,
      countsByStatus: CHANGE_SUMMARY.countsByStatus, pivot: "strip", title: "Change orders and contingency",
    });
    const rows = parseCsv(csvText);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("state");
    expect(rows[1][11]).toBe("not_applied");
    expect(rows[1][12]).toContain("hasn't been applied");
    expect(rows[1][17]).toBe(""); // value_cents: no money claimed
    expect(rows[1][18]).toBe(""); // value_count: no counts claimed
    expect(rows[1][21]).toBe(""); // drill_target: plain text, no link
  });

  it("P1.2: empty scope-by-status and block map emit state rows, never a 0 (100%) total or a header-only file", () => {
    const status = buildWidgetExport("landing-scope-by-status", {
      scope: SCOPE, now: NOW,
      summary: { totalPackages: 0, statusBreakdown: [] }, baseHref: "/forge/work", pivot: "donut",
    });
    const statusRows = parseCsv(status.csvText);
    expect(statusRows).toHaveLength(2);
    expect(statusRows[1][0]).toBe("state");
    expect(statusRows[1][11]).toBe("empty");

    const map = buildWidgetExport("landing-scope-block-map", {
      scope: SCOPE, now: NOW, summary: { groups: [] }, totalPackages: 0,
      dimension: { key: "system", label: "Equipment type", param: "system" },
      baseHref: "/forge/work",
      prefs: { visible: true, title: "Scope block map", grouping: "system", minLabelPercent: 4, pivot: "treemap" },
    });
    const mapRows = parseCsv(map.csvText);
    expect(mapRows).toHaveLength(2);
    expect(mapRows[1][0]).toBe("state");
    expect(mapRows[1][11]).toBe("empty");
  });

  it("P1.2: empty progress and empty work plan emit state rows, never 0-of-0 totals", () => {
    const emptyProgress = {
      total: { key: null, label: "All packages", packageCount: 0, completeCount: 0, percentComplete: null, packagesWithPlanning: 0, packagesWithoutPlanning: 0, statusCounts: {} },
      bySystem: [], byPlanner: [], byUnit: [],
    };
    const { csvText } = buildWidgetExport("landing-planning-progress", {
      scope: SCOPE, now: NOW, progress: emptyProgress, planningAvailable: true,
      activeDimension: "system", activeGroup: null, baseHref: "/forge/work", pivot: "table",
    });
    const rows = parseCsv(csvText);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("state");
    expect(rows[1][11]).toBe("empty");

    const emptyPlan = summarizeWorkPlanByCraft([]);
    const plan = buildWidgetExport("package-planning-work-plan", {
      scope: DETAIL_SCOPE, now: NOW, planningSummary: PLANNING_SUMMARY, workPlan: emptyPlan,
      pivot: "bars", title: "Planning and work plan",
    });
    const planRows = parseCsv(plan.csvText);
    const header = planRows[0];
    const empty = planRows.slice(1).find((r) => r[header.indexOf("display_value")] === "No work steps yet — the work plan is empty.");
    expect(empty).toBeDefined();
    expect(empty[0]).toBe("state");
    expect(empty[11]).toBe("empty");
    expect(empty[header.indexOf("drill_target")]).toBe("tab:steps");
  });

  it("P1.3: provenance records the dataset and grid filters separately, and as_of_date is an explicit unknown", () => {
    const { csvText } = buildWidgetExport("landing-scope-by-status", {
      scope: SCOPE, now: NOW, summary: summarizePlannerDashboard(PACKAGES),
      baseHref: "/forge/work?forgeProject=forge_project_1", pivot: "donut",
    });
    const rows = parseCsv(csvText);
    const filters = JSON.parse(rows[1][7]);
    expect(filters.dataset).toBe("project-scope");
    expect(filters.grid_filters.forgeProject).toBe("forge_project_1");
    expect(filters.grid_filters.status).toBe("all");
    expect(rows[1][9]).toBe(""); // as_of_date: no snapshot date exists, so it is blank, never the UTC date
    const dated = buildWidgetExport("landing-scope-by-status", {
      scope: { ...SCOPE, asOfDate: "2026-11-27" }, now: NOW, summary: summarizePlannerDashboard(PACKAGES),
      baseHref: "/forge/work", pivot: "donut",
    });
    expect(parseCsv(dated.csvText)[1][9]).toBe("2026-11-27");
  });

  it("P1.3: widget_title follows the customized title, and workspace_id records the selected workspace", () => {
    const { csvText } = buildWidgetExport("landing-scope-block-map", {
      scope: SCOPE, now: NOW, summary: summarizeScopeBlockMap(PACKAGES, "system"), totalPackages: 3,
      dimension: { key: "system", label: "Equipment type", param: "system" },
      baseHref: "/forge/work",
      prefs: { visible: true, title: "My map", grouping: "system", minLabelPercent: 4, pivot: "treemap" },
    });
    const rows = parseCsv(csvText);
    expect(rows[1][2]).toBe("My map");
    expect(rows[1][4]).toBe("owner_1");
    const otherWorkspace = buildWidgetExport("landing-scope-block-map", {
      scope: { ...SCOPE, workspaceId: "workspace_selected" }, now: NOW,
      summary: summarizeScopeBlockMap(PACKAGES, "system"), totalPackages: 3,
      dimension: { key: "system", label: "Equipment type", param: "system" },
      baseHref: "/forge/work",
      prefs: { visible: true, title: "Scope block map", grouping: "system", minLabelPercent: 4, pivot: "treemap" },
    });
    expect(parseCsv(otherWorkspace.csvText)[1][4]).toBe("workspace_selected");
  });

  it("P1.4: progress rows with partial coverage are partial, and with no planning data are unavailable — never complete", () => {
    const progress = summarizePlannerProgress(PACKAGES, PLANNING);
    const { csvText } = buildWidgetExport("landing-planning-progress", {
      scope: SCOPE, now: NOW, progress, planningAvailable: true,
      activeDimension: "system", activeGroup: null, baseHref: "/forge/work", pivot: "table",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const total = rows.slice(1).find((r) => r[0] === "total");
    expect(total[11]).toBe("partial"); // 1 of 3 packages has no checklist
    expect(total[header.indexOf("display_value")]).toContain("75.0%"); // toFixed(1), as the screen renders it
    const piping = rows.slice(1).find((r) => r[header.indexOf("group_label")] === "Piping");
    expect(piping[11]).toBe("partial");
    const noSystem = rows.slice(1).find((r) => r[header.indexOf("group_label")] === "No system");
    expect(noSystem[11]).toBe("complete");

    const unknown = {
      total: { key: null, label: "All packages", packageCount: 2, completeCount: 0, percentComplete: null, packagesWithPlanning: 0, packagesWithoutPlanning: 2, statusCounts: { draft: 2 } },
      bySystem: [{ key: "Piping", label: "Piping", packageCount: 2, completeCount: 0, percentComplete: null, packagesWithPlanning: 0, packagesWithoutPlanning: 2, statusCounts: { draft: 2 } }],
      byPlanner: [], byUnit: [],
    };
    const unknownText = buildWidgetExport("landing-planning-progress", {
      scope: SCOPE, now: NOW, progress: unknown, planningAvailable: true,
      activeDimension: "system", activeGroup: null, baseHref: "/forge/work", pivot: "table",
    }).csvText;
    const unknownRows = parseCsv(unknownText);
    expect(unknownRows.slice(1).every((r) => r[11] === "unavailable")).toBe(true);
    expect(unknownRows.slice(1).every((r) => r[header.indexOf("value_percent")] === "")).toBe(true);
  });

  it("P1.4: work-plan craft rows with missing hours are partial and preserve the known sum", () => {
    const workPlan = summarizeWorkPlanByCraft(STEPS);
    const { csvText } = buildWidgetExport("package-planning-work-plan", {
      scope: DETAIL_SCOPE, now: NOW, planningSummary: PLANNING_SUMMARY, workPlan,
      pivot: "bars", title: "Planning and work plan",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const welder = rows.slice(1).find((r) => r[header.indexOf("craft_key")] === "welder");
    expect(welder[11]).toBe("partial");
    expect(welder[header.indexOf("planned_hours")]).toBe(""); // wholly unknown hours: blank, never a false 0
    expect(welder[header.indexOf("hours_missing_count")]).toBe("1");
    const pipefitter = rows.slice(1).find((r) => r[header.indexOf("craft_key")] === "pipefitter");
    expect(pipefitter[11]).toBe("complete");
    const summary = rows.slice(1).find((r) => r[0] === "total");
    expect(summary[11]).toBe("partial");
  });

  it("P1.4: a landing cost summary claiming complete while unallocated remains is refused, not certified", () => {
    // Counts and cents re-add (categories 150000 + unallocated 25000 =
    // the 175000 total; reconciled 1 + unallocated 1 = estimated 2) —
    // only the complete claim contradicts the unallocated remainder.
    const contradictory = {
      ...COST_SUMMARY,
      categoryTotals: { ...COST_SUMMARY.categoryTotals, labor: 45000 },
      reconciledPackageCount: 1,
      unallocatedPackageCount: 1,
      unallocatedEstimateCents: 25000,
      complete: true,
    };
    expect(() => buildWidgetExport("landing-cost-split", {
      scope: SCOPE, now: NOW, costSummary: contradictory,
      baseHref: "/forge/work", pivot: "donut",
    })).toThrow(/reconcile/i);
  });

  it("P1.4: a stale package cost split carries structured reconciliation cents and the allocation drill", () => {
    const cost = summarizePackageCostSplit({
      ...ALLOCATION_DATA,
      estimate: { ...ALLOCATION_DATA.estimate, version: 3 },
    });
    expect(cost.state).toBe("stale");
    const { csvText } = buildWidgetExport("package-cost-split", {
      scope: DETAIL_SCOPE, now: NOW, cost, pivot: "donut", title: "Cost split",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("state");
    expect(rows[1][11]).toBe("stale");
    expect(rows[1][header.indexOf("state")]).toBe("stale");
    expect(rows[1][header.indexOf("line_sum_cents")]).toBe("250000");
    expect(rows[1][header.indexOf("allocated_total_cents")]).toBe("250000");
    expect(rows[1][header.indexOf("estimate_cents")]).toBe("250000");
    expect(rows[1][header.indexOf("gap_cents")]).toBe("0");
    expect(rows[1][header.indexOf("drill_target")]).toBe("tab:budget?detailFocus=budget-allocation:all");
  });

  it("P1.4: change-order figures that contradict their own estimate/pool identities are refused", () => {
    const changeStrip = summarizeChangeOrderStrip(CHANGE_SUMMARY);
    expect(() => buildWidgetExport("package-change-orders", {
      scope: DETAIL_SCOPE, now: NOW,
      changeStrip: { ...changeStrip, runningContractPriceCents: 270000 },
      countsByStatus: CHANGE_SUMMARY.countsByStatus, pivot: "strip", title: "Change orders and contingency",
    })).toThrow(/reconcile/i);
    expect(() => buildWidgetExport("package-change-orders", {
      scope: DETAIL_SCOPE, now: NOW,
      changeStrip: { ...changeStrip, contingencyRemainingCents: 0 },
      countsByStatus: CHANGE_SUMMARY.countsByStatus, pivot: "strip", title: "Change orders and contingency",
    })).toThrow(/reconcile/i);
  });

  it("P1.5: drill targets use ? on a bare base href and toggle an active row back to the base href", () => {
    const { csvText } = buildWidgetExport("landing-scope-by-status", {
      scope: SCOPE, now: NOW, summary: summarizePlannerDashboard(PACKAGES),
      baseHref: "/forge/work", pivot: "donut", activeStatus: "draft",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const draft = rows.slice(1).find((r) => r[header.indexOf("status_key")] === "draft");
    expect(draft[header.indexOf("drill_target")]).toBe("/forge/work");
    const inProgress = rows.slice(1).find((r) => r[header.indexOf("status_key")] === "in_progress");
    expect(inProgress[header.indexOf("drill_target")]).toBe("/forge/work?status=in_progress");
  });

  it("P1.5: progress drills keep the progress tab and clear an active group filter", () => {
    const progress = summarizePlannerProgress(PACKAGES, PLANNING);
    const { csvText } = buildWidgetExport("landing-planning-progress", {
      scope: SCOPE, now: NOW, progress, planningAvailable: true,
      activeDimension: "system", activeGroup: { dimension: "system", key: "Piping" },
      baseHref: "/forge/work", pivot: "table",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const piping = rows.slice(1).find((r) => r[header.indexOf("group_label")] === "Piping");
    expect(piping[header.indexOf("drill_target")]).toBe("/forge/work?progressBy=system");
    const noSystem = rows.slice(1).find((r) => r[header.indexOf("group_label")] === "No system");
    expect(noSystem[header.indexOf("drill_target")]).toBe("/forge/work?progressBy=system&system=__none__");
  });

  it("P1.5: detail drills carry the render focus — craft key, budget category, change-order filter", () => {
    const workPlan = summarizeWorkPlanByCraft(STEPS);
    const plan = buildWidgetExport("package-planning-work-plan", {
      scope: DETAIL_SCOPE, now: NOW, planningSummary: PLANNING_SUMMARY, workPlan,
      pivot: "bars", title: "Planning and work plan",
    });
    const planRows = parseCsv(plan.csvText);
    const planHeader = planRows[0];
    const pipefitter = planRows.slice(1).find((r) => r[planHeader.indexOf("craft_key")] === "pipefitter");
    expect(pipefitter[planHeader.indexOf("drill_target")]).toBe("tab:steps?detailFocus=craft:pipefitter");

    const cost = summarizePackageCostSplit(ALLOCATION_DATA);
    const laborVariance = computeLaborVariance({ laborBudgetCents: cost.categoryTotals.labor, plannedLaborForecastCents: cost.plannedLaborForecastCents });
    const costText = buildWidgetExport("package-cost-split", {
      scope: DETAIL_SCOPE, now: NOW, cost, laborVariance, pivot: "donut", title: "Cost split",
    }).csvText;
    const costRows = parseCsv(costText);
    const costHeader = costRows[0];
    const labor = costRows.slice(1).find((r) => r[costHeader.indexOf("category_key")] === "labor");
    expect(labor[costHeader.indexOf("drill_target")]).toBe("tab:budget?detailFocus=budget-allocation:labor");
    const total = costRows.slice(1).find((r) => r[0] === "total");
    expect(total[costHeader.indexOf("drill_target")]).toBe("tab:budget?detailFocus=budget-allocation:all");

    const changeStrip = summarizeChangeOrderStrip(CHANGE_SUMMARY);
    const changeText = buildWidgetExport("package-change-orders", {
      scope: DETAIL_SCOPE, now: NOW, changeStrip,
      countsByStatus: CHANGE_SUMMARY.countsByStatus, pivot: "strip", title: "Change orders and contingency",
    }).csvText;
    const changeRows = parseCsv(changeText);
    const changeHeader = changeRows[0];
    const byMetric = (id) => changeRows.slice(1).find((r) => r[changeHeader.indexOf("metric_id")] === id);
    expect(byMetric("open_count")[changeHeader.indexOf("drill_target")]).toBe("tab:budget?detailFocus=change-orders:open");
    expect(byMetric("approved_value")[changeHeader.indexOf("drill_target")]).toBe("tab:budget?detailFocus=change-orders:counted");
    expect(byMetric("counted_non_deviation")[changeHeader.indexOf("drill_target")]).toBe("");
    expect(byMetric("counted_deviation")[changeHeader.indexOf("drill_target")]).toBe("");
    expect(byMetric("contingency_used")[changeHeader.indexOf("drill_target")]).toBe("tab:budget?detailFocus=change-orders:deviation");
    expect(byMetric("contingency_remaining")[changeHeader.indexOf("drill_target")]).toBe("tab:budget?detailFocus=estimate");
    expect(byMetric("running_contract_price")[changeHeader.indexOf("drill_target")]).toBe("tab:budget?detailFocus=estimate");
  });

  it("P1.5: the strip uses the render labels and the shared drill targets", () => {
    const { csvText } = buildWidgetExport("package-number-strip", {
      scope: DETAIL_SCOPE, now: NOW, pkg: PKG, planningSummary: PLANNING_SUMMARY,
      projectLabel: "Fictional FCCU Sample Project", pivot: "cards", title: "Package",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    expect(rows.slice(1).map((r) => r[header.indexOf("field_label")])).toEqual([
      "Package number", "Status", "Planned budget", "Planning steps", "Planning percent", "Milestones due next",
    ]);
    const budget = rows.slice(1).find((r) => r[header.indexOf("field_id")] === "budget");
    expect(budget[header.indexOf("drill_target")]).toBe("tab:budget");
  });

  it("P1.6: leading tab/CR/LF cells are neutralized as triggers, trusted numerics stay bare", () => {
    const text = serializeCsv(["label", "cents"], [
      ["\t2+2", -100],
      ["\nHello", 0],
      ["\r=cmd", 0],
      ["\t@x", 0],
      ["normal -5 label", -5],
    ]);
    const rows = parseCsv(text);
    expect(rows[1][0]).toBe("'\t2+2");
    expect(rows[2][0]).toBe("'\nHello");
    expect(rows[3][0]).toBe("'\r=cmd");
    expect(rows[4][0]).toBe("'\t@x");
    expect(rows[5][0]).toBe("normal -5 label");
    expect(rows[1][1]).toBe("-100");
    expect(rows[5][1]).toBe("-5");
  });

  it("contract: block-map groups reconcile against the independent strip total, and progress status counts re-add", () => {
    const summary = summarizeScopeBlockMap(PACKAGES, "system");
    expect(() => buildWidgetExport("landing-scope-block-map", {
      scope: SCOPE, now: NOW, summary, totalPackages: 99,
      dimension: { key: "system", label: "Equipment type", param: "system" },
      baseHref: "/forge/work",
      prefs: { visible: true, title: "Scope block map", grouping: "system", minLabelPercent: 4, pivot: "treemap" },
    })).toThrow(/reconcile/i);

    const progress = summarizePlannerProgress(PACKAGES, PLANNING);
    expect(() => buildWidgetExport("landing-planning-progress", {
      scope: SCOPE, now: NOW,
      progress: { ...progress, total: { ...progress.total, statusCounts: { draft: 99, in_progress: 1 } } },
      planningAvailable: true, activeDimension: "system", activeGroup: null, baseHref: "/forge/work", pivot: "table",
    })).toThrow(/reconcile/i);
  });

  it("contract: a missing required numeric is refused, never fabricated as zero", () => {
    expect(() => buildWidgetExport("landing-cost-split", {
      scope: SCOPE, now: NOW,
      costSummary: { ...COST_SUMMARY, categoryTotals: { ...COST_SUMMARY.categoryTotals, labor: undefined } },
      baseHref: "/forge/work", pivot: "donut",
    })).toThrow(/reconcile|not a safe integer/i);
    expect(() => buildWidgetExport("package-planning-work-plan", {
      scope: DETAIL_SCOPE, now: NOW, planningSummary: PLANNING_SUMMARY, workPlan: null,
      pivot: "bars", title: "Planning and work plan",
    })).toThrow(/missing/i);
    expect(() => buildWidgetExport("package-change-orders", {
      scope: DETAIL_SCOPE, now: NOW, changeStrip: null,
      countsByStatus: {}, pivot: "strip", title: "Change orders and contingency",
    })).toThrow(/missing/i);
  });
});

describe("fix round 2 — ChatGPT verdict residual P1 + contract (red-before fixtures)", () => {
  const ALL_MISSING_STEPS = [
    { id: "m1", craftKey: "pipefitter", craftLabel: "Pipefitter", plannedPersonHours: null, retiredAt: null },
    { id: "m2", craftKey: "pipefitter", craftLabel: "Pipefitter", plannedPersonHours: null, retiredAt: null },
    { id: "m3", craftKey: "welder", craftLabel: "Welder", plannedPersonHours: undefined, retiredAt: null },
  ];

  it("residual P1.4: a work plan with every step missing hours exports blank hours and partial, never complete zero", () => {
    const workPlan = summarizeWorkPlanByCraft(ALL_MISSING_STEPS);
    expect(workPlan.hasHours).toBe(false);
    expect(workPlan.knownHoursSteps).toBe(0);
    for (const pivot of ["bars", "table"]) {
      const { csvText } = buildWidgetExport("package-planning-work-plan", {
        scope: DETAIL_SCOPE, now: NOW, planningSummary: PLANNING_SUMMARY, workPlan,
        pivot, title: "Planning and work plan",
      });
      const rows = parseCsv(csvText);
      const header = rows[0];
      const summary = rows.slice(1).find((r) => r[0] === "total");
      expect(summary[11]).toBe("partial");
      expect(summary[header.indexOf("planned_hours")]).toBe("");
      expect(summary[header.indexOf("hours_missing_count")]).toBe("3");
      for (const craft of rows.slice(1).filter((r) => r[0] === "data")) {
        expect(craft[11]).toBe("partial");
        expect(craft[header.indexOf("planned_hours")]).toBe("");
      }
      const hoursWarning = rows.slice(1).find((r) => r[0] === "state"
        && r[header.indexOf("display_value")].includes("no planned hours set"));
      expect(hoursWarning).toBeDefined();
      expect(hoursWarning[11]).toBe("partial");
      const completion = rows.slice(1).find((r) => r[header.indexOf("craft_completion_state")] === "unavailable_no_crosswalk");
      expect(completion).toBeDefined();
      expect(completion[0]).toBe("state");
    }
  });

  it("residual P1.4: mixed known/unknown hours keep the known sum and blank only the wholly unknown craft", () => {
    const workPlan = summarizeWorkPlanByCraft(STEPS);
    const { csvText } = buildWidgetExport("package-planning-work-plan", {
      scope: DETAIL_SCOPE, now: NOW, planningSummary: PLANNING_SUMMARY, workPlan,
      pivot: "bars", title: "Planning and work plan",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const welder = rows.slice(1).find((r) => r[header.indexOf("craft_key")] === "welder");
    expect(welder[11]).toBe("partial");
    expect(welder[header.indexOf("planned_hours")]).toBe("");
    expect(welder[header.indexOf("hours_missing_count")]).toBe("1");
    const pipefitter = rows.slice(1).find((r) => r[header.indexOf("craft_key")] === "pipefitter");
    expect(pipefitter[11]).toBe("complete");
    expect(pipefitter[header.indexOf("planned_hours")]).toBe("14.5");
    const summary = rows.slice(1).find((r) => r[0] === "total");
    expect(summary[11]).toBe("partial");
    expect(summary[header.indexOf("planned_hours")]).toBe("16.5");
    const hoursWarning = rows.slice(1).find((r) => r[0] === "state"
      && r[header.indexOf("display_value")].includes("no planned hours set"));
    expect(hoursWarning).toBeDefined();
    expect(hoursWarning[11]).toBe("partial");
  });

  it("residual P1.4: an explicit zero is a known zero, distinct from unknown hours", () => {
    const workPlan = summarizeWorkPlanByCraft([
      { id: "z1", craftKey: "a", craftLabel: "Crew A", plannedPersonHours: 0, retiredAt: null },
      { id: "z2", craftKey: "b", craftLabel: "Crew B", plannedPersonHours: null, retiredAt: null },
    ]);
    const { csvText } = buildWidgetExport("package-planning-work-plan", {
      scope: DETAIL_SCOPE, now: NOW, planningSummary: PLANNING_SUMMARY, workPlan,
      pivot: "table", title: "Planning and work plan",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const crewA = rows.slice(1).find((r) => r[header.indexOf("craft_key")] === "a");
    expect(crewA[11]).toBe("complete");
    expect(crewA[header.indexOf("planned_hours")]).toBe("0");
    const crewB = rows.slice(1).find((r) => r[header.indexOf("craft_key")] === "b");
    expect(crewB[11]).toBe("partial");
    expect(crewB[header.indexOf("planned_hours")]).toBe("");
    const summary = rows.slice(1).find((r) => r[0] === "total");
    expect(summary[11]).toBe("partial");
    expect(summary[header.indexOf("planned_hours")]).toBe("0");
  });

  it("residual P1.4: an empty plan exports a complete summary with blank hours plus the empty state row", () => {
    const workPlan = summarizeWorkPlanByCraft([]);
    const { csvText } = buildWidgetExport("package-planning-work-plan", {
      scope: DETAIL_SCOPE, now: NOW, planningSummary: PLANNING_SUMMARY, workPlan,
      pivot: "bars", title: "Planning and work plan",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const summary = rows.slice(1).find((r) => r[0] === "total");
    expect(summary[11]).toBe("complete");
    expect(summary[header.indexOf("planned_hours")]).toBe("");
    expect(summary[header.indexOf("step_count")]).toBe("0");
    const empty = rows.slice(1).find((r) => r[header.indexOf("display_value")] === "No work steps yet — the work plan is empty.");
    expect(empty).toBeDefined();
    expect(empty[0]).toBe("state");
    const hoursWarning = rows.slice(1).find((r) => r[0] === "state"
      && r[header.indexOf("display_value")].includes("no planned hours set"));
    expect(hoursWarning).toBeUndefined();
  });

  it("residual contract: partial planning progress carries an explanatory coverage state row", () => {
    const progress = summarizePlannerProgress(PACKAGES, PLANNING);
    const { csvText } = buildWidgetExport("landing-planning-progress", {
      scope: SCOPE, now: NOW, progress, planningAvailable: true,
      activeDimension: "system", activeGroup: null, baseHref: "/forge/work", pivot: "table",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const coverage = rows.slice(1).find((r) => r[0] === "state"
      && r[header.indexOf("packages_without_planning")] === "1");
    expect(coverage).toBeDefined();
    expect(coverage[11]).toBe("partial");
    expect(coverage[header.indexOf("display_value")]).toContain("2 of 3");
    expect(coverage[12]).toContain("1 has no checklist yet");
    expect(coverage[header.indexOf("packages_with_planning")]).toBe("2");
  });

  it("residual contract: fully unknown planning progress carries an unavailable coverage state row", () => {
    const unknown = {
      total: { key: null, label: "All packages", packageCount: 2, completeCount: 0, percentComplete: null, packagesWithPlanning: 0, packagesWithoutPlanning: 2, statusCounts: { draft: 2 } },
      bySystem: [{ key: "Piping", label: "Piping", packageCount: 2, completeCount: 0, percentComplete: null, packagesWithPlanning: 0, packagesWithoutPlanning: 2, statusCounts: { draft: 2 } }],
      byPlanner: [], byUnit: [],
    };
    const { csvText } = buildWidgetExport("landing-planning-progress", {
      scope: SCOPE, now: NOW, progress: unknown, planningAvailable: true,
      activeDimension: "system", activeGroup: null, baseHref: "/forge/work", pivot: "table",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    const coverage = rows.slice(1).find((r) => r[0] === "state"
      && r[header.indexOf("packages_without_planning")] === "2");
    expect(coverage).toBeDefined();
    expect(coverage[11]).toBe("unavailable");
    expect(coverage[header.indexOf("value_percent")]).toBe("");
  });

  it("residual contract: an empty scope-by-status breakdown with a nonzero strip total refuses the file", () => {
    expect(() => buildWidgetExport("landing-scope-by-status", {
      scope: SCOPE, now: NOW,
      summary: { totalPackages: 3, statusBreakdown: [] }, baseHref: "/forge/work", pivot: "donut",
    })).toThrow(/reconcile/i);
  });

  it("residual contract: non-Deviation/Deviation rows are classified as breakdown, not additive metrics", () => {
    const changeStrip = summarizeChangeOrderStrip(CHANGE_SUMMARY);
    const { csvText } = buildWidgetExport("package-change-orders", {
      scope: DETAIL_SCOPE, now: NOW, changeStrip,
      countsByStatus: CHANGE_SUMMARY.countsByStatus, pivot: "strip", title: "Change orders and contingency",
    });
    const rows = parseCsv(csvText);
    const header = rows[0];
    expect(header).toContain("metric_class");
    const byMetric = (id) => rows.slice(1).find((r) => r[header.indexOf("metric_id")] === id);
    expect(byMetric("approved_value")[header.indexOf("metric_class")]).toBe("metric");
    expect(byMetric("counted_non_deviation")[header.indexOf("metric_class")]).toBe("breakdown");
    expect(byMetric("counted_deviation")[header.indexOf("metric_class")]).toBe("breakdown");
    expect(byMetric("open_count")[header.indexOf("metric_class")]).toBe("metric");

    const tableText = buildWidgetExport("package-change-orders", {
      scope: DETAIL_SCOPE, now: NOW, changeStrip,
      countsByStatus: CHANGE_SUMMARY.countsByStatus, pivot: "table", title: "Change orders and contingency",
    }).csvText;
    const tableRows = parseCsv(tableText);
    const tableHeader = tableRows[0];
    const statusRow = tableRows.slice(1).find((r) => r[tableHeader.indexOf("status_key")] === "approved");
    expect(statusRow[tableHeader.indexOf("metric_class")]).toBe("breakdown");
    const warningRow = tableRows.slice(1).find((r) => r[tableHeader.indexOf("warning_code")] === "contingency_overdrawn");
    expect(warningRow[tableHeader.indexOf("metric_class")]).toBe("");
  });
});
