import { describe, expect, it } from "vitest";
import {
  FIREWATER_COLOR,
  HYDRANT_BRANCH_DIAMETER_IN,
  HYDRANT_MAX_SPACING_IN,
  SPRAY_MIN_STANDOFF_IN,
  firewaterErrors,
  hydrantGapsIn,
  sprayAssignmentStatus,
  vesselSprayStates,
} from "./firewater";
import { applyCrossingJogs, findPipeCrossings } from "./pipeCrossings";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
} from "./designerDocument";
import { placeReducer } from "./pipeReducerModel";

const P = "piping";
const E = "processEquipment";

// A straight 200-ft buried firewater main along y=0 with a source
// inlet stub junctioned onto its west end, and hydrants at the given
// along-main distances (in).
function mainWithHydrants(hydrantXs) {
  let design = createEmptyDesign();
  design = addPipeRun(design, [{ x: -240, y: 0 }, { x: 0, y: 0 }], { id: "src", diameterIn: 12 });
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 2400, y: 0 }], { id: "main", diameterIn: 12 });
  design = {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === "src"
        ? { ...p, utility: "firewater", sourceOf: "firewater", underground: true, elevationIn: -36, junctions: { end: { runId: "main" } } }
        : { ...p, utility: "firewater", underground: true, elevationIn: -36 },
    ),
  };
  hydrantXs.forEach((x, i) => {
    design = placeSymbol(design, P, "fire-hydrant", x, 0, { id: `h${i}` });
  });
  return design;
}

// One flammable vessel at (1000, 1000) inside a unit boundary, with a
// directed-spray assembly at the given position assigned to it and
// aimed at its center.
function sprayDesign(sprayAt, aimAt = { x: 1000, y: 1000 }) {
  let design = placeSymbol(createEmptyDesign(), E, "vertical-vessel", 1000, 1000, { id: "v1" });
  design = placeSymbol(design, P, "spray-nozzle", sprayAt.x, sprayAt.y, { id: "s1" });
  // D668-006: spray assignments require a verified supply path. Include
  // a minimal firewater loop with a source.
  design = addPipeRun(design, [{ x: sprayAt.x - 100, y: sprayAt.y }, { x: sprayAt.x, y: sprayAt.y }], {
    id: "fw-main",
    diameterIn: 12,
    utility: "firewater",
    sourceOf: "firewater",
    underground: true,
    elevationIn: -36,
  });
  // R6: the supply must bind the assembly's physical inlet — a
  // modeled riser leg (not itself a buried run, the sample's
  // convention) rises from the main to the inlet elevation at the
  // spray. A flat buried run ending beside the assembly is a
  // plan-only supply and is rejected. (addPipeRun does not carry
  // elevIn; it is patched on, as the sample's authoring does.)
  // F4.1 rebuild: the leg runs buried at -36 to the spray's plan
  // position and the terminal segment is a zero-plan-length vertical
  // riser vertex (duplicate plan point, per-vertex elevation) — the
  // earlier fixture's single segment rose over its whole plan run,
  // a sloped terminal F4.1 now refuses; assertions unchanged.
  design = addPipeRun(design, [{ x: sprayAt.x - 100, y: sprayAt.y }, { x: sprayAt.x, y: sprayAt.y }], {
    id: "fw-riser",
    diameterIn: 6,
    utility: "firewater",
  });
  design = {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === "fw-riser"
        ? {
            ...p,
            points: [
              { x: sprayAt.x - 100, y: sprayAt.y },
              { x: sprayAt.x, y: sprayAt.y },
              { x: sprayAt.x, y: sprayAt.y },
            ],
            elevIn: [-36, -36, 0],
            junctions: { start: { runId: "fw-main" } },
          }
        : p,
    ),
  };
  // The 12 -> 6 tap transition gets its modeled reducer, oriented
  // with its outlet facing the riser (R1: the junction edge exists
  // only when a reducer's owned interfaces bind it).
  design = placeReducer(design, sprayAt.x - 100, sprayAt.y, {
    id: "fw-tap-red",
    inletSizeIn: 12,
    outletSizeIn: 6,
    rotationDeg: 0,
  });
  design = {
    ...design,
    unitBoundary: [
      { x: 800, y: 800 },
      { x: 1200, y: 800 },
      { x: 1200, y: 1200 },
      { x: 800, y: 1200 },
    ],
    symbols: design.symbols.map((s) => {
      if (s.id === "v1") return { ...s, flammable: true };
      // F3: the riser's end is authored as the assembly's inlet
      // connection — supply is verified against that reference.
      if (s.id === "s1") return { ...s, protects: "v1", aimAt, inletRunId: "fw-riser", inletEnd: "end" };
      return s;
    }),
  };
  return design;
}

