import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { captureBaseline } from "@/domains/scheduling/schedulingBaselines";
import { loadProjectRelational, computeAndPersistCpm } from "../../scheduleProjectAssembly";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

// A Postgres unique-violation (schedule_baselines has unique(owner_id, schedule_project_id, name))
// surfaces as this unfriendly code -- turn it into the one message a caller actually needs.
const UNIQUE_VIOLATION = "23505";

export async function GET(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;
    // RLS (owner-scoped plus the public-select policy added alongside this route) already limits
    // this to baselines the caller may see -- no separate project-existence check needed for a list.
    const { data, error } = await authenticated.supabaseClient.from("schedule_baselines")
      .select("id,name,created_at").eq("schedule_project_id", projectId).order("created_at", { ascending: false });
    if (error) throw error;
    const baselines = (data || []).map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
    return NextResponse.json({ success: true, baselines });
  } catch (error) {
    console.error("Scheduling baseline list error", error);
    return NextResponse.json({ error: "Unable to load this project's baselines." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "A baseline name is required." }, { status: 400 });

    const relational = await loadProjectRelational(authenticated.supabaseClient, projectId);
    if (!relational.project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    // Capturing a baseline is a write, unlike viewing the board -- a non-owner (the shared example's
    // read-only viewers) never gets to snapshot someone else's schedule, matching the owner check
    // every other write in this API already does.
    if (relational.project.owner_id !== authenticated.user.id) {
      return NextResponse.json({ error: "You don't own this project." }, { status: 404 });
    }

    const { cpmBlocks } = await computeAndPersistCpm(authenticated.supabaseClient, relational.project, relational);
    const baselineId = `baseline_${crypto.randomUUID()}`;
    const { baseline, baselineBlocks } = captureBaseline({
      project: relational.project, blocks: cpmBlocks, name, ownerId: authenticated.user.id,
      baselineId, createdAt: new Date().toISOString(),
    });

    const { error: baselineError } = await authenticated.supabaseClient.from("schedule_baselines").insert(baseline);
    if (baselineError) {
      if (baselineError.code === UNIQUE_VIOLATION) return NextResponse.json({ error: "A baseline with that name already exists for this project." }, { status: 409 });
      throw baselineError;
    }
    if (baselineBlocks.length > 0) {
      const { error: blocksError } = await authenticated.supabaseClient.from("schedule_baseline_blocks").insert(baselineBlocks);
      if (blocksError) throw blocksError;
    }

    return NextResponse.json({ success: true, baselineId });
  } catch (error) {
    console.error("Scheduling baseline capture error", error);
    return NextResponse.json({ error: "Unable to capture a baseline for this project." }, { status: 500 });
  }
}
