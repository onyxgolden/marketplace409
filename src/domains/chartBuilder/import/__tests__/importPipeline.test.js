import { describe, expect, it } from "vitest";
import { ImportError } from "../chartImportTypes.js";
import { commitOrgImport, runOrgImportPipeline } from "../importPipeline.js";

const HEADERS = ["Name", "Title", "Supervisor"];

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
  { headerIndex: 0, target: "name" },
  { headerIndex: 1, target: "title" },
  { headerIndex: 2, target: "supervisor" },
];

describe("runOrgImportPipeline", () => {
  it("cycle A->B/B->A surfaces an error and blocks commit", () => {
    const rows = table([
      [2, "Alice", "", "Bob"],
      [3, "Bob", "", "Alice"],
    ]);
    const pipeline = runOrgImportPipeline(rows, MAPPING);
    expect(pipeline.validation.valid).toBe(false);
    expect(pipeline.preview.errorCount).toBeGreaterThan(0);
    expect(pipeline.preview.issues.some((i) => /cycle/i.test(i.message))).toBe(true);
    expect(() => commitOrgImport(pipeline)).toThrow(ImportError);
  });

  it("A->MissingPerson reports the missing supervisor and blocks commit", () => {
    const rows = table([[2, "Alice", "", "Nobody"]]);
    const pipeline = runOrgImportPipeline(rows, MAPPING);
    // The missing supervisor is a mapper-level error (no edge is invented),
    // so it surfaces in the preview and blocks commit there.
    expect(pipeline.draft.rowIssues.some((i) => /does not match any person/i.test(i.message))).toBe(
      true
    );
    expect(pipeline.preview.errorCount).toBeGreaterThan(0);
    expect(pipeline.preview.rowTrace[0].detail).toMatch(/Error/);
    expect(() => commitOrgImport(pipeline)).toThrow(ImportError);
  });

  it("three unconnected rows are valid: three roots, commit succeeds", () => {
    const rows = table([
      [2, "Alice", "", ""],
      [3, "Bob", "", ""],
      [4, "Carol", "", ""],
    ]);
    const pipeline = runOrgImportPipeline(rows, MAPPING);
    expect(pipeline.validation.valid).toBe(true);
    expect(pipeline.preview.nodeCount).toBe(3);
    expect(pipeline.preview.edgeCount).toBe(0);
    const doc = commitOrgImport(pipeline);
    expect(doc.type).toBe("org");
    expect(doc.nodes).toHaveLength(3);
    expect(doc.edges).toHaveLength(0);
    // Deterministic layout positions are stamped for every node.
    for (const node of doc.nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }
  });

  it("committed doc preserves labels and carries a valid background", () => {
    const rows = table([
      [2, "Bob", "CEO", ""],
      [3, "Alice", "Director", "Bob"],
    ]);
    const doc = commitOrgImport(runOrgImportPipeline(rows, MAPPING));
    expect(doc.nodes.map((n) => n.label).sort()).toEqual(["Alice", "Bob"]);
    expect(doc.edges).toHaveLength(1);
    expect(typeof doc.background).toBe("string");
  });

  it("changing the mapping after a preview regenerates everything", () => {
    const rows = table([
      [2, "Bob", "CEO", ""],
      [3, "Alice", "Director", "Bob"],
    ]);
    const first = runOrgImportPipeline(rows, MAPPING);
    const remapped = [
      { headerIndex: 1, target: "name" }, // Title column now plays the name
      { headerIndex: 2, target: "supervisor" },
    ];
    const second = runOrgImportPipeline(rows, remapped);
    expect(second.preview.nodeCount).toBe(2);
    expect(
      second.draft.nodes.map((n) => n.label).sort()
    ).not.toEqual(first.draft.nodes.map((n) => n.label).sort());
    expect(second.draft.nodes.map((n) => n.label).sort()).toEqual([
      "CEO",
      "Director",
    ]);
  });

  it("commit without a pipeline run throws explicitly", () => {
    expect(() => commitOrgImport(null)).toThrow(ImportError);
  });

  it("blank header columns and extra columns never invent mappings", () => {
    const rows = table([[2, "Alice", "", ""]]);
    const pipeline = runOrgImportPipeline(rows, [
      { headerIndex: 0, target: "name" },
      { headerIndex: 2, target: "supervisor" },
    ]);
    expect(pipeline.preview.nodeCount).toBe(1);
    expect(pipeline.draft.nodes[0].subtitle).toBe("");
  });
});
