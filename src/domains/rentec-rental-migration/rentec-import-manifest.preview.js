import { createHash } from "node:crypto";

const normalize = (value) => String(value || "").trim().toLowerCase();
const key = (value) => normalize(value).replace(/\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|boulevard|blvd|west|w|south|s|north|n|east|e)\b/g, "").replace(/[^a-z0-9]+/g, "");
const slug = (value) => normalize(value).replace(/\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|boulevard|blvd)\b/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const archived = (row) => row.archived === true || row.archived === 1 || row.archived === "1";
const date = (value) => String(value || "").slice(0, 10);
const cents = (value) => Math.round(Number(value || 0) * 100);
const stableId = (type, sourceId) => `rental_${type}_rentec_${String(sourceId).replace(/[^a-zA-Z0-9_-]/g, "")}`;
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const mapping = (source, target, rule) => Object.freeze({ source, target, rule });

const FIELD_MAPPINGS = Object.freeze({
  units: Object.freeze([
    mapping("property_id", "id", "rental_unit_rentec_<property_id>"),
    mapping("address", "property_id", "normalized stable property slug"),
    mapping("address or nickname", "label", "preferred human-readable label"),
    mapping("archived", "status", "unarchived candidates start as preparing"),
  ]),
  tenants: Object.freeze([
    mapping("renter_id", "id", "rental_tenant_rentec_<renter_id>"),
    mapping("f_name + l_name or company", "display_name", "trimmed display identity"),
    mapping("email", "email", "trimmed lowercase identity"),
    mapping("phone or mphone", "phone", "preferred contact number"),
    mapping("archived", "status", "unarchived candidates start as invited"),
  ]),
  leases: Object.freeze([
    mapping("lease_id", "id", "rental_lease_rentec_<lease_id>"),
    mapping("property_id", "unit_id", "resolved linked or planned unit"),
    mapping("renter_id", "tenant_id", "resolved linked or planned tenant membership"),
    mapping("lease_begin or move_in", "start_date", "date only"),
    mapping("lease_end or move_out", "end_date", "date only"),
    mapping("recurring_rent", "monthly_rent_cents", "USD rounded to cents"),
    mapping("not supplied by Rentec lease API", "rent_due_day", "owner input required; never inferred"),
    mapping("migration safety", "status", "draft until separately approved"),
  ]),
});

function indexBy(values, candidates) {
  const result = new Map();
  for (const value of values) {
    for (const candidate of candidates(value)) {
      const normalized = key(candidate);
      if (!normalized) continue;
      const rows = result.get(normalized) || [];
      rows.push(value);
      result.set(normalized, rows);
    }
  }
  return result;
}