// D9: underground firewater main, hydrants no more than 100 ft apart
// (developed centerline stationing), directed-spray assemblies for
// designated vessels from at least 50 ft away and outside the unit
// boundary. These are Jason's stated planning rules — approximately,
// not asserted identical to, and not attributed to any specific code
// as governing, the high-hazard petroleum-industry figures (≈30 m /
// ≈15 m) — layout validation only; fire-protection effectiveness is
// never evaluated.
describe("firewater", () => {
  it("hydrant gaps of exactly 100 ft (1200 in) are acceptable; 1200.001 in is flagged, 1199.999 is not", () => {
    const ok = mainWithHydrants([0, 1200, 2400]);
    expect(Math.max(...hydrantGapsIn(ok).map((g) => g.gapIn))).toBe(HYDRANT_MAX_SPACING_IN);
    expect(firewaterErrors(ok)).toEqual([]);

    const just = mainWithHydrants([0, 1199.999, 2399.998]);
    expect(firewaterErrors(just)).toEqual([]);

    const over = mainWithHydrants([0, 1200.001, 2400]);
    const errors = firewaterErrors(over);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/hydrant gap of 100 ft between stations 0 in and 1200 in/);
  });

  it("a gap just over 100 ft names the offending main interval", () => {
    const design = mainWithHydrants([0, 1201, 2400]);
    const errors = firewaterErrors(design);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/between stations 0 in and 1201 in/);
    expect(errors[0]).toMatch(/no more than 100 ft apart along the main/);
  });

  it("zero hydrants and one hydrant cannot pass a long main (endpoint tails count)", () => {
    expect(firewaterErrors(mainWithHydrants([])).some((e) => /hydrant gap/.test(e))).toBe(true);
    const one = mainWithHydrants([600]);
    const gaps = hydrantGapsIn(one).filter((g) => g.runId === "main");
    expect(gaps.map((g) => g.gapIn)).toEqual([600, 1800]);
    expect(firewaterErrors(one).some((e) => /hydrant gap of 150 ft/.test(e))).toBe(true);
  });

  it("spacing is stationing along the main, not straight-line distance", () => {
    // U-shaped main: the two hydrants are 200 in apart as the crow
    // flies but 5000 in apart along the main.
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: -240, y: 0 }, { x: 0, y: 0 }], { id: "src", diameterIn: 12 });
    design = addPipeRun(
      design,
      [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 200 }, { x: 0, y: 200 }],
      { id: "main", diameterIn: 12 },
    );
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "src"
          ? { ...p, utility: "firewater", sourceOf: "firewater", junctions: { end: { runId: "main" } } }
          : { ...p, utility: "firewater", underground: true, elevationIn: -36 },
      ),
    };
    design = placeSymbol(design, P, "fire-hydrant", 0, 0, { id: "ha" });
    design = placeSymbol(design, P, "fire-hydrant", 0, 200, { id: "hb" });
    expect(firewaterErrors(design).some((e) => /hydrant gap/.test(e))).toBe(true);
  });

  it("a disconnected hydrant does not reduce a gap, and co-located duplicates change nothing", () => {
    const stray = mainWithHydrants([0, 2400]);
    const withStray = placeSymbol(stray, P, "fire-hydrant", 1200, 500, { id: "stray" });
    const errors = firewaterErrors(withStray);
    expect(errors.some((e) => /Fire hydrant stray is not on a firewater main/.test(e))).toBe(true);
    expect(errors.some((e) => /hydrant gap of 200 ft/.test(e))).toBe(true);

    const dup = mainWithHydrants([0, 0, 2400]);
    expect(firewaterErrors(dup).some((e) => /hydrant gap of 200 ft/.test(e))).toBe(true);
  });

  it("a hydrant offset from the main on a modeled 6-inch branch counts; unbranched, it does not", () => {
    let design = mainWithHydrants([0, 2400]);
    design = addPipeRun(design, [{ x: 1200, y: 0 }, { x: 1200, y: -72 }], {
      id: "hbr",
      diameterIn: HYDRANT_BRANCH_DIAMETER_IN,
    });
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "hbr"
          ? {
              ...p,
              utility: "firewater",
              // Buried at the main, rising to the hydrant's inlet at
              // grade — the modeled riser R6 binds the supply check
              // to. (A riser leg is not itself a buried run — the
              // sample's convention; addPipeRun does not carry
              // elevIn, so it is patched on here.)
              elevIn: [-36, 0],
              junctions: { start: { runId: "main" } },
            }
          : p,
      ),
    };
    // The 12 -> 6 tap transition gets its modeled reducer, outlet
    // facing the branch (R1: the junction edge exists only when a
    // reducer's owned interfaces bind it).
    design = placeReducer(design, 1200, 0, {
      id: "hbr-red",
      inletSizeIn: 12,
      outletSizeIn: HYDRANT_BRANCH_DIAMETER_IN,
      rotationDeg: -90,
    });
    design = placeSymbol(design, P, "fire-hydrant", 1200, -72, { id: "hoff" });
    design = {
      ...design,
      symbols: design.symbols.map((s) => (s.id === "hoff" ? { ...s, stationRunId: "main" } : s)),
    };
    expect(HYDRANT_BRANCH_DIAMETER_IN).toBe(6);
    expect(firewaterErrors(design)).toEqual([]);

    // Cut the branch's junction and the hydrant is just a nearby
    // symbol again: off-main finding returns and the gap reopens.
    const cut = {
      ...design,
      pipes: design.pipes.map((p) => {
        if (p.id !== "hbr") return p;
        const { junctions, ...rest } = p;
        return rest;
      }),
    };
    const errors = firewaterErrors(cut);
    expect(errors.some((e) => /Fire hydrant hoff is not on a firewater main/.test(e))).toBe(true);
    expect(errors.some((e) => /hydrant gap of 200 ft/.test(e))).toBe(true);
  });

  it("an underground main needs an authored burial profile; above-grade vertices need a modeled riser", () => {
    let design = mainWithHydrants([0, 1200, 2400]);
    const noProfile = {
      ...design,
      pipes: design.pipes.map((p) => {
        if (p.id !== "main") return p;
        const { elevationIn, ...rest } = p;
        return rest;
      }),
    };
    expect(firewaterErrors(noProfile).some((e) => /no authored burial elevation/.test(e))).toBe(true);

    const surfaced = {
      ...design,
      pipes: design.pipes.map((p) => (p.id === "main" ? { ...p, elevationIn: 30 } : p)),
    };
    expect(firewaterErrors(surfaced).some((e) => /breaks the surface/.test(e))).toBe(true);

    const riserUnmodeled = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "main" ? { ...p, elevIn: [-36, 24], elevationIn: undefined } : p,
      ),
    };
    expect(firewaterErrors(riserUnmodeled).some((e) => /without a modeled riser/.test(e))).toBe(true);
    const riserModeled = {
      ...riserUnmodeled,
      pipes: riserUnmodeled.pipes.map((p) =>
        p.id === "main" ? { ...p, aboveGradeTransitions: [1] } : p,
      ),
    };
    expect(firewaterErrors(riserModeled).some((e) => /without a modeled riser/.test(e))).toBe(false);
  });

  it("the network needs a designated source, and mains must be connected to it", () => {
    const design = mainWithHydrants([0, 1200, 2400]);
    const noSource = {
      ...design,
      pipes: design.pipes.map((p) => {
        const { sourceOf, ...rest } = p;
        return rest;
      }),
    };
    expect(firewaterErrors(noSource)).toContain(
      "The firewater network has no designated source / boundary inlet.",
    );
    const cutClean = {
      ...design,
      pipes: design.pipes.map((p) => {
        if (p.id !== "src") return p;
        const { junctions, ...rest } = p;
        return rest;
      }),
    };
    expect(firewaterErrors(cutClean).some((e) => /no connected path to the firewater source/.test(e))).toBe(true);
  });

  it("a buried main crossing another buried line jogs DOWN — the underpass stays in the burial envelope", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "proc", diameterIn: 4, elevationIn: -40 });
    design = addPipeRun(design, [{ x: 500, y: 100 }, { x: 500, y: 900 }], { id: "fw", diameterIn: 12, elevationIn: -36 });
    design = {
      ...design,
      pipes: design.pipes.map((p) => (p.id === "fw" ? { ...p, utility: "firewater", underground: true } : p)),
    };
    const after = applyCrossingJogs(design, "fw");
    const fw = after.pipes.find((p) => p.id === "fw");
    expect(Math.max(...fw.elevIn.filter((v) => v !== null))).toBeLessThan(0);
    expect(findPipeCrossings(after).filter((c) => !c.resolved)).toEqual([]);
  });

  it("a flammable vessel with no spray assignment is flagged; a plain vessel is not", () => {
    let design = placeSymbol(createEmptyDesign(), E, "vertical-vessel", 1000, 1000, { id: "v1" });
    design = { ...design, symbols: design.symbols.map((s) => ({ ...s, flammable: true })) };
    const errors = firewaterErrors(design);
    expect(errors).toContainEqual(expect.stringMatching(/no assigned fixed directed-spray assembly/));
    const plain = placeSymbol(createEmptyDesign(), E, "vertical-vessel", 1000, 1000, { id: "v1" });
    expect(firewaterErrors(plain)).toEqual([]);
  });

  it("UNKNOWN flammability requires an assignment too — unknown is not low risk", () => {
    let design = placeSymbol(createEmptyDesign(), E, "vertical-vessel", 1000, 1000, { id: "v1" });
    design = { ...design, symbols: design.symbols.map((s) => ({ ...s, flammable: "unknown" })) };
    expect(firewaterErrors(design)).toContainEqual(
      expect.stringMatching(/UNKNOWN flammability and no assigned fixed directed-spray assembly/),
    );
    const states = vesselSprayStates(design);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ flammability: "unknown", state: "missing-or-invalid", effectiveness: "NOT_EVALUATED" });
  });

  it("spray standoff: exactly 50 ft from the footprint edge is acceptable; 1 in closer is flagged", () => {
    // Vertical vessel footprint is 48 in across -> radius 24 in from
    // its center at (1000, 1000); standoff measures from the edge.
    const ok = sprayDesign({ x: 1000 + 24 + SPRAY_MIN_STANDOFF_IN, y: 1000 });
    expect(firewaterErrors(ok)).toEqual([]);
    const close = sprayDesign({ x: 1000 + 24 + SPRAY_MIN_STANDOFF_IN - 1, y: 1000 });
    const errors = firewaterErrors(close);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/under the 600 in minimum/);
  });

  it("a spray inside the unit boundary — or ON its edge — does not qualify as outside", () => {
    let design = sprayDesign({ x: 1000, y: 300 });
    design = {
      ...design,
      unitBoundary: [
        { x: 500, y: 100 },
        { x: 1500, y: 100 },
        { x: 1500, y: 1500 },
        { x: 500, y: 1500 },
      ],
    };
    const errors = firewaterErrors(design);
    expect(errors.some((e) => /sits inside the unit boundary/.test(e))).toBe(true);
    expect(errors.some((e) => /standoff/.test(e))).toBe(false);

    const onEdge = sprayDesign({ x: 1000, y: 800 }); // exactly on the boundary's south edge
    expect(firewaterErrors(onEdge).some((e) => /on the unit boundary/.test(e))).toBe(true);
  });

  it("a missing unit boundary is an unresolved finding, never an assumed outside", () => {
    let design = sprayDesign({ x: 1700, y: 1000 });
    const { unitBoundary, ...rest } = design;
    void unitBoundary;
    const errors = firewaterErrors(rest);
    expect(errors.some((e) => /unit boundary is missing or ambiguous/.test(e))).toBe(true);
  });

  it("aim must be recorded and must land on the assigned vessel (reversed aim fails)", () => {
    const noAim = sprayDesign({ x: 1700, y: 1000 }, null);
    const noAimClean = {
      ...noAim,
      symbols: noAim.symbols.map((s) => (s.id === "s1" ? { ...s, aimAt: undefined } : s)),
    };
    expect(firewaterErrors(noAimClean).some((e) => /no aimed target point/.test(e))).toBe(true);

    const reversed = sprayDesign({ x: 1700, y: 1000 }, { x: 2400, y: 1000 });
    expect(firewaterErrors(reversed).some((e) => /aim point does not land on the assigned vessel/.test(e))).toBe(true);

    const status = sprayAssignmentStatus(sprayDesign({ x: 1700, y: 1000 }), { id: "s1", protects: "v1", x: 1700, y: 1000, aimAt: { x: 1000, y: 1000 } });
    expect(status.ok).toBe(true);
    expect(status.effectiveness).toBe("NOT_EVALUATED");
  });

  it("a spray with no assigned vessel is flagged", () => {
    const design = placeSymbol(createEmptyDesign(), P, "spray-nozzle", 2000, 2000, { id: "s1" });
    const errors = firewaterErrors(design);
    expect(errors).toContainEqual(expect.stringMatching(/has no assigned vessel/));
  });

  it("firewater red is the reserved color constant", () => {
    expect(FIREWATER_COLOR).toBe("#dc2626");
  });
});

