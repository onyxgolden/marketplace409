import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { defaultBoardState } from "@/components/forge/scheduling/schedulingBoardState";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

// RLS on forge_scheduling_projects grants select on a user's own rows AND any row with
// is_public=true (the shared "Example project"), so a plain select with no owner filter
// already returns exactly the right set -- see supabase/migrations/*_create_forge_scheduling_projects.sql.
export async function GET() {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { data, error } = await authenticated.supabaseClient.from("forge_scheduling_projects")
      .select("id,owner_id,project_name,start_date,end_date,is_public,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const projects = (data || []).map((row) => ({
      id: row.id, name: row.project_name, startDate: row.start_date, endDate: row.end_date,
      createdAt: row.created_at, updatedAt: row.updated_at,
      isOwner: row.owner_id === authenticated.user.id, isPublic: row.is_public,
    }));
    return NextResponse.json({ success: true, projects });
  } catch (error) {
    console.error("Scheduling projects list error", error);
    return NextResponse.json({ error: "Unable to load scheduling projects." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const body = await request.json().catch(() => ({}));
    // A bogus templateId falls back to the catalog's first template (see
    // projectTemplateById); an absent one falls back to defaultBoardState's own default
    // ("capital", for compatibility with callers that predate templates) -- either way,
    // never an error, just some reasonable starter content.
    const board = defaultBoardState(undefined, body.templateId);
    const record = {
      owner_id: authenticated.user.id, id: board.id, project_name: board.projectName,
      start_date: board.startDate, end_date: board.endDate, board,
      created_at: board.createdAt, updated_at: board.updatedAt,
    };
    const { data, error } = await authenticated.supabaseClient.from("forge_scheduling_projects")
      .insert(record).select("id").single();
    if (error) throw error;

    // GET /api/forge/scheduling/[projectId] reads from schedule_projects, not this jsonb row --
    // without this, the very first load of a newly-created project would 404 (no relational row
    // exists yet). Not best-effort here, unlike the PUT route's sync call: a failure means the
    // project the caller just asked to create isn't actually usable yet, so it should surface.
    const { error: syncError } = await authenticated.supabaseClient.rpc("sync_schedule_project_from_board", {
      p_owner_id: authenticated.user.id, p_project_id: data.id,
    });
    if (syncError) throw syncError;

    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error("Scheduling project create error", error);
    return NextResponse.json({ error: "Unable to create a new scheduling project." }, { status: 500 });
  }
}
