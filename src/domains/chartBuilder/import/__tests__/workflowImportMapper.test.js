import { describe, expect, it } from "vitest";
import { ImportError } from "../chartImportTypes.js";
import { mapWorkflowRows } from "../workflowImportMapper.js";

const HEADERS = ["Step", "Next Step", "Decision", "Description", "Owner"];

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
  { headerIndex: 3, target: "description" },
  { headerIndex: 4, target: "owner" },
];

describe("mapWorkflowRows", () => {
  it("maps rows to step nodes with description and owner", () => {
    const out = mapWorkflowRows(
      table([
        [2, "  Intake  ", "Review", "", "Receive the request", "  Pam  "],
        [3, "Review", "", "", "", ""],
      ]),
      MAPPING
    );
    expect(out.nodes).toHaveLength(2);
    const node = out.nodes[0];
    expect(node.id).toBe("import-row-2");
    expect(node.label).toBe("Intake");
    expect(node.subtitle).toBe("Receive the request");
    expect(node.fields).toEqual({
      description: "Receive the request",
      owner: "Pam",
    });
    expect(out.edges).toHaveLength(1);
    expect(out.rowIssues).toEqual([]);
  });

  it("creates an edge per next-step reference, splitting comma/semicolon lists", () => {
    const out = mapWorkflowRows(
      table([
        [2, "Start", "Review, Approve; Notify", "", "", ""],
        [3, "Review", "", "", "", ""],
        [4, "Approve", "", "", "", ""],
        [5, "Notify", "", "", "", ""],
      ]),
      MAPPING
    );
    expect(out.edges).toHaveLength(3);
    expect(out.edges.map((e) => e.to).sort()).toEqual([
      "import-row-3",
      "import-row-4",
      "import-row-5",
    ]);
    expect(out.edges[0].from).toBe("import-row-2");
    expect(out.edges[0].type).toBe("sequence");
  });

  it("carries the decision on the edge label and types yes/no edges", () => {
    const out = mapWorkflowRows(
      table([
        [2, "Review", "Approve", "Yes", "", ""],
        [3, "Approve", "Done", "no", "", ""],
        [4, "Done", "", "", "", ""],
        [5, "Ship", "Done", "when ready", "", ""],
      ]),
      MAPPING
    );
    const yesEdge = out.edges.find((e) => e.to === "import-row-3");
    expect(yesEdge.label).toBe("Yes");
    expect(yesEdge.type).toBe("decision-yes");
    const noEdge = out.edges.find((e) => e.to === "import-row-4");
    expect(noEdge.label).toBe("no");
    expect(noEdge.type).toBe("decision-no");
    const plainEdge = out.edges.find((e) => e.from === "import-row-5");
    expect(plainEdge.label).toBe("when ready");
    expect(plainEdge.type).toBe("sequence");
  });

  it("leaves missing next-step references as explicit errors with no edge", () => {
    const out = mapWorkflowRows(
      table([[2, "Start", "Nowhere", "", "", ""]]),
      MAPPING
    );
    expect(out.edges).toHaveLength(0);
    expect(out.rowIssues).toHaveLength(1);
    expect(out.rowIssues[0].severity).toBe("error");
    expect(out.rowIssues[0].message).toContain("Nowhere");
    expect(out.rowIssues[0].rowNumber).toBe(2);
  });

  it("rejects ambiguous next-step references without guessing", () => {
    const out = mapWorkflowRows(
      table([
        [2, "Start", "Review", "", "", ""],
        [3, "Review", "", "", "", ""],
        [4, "review", "", "", "", ""],
      ]),
      MAPPING
    );
    expect(out.edges).toHaveLength(0);
    expect(out.rowIssues).toHaveLength(1);
    expect(out.rowIssues[0].severity).toBe("error");
    expect(out.rowIssues[0].message).toContain("2 steps");
  });

  it("surfaces self-references as warnings, not errors, with no edge", () => {
    const out = mapWorkflowRows(
      table([
        [2, "Start", "Review", "", "", ""],
        [3, "Review", "Review", "", "", ""],
      ]),
      MAPPING
    );
    // The chart model cannot draw self-loop edges (createEdge forbids
    // from === to): surfaced, not silently dropped, and not an error.
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].to).toBe("import-row-3");
    expect(out.rowIssues).toHaveLength(1);
    expect(out.rowIssues[0].severity).toBe("warning");
    expect(out.rowIssues[0].message).toContain("itself");
  });

  it("accepts cycles: A→B / B→A creates both edges", () => {
    const out = mapWorkflowRows(
      table([
        [2, "A", "B", "", "", ""],
        [3, "B", "A", "", "", ""],
      ]),
      MAPPING
    );
    expect(out.edges).toHaveLength(2);
    expect(out.rowIssues).toEqual([]);
  });

  it("matches step names case-insensitively", () => {
    const out = mapWorkflowRows(
      table([
        [2, "Start", "REVIEW", "", "", ""],
        [3, "Review", "", "", "", ""],
      ]),
      MAPPING
    );
    expect(out.edges).toHaveLength(1);
    expect(out.rowIssues).toEqual([]);
  });

  it("leaves blank next-step cells as end steps with no edges", () => {
    const out = mapWorkflowRows(table([[2, "Start", "", "", "", ""]]), MAPPING);
    expect(out.edges).toHaveLength(0);
    expect(out.rowIssues).toEqual([]);
    expect(out.nodeSources["import-row-2"].detail).toContain("End step");
  });

  it("reports blank step cells as errors", () => {
    const out = mapWorkflowRows(table([[2, "", "Review", "", "", ""]]), MAPPING);
    expect(out.nodes).toHaveLength(0);
    expect(out.rowIssues).toHaveLength(1);
    expect(out.rowIssues[0].severity).toBe("error");
    expect(out.rowIssues[0].message).toContain("blank");
  });

  it("never merges duplicate step names", () => {
    const out = mapWorkflowRows(
      table([
        [2, "Review", "", "", "", ""],
        [3, "Review", "", "", "", ""],
      ]),
      MAPPING
    );
    expect(out.nodes).toHaveLength(2);
    expect(out.nodes[0].id).toBe("import-row-2");
    expect(out.nodes[1].id).toBe("import-row-3");
  });

  it("throws when step or nextStep mappings are missing", () => {
    const rows = table([[2, "Start", "End", "", "", ""]]);
    expect(() => mapWorkflowRows(rows, [])).toThrow(ImportError);
    expect(() =>
      mapWorkflowRows(rows, [{ headerIndex: 0, target: "step" }])
    ).toThrow(ImportError);
  });

  it("throws on an invalid table", () => {
    expect(() => mapWorkflowRows(null, MAPPING)).toThrow(ImportError);
    expect(() => mapWorkflowRows({ rows: null }, MAPPING)).toThrow(ImportError);
  });
});
