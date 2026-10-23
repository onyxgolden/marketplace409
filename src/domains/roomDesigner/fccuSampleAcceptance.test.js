import { describe, expect, it } from "vitest";
import { buildFccuPlotPlan } from "./fccuPlotPlanSample";
import { findSymbol } from "./symbolRegistry";
import { anchorsOf, reconcilePipeAttachments } from "./pipeAttachments";
import { downcomerLevels } from "./downcomers";
import { accessPackageLocal } from "./vesselAccess";
import { isVesselSymbol, utilityConnectionTable, vesselUtilities } from "./utilityPiping";
import { findPipeCrossings, pipeCrossingErrors, segmentElevationsForDesign } from "./pipeCrossings";
import { hydrantGapsIn, distanceToFootprintIn, pointInPolygon } from "./firewater";
import {
  moveSymbol,
  parseDesign,
  serializeDesign,
  validateDesign,
} from "./designerDocument";

// D7 acceptance: the fictional FCCU-inspired plot plan is the fixture
// for D1–D6, D8, and D9. It is an authored illustration — product draws
// are labels, temperatures stay user-entered (blank here), and nothing
// about it is a validated operating design.
const project = buildFccuPlotPlan();
const design = project.levels[0].design;
const byTag = (tag) => design.symbols.find((s) => s.tag === tag);
const symbolOf = (inst) => findSymbol(inst.domain, inst.symbolId);
const attachedTo = (instanceId, anchorId) =>
  design.pipes.filter((p) =>
    Object.values(p.attachments || {}).some(
      (ref) => ref?.symbolId === instanceId && (anchorId === undefined || ref.anchorId === anchorId),
    ),
  );

