import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { rowToField, validateFieldDefinition } from "@/domains/rental-forms/customFields";

export const runtime = "nodejs";

// Rentec parity R15: single custom field definition. Reads are open to every
// workspace member; writes are owner/co-owner only.

async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

async function loadField(authenticated, id) {
  const { data, error } = await authenticated.supabaseClient
    .from("rental_custom_fields")
    .select("id, entity, name, field_key, field_type, is_required, picklist_options, sort_order, updated_at")
    .eq("owner_id", authenticated.effectiveOwnerId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function GET(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const field = await loadField(authenticated, params.id);
    if (!field) return NextResponse.json({ error: "Custom field was not found." }, { status: 404 });
    return NextResponse.json({ success: true, field: rowToField(field) });
  } catch (error) {
    console.error("Custom field load error", error);
    return NextResponse.json({ error: "Unable to load the custom field." }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await readOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Read-only members cannot manage custom fields." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const validated = validateFieldDefinition(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  try {
    const existing = await loadField(authenticated, params.id);
    if (!existing) return NextResponse.json({ error: "Custom field was not found." }, { status: 404 });
    const { data, error } = await authenticated.supabaseClient
      .from("rental_custom_fields")
      .update({
        entity: validated.clean.entity,
        name: validated.clean.name,
        field_key: validated.clean.fieldKey,
        field_type: validated.clean.fieldType,
        is_required: validated.clean.isRequired,
        picklist_options: validated.clean.picklistOptions,
        updated_at: new Date().toISOString(),
      })
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", params.id)
      .select("id, entity, name, field_key, field_type, is_required, picklist_options, sort_order, updated_at")
      .single();
    if (error) {
      if (String(error.code) === "23505" || /duplicate/i.test(String(error.message))) {
        return NextResponse.json(
          { error: "A field with that name already exists for this record type." },
          { status: 409 },
        );
      }
      throw error;
    }
    return NextResponse.json({ success: true, field: rowToField(data) });
  } catch (error) {
    console.error("Custom field update error", error);
    return NextResponse.json({ error: "Unable to update the custom field." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await readOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Read-only members cannot manage custom fields." }, { status: 403 });
  }
  try {
    const existing = await loadField(authenticated, params.id);
    if (!existing) return NextResponse.json({ error: "Custom field was not found." }, { status: 404 });
    // Stored values cascade via the FK (on delete cascade); the render
    // context simply stops seeing the field's key afterwards.
    const { error } = await authenticated.supabaseClient
      .from("rental_custom_fields")
      .delete()
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", params.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Custom field delete error", error);
    return NextResponse.json({ error: "Unable to delete the custom field." }, { status: 500 });
  }
}
