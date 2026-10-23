import { describe, expect, it } from "vitest";
import {
  UTILITY_DROP_DIAMETER_IN,
  UTILITY_HEADER_DIAMETER_IN,
  UTILITY_SERVICES,
  designHasD8System,
  isVesselSymbol,
  utilityConnectionTable,
  utilityPipingErrors,
  utilityPortDescriptors,
} from "./utilityPiping";
import {
  detectRunAttachments,
  detectRunJunctions,
  reconcilePipeAttachments,
  reconcileRunJunctions,
} from "./pipeAttachments";
import { applyCrossingJogs, crossServiceErrors } from "./pipeCrossings";
import {
  addPipeRun,
  createEmptyDesign,
  moveSymbol,
  placeSymbol,
  validateDesign,
} from "./designerDocument";
import { PROCESS_EQUIPMENT } from "./processEquipmentCatalog";

const E = "processEquipment";
const sym = (id) => PROCESS_EQUIPMENT.find((s) => s.id === id);
const HEADER_Y = { "plant-water": 900, "plant-air": 960, nitrogen: 1020 };

function wire(design, runId) {
  let next = reconcilePipeAttachments(detectRunAttachments(design, runId));
  next = reconcileRunJunctions(detectRunJunctions(next, runId));
  return applyCrossingJogs(next, runId);
}

function addWired(design, points, fields) {
  const next = addPipeRun(design, points, fields);
  const run = next.pipes[next.pipes.length - 1];
  return wire(next, run.id);
}

const withUtility = (design, runId, extra) => ({
  ...design,
  pipes: design.pipes.map((p) => (p.id === runId ? { ...p, ...extra } : p)),
});

// One vertical vessel at (500, 500) with, per service: a source
// inlet stub -> header -> branch junctioned onto the header and
// attached to the vessel's base utility port.
function vesselWithUtilities() {
  let design = placeSymbol(createEmptyDesign(), E, "vertical-vessel", 500, 500, { id: "v1" });
  const inst = design.symbols.find((s) => s.id === "v1");
  const ports = utilityPortDescriptors(sym("vertical-vessel"), inst);
  for (const service of UTILITY_SERVICES) {
    const y = HEADER_Y[service.id];
    design = addWired(design, [{ x: 200, y }, { x: 300, y }], {
      id: `src-${service.id}`,
      diameterIn: UTILITY_HEADER_DIAMETER_IN,
    });
    design = withUtility(design, `src-${service.id}`, { utility: service.id, sourceOf: service.id });
    design = addWired(design, [{ x: 300, y }, { x: 700, y }], {
      id: `hdr-${service.id}`,
      diameterIn: UTILITY_HEADER_DIAMETER_IN,
    });
    design = withUtility(design, `hdr-${service.id}`, { utility: service.id });
    const port = ports.find((p) => p.serviceId === service.id);
    design = addWired(design, [{ x: port.x, y }, { x: port.x, y: port.y }], {
      id: `br-${service.id}`,
      diameterIn: service.sizeIn,
    });
    design = withUtility(design, `br-${service.id}`, { utility: service.id });
  }
  return design;
}

const withoutRun = (design, runId) => ({ ...design, pipes: design.pipes.filter((p) => p.id !== runId) });

