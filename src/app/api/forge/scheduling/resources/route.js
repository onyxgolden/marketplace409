import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

const RESOURCE_TYPES = ["labor", "nonlabor", "material"];
// A Postgres unique-violation (schedule_resources has unique(owner_id, name)) surfaces as this
// unfriendly code -- turn it into the one message a caller actually needs, same as the baselines
// route's duplicate-name handling.
const UNIQUE_VIOLATION = "23505";

// Resources are an owner-global dictionary, not scoped to any one project (see the SCHED-05
// migration) -- this route lives directly under /api/forge/scheduling, not under [projectId].
export async function GET() {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { data, error } = await authenticated.supabaseClient.from("schedule_resources").select("*").order("name");
    if (error) throw error;
    return NextResponse.json({ success: true, resources: data || [] });
  } catch (error) {
    console.error("Scheduling resource list error", error);
    return NextResponse.json({ error: "Unable to load resources." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const body = await request.json().catch(() => ({}));

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "A resource name is required." }, { status: 400 });
    if (!RESOURCE_TYPES.includes(body.resourceType)) return NextResponse.json({ error: "resourceType must be labor, nonlabor, or material." }, { status: 400 });

    const now = new Date().toISOString();
    const resource = {
      owner_id: authenticated.user.id,
      id: `resource_${crypto.randomUUID()}`,
      name,
      resource_type: body.resourceType,
      unit_of_measure: typeof body.unitOfMeasure === "string" && body.unitOfMeasure.trim() ? body.unitOfMeasure.trim() : null,
      calendar_id: body.calendarId || null,
      max_units_per_day: Number(body.maxUnitsPerDay) > 0 ? Number(body.maxUnitsPerDay) : 8,
      std_rate: Number(body.stdRate) >= 0 ? Number(body.stdRate) : 0,
      created_at: now, updated_at: now,
    };

    const { error } = await authenticated.supabaseClient.from("schedule_resources").insert(resource);
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return NextResponse.json({ error: "A resource with that name already exists." }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ success: true, resourceId: resource.id });
  } catch (error) {
    console.error("Scheduling resource create error", error);
    return NextResponse.json({ error: "Unable to create this resource." }, { status: 500 });
  }
}