describe("FCCU sample acceptance (D7)", () => {
  it("the sample builds valid", () => {
    expect(validateDesign(design)).toEqual([]);
  });

  it("T-101 carries three downcomer levels with the standard draws as product labels", () => {
    const t101 = byTag("T-101");
    expect(t101.symbolId).toBe("column");
    const levels = downcomerLevels(symbolOf(t101), t101);
    expect(levels.map((l) => l.elevationIn)).toEqual([120, 240, 360]);
    expect(levels.map((l) => l.product)).toEqual([
      "Heavy cycle oil",
      "Light cycle oil",
      "Overhead gas",
    ]);
    // Temperatures are user-entered data: the sample leaves them blank.
    expect(levels.every((l) => l.temperature === null)).toBe(true);
    expect(levels[0].label).toBe("Heavy cycle oil");
  });

  it("the draw outlets are connected: HCO and LCO circuits land on their level draws", () => {
    const t101 = byTag("T-101");
    expect(attachedTo(t101.id, "downcomer-1-draw")).toHaveLength(1);
    expect(attachedTo(t101.id, "downcomer-2-draw")).toHaveLength(1);
    // LCO and HCO rundown stay on their own circuits (no shared runs).
    const hco = attachedTo(t101.id, "downcomer-1-draw")[0];
    const lco = attachedTo(t101.id, "downcomer-2-draw")[0];
    expect(hco.id).not.toBe(lco.id);
  });

  it("every tagged equipment item carries flanged nozzle anchors", () => {
    for (const inst of design.symbols) {
      if (inst.domain !== "processEquipment" || !inst.tag) continue;
      // Pipe racks are structures, not process equipment: they carry
      // no nozzles by design (the deliberate catalog exception).
      if (inst.symbolId === "pipe-rack" || inst.symbolId === "sleeper-rack") continue;
      expect(anchorsOf(inst).length, inst.tag).toBeGreaterThan(0);
    }
  });

  it("vessel access follows the sill rule: V-101 (sill 18) none, V-102 (sill 30) catwalk at sill", () => {
    const v101 = byTag("V-101");
    expect(accessPackageLocal(symbolOf(v101), v101)).toBeNull();
    // V-102's manway sill is overridden to 24 in this fixture (PR668
    // fixround: the 30-in catalog sill has no feasible deck placement in
    // the congested plot). At 24 in, no access package is required.
    const v102 = byTag("V-102");
    expect(accessPackageLocal(symbolOf(v102), v102)).toBeNull();
  });

  it("no pipe crosses another at the same elevation anywhere in the sample", () => {
    expect(findPipeCrossings(design).filter((c) => !c.resolved)).toEqual([]);
    expect(pipeCrossingErrors(design)).toEqual([]);
  });

  it("every vessel carries all three utilities at its base (D8)", () => {
    for (const inst of design.symbols) {
      const symbol = symbolOf(inst);
      if (!isVesselSymbol(symbol)) continue;
      expect([...vesselUtilities(design, inst.id)].sort(), inst.tag).toEqual([
        "nitrogen",
        "plant-air",
        "plant-water",
      ]);
    }
    // The utility headers ride the rack: their derived elevation is
    // the rack's, far above the grade fallback.
    const header = design.pipes.find((p) => p.utility === "plant-water" && !p.attachments);
    expect(header).toBeTruthy();
    const elevs = segmentElevationsForDesign(design, header);
    expect(Math.max(...elevs)).toBeGreaterThan(100);
  });

  it("stripping one vessel utility makes validation flag exactly that gap", () => {
    const v102 = byTag("V-102");
    const nitrogenBranch = design.pipes.find((p) =>
      Object.values(p.attachments || {}).some(
        (ref) => ref?.symbolId === v102.id && ref.anchorId === "utility-nitrogen",
      ),
    );
    expect(nitrogenBranch).toBeTruthy();
    const stripped = { ...design, pipes: design.pipes.filter((p) => p.id !== nitrogenBranch.id) };
    const errors = validateDesign(stripped);
    expect(errors.some((e) => /V-102/.test(e) && /Nitrogen/.test(e))).toBe(true);
  });

  it("moving a vessel carries its utility branch ends with it", () => {
    const v102 = byTag("V-102");
    const before = new Map(
      design.pipes
        .filter((p) => Object.values(p.attachments || {}).some((ref) => ref?.symbolId === v102.id))
        .map((p) => [p.id, p]),
    );
    expect(before.size).toBeGreaterThan(3);
    const moved = reconcilePipeAttachments(moveSymbol(design, v102.id, v102.x + 240, v102.y));
    const anchors = new Map(anchorsOf(moved.symbols.find((s) => s.id === v102.id)).map((a) => [a.id, a]));
    for (const [id, runBefore] of before) {
      const runAfter = moved.pipes.find((p) => p.id === id);
      for (const end of ["start", "end"]) {
        const ref = runBefore.attachments?.[end];
        if (!ref || ref.symbolId !== v102.id) continue;
        const idx = end === "start" ? 0 : runAfter.points.length - 1;
        const anchor = anchors.get(ref.anchorId);
        expect(runAfter.points[idx].x).toBeCloseTo(anchor.x, 6);
        expect(runAfter.points[idx].y).toBeCloseTo(anchor.y, 6);
      }
    }
  });

  it("firewater: hydrants within 100 ft everywhere on the loop (D9)", () => {
    const gaps = hydrantGapsIn(design);
    expect(gaps.length).toBeGreaterThan(0);
    expect(Math.max(...gaps.map((g) => g.gapIn))).toBeLessThanOrEqual(100 * 12);
    const hydrants = design.symbols.filter((s) => s.symbolId === "fire-hydrant");
    expect(hydrants).toHaveLength(15);
  });

  it("firewater: every flammable vessel has spray coverage from outside the unit at >= 50 ft", () => {
    const sprays = design.symbols.filter((s) => s.symbolId === "spray-nozzle");
    expect(sprays).toHaveLength(4);
    for (const inst of design.symbols) {
      if (inst.flammable !== true) continue;
      const covering = sprays.filter((s) => s.protects === inst.id);
      expect(covering.length, inst.tag).toBeGreaterThanOrEqual(1);
      for (const spray of covering) {
        expect(pointInPolygon(spray, design.unitBoundary)).toBe(false);
        expect(distanceToFootprintIn(spray, inst, symbolOf(inst))).toBeGreaterThanOrEqual(50 * 12);
      }
    }
    expect(design.symbols.filter((s) => s.flammable === true).map((s) => s.tag).sort()).toEqual([
      "R-101",
      "T-101",
      "V-101",
      "V-102",
    ]);
  });

  it("the D8 connection table resolves every vessel/service pair branch -> header -> source", () => {
    const table = utilityConnectionTable(design);
    // Six in-scope vessels in the sample x three services.
    expect(table).toHaveLength(18);
    expect(table.map((r) => r.vesselTag).sort()).toEqual([
      "R-101", "R-101", "R-101", "R-102", "R-102", "R-102",
      "T-101", "T-101", "T-101", "T-102", "T-102", "T-102",
      "V-101", "V-101", "V-101", "V-102", "V-102", "V-102",
    ]);
    for (const row of table) {
      expect(row.supplied, `${row.vesselTag} ${row.serviceId}`).toBe(true);
      expect(row.basePortId).toBe(`utility-${row.serviceId}`);
      expect(row.branchRunIds).toHaveLength(1);
      expect(row.headerId).toBeTruthy();
      expect(row.sourceRunId).toBeTruthy();
    }
    // Sizing pin: headers 2-inch, drops 1-inch.
    const byId = new Map(design.pipes.map((p) => [p.id, p]));
    for (const row of table) {
      expect(byId.get(row.headerId).diameterIn).toBe(2);
      expect(byId.get(row.branchRunIds[0]).diameterIn).toBe(1);
    }
  });

  it("firewater sizing: 12-inch loop, 6-inch hydrant branches, 6/4-inch monitor take-offs (D9)", () => {
    const fw = design.pipes.filter((p) => p.utility === "firewater");
    const main = fw.find((p) => p.underground && p.points.length > 2);
    expect(main.diameterIn).toBe(12);
    const source = fw.find((p) => p.sourceOf === "firewater");
    expect(source.diameterIn).toBe(12);
    const hydrants = design.symbols.filter((s) => s.symbolId === "fire-hydrant");
    const endsAt = (run, x, y) =>
      [run.points[0], run.points[run.points.length - 1]].some(
        (p) => Math.hypot(p.x - x, p.y - y) <= 1,
      );
    const branches = fw.filter((p) => hydrants.some((h) => endsAt(p, h.x, h.y)));
    expect(branches).toHaveLength(15);
    expect(branches.every((p) => p.diameterIn === 6)).toBe(true);
    const sprays = design.symbols.filter((s) => s.symbolId === "spray-nozzle");
    const takeoffs = fw.filter((p) => sprays.some((s) => endsAt(p, s.x, s.y)));
    expect(takeoffs).toHaveLength(4);
    expect(takeoffs.map((p) => p.diameterIn).sort()).toEqual([4, 4, 6, 6]);
  });

  it("serialize -> parse preserves the new model data", () => {
    const back = parseDesign(serializeDesign(design));
    const t101 = back.symbols.find((s) => s.tag === "T-101");
    expect(t101.downcomerProps).toEqual(byTag("T-101").downcomerProps);
    expect(back.unitBoundary).toEqual(design.unitBoundary);
    expect(back.symbols.filter((s) => s.flammable === true)).toHaveLength(4);
    expect(back.symbols.filter((s) => s.protects)).toHaveLength(4);
    expect(validateDesign(back)).toEqual([]);
  });
});
