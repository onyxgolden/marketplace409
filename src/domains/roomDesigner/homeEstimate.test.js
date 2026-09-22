// homeEstimate — FORGE Home Designer slice 4 (remodel estimating).
//
// Contract: frozen assembly catalog maps to real measureHomeProject() total
// keys; unit costs persist as INTEGER CENTS (never float dollars); pending
// by absence (nothing priced until the user types a cost); estimateProject
// never throws at the boundary; every line item carries quantity provenance.

import { describe, expect, it, beforeEach } from "vitest";
import {
  ASSEMBLIES,
  ASSEMBLY_IDS,
  ESTIMATE_VERSION,
  MEASUREMENT_VERSION,
  QUANTITY_SOURCE,
  estimateProject,
  formatUSD,
  getEstimate,
  normalizeEstimate,
  parseUnitCostInput,
  setUnitCost,
  unitCostLabel,
} from "./homeEstimate";
import {
  createHomeProject,
  parseHomeProject,
  resetHomeProjectIds,
  serializeHomeProject,
  updateLevelDesign,
} from "./homeProject";
import { measureHomeProject } from "./homeQuantities";
import {
  addRoomFromTemplate,
  createEmptyDesign,
  resetDesignerIds,
} from "./designerDocument";
import "./pipingCatalog";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
});

function bedroomProject() {
  let p = createHomeProject("Remodel", { units: "ft" });
  let d = createEmptyDesign("Bedroom");
  d = addRoomFromTemplate(d, "bedroom", { x: 0, y: 0 }); // 12x12 = 144 sq ft
  p = updateLevelDesign(p, p.levels[0].id, () => d);
  return p;
}

function measuredTotals(project) {
  const measured = measureHomeProject(project);
  expect(measured.ok).toBe(true);
  return measured.totals;
}

describe("assembly catalog", () => {
  it("has the frozen v1 catalog of 7 assemblies", () => {
    expect(ASSEMBLY_IDS).toEqual([
      "flooring",
      "wall_paint",
      "drywall",
      "baseboard",
      "interior_door",
      "windows",
      "plumbing_rough",
    ]);
    expect(ASSEMBLIES).toHaveLength(7);
  });

  it("every quantityKey resolves to a number in measureHomeProject totals", () => {
    const totals = measuredTotals(bedroomProject());
    for (const a of ASSEMBLIES) {
      expect(typeof totals[a.quantityKey], a.quantityKey).toBe("number");
    }
  });

  it("uses only sqft | linft | each units", () => {
    for (const a of ASSEMBLIES) {
      expect(["sqft", "linft", "each"]).toContain(a.unit);
    }
  });
});

describe("setUnitCost — integer cents storage (reviewer fix 1)", () => {
  it("stores integer cents in the envelope, never float dollars", () => {
    const p = setUnitCost(bedroomProject(), "flooring", 250);
    expect(p.estimate.unitCostsCents.flooring).toBe(250);
    expect(Number.isInteger(p.estimate.unitCostsCents.flooring)).toBe(true);
    expect(p.estimate.version).toBe(ESTIMATE_VERSION);
    expect(typeof p.estimate.updatedAt).toBe("string");
  });

  it("rounds fractional cent input to whole cents", () => {
    const p = setUnitCost(bedroomProject(), "flooring", 249.6);
    expect(p.estimate.unitCostsCents.flooring).toBe(250);
  });

  it("accepts zero (a real $0.00 cost is priced, not pending)", () => {
    const p = setUnitCost(bedroomProject(), "flooring", 0);
    const est = estimateProject(p);
    const line = est.items.find((i) => i.assemblyId === "flooring");
    expect(line.status).toBe("priced");
    expect(line.extendedCents).toBe(0);
  });

  it("null clears the cost back to pending", () => {
    let p = setUnitCost(bedroomProject(), "flooring", 250);
    p = setUnitCost(p, "flooring", null);
    expect(p.estimate.unitCostsCents).not.toHaveProperty("flooring");
    const est = estimateProject(p);
    expect(est.items.find((i) => i.assemblyId === "flooring").status).toBe("pending");
  });

  it("keeps other assemblies' costs when one changes", () => {
    let p = setUnitCost(bedroomProject(), "flooring", 250);
    p = setUnitCost(p, "wall_paint", 199);
    expect(p.estimate.unitCostsCents).toEqual({ flooring: 250, wall_paint: 199 });
  });

  it("throws on unknown assembly id", () => {
    expect(() => setUnitCost(bedroomProject(), "gold_plating", 100)).toThrow(/Unknown assembly/);
  });

  it("throws on negative, NaN, or non-number costs", () => {
    const p = bedroomProject();
    expect(() => setUnitCost(p, "flooring", -1)).toThrow();
    expect(() => setUnitCost(p, "flooring", NaN)).toThrow();
    expect(() => setUnitCost(p, "flooring", "2.50")).toThrow();
  });

  it("does not mutate the input project", () => {
    const p = bedroomProject();
    const before = JSON.stringify(p.estimate);
    setUnitCost(p, "flooring", 250);
    expect(JSON.stringify(p.estimate)).toBe(before);
  });

  it("survives a JSON round-trip as integer cents", () => {
    let p = setUnitCost(bedroomProject(), "flooring", 250);
    p = parseHomeProject(serializeHomeProject(p));
    expect(p.estimate.unitCostsCents.flooring).toBe(250);
    expect(Number.isInteger(p.estimate.unitCostsCents.flooring)).toBe(true);
  });
});

