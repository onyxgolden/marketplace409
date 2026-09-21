// FORGE Chart Builder — slice 3.4 hardening tests.
//
// Large-file chunking, empty-data guards, and adversarial parser/mapper
// cases. Everything stays browser-local; no network, no uploads.
import { describe, expect, it } from "vitest";
import { ImportError, assertTableHasData } from "../chartImportTypes.js";
import { detectHeaders, produceCandidates } from "../headerDetector.js";
import { mapOrgRows, mapOrgRowsChunked } from "../orgImportMapper.js";
import { mapWorkflowRows, mapWorkflowRowsChunked } from "../workflowImportMapper.js";
import { parseCsv, parseXlsx, normalizeWorkbookSheets } from "../spreadsheetParser.js";
import {
  runOrgImportPipeline,
  runOrgImportPipelineAsync,
  runWorkflowImportPipeline,
  runWorkflowImportPipelineAsync,
} from "../importPipeline.js";
import { validateConfirmedMappings } from "../importMapping.js";

// The barrel re-exports everything; the slice-3.4 entry points must be
// reachable through it too.
import * as barrel from "@/domains/chartBuilder";

const EXPECT_BARREL = ["runOrgImportPipelineAsync", "runWorkflowImportPipelineAsync", "mapOrgRowsChunked", "mapWorkflowRowsChunked", "assertTableHasData"];

function orgChainTable(n) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    rows.push({
      rowNumber: i + 1,
      values: [
        `Person ${i}`,
        "Engineer",
        i === 1 ? null : `Person ${i - 1}`,
      ],
    });
  }
  return {
    source: "csv",
    sheetName: "Sheet1",
    headers: ["Name", "Title", "Supervisor"],
    rows,
    skippedBlankRows: 0,
  };
}

function workflowChainTable(n) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    rows.push({
      rowNumber: i + 1,
      values: [`Step ${i}`, i === n ? null : `Step ${i + 1}`],
    });
  }
  return {
    source: "csv",
    sheetName: "Sheet1",
    headers: ["Step", "Next Step"],
    rows,
    skippedBlankRows: 0,
  };
}

const ORG_MAPPINGS = [
  { headerIndex: 0, target: "name" },
  { headerIndex: 2, target: "supervisor" },
];
const WORKFLOW_MAPPINGS = [
  { headerIndex: 0, target: "step" },
  { headerIndex: 1, target: "nextStep" },
];

describe("import barrel exports (slice 3.4 API surface)", () => {
  it("exposes the async/chunked entry points through @/domains/chartBuilder", () => {
    for (const name of EXPECT_BARREL) {
      expect(typeof barrel[name], name).toBe("function");
    }
  });
});

describe("assertTableHasData", () => {
  it("throws no-data-rows for headers with zero data rows", () => {
    const table = {
      source: "csv",
      sheetName: "Sheet1",
      headers: ["Name", "Supervisor"],
      rows: [],
      skippedBlankRows: 0,
    };
    let err = null;
    try {
      assertTableHasData(table);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ImportError);
    expect(err.code).toBe("no-data-rows");
  });

  it("blocks the org pipeline before mapping on a headers-only CSV", async () => {
    const [table] = await parseCsv("Name,Title,Supervisor\n");
    expect(table.rows).toHaveLength(0);
    let err = null;
    try {
      runOrgImportPipeline(table, ORG_MAPPINGS);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ImportError);
    expect(err.code).toBe("no-data-rows");
  });

  it("blocks the workflow pipeline on a headers-only file too", async () => {
    const [table] = await parseCsv("Step,Next Step\n");
    let err = null;
    try {
      await runWorkflowImportPipelineAsync(table, WORKFLOW_MAPPINGS);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ImportError);
    expect(err.code).toBe("no-data-rows");
  });
});

