import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { levelResources } from "@/domains/scheduling/schedulingResourceLeveling";
import { loadProjectRelational, loadResourceCostData, computeAndPersistCpm } from "../../scheduleProjectAssembly";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

// Read-only preview, owner-only -- same reasoning as cost-rollup/evm-dcma (resource/cost data has
// no public-select policy per the SCHED-05 migration). allowExtension defaults to false, matching
// schedulingResourceLeveling.js's own default -- a preview never assumes the owner wants the
// project finish pushed out unless they explicitly ask for it via the query param.
export async function GET(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;
    const allowExtension = new URL(request.url).searchParams.get("allowExtension") === "true";

    const relational = await loadProjectRelational(authenticated.supabaseClient, projectId);
    if (!relational.project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    if (relational.project.owner_id !== authenticated.user.id) return NextResponse.json({ error: "You don't own this project." }, { status: 404 });

    const { cpmBlocks } = await computeAndPersistCpm(authenticated.supabaseClient, relational.project, relational);
    const { resources, assignments } = await loadResourceCostData(authenticated.supabaseClient, relational);

    const result = levelResources({
      project: relational.project, blocks: cpmBlocks, dependencies: relational.dependencies, assignments,
      resourcesById: new Map(resources.map((resource) => [resource.id, resource])),
      calendarsById: new Map(relational.calendars.map((calendar) => [calendar.id, calendar])),
      lanesById: new Map(relational.lanes.map((lane) => [lane.id, lane])),
      allowExtension,
    });

    // Only blocks that actually moved are worth a client showing -- levelResources itself reports
    // every eligible block (delay_days: 0 for anything left untouched), which would otherwise
    // swamp a preview with rows nobody needs to look at.
    const movedBlocks = result.leveledBlocks.filter((block) => block.delay_days !== 0);

    return NextResponse.json({ success: true, leveledBlocks: movedBlocks, unresolvedConflicts: result.unresolvedConflicts, projectFinishExtensionDays: result.projectFinishExtensionDays });
  } catch (error) {
    console.error("Scheduling resource leveling preview error", error);
    return NextResponse.json({ error: "Unable to compute a leveled schedule for this project." }, { status: 500 });
  }
}
