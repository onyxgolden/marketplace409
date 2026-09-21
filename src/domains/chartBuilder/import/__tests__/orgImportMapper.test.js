import { describe, expect, it } from "vitest";
import { ImportError } from "../chartImportTypes.js";
import { mapOrgRows } from "../orgImportMapper.js";

const HEADERS = ["Employee Name", "Job Role", "Reports To", "Dept", "Office"];

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
  { headerIndex: 3, target: "department" },
  { headerIndex: 4, target: "location" },
];

describe("mapOrgRows", () => {
  it("maps rows to nodes with trimmed enrichment fields", () => {
    const out = mapOrgRows(
      table([
        [2, "Bob Jones", "CEO", "", "Exec", "Austin"],
        [3, "  Jane Smith ", " Director ", "Bob Jones", "Eng", "Austin"],
      ]),
      MAPPING
    );
    expect(out.nodes).toHaveLength(2);
    const node = out.nodes[1];
    expect(node.id).toBe("import-row-3");
    expect(node.label).toBe("Jane Smith");
    expect(node.subtitle).toBe("Director");
    expect(node.fields).toEqual({ title: "Director", department: "Eng", location: "Austin" });
    expect(out.rowIssues).toEqual([]);
  });

  it("creates a supervisor edge per row by supervisor name", () => {
    const out = mapOrgRows(
      table([
        [2, "Bob Jones", "CEO", "", "", ""],
        [3, "Jane Smith", "Director", "Bob Jones", "", ""],
      ]),
      MAPPING
    );
    expect(out.nodes).toHaveLength(2);
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].type).toBe("supervisor");
    expect(out.edges[0].from).toBe("import-row-2");
    expect(out.edges[0].to).toBe("import-row-3");
  });

  it("matches supervisor names case-insensitively", () => {
    const out = mapOrgRows(
      table([
        [2, "Bob Jones", "", "", "", ""],
        [3, "Jane Smith", "", "bob jones", "", ""],
      ]),
      MAPPING
    );
    expect(out.edges).toHaveLength(1);
    expect(out.rowIssues).toEqual([]);
  });

  it("leaves blank supervisor cells as roots with no edge", () => {
    const out = mapOrgRows(table([[2, "Bob Jones", "", "", "", ""]]), MAPPING);
    expect(out.edges).toHaveLength(0);
    expect(out.rowIssues).toEqual([]);
  });

  it("reports a blank name as an error and skips the node", () => {
    const out = mapOrgRows(table([[2, "   ", "", "Bob", "", ""]]), MAPPING);
    expect(out.nodes).toHaveLength(0);
    expect(out.rowIssues).toHaveLength(1);
    expect(out.rowIssues[0].severity).toBe("error");
    expect(out.rowIssues[0].rowNumber).toBe(2);
  });

  it("reports a missing supervisor as an explicit error, no silent orphan", () => {
    const out = mapOrgRows(
      table([[2, "Jane Smith", "", "Unknown Person", "", ""]]),
      MAPPING
    );
    expect(out.edges).toHaveLength(0);
    expect(out.rowIssues).toHaveLength(1);
    expect(out.rowIssues[0].severity).toBe("error");
    expect(out.rowIssues[0].message).toMatch(/does not match any person/);
  });

  it("rejects self-supervision without creating an edge", () => {
    const out = mapOrgRows(
      table([[2, "Jane Smith", "", "Jane Smith", "", ""]]),
      MAPPING
    );
    expect(out.edges).toHaveLength(0);
    expect(out.rowIssues).toHaveLength(1);
    expect(out.rowIssues[0].message).toMatch(/own supervisor/);
  });

  it("never merges duplicate names automatically", () => {
    const out = mapOrgRows(
      table([
        [2, "Jane Smith", "Director", "", "", ""],
        [3, "Jane Smith", "Analyst", "", "", ""],
      ]),
      MAPPING
    );
    expect(out.nodes).toHaveLength(2);
    expect(out.nodes[0].id).not.toBe(out.nodes[1].id);
    // Duplicate labels stay visible for the validator to flag — the mapper
    // does not invent a merge.
  });

  it("reports an ambiguous supervisor reference as an error", () => {
    const out = mapOrgRows(
      table([
        [2, "Bob Jones", "CEO", "", "", ""],
        [3, "Bob Jones", "CTO", "", "", ""],
        [4, "Jane Smith", "", "Bob Jones", "", ""],
      ]),
      MAPPING
    );
    expect(out.edges).toHaveLength(0);
    expect(out.rowIssues.some((i) => i.message.includes("Ambiguous"))).toBe(true);
  });

  it("throws on incomplete mappings (no invented mappings)", () => {
    expect(() =>
      mapOrgRows(table([[2, "Jane", "", "Bob", "", ""]]), [
        { headerIndex: 0, target: "name" },
      ])
    ).toThrow(ImportError);
  });

  it("records node sources with original row numbers", () => {
    const out = mapOrgRows(
      table([[7, "Jane Smith", "", "Bob Jones", "", ""]]),
      MAPPING
    );
    expect(out.nodeSources["import-row-7"]).toEqual({
      rowNumber: 7,
      name: "Jane Smith",
      supervisor: "Bob Jones",
      sheetName: "Sheet1",
    });
  });
});
