import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { parseDesign, validateDesign } from "@/domains/roomDesigner/designerDocument";

function ownerIdOf(authenticated) {
  return authenticated.effectiveOwnerId || authenticated.user.id;
}

async function loadProject(authenticated, projectId) {
  const { data, error } = await authenticated.supabaseClient
    .from("designer_projects")
    .select("id,owner_id,project_name,design,created_at,updated_at")
    .eq("owner_id", ownerIdOf(authenticated))
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// GET /api/forge/designer/[projectId] — load one design.
export async function GET(_request, { params }) {
  const { projectId } = await params;
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const project = await loadProject(authenticated, projectId);
    if (!project) {
      return NextResponse.json({ error: "Room design not found." }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      project: {
        id: project.id,
        name: project.project_name,
        design: project.design,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
      },
    });
  } catch (error) {
    console.error("Designer project load error", error);
    return NextResponse.json({ error: "Unable to load the room design." }, { status: 500 });
  }
}

// PUT /api/forge/designer/[projectId] — save the design document.
// The document is validated structurally before write; invalid documents
// are rejected with 400 so a corrupt client state can never persist.
export async function PUT(request, { params }) {
  const { projectId } = await params;
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const body = await request.json().catch(() => null);
    if (!body || typeof body.design === "undefined") {
      return NextResponse.json({ error: "A design document is required." }, { status: 400 });
    }
    let design;
    try {
      design = parseDesign(JSON.stringify(body.design));
    } catch (parseError) {
      return NextResponse.json(
        { error: `Invalid design document: ${parseError.message}` },
        { status: 400 },
      );
    }
    const problems = validateDesign(design);
    if (problems.length > 0) {
      return NextResponse.json(
        { error: `Design failed validation: ${problems[0]}` },
        { status: 400 },
      );
    }
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim().slice(0, 120)
        : design.name;
    const { data, error } = await authenticated.supabaseClient
      .from("designer_projects")
      .update({ project_name: name, design: { ...design, name }, updated_at: new Date().toISOString() })
      .eq("owner_id", ownerIdOf(authenticated))
      .eq("id", projectId)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Room design not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, id: projectId });
  } catch (error) {
    console.error("Designer project save error", error);
    return NextResponse.json({ error: "Unable to save the room design." }, { status: 500 });
  }
}

// DELETE /api/forge/designer/[projectId] — delete a design.
export async function DELETE(_request, { params }) {
  const { projectId } = await params;
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const { error } = await authenticated.supabaseClient
      .from("designer_projects")
      .delete()
      .eq("owner_id", ownerIdOf(authenticated))
      .eq("id", projectId);
    if (error) throw error;
    return NextResponse.json({ success: true, id: projectId });
  } catch (error) {
    console.error("Designer project delete error", error);
    return NextResponse.json({ error: "Unable to delete the room design." }, { status: 500 });
  }
}
