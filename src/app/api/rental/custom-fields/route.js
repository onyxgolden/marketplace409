import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { rowToField, validateFieldDefinition } from "@/domains/rental-forms/customFields";

export const runtime = "nodejs";

// Rentec parity R15: custom field definitions (Settings → Custom fields in
// Rentec's IA; FORGE mounts it in the Rental Setup panel). GET is readable
// by every workspace member — reading definitions is not a write. POST/PUT/
// DELETE are owner/co-owner only (403 for read-only members).

async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

export async function GET(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const { searchParams } = new URL(request.url);
    let query = authenticated.supabaseClient
      .from("rental_custom_fields")
      .select("id, entity, name, field_key, field_type, is_required, picklist_options, sort_order, updated_at")
      .eq("owner_id", authenticated.effectiveOwnerId);
    const entity = searchParams.get("entity");
    if (entity) query = query.eq("entity", entity);
    const { data, error } = await query
      .order("entity", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ success: true, fields: (data || []).map(rowToField) });
  } catch (error) {
    console.error("Custom fields load error", error);
    return NextResponse.json({ error: "Unable to load custom fields." }, { status: 500 });
  }
}

export async function POST(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await readOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Read-only members cannot manage custom fields." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const validated = validateFieldDefinition(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  try {
    const { data, error } = await authenticated.supabaseClient
      .from("rental_custom_fields")
      .insert({
        owner_id: authenticated.effectiveOwnerId,
        entity: validated.clean.entity,
        name: validated.clean.name,
        field_key: validated.clean.fieldKey,
        field_type: validated.clean.fieldType,
        is_required: validated.clean.isRequired,
        picklist_options: validated.clean.picklistOptions,
        created_by: authenticated.user.id,
      })
      .select("id, entity, name, field_key, field_type, is_required, picklist_options, sort_order, updated_at")
      .single();
    if (error) {
      // A duplicate name on the same entity hits the unique constraint.
      if (String(error.code) === "23505" || /duplicate/i.test(String(error.message))) {
        return NextResponse.json(
          { error: "A field with that name already exists for this record type." },
          { status: 409 },
        );
      }
      throw error;
    }
    return NextResponse.json({ success: true, field: rowToField(data) }, { status: 201 });
  } catch (error) {
    console.error("Custom field create error", error);
    return NextResponse.json({ error: "Unable to save the custom field." }, { status: 500 });
  }
}
