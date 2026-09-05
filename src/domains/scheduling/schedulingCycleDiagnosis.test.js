import { describe, expect, it } from "vitest";
import { traceCycle, suggestCycleBreak, diagnoseCycles } from "./schedulingCycleDiagnosis";

function block(id) {
  return { id, task_code: id, block_type: "task" };
}
function dependency(id, predecessorId, successorId, overrides = {}) {
  return { id, predecessor_id: predecessorId, successor_id: successorId, relationship_type: "FS", lag_days: 0, ...overrides };
}

describe("schedulingCycleDiagnosis — traceCycle", () => {
  it("returns no cycles for an acyclic graph", () => {
    const blocks = [block("A"), block("B")];
    const dependencies = [dependency("d1", "A", "B")];
    expect(traceCycle({ blocks, dependencies })).toEqual([]);
  });

  it("traces a simple 3-node loop as a readable task-code path plus its edges", () => {
    const blocks = [block("A"), block("B"), block("C")];
    const dependencies = [dependency("d1", "A", "B"), dependency("d2", "B", "C"), dependency("d3", "C", "A")];
    const cycles = traceCycle({ blocks, dependencies });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].taskCodes).toEqual(["A", "B", "C", "A"]);
    expect(cycles[0].edges.map((edge) => edge.id)).toEqual(["d1", "d2", "d3"]);
  });

  it("excludes a block merely downstream of the cycle (not itself looping) from the traced path", () => {
    // A <-> B is the loop; D depends on B but nothing depends back on D -- D is in cyclicBlockIds
    // (per topologicalOrder's own definition: it never reaches in-degree 0, blocked by the cycle)
    // but must never appear IN a reported cycle path.
    const blocks = [block("A"), block("B"), block("D")];
    const dependencies = [dependency("d1", "A", "B"), dependency("d2", "B", "A"), dependency("d3", "B", "D")];
    const cycles = traceCycle({ blocks, dependencies });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].taskCodes).toEqual(["A", "B", "A"]);
    expect(cycles[0].taskCodes).not.toContain("D");
  });

  it("traces two independent loops separately, not merged into one report", () => {
    const blocks = [block("A"), block("B"), block("X"), block("Y")];
    const dependencies = [
      dependency("d1", "A", "B"), dependency("d2", "B", "A"),
      dependency("d3", "X", "Y"), dependency("d4", "Y", "X"),
    ];
    const cycles = traceCycle({ blocks, dependencies });
    expect(cycles).toHaveLength(2);
    expect(cycles.map((cycle) => cycle.taskCodes)).toEqual(expect.arrayContaining([["A", "B", "A"], ["X", "Y", "X"]]));
  });
});

describe("schedulingCycleDiagnosis — suggestCycleBreak", () => {
  it("prefers a non-FS relationship as the likely mistake", () => {
    const blocks = [block("A"), block("B"), block("C")];
    const dependencies = [dependency("d1", "A", "B"), dependency("d2", "B", "C", { relationship_type: "SS" }), dependency("d3", "C", "A")];
    const suggestion = suggestCycleBreak(traceCycle({ blocks, dependencies })[0]);
    expect(suggestion.dependency.id).toBe("d2");
    expect(suggestion.reason).toContain("SS");
  });

  it("prefers a lead (negative lag) over a plain FS link with no lag", () => {
    const blocks = [block("A"), block("B"), block("C")];
    const dependencies = [dependency("d1", "A", "B", { lag_days: -2 }), dependency("d2", "B", "C"), dependency("d3", "C", "A")];
    const suggestion = suggestCycleBreak(traceCycle({ blocks, dependencies })[0]);
    expect(suggestion.dependency.id).toBe("d1");
    expect(suggestion.reason).toContain("lead");
  });

  it("prefers a non-FS link over a lead when both are present -- relationship type outranks lag", () => {
    const blocks = [block("A"), block("B"), block("C")];
    const dependencies = [dependency("d1", "A", "B", { lag_days: -2 }), dependency("d2", "B", "C", { relationship_type: "FF" }), dependency("d3", "C", "A")];
    const suggestion = suggestCycleBreak(traceCycle({ blocks, dependencies })[0]);
    expect(suggestion.dependency.id).toBe("d2");
  });

  it("falls back to the most recently created link when nothing structurally stands out", () => {
    const blocks = [block("A"), block("B"), block("C")];
    const dependencies = [
      dependency("d1", "A", "B", { created_at: "2026-01-01T00:00:00.000Z" }),
      dependency("d2", "B", "C", { created_at: "2026-01-03T00:00:00.000Z" }),
      dependency("d3", "C", "A", { created_at: "2026-01-02T00:00:00.000Z" }),
    ];
    const suggestion = suggestCycleBreak(traceCycle({ blocks, dependencies })[0]);
    expect(suggestion.dependency.id).toBe("d2"); // most recent created_at.
    expect(suggestion.reason).toContain("most recently added");
  });

  it("falls back to a deterministic id tie-break when nothing distinguishes the edges at all", () => {
    const blocks = [block("A"), block("B"), block("C")];
    const dependencies = [dependency("d3", "A", "B"), dependency("d1", "B", "C"), dependency("d2", "C", "A")];
    const suggestion = suggestCycleBreak(traceCycle({ blocks, dependencies })[0]);
    expect(suggestion.dependency.id).toBe("d1"); // lowest id, sorted.
  });

  it("returns null for an empty/no-edge input rather than throwing", () => {
    expect(suggestCycleBreak(null)).toBeNull();
    expect(suggestCycleBreak({ edges: [] })).toBeNull();
  });
});

describe("schedulingCycleDiagnosis — diagnoseCycles", () => {
  it("combines the trace and a suggestion for every cycle found", () => {
    const blocks = [block("A"), block("B")];
    const dependencies = [dependency("d1", "A", "B"), dependency("d2", "B", "A", { relationship_type: "SS" })];
    const diagnoses = diagnoseCycles({ blocks, dependencies });
    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0].taskCodes).toEqual(["A", "B", "A"]);
    expect(diagnoses[0].suggestion.dependency.id).toBe("d2");
  });

  it("returns an empty array for an acyclic graph", () => {
    expect(diagnoseCycles({ blocks: [block("A")], dependencies: [] })).toEqual([]);
  });
});
