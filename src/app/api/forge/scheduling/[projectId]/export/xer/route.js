import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { exportProjectToXer } from "@/domains/scheduling/schedulingXerExport";
import { loadProjectRelational, loadResourceCostData, computeAndPersistCpm } from "../../../scheduleProjectAssembly";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

function sanitizeFilename(name) {
  return (name || "schedule").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "schedule";
}

// Owner-only -- an export bundles resource/cost data into the same file (matching every other
// resource-touching route since SCHED-05's no-public-select decision), so there's no meaningful
// "read-only export for a non-owner viewer" version to offer.
//
// Exports only Gantt task/milestone blocks (cpmBlocks) -- the same set every other CPM-derived
// feature in this build-out (baselines, EVM, leveling) operates on. Hammocks are NOT exported: a
// pre-existing gap in computeAndPersistCpm (it filters hammocks out of the CPM run entirely and
// never persists early_start/early_finish for them -- see that function's own ganttBlocks filter),
// not something this ticket introduces or is scoped to fix. schedulingXerExport.js's TT_LOE mapping
// is written and tested for whenever that gap closes; it's simply never reached from this route
// today.
export async function GET(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;

    const relational = await loadProjectRelational(authenticated.supabaseClient, projectId);
    if (!relational.project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    if (relational.project.owner_id !== authenticated.user.id) return NextResponse.json({ error: "You don't own this project." }, { status: 404 });

    const { cpmBlocks } = await computeAndPersistCpm(authenticated.supabaseClient, relational.project, relational);
    const { resources, assignments } = await loadResourceCostData(authenticated.supabaseClient, relational);

    // loadProjectRelational's own calendars fetch is scoped to THIS project (schedule_project_id =
    // projectId), which misses any reusable/global calendar (schedule_project_id IS NULL) that the
    // project or its lanes/blocks reference -- fetch those by id too, or the exported CALENDAR
    // table would be missing an id that TASK/PROJECT rows still reference.
    const referencedCalendarIds = new Set([
      relational.project.default_calendar_id,
      ...relational.lanes.map((lane) => lane.calendar_id),
      ...cpmBlocks.map((block) => block.calendar_id),
    ].filter(Boolean));
    const missingCalendarIds = [...referencedCalendarIds].filter((id) => !relational.calendars.some((calendar) => calendar.id === id));
    let calendars = relational.calendars;
    if (missingCalendarIds.length > 0) {
      const { data: extraCalendars, error: extraCalendarsError } = await authenticated.supabaseClient
        .from("schedule_calendars").select("*").in("id", missingCalendarIds);
      if (extraCalendarsError) throw extraCalendarsError;
      calendars = [...calendars, ...(extraCalendars || [])];
    }

    const calendarIds = calendars.map((calendar) => calendar.id);
    const { data: holidays, error: holidaysError } = calendarIds.length
      ? await authenticated.supabaseClient.from("schedule_calendar_holidays").select("*").in("calendar_id", calendarIds)
      : { data: [], error: null };
    if (holidaysError) throw holidaysError;

    // TASKPRED/TASKRSRC referencing a block outside the exported TASK table would break the file's
    // referential integrity -- filter both to the same cpmBlocks id set actually being exported.
    const cpmBlockIds = new Set(cpmBlocks.map((block) => block.id));
    const exportDependencies = relational.dependencies.filter((dependency) => cpmBlockIds.has(dependency.predecessor_id) && cpmBlockIds.has(dependency.successor_id));
    const exportAssignments = assignments.filter((assignment) => cpmBlockIds.has(assignment.block_id));

    const xer = exportProjectToXer({
      project: relational.project, calendars, holidays: holidays || [],
      wbsNodes: relational.wbsNodes, lanes: relational.lanes, blocks: cpmBlocks, dependencies: exportDependencies,
      resources, assignments: exportAssignments, exportedBy: authenticated.user.email || authenticated.user.id,
    });

    return new NextResponse(xer, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(relational.project.name)}.xer"`,
      },
    });
  } catch (error) {
    console.error("Scheduling XER export error", error);
    return NextResponse.json({ error: "Unable to export this project to XER." }, { status: 500 });
  }
}
