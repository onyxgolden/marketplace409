import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
// HOME DESIGNER slice 2: new projects are born as a HomeProject envelope so
// multi-level works from creation. Legacy rows keep loading untouched.
import { createHomeProject } from "@/domains/roomDesigner/homeProject";

function ownerIdOf(authenticated) {
  return authenticated.effectiveOwnerId || authenticated.user.id;
}

// GET /api/forge/designer — list the caller's saved designs (newest first).
export async function GET() {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const { data, error } = await authenticated.supabaseClient
      .from("designer_projects")
      .select("id,owner_id,project_name,created_at,updated_at")
      .eq("owner_id", ownerIdOf(authenticated))
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({
      success: true,
      projects: (data || []).map((row) => ({
        id: row.id,
        name: row.project_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error("Designer projects list error", error);
    return NextResponse.json({ error: "Unable to load room designs." }, { status: 500 });
  }
}

// POST /api/forge/designer — create a new blank design owned by the caller.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
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
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("Designer project create error", error);
    return NextResponse.json({ error: "Unable to create a room design." }, { status: 500 });
  }
}