describe("mapOrgRowsChunked (10k rows)", () => {
  it(
    "maps 10,000 chained rows with correct counts and progress",
    { timeout: 30000 },
    async () => {
      const table = orgChainTable(10000);
      const progress = [];
      const result = await mapOrgRowsChunked(table, ORG_MAPPINGS, {
        chunkSize: 1000,
        onProgress: (p) => progress.push(p),
      });
      expect(result.nodes).toHaveLength(10000);
      expect(result.edges).toHaveLength(9999);
      expect(result.rowIssues).toHaveLength(0);
      // Progress was reported and reached the totals for both phases.
      expect(progress.length).toBeGreaterThan(0);
      const mappingPhase = progress.filter((p) => p.phase === "mapping");
      const edgesPhase = progress.filter((p) => p.phase === "edges");
      expect(mappingPhase.at(-1)).toEqual({
        phase: "mapping",
        processed: 10000,
        total: 10000,
      });
      expect(edgesPhase.at(-1).processed).toBe(10000);
      // First edge links person 2 to person 1; no progress callback broke it.
      const byId = new Map(result.nodes.map((n) => [n.id, n]));
      expect(byId.get(result.edges[0].from).label).toBe("Person 1");
      expect(byId.get(result.edges[0].to).label).toBe("Person 2");
    }
  );

  it("produces byte-identical output to the synchronous mapper", async () => {
    const table = {
      source: "csv",
      sheetName: "Sheet1",
      headers: ["Name", "Title", "Supervisor"],
      rows: [
        { rowNumber: 2, values: ["Ada", "CEO", null] },
        { rowNumber: 3, values: ["Bob", "CTO", "Ada"] },
        { rowNumber: 4, values: [null, "Intern", "Bob"] }, // blank name
        { rowNumber: 5, values: ["Cy", "CFO", "Nobody"] }, // missing supervisor
        { rowNumber: 6, values: ["Dee", "COO", "Dee"] }, // self supervisor
      ],
      skippedBlankRows: 0,
    };
    const sync = mapOrgRows(table, ORG_MAPPINGS);
    const chunked = await mapOrgRowsChunked(table, ORG_MAPPINGS, {
      chunkSize: 2,
    });
    expect(JSON.stringify(chunked)).toBe(JSON.stringify(sync));
  });
});

describe("mapWorkflowRowsChunked (10k steps)", () => {
  it(
    "maps 10,000 chained steps with correct counts",
    { timeout: 30000 },
    async () => {
      const table = workflowChainTable(10000);
      const progress = [];
      const result = await mapWorkflowRowsChunked(table, WORKFLOW_MAPPINGS, {
        chunkSize: 1000,
        onProgress: (p) => progress.push(p),
      });
      expect(result.nodes).toHaveLength(10000);
      expect(result.edges).toHaveLength(9999);
      expect(result.rowIssues).toHaveLength(0);
      expect(progress.at(-1).processed).toBe(10000);
    }
  );

  it("produces byte-identical output to the synchronous mapper", async () => {
    const table = {
      source: "csv",
      sheetName: "Sheet1",
      headers: ["Step", "Next Step", "Decision"],
      rows: [
        { rowNumber: 2, values: ["A", "B, Missing, C", "yes"] },
        { rowNumber: 3, values: ["B", null, null] },
        { rowNumber: 4, values: ["C", "A", null] },
      ],
      skippedBlankRows: 0,
    };
    const sync = mapWorkflowRows(table, WORKFLOW_MAPPINGS);
    const chunked = await mapWorkflowRowsChunked(table, WORKFLOW_MAPPINGS, {
      chunkSize: 1,
    });
    expect(JSON.stringify(chunked)).toBe(JSON.stringify(sync));
  });
});

describe("async pipeline entry points", () => {
  it("runOrgImportPipelineAsync matches the sync pipeline on a small file", async () => {
    const [table] = await parseCsv(
      "Name,Title,Supervisor\nAda,CEO,\nBob,CTO,Ada\n"
    );
    const syncResult = runOrgImportPipeline(table, ORG_MAPPINGS);
    const asyncResult = await runOrgImportPipelineAsync(table, ORG_MAPPINGS);
    expect(asyncResult.preview.nodeCount).toBe(syncResult.preview.nodeCount);
    expect(asyncResult.preview.edgeCount).toBe(syncResult.preview.edgeCount);
    expect(asyncResult.preview.errorCount).toBe(0);
    expect(asyncResult.draftDoc.nodes).toHaveLength(2);
  });

  it("runWorkflowImportPipelineAsync matches the sync pipeline", async () => {
    const [table] = await parseCsv("Step,Next Step\nA,B\nB,\n");
    const syncResult = runWorkflowImportPipeline(table, WORKFLOW_MAPPINGS);
    const asyncResult = await runWorkflowImportPipelineAsync(table, WORKFLOW_MAPPINGS);
    expect(asyncResult.preview.nodeCount).toBe(2);
    expect(asyncResult.preview.edgeCount).toBe(1);
    expect(asyncResult.validation.valid).toBe(syncResult.validation.valid);
  });
});