function group(values) {
  const counts = new Map();
  for (const label of values) counts.set(label, (counts.get(label) || 0) + 1);
  return Object.freeze([...counts].map(([label, count]) => Object.freeze({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)));
}

export function buildRentecImportManifest({
  rentecProperties = [], rentecTenants = [], rentecLeases = [],
  forgeUnits = [], forgeTenants = [], forgeLeases = [], ownerInputs = {}, asOf = new Date().toISOString().slice(0, 10),
} = {}) {
  for (const value of [rentecProperties, rentecTenants, rentecLeases, forgeUnits, forgeTenants, forgeLeases]) {
    if (!Array.isArray(value)) throw new Error("Rentec import manifest records must be arrays.");
  }

  const tenantEmailInputs = ownerInputs?.tenantEmails || {};
  const tenantExclusions = ownerInputs?.tenantExclusions || {};
  const tenantClassifications = ownerInputs?.tenantClassifications || {};
  const leaseDueDayInputs = ownerInputs?.leaseRentDueDays || {};
  const unitIndex = indexBy(forgeUnits, (unit) => [unit.property_id, unit.label]);
  const tenantIndex = indexBy(forgeTenants, (tenant) => [tenant.email]);
  const excludedTenantIds = new Set(rentecTenants.filter((row) => {
    const sourceId = String(row.renter_id || row.id || "");
    const missingEmailExclusion = !normalize(row.email) && tenantExclusions[sourceId] === true;
    const companyExclusion = Boolean(normalize(row.company)) && tenantClassifications[sourceId] === "non_renter";
    return sourceId && !archived(row) && (missingEmailExclusion || companyExclusion);
  }).map((row) => String(row.renter_id || row.id || "")));
  const unitResolution = new Map(), tenantResolution = new Map();
  const units = [], tenants = [], leases = [], blockers = [];
  let excludedTenants = 0, excludedLeases = 0;

  for (const row of rentecProperties) {
    const sourceId = String(row.property_id || row.id || "");
    const address = String(row.address || "").trim();
    const label = address || String(row.nickname || "").trim();
    const matches = unitIndex.get(key(label || sourceId)) || [];
    if (matches.length === 1) unitResolution.set(sourceId, matches[0].id);
    else if (!archived(row) && matches.length === 0 && sourceId && label) {
      const id = stableId("unit", sourceId);
      unitResolution.set(sourceId, id);
      units.push({ id, property_id: slug(address || label) || `rentec-${sourceId}`, label, status: "preparing" });
    } else if (!archived(row) && matches.length !== 1) blockers.push("Property identity requires review");
  }

  for (const row of rentecTenants) {
    const sourceId = String(row.renter_id || row.id || "");
    if (excludedTenantIds.has(sourceId)) { excludedTenants++; continue; }
    if (!archived(row) && normalize(row.company) && tenantClassifications[sourceId] !== "renter") {
      blockers.push("Company contact requires renter classification");
      continue;
    }
    const normalizedEmail = normalize(tenantEmailInputs[sourceId] || row.email);
    const matches = normalizedEmail ? tenantIndex.get(key(normalizedEmail)) || [] : [];
    if (matches.length === 1) tenantResolution.set(sourceId, matches[0].id);
    else if (!archived(row) && matches.length === 0 && normalizedEmail) {
      const displayName = [row.f_name, row.l_name].map((part) => String(part || "").trim()).filter(Boolean).join(" ") || String(row.company || "").trim();
      if (!displayName) { blockers.push("Active renter lacks a display identity"); continue; }
      const id = stableId("tenant", sourceId);
      tenantResolution.set(sourceId, id);
      tenants.push({ id, display_name: displayName, email: normalizedEmail, phone: String(row.phone || row.mphone || "").trim() || null, status: "invited" });
    } else if (!archived(row)) blockers.push(normalizedEmail ? "Tenant identity requires review" : "Active renter has no email identity");
  }

  for (const row of rentecLeases) {
    const renterSourceId = String(row.renter_id || "");
    if (excludedTenantIds.has(renterSourceId)) { excludedLeases++; continue; }
    const endDate = date(row.lease_end || row.move_out);
    if (endDate && endDate < asOf) continue;
    const sourceId = String(row.lease_id || row.id || "");
    const startDate = date(row.lease_begin || row.move_in);
    const rent = cents(row.recurring_rent);
    const unitId = unitResolution.get(String(row.property_id || ""));
    const tenantId = tenantResolution.get(String(row.renter_id || ""));
    if (!sourceId || !startDate || rent <= 0 || !unitId || !tenantId) {
      blockers.push("Active lease lacks required identity, dependency, or rent terms");
      continue;
    }
    const existing = forgeLeases.some((lease) => lease.unit_id === unitId && date(lease.start_date) === startDate && Number(lease.monthly_rent_cents) === rent);
    if (existing) continue;
    const rentDueDay = Number(leaseDueDayInputs[sourceId] || 0);
    leases.push({
      id: stableId("lease", sourceId), property_id: units.find((unit) => unit.id === unitId)?.property_id || forgeUnits.find((unit) => unit.id === unitId)?.property_id || null,
      unit_id: unitId, tenant_id: tenantId, status: "draft", start_date: startDate,
      end_date: endDate || null, monthly_rent_cents: rent, currency_code: "USD", rent_due_day: rentDueDay || null,
    });
    if (!rentDueDay) blockers.push("Rent due day requires owner input");
  }

  const canonical = {
    ownerDecisions: { tenantExclusions: [...excludedTenantIds].sort(), tenantClassifications: Object.entries(tenantClassifications).sort(([a], [b]) => a.localeCompare(b)) },
    units: [...units].sort((a, b) => a.id.localeCompare(b.id)),
    tenants: [...tenants].sort((a, b) => a.id.localeCompare(b.id)),
    leases: [...leases].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const leaseBlockers = blockers.filter((label) => label === "Rent due day requires owner input").length;

  return Object.freeze({
    mode: "preview_only",
    canCommit: false,
    checksum: digest(canonical),
    dependencyOrder: Object.freeze(["properties_and_units", "renters", "leases_and_memberships"]),
    fieldMappings: FIELD_MAPPINGS,
    readiness: Object.freeze({
      units: Object.freeze({ ready: units.length, blocked: blockers.filter((label) => label === "Property identity requires review").length }),
      tenants: Object.freeze({ ready: tenants.length, blocked: blockers.filter((label) => label.includes("renter") || label.includes("Tenant")).length }),
      leases: Object.freeze({ ready: Math.max(0, leases.length - leaseBlockers), blocked: leaseBlockers + blockers.filter((label) => label.startsWith("Active lease")).length }),
    }),
    blockers: group(blockers),
    privateRecordCounts: Object.freeze({ units: units.length, tenants: tenants.length, leases: leases.length }),
    ownerExclusions: Object.freeze({ tenants: excludedTenants, leases: excludedLeases }),
    warnings: Object.freeze([
      "The checksum covers private server-side candidate records; those records are not returned to the browser.",
      "Imported leases remain draft and cannot activate billing, portals, or autopay.",
      "No manifest record was persisted or written to Rental Manager.",
    ]),
  });
}