// Red reservation audit: red is reserved to firewater at the final
// resolved color boundary. Scan every color a pipe can render with in
// the shipped sample and prove only firewater is red (HSL hue in the
// red band with real saturation). Equipment fills are not piping.
describe("red reservation", () => {
  const isReservedRed = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return false;
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
    return (h >= 345 || h <= 12) && s >= 0.45 && l >= 0.2 && l <= 0.7;
  };

  it("the audit helper itself classifies known colors correctly", () => {
    expect(isReservedRed("#dc2626")).toBe(true); // firewater red
    expect(isReservedRed("#ef4444")).toBe(true); // the old relief red — must not survive on piping
    expect(isReservedRed("#b45309")).toBe(false); // amber-brown (new relief color)
    expect(isReservedRed("#db2777")).toBe(false); // pink/magenta (nitrogen)
    expect(isReservedRed("#7dd3fc")).toBe(false); // default pipe blue
  });

  // Builds the full FCCU sample (~4-6 s of CPU): the 5 s default
  // timeout tips over under full-suite parallel load with no
  // assertion failing, so this test carries an explicit timeout.
  it("no piping color in the FCCU sample is red except firewater", async () => {
    const { buildFccuPlotPlan } = await import("./fccuPlotPlanSample");
    const { effectiveColor } = await import("./designSystems");
    const project = buildFccuPlotPlan();
    const design = project.levels[0].design;
    for (const run of design.pipes) {
      const color = run.utility === "firewater" ? FIREWATER_COLOR : effectiveColor(design, run, "#7dd3fc");
      if (run.utility === "firewater") {
        expect(color).toBe(FIREWATER_COLOR);
      } else {
        expect(isReservedRed(color), `${run.id} renders ${color}`).toBe(false);
      }
    }
    expect(design.pipes.some((p) => p.utility === "firewater")).toBe(true);
  }, 30000);
});
