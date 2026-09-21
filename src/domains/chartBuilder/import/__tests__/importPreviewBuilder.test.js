import { describe, expect, it } from "vitest";
import { buildImportPreview } from "../importPreviewBuilder.js";

const SOURCES = {
  "import-row-2": { rowNumber: 2, name: "Bob Jones", supervisor: null },
  "import-row-3": { rowNumber: 3, name: "Jane Smith", supervisor: "Bob Jones" },
};

describe("buildImportPreview", () => {
  it("counts nodes, edges, warnings, and errors", () => {
    const preview = buildImportPreview({
      nodeSources: SOURCES,
      edges: [{ id: "e" }],
      mapperIssues: [],
      validationIssues: [
        { severity: "warning", message: "orphan", rowNumber: null, header: null, nodeId: "import-row-2" },
      ],
    });
    expect(preview.nodeCount).toBe(2);
    expect(preview.edgeCount).toBe(1);
    expect(preview.warningCount).toBe(1);
    expect(preview.errorCount).toBe(0);
  });

  it("resolves validator row numbers through node sources", () => {
    const preview = buildImportPreview({
      nodeSources: SOURCES,
      edges: [],
      mapperIssues: [],
      validationIssues: [
        { severity: "error", message: "duplicate label", rowNumber: null, header: null, nodeId: "import-row-3" },
      ],
    });
    expect(preview.issues[0].rowNumber).toBe(3);
  });

  it("sorts errors before warnings", () => {
    const preview = buildImportPreview({
      nodeSources: SOURCES,
      edges: [],
      mapperIssues: [
        { severity: "warning", message: "w", rowNumber: 2, header: null },
        { severity: "error", message: "e", rowNumber: 3, header: null },
      ],
      validationIssues: [],
    });
    expect(preview.issues.map((i) => i.severity)).toEqual(["error", "warning"]);
  });

  it("traces every row with a human-readable detail line", () => {
    const preview = buildImportPreview({
      nodeSources: SOURCES,
      edges: [],
      mapperIssues: [
        { severity: "error", message: "supervisor missing", rowNumber: 3, header: null },
      ],
      validationIssues: [],
    });
    expect(preview.rowTrace).toHaveLength(2);
    expect(preview.rowTrace[0]).toEqual({
      rowNumber: 2,
      label: "Bob Jones",
      detail: "Root — no supervisor",
    });
    expect(preview.rowTrace[1].rowNumber).toBe(3);
    expect(preview.rowTrace[1].detail).toMatch(/Error: supervisor missing/);
  });

  it("produces the required ImportPreview shape", () => {
    const preview = buildImportPreview({ nodeSources: {}, edges: [], mapperIssues: [], validationIssues: [] });
    expect(preview).toEqual({
      nodeCount: 0,
      edgeCount: 0,
      warningCount: 0,
      errorCount: 0,
      rowTrace: [],
      issues: [],
    });
  });
});
