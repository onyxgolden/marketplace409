import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

const UNIQUE_VIOLATION = "23505";

export async function PATCH(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { costAccountId } = await params;
    const body = await request.json().catch(() => ({}));

    const patch = {};
    if ("code" in body) {
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!code) return NextResponse.json({ error: "A code is required." }, { status: 400 });
      patch.code = code;
    }
    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });
      patch.name = name;
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    patch.updated_at = new Date().toISOString();

    const { data, error } = await authenticated.supabaseClient.from("schedule_cost_accounts")
      .update(patch).eq("id", costAccountId).eq("owner_id", authenticated.user.id).select("id").maybeSingle();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return NextResponse.json({ error: "A cost code with that code already exists." }, { status: 409 });
      throw error;
    }
    if (!data) return NextResponse.json({ error: "Cost code not found." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Scheduling cost account update error", error);
    return NextResponse.json({ error: "Unable to update this cost code." }, { status: 500 });
  }
}

// schedule_resource_assignments.cost_account_id and schedule_expenses.cost_account_id are both ON
// DELETE SET NULL (see the SCHED-05 migration) -- unlike deleting a resource, deleting a cost code
// never fails with a foreign-key violation; any assignment/expense tagged with it just goes back to
// uncoded instead of losing its cost data.
export async function DELETE(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { costAccountId } = await params;

    const { data, error } = await authenticated.supabaseClient.from("schedule_cost_accounts")
      .delete().eq("id", costAccountId).eq("owner_id", authenticated.user.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Cost code not found." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Scheduling cost account delete error", error);
    return NextResponse.json({ error: "Unable to delete this cost code." }, { status: 500 });
  }
}
