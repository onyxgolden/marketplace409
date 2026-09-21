// FORGE Chart Builder — spreadsheet parsing (slice 3.1).
//
// Browser-local translation pipeline step 1: File/Blob/bytes → RawTable[].
// CSV is parsed with a small RFC-4180 reader (BOM, quoted commas, multiline
// cells). XLSX goes through exceljs, which is already a repo dependency and is
// loaded lazily (code-split chunk, fetched on first import) so it never lands
// in the page's initial bundle.
//
// The output is the raw table model only — headers, rows, and original row
// numbers. No nodes, no edges, no chart mutation. Every failure mode is an
// explicit ImportError; nothing is silently dropped or guessed.

import { ImportError } from "./chartImportTypes.js";

// ---------------------------------------------------------------------------
// input normalization
// ---------------------------------------------------------------------------

function isBlobLike(value) {
  return (
    value != null &&
    typeof value.arrayBuffer === "function" &&
    typeof value.text === "function"
  );
}

async function toText(source) {
  if (typeof source === "string") return source;
  if (isBlobLike(source)) return source.text();
  if (source instanceof ArrayBuffer) return new TextDecoder("utf-8").decode(source);
  if (ArrayBuffer.isView(source)) {
    return new TextDecoder("utf-8").decode(source);
  }
  throw new ImportError(
    "unsupported-input",
    "parseCsv accepts a string, Blob/File, ArrayBuffer, or Uint8Array."
  );
}

async function toArrayBuffer(source) {
  if (isBlobLike(source)) return source.arrayBuffer();
  if (source instanceof ArrayBuffer) return source;
  if (ArrayBuffer.isView(source)) {
    return source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength
    );
  }
  if (typeof source === "string") {
    return new TextEncoder().encode(source).buffer;
  }
  throw new ImportError(
    "unsupported-input",
    "parseXlsx accepts a Blob/File, ArrayBuffer, or Uint8Array."
  );
}

// ---------------------------------------------------------------------------
// RFC-4180 CSV reader
// ---------------------------------------------------------------------------

/**
 * Parse CSV text into rows of raw cell strings. Handles quoted fields,
 * escaped quotes (""), commas and newlines inside quotes, and CRLF/LF/CR
 * line endings. A quote that is never closed is treated leniently: the rest
 * of the input becomes the field (the row is kept, not dropped).
 *
 * @returns {{ rows: string[][], startLines: number[] }} startLines[i] is the
 *   1-based line number where rows[i] begins (for multiline quoted fields).
 */
function readCsvRows(text) {
  const rows = [];
  const startLines = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let fieldHasContent = false;

  const pushField = () => {
    row.push(field);
    field = "";
    fieldHasContent = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    startLines.push(rowStartLine);
    row = [];
    // `line` already points at the upcoming line: each newline handler
    // increments it before calling pushRow.
    rowStartLine = line;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      fieldHasContent = true;
    } else if (ch === '"') {
      // A quote only opens a quoted field at the start of a field; a stray
      // quote mid-field is kept literally (lenient, never drops the row).
      if (!fieldHasContent && field === "") {
        inQuotes = true;
      } else {
        field += ch;
      }
      fieldHasContent = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      line++;
      pushRow();
    } else if (ch === "\n") {
      line++;
      pushRow();
    } else {
      field += ch;
      if (ch !== " " && ch !== "\t") fieldHasContent = true;
    }
  }
  // Trailing content without a final newline still forms a row.
  if (row.length > 0 || field !== "" || fieldHasContent) {
    pushRow();
  }
  return { rows, startLines };
}

const cellOrNull = (value) => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

function isBlankCells(cells) {
  return cells.every((c) => cellOrNull(c) === null);
}

/**
 * Build a RawTable from parsed CSV rows.
 */
function tableFromCsvRows(parsed) {
  const { rows, startLines } = parsed;
  let headerIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (!isBlankCells(rows[i])) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new ImportError(
      "empty-file",
      "The CSV file has no header row and no data rows."
    );
  }
  const headers = rows[headerIndex].map((h) => h.trim());
  const dataRows = [];
  let skippedBlankRows = 0;
  for (let i = headerIndex + 1; i < rows.length; i++) {
    if (isBlankCells(rows[i])) {
      skippedBlankRows++;
      continue;
    }
    const values = rows[i].map(cellOrNull);
    while (values.length < headers.length) values.push(null);
    dataRows.push({
      rowNumber: startLines[i],
      values: values.slice(0, headers.length),
    });
  }
  return {
    source: "csv",
    sheetName: "Sheet1",
    headers,
    rows: dataRows,
    skippedBlankRows,
  };
}

