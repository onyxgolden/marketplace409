import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { ACTIVITY_COLUMNS, READ_ONLY_IMPORT_COLUMNS } from "@/domains/scheduling/schedulingExcelExport";
import { validateAndPlanImport } from "@/domains/scheduling/schedulingExcelImport";
import { stripNamespace } from "@/domains/scheduling/schedulingRelationalToBoard";
import { loadProjectRelational } from "../../../scheduleProjectAssembly";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

const IMPORTABLE_COLUMNS = ACTIVITY_COLUMNS.filter((column) => !READ_ONLY_IMPORT_COLUMNS.includes(column.key));

// Parses and validates only -- no write happens here. The client applies the returned patches to
// its own in-memory board (schedulingBoardState.js's applyImportedActivities, an undoable
// commitBoard action like every other structural edit) and PATCHes percentComplete/actualStart/
// actualFinish per activity via the existing progress route, then the normal autosave persists
// everything -- see SchedulingBoard.jsx's handleImportExcel. This route never touches
// schedule_blocks/schedule_projects itself, so there's no new write path to get wrong.
export async function POST(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;

    const relational = await loadProjectRelational(authenticated.supabaseClient, projectId);
    if (!relational.project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    if (relational.project.owner_id !== authenticated.user.id) return NextResponse.json({ error: "You don't own this project." }, { status: 404 });

    const bytes = await request.arrayBuffer();
    if (!bytes || bytes.byteLength === 0) return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(Buffer.from(bytes));
    } catch {
      return NextResponse.json({ error: "That file could not be read as an .xlsx workbook." }, { status: 400 });
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return NextResponse.json({ error: "The workbook has no worksheet." }, { status: 400 });

    const headerRow = worksheet.getRow(1).values; // 1-indexed, values[0] is undefined
    const columnIndexByKey = new Map();
    IMPORTABLE_COLUMNS.forEach((column) => {
      const columnIndex = headerRow.findIndex((value) => typeof value === "string" && value.trim() === column.header);
      if (columnIndex > 0) columnIndexByKey.set(column.key, columnIndex);
    });
    if (!columnIndexByKey.has("taskCode")) {
      return NextResponse.json({ error: `This doesn't look like an exported Activities sheet -- no "Task Code" column found.` }, { status: 400 });
    }

    const rows = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const values = worksheet.getRow(rowNumber).values;
      if (!values || values.every((value) => value == null || value === "")) continue; // fully blank row
      const row = {};
      columnIndexByKey.forEach((columnIndex, key) => { row[key] = values[columnIndex]; });
      rows.push(row);
    }

    const existingBlocksByTaskCode = new Map(relational.blocks.map((block) => [
      block.task_code, { category: block.category, milestone: block.block_type === "milestone" },
    ]));
    const laneIdByNameLower = new Map(relational.lanes.map((lane) => [lane.name.trim().toLowerCase(), stripNamespace(projectId, lane.id)]));

    const result = validateAndPlanImport({
      rows, existingBlocksByTaskCode, laneIdByNameLower, projectStartDate: relational.project.start_date,
    });
    if (!result.success) return NextResponse.json({ error: "This file has errors.", errors: result.errors }, { status: 400 });

    return NextResponse.json({ success: true, patches: result.patches });
  } catch (error) {
    console.error("Scheduling Excel import error", error);
    return NextResponse.json({ error: "Unable to read this Excel file." }, { status: 500 });
  }
}
