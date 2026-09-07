import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

// A Postgres unique-violation (schedule_cost_accounts has unique(owner_id, code)) surfaces as this
// unfriendly code -- turn it into the one message a caller actually needs, matching the resources
// route's identical handling.
const UNIQUE_VIOLATION = "23505";

// SCHED-19: cost accounts are an owner-global flat code/name dictionary (see the SCHED-05
// migration), same shape and scoping as schedule_resources -- a PO#, WO#, or any other cost code
// the caller wants to tag a resource assignment or expense with. Not scoped to any one project, so
// this route lives directly under /api/forge/scheduling, mirroring /resources exactly.
export async function GET() {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { data, error } = await authenticated.supabaseClient.from("schedule_cost_accounts").select("*").order("code");
    if (error) throw error;
    return NextResponse.json({ success: true, costAccounts: data || [] });
  } catch (error) {
    console.error("Scheduling cost account list error", error);
    return NextResponse.json({ error: "Unable to load cost codes." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const body = await request.json().catch(() => ({}));

    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) return NextResponse.json({ error: "A code is required." }, { status: 400 });
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });

    const now = new Date().toISOString();
    const costAccount = {
      owner_id: authenticated.user.id,
      id: `cost_account_${crypto.randomUUID()}`,
      code, name,
      created_at: now, updated_at: now,
    };

    const { error } = await authenticated.supabaseClient.from("schedule_cost_accounts").insert(costAccount);
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return NextResponse.json({ error: "A cost code with that code already exists." }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ success: true, costAccountId: costAccount.id });
  } catch (error) {
    console.error("Scheduling cost account create error", error);
    return NextResponse.json({ error: "Unable to create this cost code." }, { status: 500 });
  }
}
