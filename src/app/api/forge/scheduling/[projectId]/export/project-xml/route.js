import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { exportProjectToProjectXml } from "@/domains/scheduling/schedulingProjectXmlExport";
import { loadProjectRelational, loadResourceCostData, computeAndPersistCpm, loadExportData } from "../../../scheduleProjectAssembly";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

function sanitizeFilename(name) {
  return (name || "schedule").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "schedule";
}

// Mirrors [projectId]/export/xer/route.js exactly -- same owner-only gating, same
// Gantt-blocks-only scope (hammocks not exported, same pre-existing computeAndPersistCpm gap),
// same shared loadExportData prep (calendar gap-fill, holidays, referential-integrity filtering).
// The two routes differ only in which exporter they call and the file's Content-Type/extension.
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
    const { calendars, holidays, dependencies, assignments: exportAssignments } = await loadExportData(authenticated.supabaseClient, relational, cpmBlocks, assignments);

    const projectXml = exportProjectToProjectXml({
      project: relational.project, calendars, holidays,
      blocks: cpmBlocks, dependencies, resources, assignments: exportAssignments,
    });

    return new NextResponse(projectXml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(relational.project.name)}.xml"`,
      },
    });
  } catch (error) {
    console.error("Scheduling Project XML export error", error);
    return NextResponse.json({ error: "Unable to export this project to Project XML." }, { status: 500 });
  }
}
