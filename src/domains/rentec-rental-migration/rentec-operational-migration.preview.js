const normalize = (value) => String(value || "").trim().toLowerCase().replace(/\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|boulevard|blvd|west|w|south|s|north|n|east|e)\b/g, "").replace(/[^a-z0-9]+/g, "");
const email = (value) => String(value || "").trim().toLowerCase();
const cents = (value) => Math.round(Number(value || 0) * 100);
const date = (value) => String(value || "").slice(0, 10);
const archived = (row) => row.archived === true || row.archived === 1 || row.archived === "1";
const blankCounts = () => ({ create: 0, link: 0, skip: 0, review: 0 });
const add = (counts, action) => { counts[action]++; };
const freezeCounts = (counts) => Object.freeze({ ...counts });

function propertyIndex(units) {
  const index = new Map();
  for (const unit of units) {
    for (const candidate of [unit.property_id, unit.label]) {
      const key = normalize(candidate);
      if (!key) continue;
      const values = index.get(key) || [];
      if (!values.includes(unit.id)) values.push(unit.id);
      index.set(key, values);
    }
  }
  return index;
}

function tenantIndex(tenants) {
  const index = new Map();
  for (const tenant of tenants) {
    const key = email(tenant.email);
    if (!key) continue;
    const values = index.get(key) || [];
    values.push(tenant.id);
    index.set(key, values);
  }
  return index;
}

const sourcePropertyKey = (row) => normalize(row.address || row.nickname || row.property_id || row.id);

export function previewRentecOperationalMigration({
  rentecProperties = [], rentecTenants = [], rentecLeases = [],
  forgeUnits = [], forgeTenants = [], forgeLeases = [], asOf = new Date().toISOString().slice(0, 10),
} = {}) {
  for (const value of [rentecProperties, rentecTenants, rentecLeases, forgeUnits, forgeTenants, forgeLeases]) {
    if (!Array.isArray(value)) throw new Error("Operational migration records must be arrays.");
  }

  const properties = blankCounts(), tenants = blankCounts(), leases = blankCounts();
  const reasons = new Map();
  const note = (label) => reasons.set(label, (reasons.get(label) || 0) + 1);
  const unitsByProperty = propertyIndex(forgeUnits);
  const tenantsByEmail = tenantIndex(forgeTenants);
  const propertyResolution = new Map();
  const tenantResolution = new Map();

  for (const row of rentecProperties) {
    const sourceId = String(row.property_id || row.id || "");
    const matches = unitsByProperty.get(sourcePropertyKey(row)) || [];
    if (matches.length === 1) { add(properties, "link"); propertyResolution.set(sourceId, matches[0]); }
    else if (matches.length > 1) { add(properties, "review"); note("Property matches multiple FORGE units"); }
    else if (archived(row)) { add(properties, "skip"); note("Archived Rentec property has no FORGE match"); }
    else { add(properties, "create"); propertyResolution.set(sourceId, "planned:create"); }
  }

  for (const row of rentecTenants) {
    const sourceId = String(row.renter_id || row.id || "");
    const key = email(row.email);
    const matches = key ? tenantsByEmail.get(key) || [] : [];
    if (matches.length === 1) { add(tenants, "link"); tenantResolution.set(sourceId, matches[0]); }
    else if (matches.length > 1) { add(tenants, "review"); note("Tenant email matches multiple FORGE tenants"); }
    else if (archived(row)) { add(tenants, "skip"); note("Archived Rentec tenant has no FORGE match"); }
    else if (!key) { add(tenants, "review"); note("Active Rentec tenant has no email identity"); }
    else { add(tenants, "create"); tenantResolution.set(sourceId, "planned:create"); }
  }

  for (const row of rentecLeases) {
    const propertyId = String(row.property_id || "");
    const renterId = String(row.renter_id || "");
    const startDate = date(row.lease_begin || row.move_in);
    const endDate = date(row.lease_end || row.move_out);
    const rentCents = cents(row.recurring_rent);
    const unitId = propertyResolution.get(propertyId);
    const tenantId = tenantResolution.get(renterId);
    const matches = unitId && unitId !== "planned:create" ? forgeLeases.filter((lease) =>
      lease.unit_id === unitId && date(lease.start_date) === startDate && Number(lease.monthly_rent_cents) === rentCents
    ) : [];
    if (matches.length === 1) add(leases, "link");
    else if (matches.length > 1) { add(leases, "review"); note("Lease matches multiple FORGE leases"); }
    else if (endDate && endDate < asOf) { add(leases, "skip"); note("Ended Rentec lease has no FORGE match"); }
    else if (!startDate || rentCents <= 0 || !propertyId || !renterId) { add(leases, "review"); note("Rentec lease lacks required identity or rent terms"); }
    else if (!unitId || !tenantId) { add(leases, "review"); note("Lease depends on an unresolved property or tenant"); }
    else add(leases, "create");
  }

  const groupedReasons = Object.freeze([...reasons.entries()].map(([label, count]) => Object.freeze({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)));

  return Object.freeze({
    mode: "preview_only",
    canCommit: false,
    properties: freezeCounts(properties),
    tenants: freezeCounts(tenants),
    leases: freezeCounts(leases),
    reviewReasons: groupedReasons,
    warnings: Object.freeze([
      "No Rentec or FORGE record was created, updated, linked, or deleted.",
      "Archived tenants and ended leases remain historical evidence unless an existing FORGE record is found.",
      "Every review item must be resolved before an operational import can be enabled.",
    ]),
  });
}
