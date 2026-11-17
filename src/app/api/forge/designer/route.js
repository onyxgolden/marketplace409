import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
// HOME DESIGNER slice 2: new projects are born as a HomeProject envelope so
// multi-level works from creation. Legacy rows keep loading untouched.
import { createHomeProject } from "@/domains/roomDesigner/homeProject";
import { getCachedDesignerProjects } from "@/lib/forge/listReadCache";

// S2A (load-times slice 2): the list is served from the hot-read server
// data cache (see src/lib/forge/listReadCache.js). Auth still runs first,
// on every request, before any cache lookup — including hits. The Designer
// list is strictly owner-filtered (no public rows), so the whole DTO is
// cached. HTTP responses stay private/non-cacheable.
const NO_STORE = { "Cache-Control": "private, no-store" };

function ownerIdOf(authenticated) {
  return authenticated.effectiveOwnerId || authenticated.user.id;
}

// GET /api/forge/designer — list the caller's saved designs (newest first).
// UI-density redesign: ?workspace=<ownerId> selects a workspace the actor
// can act within, validated the same way as the work API (own id or an
// active membership only; anything else falls back to the default).
export async function GET(request) {
  try {
    let requestedOwnerId = null;
    try {
      requestedOwnerId = new URL(request.url).searchParams.get("workspace");
    } catch {
      requestedOwnerId = null;
    }
    const authenticated = await createAuthenticatedForgeApplication({ requestedOwnerId, appKey: "designer" });
    if (authenticated.response) return authenticated.response;
    const ownerId = ownerIdOf(authenticated);
    const projects = await getCachedDesignerProjects({
      supabaseClient: authenticated.supabaseClient,
      ownerId,
      actorId: authenticated.user.id,
    });
    return NextResponse.json({ success: true, projects }, { headers: NO_STORE });
  } catch (error) {
    console.error("Designer projects list error", error);
    return NextResponse.json({ error: "Unable to load room designs." }, { status: 500 });
  }
}

// POST /api/forge/designer — create a new blank design owned by the caller.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication({ appKey: "designer" });
    if (authenticated.response) return authenticated.response;
    const body = await request.json().catch(() => ({}));
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim().slice(0, 120)
        : "Untitled design";
    const design = createHomeProject(name);
    const id = `design_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const { error } = await authenticated.supabaseClient
      .from("designer_projects")
      .insert({
        owner_id: ownerIdOf(authenticated),
        id,
        project_name: name,
        design,
      });
    if (error) throw error;

    // S2A: no cache step here by design (fix round 1, P1-1/P1-2). The list
    // GET re-probes the digest on every request, and the insert above
    // changes the digest, so the next list read cannot serve the pre-write
    // entry — freshness needs no invalidation call that could fail silently.
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("Designer project create error", error);
    return NextResponse.json({ error: "Unable to create a room design." }, { status: 500 });
  }
}
