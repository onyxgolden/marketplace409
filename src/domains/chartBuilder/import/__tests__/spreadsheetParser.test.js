import { describe, expect, it } from "vitest";
import { ImportError } from "../chartImportTypes.js";
import {
  normalizeWorkbookSheets,
  parseCsv,
  parseXlsx,
} from "../spreadsheetParser.js";

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

describe("parseCsv", () => {
  it("parses headers, rows, and original row numbers", async () => {
    const [table] = await parseCsv(
      "Name,Title,Supervisor\nAda,CEO,\nBob,CTO,Ada\n"
    );
    expect(table.source).toBe("csv");
    expect(table.headers).toEqual(["Name", "Title", "Supervisor"]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toEqual({
      rowNumber: 2,
      values: ["Ada", "CEO", null],
    });
    expect(table.rows[1].values).toEqual(["Bob", "CTO", "Ada"]);
    expect(table.skippedBlankRows).toBe(0);
  });

  it("strips a UTF-8 BOM", async () => {
    const [table] = await parseCsv("﻿Name,Title\nAda,CEO\n");
    expect(table.headers).toEqual(["Name", "Title"]);
    expect(table.rows[0].values).toEqual(["Ada", "CEO"]);
  });

  it("handles quoted commas and trims whitespace", async () => {
    const [table] = await parseCsv(
      'Name,Title\n"Smith, Jane","VP, Engineering"\n  Bob  , CTO \n'
    );
    expect(table.rows[0].values).toEqual(["Smith, Jane", "VP, Engineering"]);
    expect(table.rows[1].values).toEqual(["Bob", "CTO"]);
  });

  it("handles multiline quoted cells and keeps the starting row number", async () => {
    const [table] = await parseCsv(
      'Name,Notes\nAda,"line one\nline two"\nBob,plain\n'
    );
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].rowNumber).toBe(2);
    expect(table.rows[0].values).toEqual(["Ada", "line one\nline two"]);
    expect(table.rows[1].rowNumber).toBe(4);
  });

  it("skips blank rows but preserves row numbers for diagnostics", async () => {
    const [table] = await parseCsv(
      "Name,Supervisor\nAda,\n\n   \nBob,Ada\n"
    );
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].rowNumber).toBe(2);
    expect(table.rows[1].rowNumber).toBe(5);
    expect(table.skippedBlankRows).toBe(2);
  });

  it("finds the header on the first non-blank line", async () => {
    const [table] = await parseCsv("\n\nName,Title\nAda,CEO\n");
    expect(table.headers).toEqual(["Name", "Title"]);
    expect(table.rows[0].rowNumber).toBe(4);
  });

  it("pads short rows and truncates ragged rows to the header width", async () => {
    const [table] = await parseCsv("A,B\nx\np,q,r\n");
    expect(table.rows[0].values).toEqual(["x", null]);
    expect(table.rows[1].values).toEqual(["p", "q"]);
  });

  it("accepts Blob input like a browser file picker", async () => {
    const blob = new Blob(["Name\nAda\n"], { type: "text/csv" });
    const [table] = await parseCsv(blob);
    expect(table.headers).toEqual(["Name"]);
    expect(table.rows[0].values).toEqual(["Ada"]);
  });

  it("rejects empty and whitespace-only files explicitly", async () => {
    await expect(parseCsv("")).rejects.toMatchObject({
      name: "ImportError",
      code: "empty-file",
    });
    await expect(parseCsv("  \n \n")).rejects.toMatchObject({
      code: "empty-file",
    });
  });

  it("rejects unsupported input types explicitly", async () => {
    await expect(parseCsv(42)).rejects.toMatchObject({
      code: "unsupported-input",
    });
  });
});

describe("parseXlsx", () => {
  it("parses a workbook and exposes every sheet", async () => {
    const buffer = await xlsxBuffer((workbook) => {
      const people = workbook.addWorksheet("People");
      people.addRow(["Name", "Title", "Supervisor"]);
      people.addRow(["Ada", "CEO", null]);
      people.addRow(["Bob", "CTO", "Ada"]);
      const steps = workbook.addWorksheet("Steps");
      steps.addRow(["Step", "Next Step"]);
      steps.addRow(["Start", "Middle"]);
    });
    const tables = await parseXlsx(buffer);
    // Never picks the first sheet silently: all sheets are returned.
    expect(tables).toHaveLength(2);
    expect(tables.map((t) => t.sheetName)).toEqual(["People", "Steps"]);
    const [people] = tables;
    expect(people.source).toBe("xlsx");
    expect(people.headers).toEqual(["Name", "Title", "Supervisor"]);
    expect(people.rows).toHaveLength(2);
    expect(people.rows[0]).toEqual({
      rowNumber: 2,
      values: ["Ada", "CEO", null],
    });
    expect(people.rows[1].values).toEqual(["Bob", "CTO", "Ada"]);
  });

  it("skips blank rows but preserves original row numbers", async () => {
    const buffer = await xlsxBuffer((workbook) => {
      const ws = workbook.addWorksheet("Data");
      ws.addRow(["Name"]);
      ws.addRow(["Ada"]);
      ws.addRow([]);
      ws.addRow(["Bob"]);
    });
    const [table] = await parseXlsx(buffer);
    expect(table.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(table.skippedBlankRows).toBe(1);
  });

  it("normalizes numbers, dates, and rich text cells", async () => {
    const buffer = await xlsxBuffer((workbook) => {
      const ws = workbook.addWorksheet("Mixed");
      ws.addRow(["Count", "When", "Note"]);
      ws.addRow([
        42,
        new Date("2026-01-15T00:00:00.000Z"),
        { richText: [{ text: "hello" }, { text: " world" }] },
      ]);
    });
    const [table] = await parseXlsx(buffer);
    expect(table.rows[0].values[0]).toBe("42");
    expect(table.rows[0].values[1]).toBe("2026-01-15T00:00:00.000Z");
    expect(table.rows[0].values[2]).toBe("hello world");
  });

  it("rejects empty input explicitly", async () => {
    await expect(parseXlsx(new Uint8Array(0))).rejects.toMatchObject({
      code: "empty-file",
    });
  });

  it("rejects malformed binary explicitly", async () => {
    const garbage = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x99]);
    await expect(parseXlsx(garbage)).rejects.toMatchObject({
      code: "malformed",
    });
    await expect(parseXlsx(new Blob(["not a workbook"]))).rejects.toMatchObject(
      { code: "malformed" }
    );
  });

  it("rejects a workbook with no sheets", async () => {
    const ExcelJS = await exceljs();
    const workbook = new ExcelJS.Workbook();
    const buffer = await workbook.xlsx.writeBuffer();
    await expect(parseXlsx(buffer)).rejects.toMatchObject({
      code: "empty-workbook",
    });
  });

  it("rejects a workbook whose sheets are all blank", async () => {
    const buffer = await xlsxBuffer((workbook) => {
      workbook.addWorksheet("Empty1");
      const ws = workbook.addWorksheet("Empty2");
      ws.addRow([null, null]);
    });
    await expect(parseXlsx(buffer)).rejects.toMatchObject({
      code: "empty-workbook",
    });
  });
});

describe("normalizeWorkbookSheets", () => {
  it("keeps a partially-filled workbook and skips only blank sheets", async () => {
    const ExcelJS = await exceljs();
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Blank");
    const data = workbook.addWorksheet("Data");
    data.addRow(["Name"]);
    data.addRow(["Ada"]);
    const tables = normalizeWorkbookSheets(workbook);
    expect(tables).toHaveLength(1);
    expect(tables[0].sheetName).toBe("Data");
  });
});
