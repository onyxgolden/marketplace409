import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { hydrateBoardState } from "@/components/forge/scheduling/schedulingBoardState";
import { relationalTablesToBoard, stripNamespace } from "@/domains/scheduling/schedulingRelationalToBoard";
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
    const { byTaskCode, criticalTaskCodes, conflicts, cycleDiagnoses } = await computeAndPersistCpm(authenticated.supabaseClient, relational.project, relational);

    // Every id in `board` has already been de-namespaced by relationalTablesToBoard -- the
    // suggested dependency's id needs the same treatment before the client's removeDependency
    // board action (which matches against board.dependencies' already-stripped ids) can use it.
    const boardCycleDiagnoses = cycleDiagnoses.map((cycle) => (
      cycle.suggestion
        ? { ...cycle, suggestion: { ...cycle.suggestion, dependency: { ...cycle.suggestion.dependency, id: stripNamespace(projectId, cycle.suggestion.dependency.id) } } }
        : cycle
    ));

    return NextResponse.json({
      success: true,
      board: { ...board, cpm: { byTaskCode, criticalTaskCodes, conflicts, cycleDiagnoses: boardCycleDiagnoses } },
      isOwner: relational.project.owner_id === authenticated.user.id,
    });
  } catch (error) {
    console.error("Scheduling project load error", error);
    return NextResponse.json({ error: "Unable to load the scheduling project." }, { status: 500 });
  }
}

// SCHED-20: the board JSON write and the relational sync now happen inside
// save_schedule_project_board's single plpgsql call -- one DB transaction, so a sync failure
// rolls back the JSON write too instead of the two silently diverging (the old route logged
// and ignored sync errors). expectedRevision is the board_revision the client last loaded
// (board.boardRevision from GET, defaulting to 0 for a client that hasn't reloaded since
// this shipped); a mismatch means someone else saved this project first, and the function
// raises SCHEDULE_SAVE_CONFLICT rather than silently overwriting their save.
const CONFLICT_MESSAGE = "This schedule changed elsewhere; reload before saving.";

export async function PUT(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;
    const board = await request.json();
    if (!board || typeof board !== "object") return NextResponse.json({ error: "A board is required." }, { status: 400 });
    const expectedRevision = Number.isInteger(board.boardRevision) ? board.boardRevision : 0;
    const updatedAt = new Date().toISOString();

    const { data, error } = await authenticated.supabaseClient.rpc("save_schedule_project_board", {
      p_owner_id: authenticated.user.id,
      p_project_id: projectId,
      p_board: { ...board, updatedAt },
      p_expected_revision: expectedRevision,
    });

    if (error) {
      if (error.message?.includes("SCHEDULE_SAVE_CONFLICT")) {
        return NextResponse.json({ error: CONFLICT_MESSAGE, code: "SCHEDULE_SAVE_CONFLICT" }, { status: 409 });
      }
      if (error.message?.includes("SCHEDULE_SAVE_NOT_FOUND")) {
        return NextResponse.json({ error: "Project not found, or you don't own it." }, { status: 404 });
      }
      throw error;
    }

    const result = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ success: true, updatedAt: result?.updated_at ?? updatedAt, boardRevision: result?.board_revision ?? expectedRevision + 1 });
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