describe("parseHomeProject estimate normalization (fail-closed)", () => {
  function withEstimate(rawEstimate) {
    const p = bedroomProject();
    return parseHomeProject(JSON.stringify({ ...p, estimate: rawEstimate }));
  }

  it("drops unknown assembly ids", () => {
    const p = withEstimate({ version: 1, unitCostsCents: { flooring: 250, unicorn: 99 } });
    expect(p.estimate.unitCostsCents).toEqual({ flooring: 250 });
  });

  it("drops non-finite and negative costs", () => {
    const p = withEstimate({
      version: 1,
      unitCostsCents: { flooring: 250, wall_paint: -5, drywall: NaN, baseboard: Infinity },
    });
    expect(p.estimate.unitCostsCents).toEqual({ flooring: 250 });
  });

  it("rounds fractional cents to whole cents", () => {
    const p = withEstimate({ version: 1, unitCostsCents: { flooring: 249.6 } });
    expect(p.estimate.unitCostsCents.flooring).toBe(250);
  });

  it("tolerates a missing estimate (legacy rows)", () => {
    const p = bedroomProject();
    const { estimate, ...rest } = p;
    const parsed = parseHomeProject(JSON.stringify(rest));
    expect(parsed.estimate.unitCostsCents).toEqual({});
    expect(parsed.estimate.version).toBe(ESTIMATE_VERSION);
  });

  it("tolerates a non-object estimate", () => {
    const p = withEstimate("junk");
    expect(p.estimate.unitCostsCents).toEqual({});
  });

  it("getEstimate normalizes on read even when parse was bypassed", () => {
    const p = bedroomProject();
    p.estimate = { version: 1, unitCostsCents: { flooring: 250, bogus: 1, wall_paint: -2 } };
    expect(getEstimate(p).unitCostsCents).toEqual({ flooring: 250 });
  });
});

