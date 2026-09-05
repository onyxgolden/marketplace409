import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { hydrateBoardState } from "@/components/forge/scheduling/schedulingBoardState";
import { relationalTablesToBoard } from "@/domains/scheduling/schedulingRelationalToBoard";
import { loadProjectRelational, computeAndPersistCpm } from "../scheduleProjectAssembly";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

export async function GET(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;

    const relational = await loadProjectRelational(authenticated.supabaseClient, projectId);
    if (!relational.project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

    const board = hydrateBoardState(relationalTablesToBoard(relational));
    const { byTaskCode, criticalTaskCodes, conflicts } = await computeAndPersistCpm(authenticated.supabaseClient, relational.project, relational);

    return NextResponse.json({
      success: true,
      board: { ...board, cpm: { byTaskCode, criticalTaskCodes, conflicts } },
      isOwner: relational.project.owner_id === authenticated.user.id,
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