/**
 * Parse CSV content into a single-element RawTable array.
 *
 * Accepts a string, Blob/File, ArrayBuffer, or Uint8Array. Handles UTF-8
 * (with or without BOM), quoted commas, and multiline quoted cells.
 * Empty files and files with no usable rows throw ImportError("empty-file").
 *
 * @param {string|Blob|ArrayBuffer|Uint8Array} source
 * @returns {Promise<import("./chartImportTypes.js").RawTable[]>}
 */
export async function parseCsv(source) {
  let text = await toText(source);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM
  if (text.trim() === "") {
    throw new ImportError("empty-file", "The CSV file is empty.");
  }
  return [tableFromCsvRows(readCsvRows(text))];
}

// ---------------------------------------------------------------------------
// XLSX via exceljs
// ---------------------------------------------------------------------------

function normalizeXlsxCell(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      const text = value.richText.map((part) => part.text ?? "").join("");
      return cellOrNull(text);
    }
    if (typeof value.text === "string") return cellOrNull(value.text);
    if (value.result !== undefined && value.result !== null) {
      return normalizeXlsxCell(value.result);
    }
    return null;
  }
  return cellOrNull(String(value));
}

function tableFromWorksheet(worksheet) {
  const width = worksheet.columnCount;
  const raw = [];
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const cells = [];
    for (let c = 1; c <= width; c++) {
      cells.push(normalizeXlsxCell(row.getCell(c).value));
    }
    raw.push({ rowNumber: r, cells });
  }
  const headerPos = raw.findIndex((r) => !r.cells.every((c) => c === null));
  if (headerPos === -1) return null; // entirely blank sheet
  const headers = raw[headerPos].cells.map((c) => (c === null ? "" : c));
  const rows = [];
  let skippedBlankRows = 0;
  for (let i = headerPos + 1; i < raw.length; i++) {
    const { rowNumber, cells } = raw[i];
    if (cells.every((c) => c === null)) {
      skippedBlankRows++;
      continue;
    }
    const values = cells.slice();
    while (values.length < headers.length) values.push(null);
    rows.push({ rowNumber, values: values.slice(0, headers.length) });
  }
  return {
    source: "xlsx",
    sheetName: worksheet.name,
    headers,
    rows,
    skippedBlankRows,
  };
}

/**
 * Convert an exceljs Workbook into RawTable[] — one table per worksheet.
 * Every sheet is exposed; the first sheet is never chosen silently (sheet
 * selection is the wizard's job in slice 3.2). Blank sheets are skipped, and
 * a workbook with no usable sheets throws ImportError("empty-workbook").
 *
 * @param {object} workbook an exceljs Workbook (already loaded)
 * @returns {import("./chartImportTypes.js").RawTable[]}
 */
export function normalizeWorkbookSheets(workbook) {
  const sheets = workbook?.worksheets ?? [];
  const tables = [];
  for (const sheet of sheets) {
    const table = tableFromWorksheet(sheet);
    if (table) tables.push(table);
  }
  if (tables.length === 0) {
    throw new ImportError(
      "empty-workbook",
      "The workbook has no worksheet with data."
    );
  }
  return tables;
}

/**
 * Parse .xlsx content into a RawTable per worksheet.
 *
 * Accepts a Blob/File, ArrayBuffer, or Uint8Array. exceljs is imported
 * lazily so it stays out of the page's initial bundle. Empty input throws
 * ImportError("empty-file"); unreadable binary throws ImportError("malformed");
 * a workbook with no usable sheets throws ImportError("empty-workbook").
 *
 * @param {Blob|ArrayBuffer|Uint8Array} source
 * @returns {Promise<import("./chartImportTypes.js").RawTable[]>}
 */
export async function parseXlsx(source) {
  const buffer = await toArrayBuffer(source);
  if (!buffer || buffer.byteLength === 0) {
    throw new ImportError("empty-file", "The .xlsx file is empty.");
  }
  let ExcelJS;
  try {
    const exceljsModule = await import("exceljs");
    ExcelJS = exceljsModule.default ?? exceljsModule;
  } catch {
    throw new ImportError(
      "xlsx-unavailable",
      "The spreadsheet reader could not be loaded. Check your connection and try again."
    );
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new ImportError(
      "malformed",
      "That file could not be read as an .xlsx workbook. It may be corrupt or not a real .xlsx file."
    );
  }
  return normalizeWorkbookSheets(workbook);
}
