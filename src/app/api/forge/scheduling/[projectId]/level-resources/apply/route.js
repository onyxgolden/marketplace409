import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { levelResources } from "@/domains/scheduling/schedulingResourceLeveling";
import { loadProjectRelational, loadResourceCostData, computeAndPersistCpm } from "../../../scheduleProjectAssembly";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

// Re-runs the SAME computation as GET .../level-resources server-side rather than trusting a
// client-supplied set of dates -- the preview is display-only; this is the one place leveling
// actually becomes a write. For every block that moved (delay_days !== 0), persists the leveled
// start as a start_on constraint -- reusing the exact constraint field/semantics the CPM engine
// already honors (see the SCHED-05...SCHED-09 build-out), rather than inventing a new "leveled
// date" column. A block the algorithm never moved (delay_days === 0, including every hard-pinned
// block -- see schedulingResourceLeveling.js's isHardPinned guard) is left untouched.
export async function POST(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));
    const allowExtension = body.allowExtension === true;

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

    const movedBlocks = result.leveledBlocks.filter((block) => block.delay_days !== 0);
    await Promise.all(movedBlocks.map(async (block) => {
      const { error } = await authenticated.supabaseClient.from("schedule_blocks")
        .update({ constraint_type: "start_on", constraint_date: block.leveled_start })
        .eq("owner_id", authenticated.user.id).eq("id", block.id);
      if (error) console.error("Leveling apply persist error for block", block.id, error);
    }));

    return NextResponse.json({ success: true, appliedCount: movedBlocks.length });
  } catch (error) {
    console.error("Scheduling resource leveling apply error", error);
    return NextResponse.json({ error: "Unable to apply the leveled schedule for this project." }, { status: 500 });
  }
}
