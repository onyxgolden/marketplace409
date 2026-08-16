// Narrows raw Rentec evidence down to a single property before it ever
// reaches the manifest builder or the commit RPC. This is the "one
// property at a time" boundary for the import commit step — the RPC
// itself has no concept of property scope, it just writes whatever it's
// given, so this has to happen upstream of it.
//
// Tenants are scoped by inclusion, not by their own property field (they
// don't have one) — a tenant is in scope only if they have at least one
// lease at the chosen property.
export function scopeRentecEvidenceToProperty({
  rentecProperties = [],
  rentecTenants = [],
  rentecLeases = [],
  propertyId,
} = {}) {
  const id = String(propertyId || "").trim();
  if (!id) throw new Error("A Rentec property id is required to scope an import commit.");

  const scopedProperties = rentecProperties.filter(
    (row) => String(row.property_id || row.id || "") === id,
  );
  const scopedLeases = rentecLeases.filter((row) => String(row.property_id || "") === id);
  const renterIds = new Set(scopedLeases.map((row) => String(row.renter_id || "")));
  const scopedTenants = rentecTenants.filter((row) =>
    renterIds.has(String(row.renter_id || row.id || "")),
  );

  return {
    rentecProperties: scopedProperties,
    rentecTenants: scopedTenants,
    rentecLeases: scopedLeases,
  };
}
