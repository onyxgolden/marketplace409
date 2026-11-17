import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { defaultBoardState } from "@/components/forge/scheduling/schedulingBoardState";
import {
  fetchFreshPublicSchedulingProjects,
  getCachedSchedulingPrivateProjects,
  mergeSchedulingProjectLists,
} from "@/lib/forge/listReadCache";

// S2A (load-times slice 2): the list is served from the hot-read server
// data cache (see src/lib/forge/listReadCache.js). Auth still runs first,
// on every request, before any cache lookup — including hits. The cached
// portion is the owner-scoped rows only; the shared public example rows
// are fetched fresh on every GET and merged, so a public row can never
// linger stale in another actor's cache entry. HTTP responses stay
// private/non-cacheable.
const NO_STORE = { "Cache-Control": "private, no-store" };

async function authenticatedContext() {
  return createAuthenticatedForgeApplication({ appKey: "scheduler" });
}

// RLS on forge_scheduling_projects grants select on a user's own rows AND any row with
// is_public=true (the shared "Example project"), so a plain select with no owner filter
// already returns exactly the right set -- see supabase/migrations/*_create_forge_scheduling_projects.sql.
export async function GET() {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const privateProjects = await getCachedSchedulingPrivateProjects({
      supabaseClient: authenticated.supabaseClient,
      effectiveOwnerId: authenticated.effectiveOwnerId,
      actorId: authenticated.user.id,
    });
    const publicProjects = await fetchFreshPublicSchedulingProjects({
      supabaseClient: authenticated.supabaseClient,
      effectiveOwnerId: authenticated.effectiveOwnerId,
    });
    const projects = mergeSchedulingProjectLists(privateProjects, publicProjects);
    return NextResponse.json({ success: true, projects }, { headers: NO_STORE });
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
      owner_id: authenticated.effectiveOwnerId, id: board.id, project_name: board.projectName,
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
      p_owner_id: authenticated.effectiveOwnerId, p_project_id: data.id,
    });
    if (syncError) throw syncError;

    // S2A: no cache step here by design (fix round 1, P1-1/P1-2). The list
    // GET re-probes the generation on every request, and the insert above
    // changes the count, so the next list read cannot serve the pre-write
    // entry — freshness needs no invalidation call that could fail silently.
    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error("Scheduling project create error", error);
    return NextResponse.json({ error: "Unable to create a new scheduling project." }, { status: 500 });
  }
}
