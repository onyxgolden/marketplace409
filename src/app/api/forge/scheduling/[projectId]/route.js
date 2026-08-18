import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { hydrateBoardState } from "@/components/forge/scheduling/schedulingBoardState";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

export async function GET(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;
    // RLS already restricts this to the caller's own rows plus any is_public=true row, so
    // a miss here means "doesn't exist" and "exists but isn't yours or public" alike --
    // both correctly surface as 404, never leaking which one it was.
    const { data, error } = await authenticated.supabaseClient.from("forge_scheduling_projects")
      .select("owner_id,board").eq("id", projectId).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json({
      success: true,
      board: hydrateBoardState(data.board),
      isOwner: data.owner_id === authenticated.user.id,
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
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Scheduling project delete error", error);
    return NextResponse.json({ error: "Unable to delete the scheduling project." }, { status: 500 });
  }
}
