import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { ACTIVITY_COLUMNS, buildActivityRows } from "@/domains/scheduling/schedulingExcelExport";
import { loadProjectRelational, computeAndPersistCpm } from "../../../scheduleProjectAssembly";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

function sanitizeFilename(name) {
  return (name || "schedule").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "schedule";
}

// Owner-only, matching every export in this build-out (SCHED-13/15) -- no resource/cost data in
// this v1 sheet, but the consistency of "exports require ownership" is worth more than the
// narrower justification those two had.
export async function GET(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;

    const relational = await loadProjectRelational(authenticated.supabaseClient, projectId);
    if (!relational.project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    if (relational.project.owner_id !== authenticated.user.id) return NextResponse.json({ error: "You don't own this project." }, { status: 404 });

    const { cpmBlocks } = await computeAndPersistCpm(authenticated.supabaseClient, relational.project, relational);
    const cpmBlockIds = new Set(cpmBlocks.map((block) => block.id));
    const dependencies = relational.dependencies.filter((dependency) => cpmBlockIds.has(dependency.predecessor_id) && cpmBlockIds.has(dependency.successor_id));
    const lanesById = new Map(relational.lanes.map((lane) => [lane.id, lane]));

    const rows = buildActivityRows({ ganttBlocks: cpmBlocks, dependencies, lanesById });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Activities");
    worksheet.columns = ACTIVITY_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: 18 }));
    worksheet.getRow(1).font = { bold: true };
    rows.forEach((row) => worksheet.addRow(row));

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(relational.project.name)}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Scheduling Excel export error", error);
    return NextResponse.json({ error: "Unable to export this project to Excel." }, { status: 500 });
  }
}
