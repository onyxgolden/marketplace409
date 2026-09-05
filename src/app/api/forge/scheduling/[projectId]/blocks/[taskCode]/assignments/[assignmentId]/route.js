import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

// No block/taskCode lookup needed here (unlike the collection route) -- assignmentId plus an
// owner_id match in the WHERE clause is enough to scope this write, same pattern as the progress
// PATCH route. taskCode/projectId in the URL are for a clean, RESTful nested path; not consulted.
export async function PATCH(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { assignmentId } = await params;
    const body = await request.json().catch(() => ({}));

    const patch = {};
    if ("budgetedUnits" in body) {
      const budgetedUnits = Number(body.budgetedUnits);
      if (!Number.isFinite(budgetedUnits) || budgetedUnits < 0) return NextResponse.json({ error: "Budgeted units must be a non-negative number." }, { status: 400 });
      patch.budgeted_units = budgetedUnits;
    }
    if ("actualUnits" in body) {
      const actualUnits = Number(body.actualUnits);
      if (!Number.isFinite(actualUnits) || actualUnits < 0) return NextResponse.json({ error: "Actual units must be a non-negative number." }, { status: 400 });
      patch.actual_units = actualUnits;
    }
    if ("rateOverride" in body) patch.rate_override = body.rateOverride != null && body.rateOverride !== "" ? Number(body.rateOverride) : null;
    if ("costAccountId" in body) patch.cost_account_id = body.costAccountId || null;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    patch.updated_at = new Date().toISOString();

    const { data, error } = await authenticated.supabaseClient.from("schedule_resource_assignments")
      .update(patch).eq("id", assignmentId).eq("owner_id", authenticated.user.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Assignment not found, or you don't own this project." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Scheduling assignment update error", error);
    return NextResponse.json({ error: "Unable to update this assignment." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { assignmentId } = await params;

    const { data, error } = await authenticated.supabaseClient.from("schedule_resource_assignments")
      .delete().eq("id", assignmentId).eq("owner_id", authenticated.user.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Assignment not found, or you don't own this project." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Scheduling assignment delete error", error);
    return NextResponse.json({ error: "Unable to remove this assignment." }, { status: 500 });
  }
}