describe("adversarial parser cases", () => {
  it("keeps original row numbers across many interleaved blank rows", async () => {
    const lines = ["Name,Supervisor"];
    for (let i = 1; i <= 300; i++) {
      lines.push(`Person ${i},${i === 1 ? "" : `Person ${i - 1}`}`);
      if (i % 3 === 0) lines.push(""); // blank line every third row
    }
    const [table] = await parseCsv(lines.join("\n"));
    expect(table.rows).toHaveLength(300);
    // The blank after the final row is consumed as that row's line
    // terminator, so only 99 standalone blank rows are skipped.
    expect(table.skippedBlankRows).toBe(99);
    // Blanks fall after every 3rd person, so Person 3 sits on file line 4.
    const person3 = table.rows.find((r) => r.values[0] === "Person 3");
    expect(person3.rowNumber).toBe(4);
    const person300 = table.rows.at(-1);
    expect(person300.values[0]).toBe("Person 300");
    expect(person300.rowNumber).toBe(400); // 1 header + 300 data + 99 blanks before it
  });

  it("duplicate CSV headers are both flagged ambiguous, never silently dropped", async () => {
    const [table] = await parseCsv("Name,Name,Title\nAda,Bob,CEO\n");
    expect(table.headers).toEqual(["Name", "Name", "Title"]);
    const candidates = produceCandidates(table.headers);
    const nameCandidates = candidates.filter((c) => c.header === "Name");
    expect(nameCandidates).toHaveLength(2);
    // Same target claimed twice → ambiguous for both claimants.
    expect(nameCandidates[0].ambiguous).toBe(true);
    expect(nameCandidates[1].ambiguous).toBe(true);
    // Both stay visible in the analysis.
    const analysis = detectHeaders(table);
    expect(analysis.headers).toEqual(["Name", "Name", "Title"]);
  });

  it("blocks continue when two columns claim the same target", () => {
    const analysis = {
      headers: ["Name", "Employee Name"],
      candidates: produceCandidates(["Name", "Employee Name"]),
      requiresConfirmation: true,
    };
    const gate = validateConfirmedMappings("org", analysis, [
      { headerIndex: 0, target: "name" },
      { headerIndex: 1, target: "name" },
      { headerIndex: 0, target: "supervisor" },
    ]);
    expect(gate.complete).toBe(false);
    expect(gate.duplicateTargetClaims).toHaveLength(1);
    expect(gate.duplicateTargetClaims[0].target).toBe("name");
    expect(gate.duplicateTargetClaims[0].headers).toEqual([
      "Name",
      "Employee Name",
    ]);
  });
});

describe("adversarial XLSX cases", () => {
  async function exceljs() {
    const mod = await import("exceljs");
    return mod.default ?? mod;
  }

  async function xlsxBuffer(build) {
    const ExcelJS = await exceljs();
    const workbook = new ExcelJS.Workbook();
    build(workbook);
    return workbook.xlsx.writeBuffer();
  }

  it("strips a BOM from an XLSX header row", async () => {
    const buffer = await xlsxBuffer((workbook) => {
      const sheet = workbook.addWorksheet("People");
      sheet.addRow(["﻿Name", "Supervisor"]);
      sheet.addRow(["Ada", ""]);
      sheet.addRow(["Bob", "Ada"]);
    });
    const [table] = await parseXlsx(buffer);
    // The BOM is whitespace per JS trim, so it never reaches header detection.
    expect(table.headers).toEqual(["Name", "Supervisor"]);
    const analysis = detectHeaders(table);
    expect(analysis.candidates[0].suggestions[0].target).toBe("name");
  });

  it("preserves newline characters inside XLSX cells", async () => {
    const buffer = await xlsxBuffer((workbook) => {
      const sheet = workbook.addWorksheet("Steps");
      sheet.addRow(["Step", "Notes"]);
      sheet.addRow(["A", "line one\nline two"]);
    });
    const [table] = await parseXlsx(buffer);
    expect(table.rows[0].values[1]).toBe("line one\nline two");
  });

  it("exposes unicode sheet names without mangling them", async () => {
    const buffer = await xlsxBuffer((workbook) => {
      const people = workbook.addWorksheet("Données 📊");
      people.addRow(["Name"]);
      people.addRow(["Ada"]);
      const steps = workbook.addWorksheet("日本語");
      steps.addRow(["Step"]);
      steps.addRow(["A"]);
    });
    const ExcelJS = await exceljs();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const tables = normalizeWorkbookSheets(workbook);
    expect(tables.map((t) => t.sheetName)).toEqual(["Données 📊", "日本語"]);
  });
});

describe("adversarial workflow cases", () => {
  it("a missing next-step target mid-list errors only for that reference", async () => {
    const [table] = await parseCsv(
      "Step,Next Step\nA,\"B, Missing, C\"\nB,\nC,\n"
    );
    const draft = mapWorkflowRows(table, WORKFLOW_MAPPINGS);
    expect(draft.nodes).toHaveLength(3);
    // B and C edges created; Missing is an error, not a silent drop.
    expect(draft.edges).toHaveLength(2);
    const targets = draft.edges.map((e) => e.to).sort();
    expect(targets).toEqual(["import-row-3", "import-row-4"]);
    const errors = draft.rowIssues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('next step "Missing"');
  });
});
