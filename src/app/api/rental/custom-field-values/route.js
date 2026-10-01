import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { rowToField, validateFieldValue } from "@/domains/rental-forms/customFields";

export const runtime = "nodejs";

// Rentec parity R15: custom field values for one record.
//   GET  /api/rental/custom-field-values?entity=tenant&recordId=... ->
//        { fields: [...definitions...], values: { fieldId: valueText } }
//   POST { entity, recordId, values: { fieldId: rawValue } } ->
//        validates every value against its definition (type + required),
//        then upserts; clearing an optional field removes its row.
// Reads are open to every workspace member; writes are owner/co-owner only.

async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

async function loadDefinitions(authenticated, entity) {
  const { data, error } = await authenticated.supabaseClient
    .from("rental_custom_fields")
    .select("id, entity, name, field_key, field_type, is_required, picklist_options, sort_order, updated_at")
    .eq("owner_id", authenticated.effectiveOwnerId)
    .eq("entity", entity)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToField);
}

export async function GET(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  const { searchParams } = new URL(request.url);
  const entity = searchParams.get("entity");
  const recordId = searchParams.get("recordId");
  if (!entity || !recordId) {
    return NextResponse.json({ error: "entity and recordId are required." }, { status: 400 });
  }
  try {
    const fields = await loadDefinitions(authenticated, entity);
    const values = {};
    if (fields.length > 0) {
      const { data, error } = await authenticated.supabaseClient
        .from("rental_custom_field_values")
        .select("field_id, value_text")
        .eq("owner_id", authenticated.effectiveOwnerId)
        .eq("record_id", recordId)
        .in("field_id", fields.map((field) => field.id));
      if (error) throw error;
      for (const row of data || []) values[row.field_id] = row.value_text;
    }
    return NextResponse.json({ success: true, fields, values });
  } catch (error) {
    console.error("Custom field values load error", error);
    return NextResponse.json({ error: "Unable to load custom field values." }, { status: 500 });
  }
}

export async function POST(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await readOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Read-only members cannot save custom field values." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const entity = String(body.entity ?? "").trim();
  const recordId = String(body.recordId ?? "").trim();
  const inputValues = body.values && typeof body.values === "object" ? body.values : {};
  if (!entity || !recordId) {
    return NextResponse.json({ error: "entity and recordId are required." }, { status: 400 });
  }
  try {
    const fields = await loadDefinitions(authenticated, entity);
    const byId = new Map(fields.map((field) => [field.id, field]));

    // Reject values for fields the caller should not know about (a stale
    // form posting another workspace's field id, for example).
    for (const fieldId of Object.keys(inputValues)) {
      if (!byId.has(fieldId)) {
        return NextResponse.json({ error: "One of the fields is not valid for this record." }, { status: 400 });
      }
    }

    // Validate everything BEFORE writing anything — a partial save would
    // leave required-field state ambiguous.
    const cleaned = {};
    for (const field of fields) {
      const hasValue = Object.prototype.hasOwnProperty.call(inputValues, field.id);
      const validated = validateFieldValue(field, hasValue ? inputValues[field.id] : null);
      if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
      cleaned[field.id] = validated.clean;
    }

    const upsertRows = [];
    const clearedIds = [];
    for (const field of fields) {
      const clean = cleaned[field.id];
      if (clean === null) clearedIds.push(field.id);
      else upsertRows.push({ owner_id: authenticated.effectiveOwnerId, field_id: field.id, record_id: recordId, value_text: clean });
    }

    if (clearedIds.length > 0) {
      const { error } = await authenticated.supabaseClient
        .from("rental_custom_field_values")
        .delete()
        .eq("owner_id", authenticated.effectiveOwnerId)
        .eq("record_id", recordId)
        .in("field_id", clearedIds);
      if (error) throw error;
    }
    if (upsertRows.length > 0) {
      const { error } = await authenticated.supabaseClient
        .from("rental_custom_field_values")
        .upsert(upsertRows, { onConflict: "owner_id,field_id,record_id" });
      if (error) throw error;
    }

    return NextResponse.json({ success: true, values: Object.fromEntries(fields.map((field) => [field.id, cleaned[field.id]])) });
  } catch (error) {
    console.error("Custom field values save error", error);
    return NextResponse.json({ error: "Unable to save custom field values." }, { status: 500 });
  }
}
