import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

const RESOURCE_TYPES = ["labor", "nonlabor", "material"];
const UNIQUE_VIOLATION = "23505";
// schedule_resource_assignments.resource_id is ON DELETE RESTRICT (see the SCHED-05 migration) --
// deleting a resource still tied to budget/actual history throws this code instead of silently
// destroying cost data. Surfaced as a clear, actionable message rather than a raw 500.
const FOREIGN_KEY_VIOLATION = "23503";

export async function PATCH(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { resourceId } = await params;
    const body = await request.json().catch(() => ({}));

    const patch = {};
    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return NextResponse.json({ error: "A resource name is required." }, { status: 400 });
      patch.name = name;
    }
    if ("resourceType" in body) {
      if (!RESOURCE_TYPES.includes(body.resourceType)) return NextResponse.json({ error: "resourceType must be labor, nonlabor, or material." }, { status: 400 });
      patch.resource_type = body.resourceType;
    }
    if ("unitOfMeasure" in body) patch.unit_of_measure = typeof body.unitOfMeasure === "string" && body.unitOfMeasure.trim() ? body.unitOfMeasure.trim() : null;
    if ("calendarId" in body) patch.calendar_id = body.calendarId || null;
    if ("maxUnitsPerDay" in body) patch.max_units_per_day = Number(body.maxUnitsPerDay) > 0 ? Number(body.maxUnitsPerDay) : 8;
    if ("stdRate" in body) patch.std_rate = Number(body.stdRate) >= 0 ? Number(body.stdRate) : 0;
    if ("isActive" in body) patch.is_active = !!body.isActive;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    patch.updated_at = new Date().toISOString();

    const { data, error } = await authenticated.supabaseClient.from("schedule_resources")
      .update(patch).eq("id", resourceId).eq("owner_id", authenticated.user.id).select("id").maybeSingle();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return NextResponse.json({ error: "A resource with that name already exists." }, { status: 409 });
      throw error;
    }
    if (!data) return NextResponse.json({ error: "Resource not found." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Scheduling resource update error", error);
    return NextResponse.json({ error: "Unable to update this resource." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { resourceId } = await params;

    const { data, error } = await authenticated.supabaseClient.from("schedule_resources")
      .delete().eq("id", resourceId).eq("owner_id", authenticated.user.id).select("id").maybeSingle();
    if (error) {
      if (error.code === FOREIGN_KEY_VIOLATION) {
        return NextResponse.json({ error: "This resource has assignments on one or more activities -- remove those first, or deactivate the resource instead of deleting it." }, { status: 409 });
      }
      throw error;
    }
    if (!data) return NextResponse.json({ error: "Resource not found." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Scheduling resource delete error", error);
    return NextResponse.json({ error: "Unable to delete this resource." }, { status: 500 });
  }
}
