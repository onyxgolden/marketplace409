// D668-003 probe — collision validation misses endpoint, parallel,
// riser, and vessel penetrations. All of these return NO errors today:
//   - an unmodeled endpoint-T contact,
//   - two parallel 2-in runs 1 in apart,
//   - a horizontal run at elevation 50 crossing a vertical riser spanning 0-100,
//   - a run through a vessel footprint where a stale top-out attachment
//     exempts the WHOLE run.
//
// These probes FAIL against the current implementation and must PASS after
// the fix: validate actual pipe/riser envelopes with outside-radius
// clearance plus LOCALIZED, verified connection exemptions (never exempt a
// whole run/body because an attachment names it).

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { pipeCrossingErrors } from "../pipeCrossings";

beforeEach(() => {
  resetDesignerIds();
});

describe("D668-003 collision validation: envelopes, not exemptions", () => {
  it("flags an unmodeled endpoint-T contact", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], {
      id: "host",
      diameterIn: 2,
      elevationIn: 30,
    });
    // Branch end lands mid-span on the host with NO junction record.
    design = addPipeRun(design, [{ x: 500, y: 500 }, { x: 500, y: 800 }], {
      id: "branch",
      diameterIn: 2,
      elevationIn: 30,
    });
    const errors = pipeCrossingErrors(design);
    expect(errors.some((e) => /unmodeled|contact/i.test(e))).toBe(true);
  });

  it("flags two parallel 2-in runs 1 in apart at the same elevation", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 30,
    });
    design = addPipeRun(design, [{ x: 100, y: 501 }, { x: 900, y: 501 }], {
      id: "p2",
      diameterIn: 2,
      elevationIn: 30,
    });
    const errors = pipeCrossingErrors(design);
    expect(errors.some((e) => /p1.*p2|p2.*p1|parallel|clearance/i.test(e))).toBe(true);
  });

  it("parallel runs separated vertically are fine (positive partner)", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 30,
    });
    design = addPipeRun(design, [{ x: 100, y: 501 }, { x: 900, y: 501 }], {
      id: "p2",
      diameterIn: 2,
      elevationIn: 90,
    });
    expect(pipeCrossingErrors(design)).toEqual([]);
  });

  it("flags a horizontal run crossing a vertical riser within its span", () => {
    let design = createEmptyDesign();
    // Riser at x=500: zero plan length, elevation 0 -> 100. Authored
    // directly (addPipeRun collapses duplicate consecutive points).
    const riserRun = {
      id: "riser",
      points: [{ x: 500, y: 500 }, { x: 500, y: 500 }, { x: 500, y: 700 }],
      elevIn: [0, 100, 100],
      diameterIn: 2,
    };
    design = { ...design, pipes: [...(design.pipes || []), riserRun] };
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], {
      id: "cross",
      diameterIn: 2,
      elevationIn: 50,
    });
    const errors = pipeCrossingErrors(design);
    expect(errors.some((e) => /riser|cross/i.test(e))).toBe(true);
  });

  it("a stale top-out attachment does not exempt a run through the vessel", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 500, 500, {
      id: "v-1",
      tag: "V-101",
    });
    // Run passes straight through the vessel footprint at grade
    // elevation; its end attachment names the vessel's top nozzle but
    // the run body still penetrates the shell.
    let runDesign = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], {
      id: "through",
      diameterIn: 2,
      elevationIn: 30,
    });
    const pipes = runDesign.pipes.map((p) =>
      p.id === "through"
        ? { ...p, attachments: { end: { symbolId: "v-1", anchorId: "top-out" } } }
        : p,
    );
    runDesign = { ...runDesign, pipes };
    const errors = pipeCrossingErrors(runDesign);
    expect(errors.some((e) => /through.*V-101|passes through/i.test(e))).toBe(true);
  });

  it("a run that genuinely ENDS at its attached nozzle is not a penetration", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 500, 500, {
      id: "v-1",
      tag: "V-101",
    });
    // side-out nozzle sits at the east edge (fx=1 -> x=524); the run
    // ends there, outside the footprint.
    let runDesign = addPipeRun(design, [{ x: 900, y: 500 }, { x: 524, y: 500 }], {
      id: "to-nozzle",
      diameterIn: 8,
      elevationIn: 74,
    });
    const pipes = runDesign.pipes.map((p) =>
      p.id === "to-nozzle"
        ? { ...p, attachments: { end: { symbolId: "v-1", anchorId: "side-out" } } }
        : p,
    );
    runDesign = { ...runDesign, pipes };
    const errors = pipeCrossingErrors(runDesign).filter((e) => /passes through/i.test(e));
    expect(errors).toEqual([]);
  });
});
