import { describe, expect, it } from "vitest";
import { ImportError } from "../chartImportTypes.js";
import {
  runWorkflowImportPipeline,
  commitWorkflowImport,
} from "../importPipeline.js";

const HEADERS = ["Step", "Next Step", "Decision"];

function table(rows) {
  return {
    source: "csv",
    sheetName: "Sheet1",
    headers: HEADERS,
    rows: rows.map(([rowNumber, ...values]) => ({ rowNumber, values })),
    skippedBlankRows: 0,
  };
}

const MAPPING = [
  { headerIndex: 0, target: "step" },
  { headerIndex: 1, target: "nextStep" },
  { headerIndex: 2, target: "decision" },
];

describe("runWorkflowImportPipeline / commitWorkflowImport", () => {
  it("commits a valid workflow with a cycle when a start node exists", () => {
    // Start→A, A→B, B→A: a cycle embedded in a graph that still has a
    // start node (Start) is valid — cycles are allowed in workflows.
    const result = runWorkflowImportPipeline(
      table([
        [2, "Start", "A", ""],
        [3, "A", "B", ""],
        [4, "B", "A", ""],
      ]),
      MAPPING
    );
    expect(result.validation.valid).toBe(true);
    expect(result.preview.errorCount).toBe(0);
    expect(result.preview.nodeCount).toBe(3);
    expect(result.preview.edgeCount).toBe(3);
    const doc = commitWorkflowImport(result);
    expect(doc.type).toBe("workflow");
    expect(doc.nodes).toHaveLength(3);
    expect(doc.edges).toHaveLength(3);
    // Layout positions were stamped at commit, like the page's auto-layout.
    for (const node of doc.nodes) {
      expect(node.position).toBeTruthy();
      expect(typeof node.position.x).toBe("number");
    }
  });

  it("blocks commit when the workflow has no start node", () => {
    // An isolated 2-cycle has every node with an incoming edge: no start
    // node, which the canonical workflow validator reports as an error.
    const result = runWorkflowImportPipeline(
      table([
        [2, "A", "B", ""],
        [3, "B", "A", ""],
      ]),
      MAPPING
    );
    expect(result.validation.valid).toBe(false);
    expect(
      result.validation.issues.some((i) => i.message.includes("start node"))
    ).toBe(true);
    expect(() => commitWorkflowImport(result)).toThrow(ImportError);
  });

  it("blocks commit on invalid next-step references", () => {
    const result = runWorkflowImportPipeline(
      table([[2, "Start", "Nowhere", ""]]),
      MAPPING
    );
    expect(result.preview.errorCount).toBeGreaterThan(0);
    expect(result.preview.issues[0].message).toContain("Nowhere");
    expect(result.preview.issues[0].rowNumber).toBe(2);
    expect(() => commitWorkflowImport(result)).toThrow(ImportError);
  });

  it("allows commit with only disconnected-node warnings", () => {
    const result = runWorkflowImportPipeline(
      table([
        [2, "Start", "Finish", ""],
        [3, "Finish", "", ""],
        [4, "Lonely", "", ""],
      ]),
      MAPPING
    );
    expect(result.preview.errorCount).toBe(0);
    expect(result.preview.warningCount).toBeGreaterThan(0);
    expect(
      result.preview.issues.some(
        (i) => i.severity === "warning" && i.message.includes("disconnected")
      )
    ).toBe(true);
    const doc = commitWorkflowImport(result);
    expect(doc.nodes).toHaveLength(3);
  });

  it("passes decision text through as the edge label", () => {
    const result = runWorkflowImportPipeline(
      table([
        [2, "Review", "Ship", "Yes"],
        [3, "Ship", "", ""],
      ]),
      MAPPING
    );
    const doc = commitWorkflowImport(result);
    expect(doc.edges).toHaveLength(1);
    expect(doc.edges[0].label).toBe("Yes");
    expect(doc.edges[0].type).toBe("decision-yes");
  });

  it("regenerates the preview from scratch when the mapping changes", () => {
    const rows = table([
      [2, "Start", "Finish", ""],
      [3, "Finish", "", ""],
    ]);
    const withDecision = runWorkflowImportPipeline(rows, MAPPING);
    const withoutDecision = runWorkflowImportPipeline(rows, [
      { headerIndex: 0, target: "step" },
      { headerIndex: 1, target: "nextStep" },
    ]);
    // The second run did not inherit the first run's decision labels.
    expect(withoutDecision.draft.edges[0].label).toBe("");
    expect(withoutDecision.preview.nodeCount).toBe(
      withDecision.preview.nodeCount
    );
  });

  it("throws before preview when step or nextStep mappings are missing", () => {
    const rows = table([[2, "Start", "Finish", ""]]);
    expect(() => runWorkflowImportPipeline(rows, [])).toThrow(ImportError);
    expect(() =>
      runWorkflowImportPipeline(rows, [{ headerIndex: 0, target: "step" }])
    ).toThrow(ImportError);
  });

  it("throws on commit with no pipeline result", () => {
    expect(() => commitWorkflowImport(null)).toThrow(ImportError);
  });
});
