import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

// Progress fields only (percent_complete/actual_start/actual_finish) -- everything else about a
// block (label, dates, dependencies) still flows through the whole-board PUT, matching how
// ActivitiesPage.jsx already edits percent_complete on WBS activities today. This is a direct
// relational write with no board-jsonb round-trip at all: the legacy board.blocks shape never
// learned these fields (see scheduleProjectAssembly.js), so there's nothing to keep in sync.
export async function PATCH(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId, taskCode } = await params;
    const body = await request.json().catch(() => ({}));

    const patch = {};
    if ("percentComplete" in body) patch.percent_complete = Math.max(0, Math.min(100, Math.round(Number(body.percentComplete)) || 0));
    if ("actualStart" in body) patch.actual_start = body.actualStart || null;
    if ("actualFinish" in body) patch.actual_finish = body.actualFinish || null;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

    // The owner_id match in the WHERE clause (on top of what RLS already enforces) is what makes
    // an attempt to edit the shared example -- or anyone else's project -- affect 0 rows instead of
    // erroring, so it comes back as a clean 404, matching every other write in this API.
    const { data, error } = await authenticated.supabaseClient.from("schedule_blocks")
      .update(patch).eq("schedule_project_id", projectId).eq("task_code", taskCode).eq("owner_id", authenticated.user.id)
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Block not found, or you don't own this project." }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Scheduling block progress update error", error);
    return NextResponse.json({ error: "Unable to update progress for this block." }, { status: 500 });
  }
}
