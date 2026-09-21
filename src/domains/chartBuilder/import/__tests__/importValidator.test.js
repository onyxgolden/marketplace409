import { describe, expect, it } from "vitest";
import { createChartDocument } from "../../chartDocument.js";
import { validateDraftDocument } from "../importValidator.js";

function doc(type, nodes, edges = []) {
  return createChartDocument({
    id: `doc-${Math.random().toString(36).slice(2)}`,
    type,
    nodes: nodes.map(([id, label]) => ({ id, label })),
    edges: edges.map(([id, from, to, edgeType]) => ({
      id,
      from,
      to,
      type: edgeType ?? (type === "org" ? "supervisor" : "sequence"),
    })),
  });
}

describe("validateDraftDocument", () => {
  it("surfaces an org supervisor cycle as an error", () => {
    const result = validateDraftDocument(
      doc("org", [["a", "A"], ["b", "B"]], [["e1", "a", "b"], ["e2", "b", "a"]])
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === "error" && /cycle/i.test(i.message))).toBe(
      true
    );
  });

  it("accepts an org forest of three roots with warnings only", () => {
    const result = validateDraftDocument(
      doc("org", [["a", "A"], ["b", "B"], ["c", "C"]])
    );
    expect(result.valid).toBe(true);
    expect(result.issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("flags duplicate org labels as errors", () => {
    const result = validateDraftDocument(doc("org", [["a", "Sam"], ["b", "Sam"]]));
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.severity === "error" && /duplicate label/i.test(i.message))
    ).toBe(true);
  });

  it("rejects a non-chart document explicitly", () => {
    const result = validateDraftDocument({ type: "mystery" });
    expect(result.valid).toBe(false);
    expect(result.issues[0].severity).toBe("error");
  });

  it("reports validator nodeIds so the preview can trace rows", () => {
    const result = validateDraftDocument(doc("org", [["a", "Sam"], ["b", "Sam"]]));
    const labelIssues = result.issues.filter((i) => /duplicate label/i.test(i.message));
    expect(labelIssues.length).toBeGreaterThan(0);
    expect(labelIssues.every((i) => i.nodeId !== null)).toBe(true);
    expect(labelIssues.every((i) => i.rowNumber === null)).toBe(true);
  });

  it("requires a workflow start node", () => {
    const result = validateDraftDocument(
      doc("workflow", [["a", "A"], ["b", "B"]], [["e1", "a", "b", "sequence"], ["e2", "b", "a", "sequence"]])
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /start node/i.test(i.message))).toBe(true);
  });
});
