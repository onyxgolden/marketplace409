// Work Package Planner file import — preview.
//
// Upload → parse → preview/mapping screen → confirm. This route only
// parses and plans: nothing is written here. The confirm route
// re-validates the same rows against fresh data and applies them.
//
// Formats: .xlsx via exceljs (already a dependency, lazy import — the
// same pattern as the scheduling Excel import) and .csv / .tsv / .txt
// via the delimiter parser in the import domain. No live SAP / Maximo
// / P6 connection: files only, per the brief.
import { NextResponse } from "next/server";
import { workAuth, ok, fail, serverError } from "../../_lib/auth.js";
import { SCOPE_KINDS } from "@/application/work-management/projectScope";
import {
  PACKAGE_IMPORT_COLUMNS,
  STEP_IMPORT_COLUMNS,
  IMPORT_SOURCE_SYSTEMS,
  matchHeaders,
  parseDelimitedText,
  validateAndPlanWorkPackageImport,
} from "@/domains/work-management/workPackageImport";
import { loadImportContext } from "@/application/work-management/workPackageImportApply";

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function xlsxCellValue(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("");
    if (value.result !== undefined) return xlsxCellValue(value.result);
    return "";
  }
  return value;
}

async function parseXlsx(bytes) {
  // exceljs stays out of this function's initial bundle: it is
  // code-split into a lazily-loaded chunk and fetched on first import.
  const exceljsModule = await import("exceljs");
  const ExcelJS = exceljsModule.default ?? exceljsModule;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch {
    throw new Error("That file could not be read as an .xlsx workbook.");
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("The workbook has no worksheet.");
  const headerRow = worksheet.getRow(1).values || [];
  const headers = headerRow.slice(1).map((value) => String(xlsxCellValue(value) ?? "").trim());
  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const values = worksheet.getRow(rowNumber).values || [];
    const cells = headers.map((_, index) => xlsxCellValue(values[index + 1]));
    if (cells.every((value) => value == null || String(value).trim() === "")) continue;
    rows.push(cells);
  }
  return { headers, rows };
}

// Parses an uploaded file into { headers, rows } — rows are arrays of
// cell values, header row excluded, fully blank rows skipped.
export async function parseImportFile(bytes, filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".xlsx")) return parseXlsx(bytes);
  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
    const text = Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/, "");
    return parseDelimitedText(text);
  }
  throw new Error("Import .xlsx, .csv, .tsv, or .txt files — other formats are not supported.");
}

export async function POST(request) {
  try {
    const auth = await workAuth(request);
    if (auth.error) return auth.error;
    const form = await request.formData();
    const kind = String(form.get("kind") || "");
    if (kind !== "packages" && kind !== "steps") {
      return NextResponse.json({ error: "kind must be packages or steps." }, { status: 400 });
    }
    const packageId = kind === "steps" ? String(form.get("packageId") || "") : null;
    if (kind === "steps" && !packageId) {
      return NextResponse.json({ error: "packageId is required to import steps." }, { status: 400 });
    }
    const sourceSystemRaw = form.get("sourceSystem");
    const sourceSystem = sourceSystemRaw ? String(sourceSystemRaw) : null;
    if (sourceSystem && !IMPORT_SOURCE_SYSTEMS.includes(sourceSystem)) {
      return NextResponse.json({ error: `sourceSystem must be one of: ${IMPORT_SOURCE_SYSTEMS.join(", ")}.` }, { status: 400 });
    }
    // Mode selector: only meaningful for packages (steps are identical
    // in both modes). Validated against the real WP_MODES list so a
    // malformed value never silently falls through to "no mode check".
    const modeRaw = kind === "packages" ? form.get("mode") : null;
    const mode = modeRaw === "industrial" || modeRaw === "commercial" ? modeRaw : null;
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "Choose a file to import." }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength === 0) {
      return NextResponse.json({ error: "The file is empty." }, { status: 400 });
    }
    if (bytes.byteLength > MAX_IMPORT_BYTES) {
      return NextResponse.json({ error: "The file is too large — keep imports under 5 MB." }, { status: 400 });
    }
    let parsed;
    try {
      parsed = await parseImportFile(bytes, file.name || "");
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const columns = kind === "packages" ? PACKAGE_IMPORT_COLUMNS : STEP_IMPORT_COLUMNS;
    let mapping;
    const mappingRaw = form.get("mapping");
    if (mappingRaw) {
      // The dialog's remap: the user re-assigns file columns by hand
      // and re-previews. A mapping entry is a field key or null
      // ("Ignore this column"); unknown keys are rejected, not guessed.
      try {
        const override = JSON.parse(String(mappingRaw));
        const known = new Set(columns.map((column) => column.key));
        if (!Array.isArray(override) || override.some((key) => key !== null && !known.has(key))) {
          return NextResponse.json({ error: "The column mapping is invalid." }, { status: 400 });
        }
        mapping = parsed.headers.map((header, index) => ({
          header: String(header ?? ""),
          fieldKey: override[index] ?? null,
        }));
      } catch {
        return NextResponse.json({ error: "The column mapping is invalid." }, { status: 400 });
      }
    } else {
      mapping = matchHeaders(parsed.headers, columns);
    }
    const mapped = parsed.rows.map((cells) => {
      const row = {};
      mapping.forEach((match, index) => {
        if (match.fieldKey) row[match.fieldKey] = cells[index] ?? "";
      });
      return row;
    }).filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""));
    if (mapped.length === 0) {
      return NextResponse.json({ error: "The file has no data rows." }, { status: 400 });
    }
    if (mapped.length > MAX_IMPORT_ROWS) {
      return NextResponse.json({ error: `This file has ${mapped.length} rows — split it into files of ${MAX_IMPORT_ROWS} rows or fewer.` }, { status: 400 });
    }
    // PR B fix round 1: an import run requires an explicit scope —
    // a PROJECT or UNASSIGNED selection. A request without
    // ?forgeProject= resolves to NO_SCOPE and is refused here (400),
    // before any matching: there is no owner-wide match pool anymore.
    // The Planner import dialog sends the scope from the page URL
    // (withWorkspaceQuery); the chooser page has no import control.
    if (auth.scopeError) return fail(auth.scopeError);
    if (auth.scope.kind === SCOPE_KINDS.NONE) {
      return NextResponse.json(
        { error: "Choose a project (or Unassigned) before importing." },
        { status: 400 },
      );
    }
    const context = await loadImportContext(auth.db, {
      ownerId: auth.ownerId, kind, packageId,
      scope: auth.scope,
    });
    if (!context.ok) return fail(context);
    const plan = validateAndPlanWorkPackageImport({
      kind,
      rows: mapped,
      existingPackages: context.existingPackages || [],
      existingSteps: context.existingSteps || [],
      sourceSystem,
      sourceTrackingAvailable: context.sourceTrackingAvailable,
      properties: context.properties,
      mode,
    });
    return ok({
      success: plan.success,
      kind,
      packageId,
      sourceSystem,
      mode,
      sourceTrackingAvailable: context.sourceTrackingAvailable,
      columns: mapping,
      rows: mapped,
      plan: {
        creates: plan.creates,
        updates: plan.updates,
        errors: plan.errors,
        summary: plan.summary,
      },
    });
  } catch (error) {
    return serverError("Work package import preview error", error);
  }
}