describe("estimateProject", () => {
  it("prices nothing on a fresh project — pending by absence", () => {
    const est = estimateProject(bedroomProject());
    expect(est.ok).toBe(true);
    expect(est.items).toHaveLength(7);
    expect(est.items.every((i) => i.status === "pending")).toBe(true);
    expect(est.items.every((i) => i.unitCostCents === null)).toBe(true);
    expect(est.items.every((i) => i.extendedCents === null)).toBe(true);
    expect(est.subtotalCents).toBe(0);
    expect(est.pricedCount).toBe(0);
    expect(est.pendingCount).toBe(7);
  });

  it("does integer-cent money math: quantity x unitCostCents", () => {
    const project = bedroomProject();
    const totals = measuredTotals(project);
    const p = setUnitCost(project, "flooring", 250); // $2.50/sq ft
    const est = estimateProject(p);
    const line = est.items.find((i) => i.assemblyId === "flooring");
    expect(line.status).toBe("priced");
    expect(line.quantity).toBe(totals.netRoomAreaSqFt);
    expect(line.extendedCents).toBe(Math.round(totals.netRoomAreaSqFt * 250));
    expect(Number.isInteger(line.extendedCents)).toBe(true);
    expect(est.subtotalCents).toBe(line.extendedCents);
  });

  it("converts inch-based totals to linear feet for linft assemblies", () => {
    const project = bedroomProject();
    const totals = measuredTotals(project);
    const p = setUnitCost(project, "baseboard", 100); // $1.00/lin ft
    const line = estimateProject(p).items.find((i) => i.assemblyId === "baseboard");
    expect(line.quantity).toBeCloseTo(totals.netWallLengthIn / 12, 2);
    expect(line.extendedCents).toBe(Math.round(line.quantity * 100));
  });

  it("uses counts directly for each assemblies", () => {
    const project = bedroomProject();
    const totals = measuredTotals(project);
    const p = setUnitCost(project, "interior_door", 15000); // $150/door
    const line = estimateProject(p).items.find((i) => i.assemblyId === "interior_door");
    expect(line.quantity).toBe(totals.doorCount);
    expect(line.extendedCents).toBe(Math.round(totals.doorCount * 15000));
  });

  it("subtotal sums only priced lines", () => {
    let p = bedroomProject();
    p = setUnitCost(p, "flooring", 250);
    p = setUnitCost(p, "wall_paint", 199);
    const est = estimateProject(p);
    const expected = est.items
      .filter((i) => i.status === "priced")
      .reduce((s, i) => s + i.extendedCents, 0);
    expect(est.subtotalCents).toBe(expected);
    expect(est.pricedCount).toBe(2);
    expect(est.pendingCount).toBe(5);
    expect(est.pendingItems).toHaveLength(5);
  });

  it("measures the edited on-screen design, not the saved one", () => {
    const project = bedroomProject();
    const p = setUnitCost(project, "flooring", 100);
    const edited = createEmptyDesign("emptied");
    const line = estimateProject(p, edited).items.find((i) => i.assemblyId === "flooring");
    expect(line.quantity).toBe(0);
    expect(line.extendedCents).toBe(0);
  });

  it("passes quantity assumptions through for the UI", () => {
    const est = estimateProject(bedroomProject());
    expect(Array.isArray(est.assumptions)).toBe(true);
  });

  it("never throws — damaged input returns { ok: false }", () => {
    expect(estimateProject(null).ok).toBe(false);
    expect(estimateProject({ version: 1, levels: [], currentLevelId: "x" }).ok).toBe(false);
    expect(estimateProject("junk").ok).toBe(false);
  });

  it("carries project name, units, and level count", () => {
    const est = estimateProject(bedroomProject());
    expect(est.projectName).toBe("Remodel");
    expect(est.units).toBe("ft");
    expect(est.levelCount).toBe(1);
  });
});

describe("quantity provenance (reviewer fix 3)", () => {
  it("every line item carries geometry provenance", () => {
    const est = estimateProject(bedroomProject());
    expect(est.measurementVersion).toBe(MEASUREMENT_VERSION);
    expect(typeof est.generatedAt).toBe("string");
    for (const item of est.items) {
      expect(item.quantitySource).toBe(QUANTITY_SOURCE);
      expect(item.quantitySource).toBe("designer_geometry");
      expect(item.measurementVersion).toBe(MEASUREMENT_VERSION);
      expect(typeof item.generatedAt).toBe("string");
    }
  });
});

describe("formatting helpers", () => {
  it("formatUSD renders integer cents as dollars", () => {
    expect(formatUSD(250)).toBe("$2.50");
    expect(formatUSD(36000)).toBe("$360.00");
    expect(formatUSD(0)).toBe("$0.00");
    expect(formatUSD(199)).toBe("$1.99");
  });

  it("parseUnitCostInput converts dollars text to integer cents", () => {
    expect(parseUnitCostInput("2.50")).toEqual({ cents: 250 });
    expect(parseUnitCostInput("$1,234.56")).toEqual({ cents: 123456 });
    expect(parseUnitCostInput(" 3 ")).toEqual({ cents: 300 });
  });

  it("parseUnitCostInput flags empty as clear and junk as invalid", () => {
    expect(parseUnitCostInput("")).toEqual({ clear: true });
    expect(parseUnitCostInput("   ")).toEqual({ clear: true });
    expect(parseUnitCostInput("abc")).toEqual({ invalid: true });
    expect(parseUnitCostInput("-5")).toEqual({ invalid: true });
  });

  it("unitCostLabel matches the assembly unit", () => {
    expect(unitCostLabel("sqft")).toBe("$/sq ft");
    expect(unitCostLabel("linft")).toBe("$/lin ft");
    expect(unitCostLabel("each")).toBe("$/each");
  });

  it("normalizeEstimate defaults a missing envelope to empty", () => {
    const n = normalizeEstimate(undefined);
    expect(n.unitCostsCents).toEqual({});
    expect(n.version).toBe(ESTIMATE_VERSION);
  });
});
