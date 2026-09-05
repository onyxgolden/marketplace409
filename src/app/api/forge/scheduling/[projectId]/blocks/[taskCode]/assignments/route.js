import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { resolveOwnedBlock } from "../../../../scheduleProjectAssembly";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

// Resource cost data is owner-only (no public-select policy -- see the SCHED-05 migration), so
// every route here resolves the block through resolveOwnedBlock (owner_id-filtered) even for GET,
// not just writes: a non-owner gets the same 404 they'd get from RLS silently returning nothing,
// just with a clearer message.
export async function GET(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId, taskCode } = await params;
    const block = await resolveOwnedBlock(authenticated.supabaseClient, authenticated.user.id, projectId, taskCode);
    if (!block) return NextResponse.json({ error: "Block not found, or you don't own this project." }, { status: 404 });

    const { data, error } = await authenticated.supabaseClient.from("schedule_resource_assignments").select("*").eq("block_id", block.id);
    if (error) throw error;
    return NextResponse.json({ success: true, assignments: data || [] });
  } catch (error) {
    console.error("Scheduling assignment list error", error);
    return NextResponse.json({ error: "Unable to load this activity's resource assignments." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId, taskCode } = await params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.resourceId !== "string" || !body.resourceId) return NextResponse.json({ error: "A resource is required." }, { status: 400 });
    const budgetedUnits = Number(body.budgetedUnits);
    if (!Number.isFinite(budgetedUnits) || budgetedUnits < 0) return NextResponse.json({ error: "Budgeted units must be a non-negative number." }, { status: 400 });

    const block = await resolveOwnedBlock(authenticated.supabaseClient, authenticated.user.id, projectId, taskCode);
    if (!block) return NextResponse.json({ error: "Block not found, or you don't own this project." }, { status: 404 });

    const now = new Date().toISOString();
    const assignment = {
      owner_id: authenticated.user.id,
      id: `assignment_${crypto.randomUUID()}`,
      block_id: block.id,
      resource_id: body.resourceId,
      cost_account_id: body.costAccountId || null,
      budgeted_units: budgetedUnits,
      rate_override: body.rateOverride != null && body.rateOverride !== "" ? Number(body.rateOverride) : null,
      actual_units: 0,
      created_at: now, updated_at: now,
    };

    const { error } = await authenticated.supabaseClient.from("schedule_resource_assignments").insert(assignment);
    if (error) {
      // unique(owner_id, block_id, resource_id) -- this resource is already assigned to this activity.
      if (error.code === "23505") return NextResponse.json({ error: "This resource is already assigned to this activity." }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ success: true, assignmentId: assignment.id });
  } catch (error) {
    console.error("Scheduling assignment create error", error);
    return NextResponse.json({ error: "Unable to assign this resource." }, { status: 500 });
  }
}
