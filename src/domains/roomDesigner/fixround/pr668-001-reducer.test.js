// PR668-001 probe — mixed-size pipe-to-pipe connections accepted without a
// modeled reducer. Exact shapes from the ChatGPT finding:
//   - D8: 1-in branch junctioned onto a 2-in header validates as an ordinary
//     flanged tee (no size check at pipe-to-pipe junctions).
//   - A reducer symbol floating NEARBY (within 6 in) but not connected to
//     the junction waives the equipment-attachment size check via proximity.
//
// These probes FAIL against the current implementation (no error reported)
// and must PASS after the fix (named size/reducer findings; only a CONNECTED
// reducer with matching declared inlet/outlet sizes authorizes a mismatch).

import { describe, expect, it } from "vitest";
import { addPipeRun, createEmptyDesign, placeSymbol } from "../designerDocument";
import { connectionCompatibilityErrors } from "../pipeAttachments";

// 2-in header at elevation 150 with a 1-in branch teed mid-span at the same
// elevation — the exact D8 branch->header shape from the FCCU fixture.
function mixedJunctionDesign() {
  let design = createEmptyDesign();
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], {
    id: "header",
    diameterIn: 2,
    elevationIn: 150,
  });
  design = addPipeRun(design, [{ x: 50, y: 0 }, { x: 50, y: 60 }], {
    id: "branch",
    diameterIn: 1,
    elevationIn: 150,
  });
  const branch = design.pipes.find((p) => p.id === "branch");
  const pipes = design.pipes.map((p) =>
    p.id === "branch" ? { ...branch, junctions: { start: { runId: "header" } } } : p,
  );
  return { ...design, pipes };
}

describe("PR668-001 mixed-size connections require a modeled reducer", () => {
  it("flags a 1-in branch junctioned onto a 2-in header (pipe-to-pipe size check)", () => {
    const errors = connectionCompatibilityErrors(mixedJunctionDesign());
    expect(errors.some((e) => /reducer|size/i.test(e))).toBe(true);
  });

  it("a nearby but UNCONNECTED reducer does not authorize the mismatch", () => {
    let design = mixedJunctionDesign();
    // Reducer 5 in from the tap point: inside the old 6-in proximity
    // waiver, but not part of the connection topology.
    design = placeSymbol(design, "piping", "reducer", 50, 5, { id: "red-nearby" });
    const errors = connectionCompatibilityErrors(design);
    expect(errors.some((e) => /reducer|size/i.test(e))).toBe(true);
  });

  it("a CONNECTED reducer with matching declared sizes authorizes the transition", async () => {
    const { placeReducer } = await import("../pipeReducerModel");
    let design = mixedJunctionDesign();
    design = placeReducer(design, 50, 0, {
      id: "red-tap",
      inletSizeIn: 2,
      outletSizeIn: 1,
      rotationDeg: 90,
    });
    expect(connectionCompatibilityErrors(design)).toEqual([]);
  });

  it("a connected reducer with the WRONG declared sizes does not authorize", async () => {
    const { placeReducer } = await import("../pipeReducerModel");
    let design = mixedJunctionDesign();
    design = placeReducer(design, 50, 0, {
      id: "red-wrong",
      inletSizeIn: 2,
      outletSizeIn: 2,
      rotationDeg: 90,
    });
    const errors = connectionCompatibilityErrors(design);
    expect(errors.some((e) => /reducer|size/i.test(e))).toBe(true);
  });

  it("same-size junctions still validate as ordinary flanged tees", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], {
      id: "header",
      diameterIn: 2,
      elevationIn: 150,
    });
    design = addPipeRun(design, [{ x: 50, y: 0 }, { x: 50, y: 60 }], {
      id: "branch",
      diameterIn: 2,
      elevationIn: 150,
    });
    const pipes = design.pipes.map((p) =>
      p.id === "branch" ? { ...p, junctions: { start: { runId: "header" } } } : p,
    );
    expect(connectionCompatibilityErrors({ ...design, pipes })).toEqual([]);
  });
});
