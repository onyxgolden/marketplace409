import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { exportProjectToXer } from "@/domains/scheduling/schedulingXerExport";
import { loadProjectRelational, loadResourceCostData, computeAndPersistCpm, loadExportData } from "../../../scheduleProjectAssembly";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication({ appKey: "scheduler" });
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
    if (relational.project.owner_id !== authenticated.effectiveOwnerId) return NextResponse.json({ error: "You don't own this project." }, { status: 404 });

    const { cpmBlocks } = await computeAndPersistCpm(authenticated.supabaseClient, relational.project, relational);
    const { resources, assignments } = await loadResourceCostData(authenticated.supabaseClient, relational);
    const { calendars, holidays, dependencies, assignments: exportAssignments } = await loadExportData(authenticated.supabaseClient, relational, cpmBlocks, assignments);

    const xer = exportProjectToXer({
      project: relational.project, calendars, holidays,
      wbsNodes: relational.wbsNodes, lanes: relational.lanes, blocks: cpmBlocks, dependencies,
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