// D8: every in-scope vessel carries three stable base utility ports
// (plant water / plant air / nitrogen), each supplied only through an
// explicit same-service connection graph: branch -> header -> source.
describe("utility piping (D8)", () => {
  it("a fully connected vessel validates clean, with exactly one supplied connection per service", () => {
    const design = vesselWithUtilities();
    expect(utilityPipingErrors(design)).toEqual([]);
    const table = utilityConnectionTable(design);
    expect(table).toHaveLength(3);
    for (const row of table) {
      expect(row.supplied).toBe(true);
      expect(row.basePortId).toBe(`utility-${row.serviceId}`);
      expect(row.branchRunIds).toEqual([`br-${row.serviceId}`]);
      expect(row.headerId).toBe(`hdr-${row.serviceId}`);
      expect(row.sourceRunId).toBe(`src-${row.serviceId}`);
    }
  });

  it("deleting one branch flags exactly that service's port, and the intact design stays clean", () => {
    const design = vesselWithUtilities();
    const stripped = withoutRun(design, "br-nitrogen");
    const errors = utilityPipingErrors(stripped);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Nitrogen port utility-nitrogen has no connected branch/);
    expect(utilityConnectionTable(stripped).find((r) => r.serviceId === "nitrogen").supplied).toBe(false);
    expect(utilityPipingErrors(design)).toEqual([]);
  });

  it("a branch ending NEAR the port but not attached does not count as supplied", () => {
    let design = withoutRun(vesselWithUtilities(), "br-nitrogen");
    design = addPipeRun(design, [{ x: 514.4, y: 1020 }, { x: 514.4, y: 530 }], {
      id: "near-miss",
      diameterIn: 1.5,
    });
    design = withUtility(design, "near-miss", { utility: "nitrogen" });
    expect(
      utilityPipingErrors(design).some((e) => /Nitrogen port utility-nitrogen has no connected branch/.test(e)),
    ).toBe(true);
  });

  it("cutting the header upstream disconnects the path; deleting the source does too", () => {
    const design = vesselWithUtilities();
    const cutHeader = withoutRun(design, "hdr-plant-air");
    expect(
      utilityPipingErrors(cutHeader).some((e) =>
        /Plant air port utility-plant-air: branch br-plant-air has no connected path to the designated Plant air source/.test(e),
      ),
    ).toBe(true);
    const noSource = withoutRun(design, "src-plant-water");
    expect(
      utilityPipingErrors(noSource).some((e) =>
        /Plant water port utility-plant-water/.test(e) && /no connected path|no designated/.test(e),
      ),
    ).toBe(true);
  });

  it("a nitrogen branch tied into the water system is a named wrong-service finding (never a cross-service tee)", () => {
    const design = withUtility(vesselWithUtilities(), "br-nitrogen", { utility: "plant-water" });
    const errors = utilityPipingErrors(design);
    expect(errors.some((e) => /Nitrogen port utility-nitrogen is connected to pipe run br-nitrogen carrying service plant-water/.test(e))).toBe(true);
    expect(crossServiceErrors(design).some((e) => /different services must not be teed/.test(e) && /br-nitrogen/.test(e))).toBe(true);
    expect(validateDesign(design).some((e) => /different services must not be teed/.test(e))).toBe(true);
  });

  it("moving the vessel carries branch ends along and the supply path survives", () => {
    const moved = moveSymbol(vesselWithUtilities(), "v1", 700, 620);
    expect(utilityPipingErrors(moved)).toEqual([]);
    expect(utilityConnectionTable(moved).every((r) => r.supplied)).toBe(true);
  });

  it("a new vessel with zero utilities is flagged (missing all three) — D668-008", () => {
    const design = placeSymbol(createEmptyDesign(), E, "vertical-vessel", 500, 500, { id: "v1" });
    // D668-008: the old guard that disabled checks when the system was
    // absent is removed — a new vessel with no utility branches is
    // flagged for all three missing services.
    const errors = utilityPipingErrors(design);
    expect(errors).toHaveLength(3);
    expect(errors.some((e) => /Plant water.*missing supply path/.test(e))).toBe(true);
    expect(errors.some((e) => /Plant air.*missing supply path/.test(e))).toBe(true);
    expect(errors.some((e) => /Nitrogen.*missing supply path/.test(e))).toBe(true);
    // The connection table still lists the vessel's ports as evidence —
    // every row unsupplied.
    const table = utilityConnectionTable(design);
    expect(table).toHaveLength(3);
    expect(table.every((r) => r.supplied === false)).toBe(true);
  });

  it("a firewater-only design does not demand plant water/air/nitrogen", () => {
    let design = placeSymbol(createEmptyDesign(), E, "vertical-vessel", 500, 500, { id: "v1" });
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], {
      id: "fw",
      diameterIn: 12,
      elevationIn: -36,
    });
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "fw" ? { ...p, utility: "firewater", sourceOf: "firewater" } : p,
      ),
    };
    expect(designHasD8System(design)).toBe(false);
    expect(utilityPipingErrors(design)).toEqual([]);
  });

  it("isVesselSymbol follows the explicit in-scope catalog set", () => {
    expect(isVesselSymbol(sym("vertical-vessel"))).toBe(true);
    expect(isVesselSymbol(sym("column"))).toBe(true);
    expect(isVesselSymbol(sym("fluidized-bed-reactor"))).toBe(true);
    expect(isVesselSymbol(sym("centrifugal-pump"))).toBe(false);
    expect(isVesselSymbol(sym("pipe-rack"))).toBe(false);
    expect(isVesselSymbol(sym("electric-motor"))).toBe(false);
  });

  it("utility ports are stable, sized, and face outward from the vessel base", () => {
    const design = placeSymbol(createEmptyDesign(), E, "vertical-vessel", 500, 500, { id: "v1" });
    const ports = utilityPortDescriptors(sym("vertical-vessel"), design.symbols[0]);
    expect(ports.map((p) => p.id)).toEqual(["utility-plant-water", "utility-plant-air", "utility-nitrogen"]);
    expect(ports.every((p) => p.parentId === "v1")).toBe(true);
    expect(ports.every((p) => p.elevationIn === 24)).toBe(true);
    // Outward normal points away from the vessel center (south here).
    expect(ports.every((p) => p.dirY > 0)).toBe(true);
    expect(ports.map((p) => p.sizeIn)).toEqual([1, 1, 1]);
  });

  it("sizing defaults: 2-inch headers, 1-inch drops to the base stations (sizes stay editable per run)", () => {
    expect(UTILITY_HEADER_DIAMETER_IN).toBe(2);
    expect(UTILITY_DROP_DIAMETER_IN).toBe(1);
    expect(UTILITY_SERVICES.every((s) => s.sizeIn === UTILITY_DROP_DIAMETER_IN)).toBe(true);
    const design = vesselWithUtilities();
    for (const service of UTILITY_SERVICES) {
      expect(design.pipes.find((p) => p.id === `hdr-${service.id}`).diameterIn).toBe(2);
      expect(design.pipes.find((p) => p.id === `src-${service.id}`).diameterIn).toBe(2);
      expect(design.pipes.find((p) => p.id === `br-${service.id}`).diameterIn).toBe(1);
    }
  });
});
