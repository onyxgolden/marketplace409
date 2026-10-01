// Rentec parity R15: maps a custom-field entity to the rental table that owns
// its records, so the API can verify recordId before reading or writing
// values. Property identity lives on rental_units.property_id — there is no
// standalone properties table, so a property recordId is valid when some unit
// of the effective owner carries that property_id.

export const CUSTOM_FIELD_TARGET_TABLES = {
  tenant: { table: "rental_tenants", idColumn: "id" },
  lease: { table: "rental_leases", idColumn: "id" },
  unit: { table: "rental_units", idColumn: "id" },
  property: { table: "rental_units", idColumn: "property_id" },
};

export function isKnownCustomFieldEntity(entity) {
  return Object.prototype.hasOwnProperty.call(CUSTOM_FIELD_TARGET_TABLES, entity);
}

// True when a row with recordId exists in the entity's table for the
// effective owner. Scoped by owner_id so one workspace can never probe or
// attach values to another workspace's records.
export async function customFieldRecordExists({ supabaseClient, ownerId, entity, recordId }) {
  const target = CUSTOM_FIELD_TARGET_TABLES[entity];
  if (!target) return false;
  const { data, error } = await supabaseClient
    .from(target.table)
    .select(target.idColumn)
    .eq("owner_id", ownerId)
    .eq(target.idColumn, recordId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}
