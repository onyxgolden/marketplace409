import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { hydrateBoardState } from "@/components/forge/scheduling/schedulingBoardState";
import { relationalTablesToBoard } from "@/domains/scheduling/schedulingRelationalToBoard";
import { runCpmEngine } from "@/domains/scheduling/schedulingCpmEngine";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

// Every relational table directly scoped by schedule_project_id -- schedule_dependencies and
// schedule_hammock_anchors have no such column (see the relational schema migration) and are
// fetched separately, filtered by the block ids these tables already gave us.
const PROJECT_SCOPED_TABLES = [
  ["calendars", "schedule_calendars"],
  ["wbsNodes", "schedule_wbs_nodes"],
  ["blackoutWindows", "schedule_blackout_windows"],
  ["lanes", "schedule_lanes"],
  ["blocks", "schedule_blocks"],
];

// Runs the real CPM engine over a project's Gantt blocks (WBS activities have no dependency graph
// and are excluded -- lane_id is what distinguishes a Gantt block from a WBS activity, see
// schedulingRelationalToBoard.js), keyed by task_code (never namespaced, unlike every other id
// here) so the UI can look up a board block's CPM result without needing to know about relational
// ids at all. Also best-effort persists the computed dates back onto schedule_blocks so a later
// baseline capture (SCHED-04) always has fresh early/late/float data -- failures here are logged,
// never fail the read itself.
async function computeAndPersistCpm(supabaseClient, project, relational) {
  const ganttBlocks = relational.blocks.filter((block) => block.lane_id != null && block.block_type !== "hammock");
  if (ganttBlocks.length === 0) return { byTaskCode: {}, criticalTaskCodes: [], conflicts: [] };

  const blockIds = new Set(relational.blocks.map((block) => block.id));
  const dependencies = relational.dependencies.filter((dependency) => blockIds.has(dependency.predecessor_id) && blockIds.has(dependency.successor_id));

  const result = runCpmEngine({
    project: { start_date: project.start_date, end_date: project.end_date, default_calendar_id: project.default_calendar_id },
    blocks: ganttBlocks, dependencies, calendars: relational.calendars, holidays: [], hammockAnchors: [], lanes: relational.lanes,
  });

  const byTaskCode = {};
  const criticalTaskCodes = [];
  await Promise.all(result.blocks.map(async (block) => {
    byTaskCode[block.task_code] = {
      earlyStart: block.early_start, earlyFinish: block.early_finish,
      lateStart: block.late_start, lateFinish: block.late_finish,
      totalFloatDays: block.total_float_days, isCritical: block.is_critical,
    };
    if (block.is_critical) criticalTaskCodes.push(block.task_code);
    const { error } = await supabaseClient.from("schedule_blocks").update({
      early_start: block.early_start, early_finish: block.early_finish,
      late_start: block.late_start, late_finish: block.late_finish,
      total_float_days: block.total_float_days, is_critical: block.is_critical,
    }).eq("owner_id", block.owner_id).eq("id", block.id);
    if (error) console.error("CPM persist error for block", block.id, error);
  }));

  return { byTaskCode, criticalTaskCodes, conflicts: result.conflicts };
}

export async function GET(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;

    // RLS already restricts this to the caller's own rows plus any is_public=true row (and, via
    // the public-select policies added alongside sync_schedule_project_from_board, every other
    // schedule_* table scoped to that same project) -- a miss here means "doesn't exist" and
    // "exists but isn't yours or public" alike, both correctly surfacing as 404.
    const { data: project, error: projectError } = await authenticated.supabaseClient
      .from("schedule_projects").select("*").eq("id", projectId).maybeSingle();
    if (projectError) throw projectError;
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

    const results = await Promise.all(
      PROJECT_SCOPED_TABLES.map(([, table]) => authenticated.supabaseClient.from(table).select("*").eq("schedule_project_id", projectId)),
    );
    const failedScoped = results.find((result) => result.error);
    if (failedScoped) throw failedScoped.error;
    const relational = { project, ...Object.fromEntries(PROJECT_SCOPED_TABLES.map(([key], index) => [key, results[index].data || []])) };

    const blockIds = relational.blocks.map((block) => block.id);
    const { data: dependencies, error: dependenciesError } = blockIds.length
      ? await authenticated.supabaseClient.from("schedule_dependencies").select("*").in("predecessor_id", blockIds)
      : { data: [], error: null };
    if (dependenciesError) throw dependenciesError;
    relational.dependencies = dependencies || [];

    const board = hydrateBoardState(relationalTablesToBoard(relational));
    const cpm = await computeAndPersistCpm(authenticated.supabaseClient, project, relational);

    return NextResponse.json({
      success: true,
      board: { ...board, cpm },
      isOwner: project.owner_id === authenticated.user.id,
    });
  } catch (error) {
    console.error("Scheduling project load error", error);
    return NextResponse.json({ error: "Unable to load the scheduling project." }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;
    const board = await request.json();
    if (!board || typeof board !== "object") return NextResponse.json({ error: "A board is required." }, { status: 400 });
    const updatedAt = new Date().toISOString();
    const record = {
      project_name: board.projectName || "New Project",
      start_date: board.startDate || null,
      end_date: board.endDate || null,
      board: { ...board, updatedAt },
      updated_at: updatedAt,
    };
    // The owner_id match in the WHERE clause (on top of what RLS already enforces) is what
    // makes an attempt to save the shared example -- or anyone else's project -- affect 0
    // rows instead of erroring, so it comes back as a clean 404 rather than a 500.
    const { data, error } = await authenticated.supabaseClient.from("forge_scheduling_projects")
      .update(record).eq("id", projectId).eq("owner_id", authenticated.user.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Project not found, or you don't own it." }, { status: 404 });

    // Relational tables are the real source of truth for reads (see GET above); the jsonb write
    // above stays a safety net during rollout, not the read path. Sync failure is logged but never
    // fails the user's save -- see the migration that adds this function for the full rationale.
    const { error: syncError } = await authenticated.supabaseClient.rpc("sync_schedule_project_from_board", {
      p_owner_id: authenticated.user.id, p_project_id: projectId,
    });
    if (syncError) console.error("Scheduling relational sync error", syncError);

    return NextResponse.json({ success: true, updatedAt });
  } catch (error) {
    console.error("Scheduling project save error", error);
    return NextResponse.json({ error: "Unable to save the scheduling project." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;
    const { data, error } = await authenticated.supabaseClient.from("forge_scheduling_projects")
      .delete().eq("id", projectId).eq("owner_id", authenticated.user.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Project not found, or you don't own it." }, { status: 404 });

    // schedule_projects has no FK back to forge_scheduling_projects, so deleting the jsonb row
    // above doesn't cascade to its relational mirror -- every schedule_* child table does cascade
    // from schedule_projects, though, so this one delete is enough. Logged, not fatal: the row the
    // user asked to delete is already gone by the point this runs.
    const { error: relationalDeleteError } = await authenticated.supabaseClient.from("schedule_projects")
      .delete().eq("id", projectId).eq("owner_id", authenticated.user.id);
    if (relationalDeleteError) console.error("Scheduling relational delete error", relationalDeleteError);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Scheduling project delete error", error);
    return NextResponse.json({ error: "Unable to delete the scheduling project." }, { status: 500 });
  }
}
