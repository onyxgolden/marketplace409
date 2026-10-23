/**
 * Named synthetic repositories (closed registry — a job request can
 * never name a path or URL; the host harness selects one of these by
 * ID). Every row is invented. Raw rows deliberately carry PII-shaped
 * fields (tenant names, emails, phones, an SSN-shaped canary) OUTSIDE
 * the projection allowlist, so the preview run proves those bytes are
 * dropped at projection and never reach a snapshot, report or item.
 *
 * owner-a and owner-b deliberately reuse the same record refs
 * (prop-1, unit-1, lease-1, ch-1, sch-1) with different facts, so
 * scope tests can prove there is no cross-owner bleed or join.
 */
export const PII_CANARIES = Object.freeze([
  "CANARY-NAME-ALPHA", "canary.alpha@example.com", "CANARY-PHONE-555-0101", "CANARY-SSN-001",
  "CANARY-NAME-BETA", "canary.beta@example.com",
]);

function ownerA() {
  return {
    properties: [
      { property_ref: "prop-1", owner_ref: "owner-a", display_name: "CANARY-NAME-ALPHA", street_address: "1 Canary Way" },
    ],
    units: [
      { unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-a", status: "occupied" },
      { unit_ref: "unit-2", property_ref: "prop-1", owner_ref: "owner-a", status: "occupied" },
      { unit_ref: "unit-3", property_ref: "prop-1", owner_ref: "owner-a", status: "vacant" },
    ],
    leases: [
      { lease_ref: "lease-1", unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-a", status: "active", start_date: "2025-11-01", end_date: "2026-10-17", monthly_rent_cents: 160000, currency: "USD", tenant_name: "CANARY-NAME-ALPHA", tenant_email: "canary.alpha@example.com", tenant_phone: "CANARY-PHONE-555-0101", ssn_fragment: "CANARY-SSN-001" },
      { lease_ref: "lease-2", unit_ref: "unit-2", property_ref: "prop-1", owner_ref: "owner-a", status: "active", start_date: "2026-01-01", end_date: "2026-11-21", monthly_rent_cents: 145000, currency: "USD" },
      { lease_ref: "lease-3", unit_ref: "unit-3", property_ref: "prop-1", owner_ref: "owner-a", status: "active", start_date: "2026-01-01", end_date: "2026-12-22", monthly_rent_cents: 120000, currency: "USD" },
    ],
    memberships: [
      { lease_ref: "lease-1", owner_ref: "owner-a", tenant_id: "tenant-secret-a1" },
      { lease_ref: "lease-2", owner_ref: "owner-a", tenant_id: "tenant-secret-a2" },
    ],
    charges: [
      { charge_ref: "ch-1", lease_ref: "lease-2", schedule_ref: "sch-1", owner_ref: "owner-a", status: "open", due_date: "2026-10-01", amount_cents: 145000, paid_amount_cents: 45000, currency: "USD", tenant_email: "canary.alpha@example.com" },
      { charge_ref: "ch-2", lease_ref: "lease-2", schedule_ref: "sch-2", owner_ref: "owner-a", status: "open", due_date: "2026-09-01", amount_cents: 30000, paid_amount_cents: 0, currency: "USD" },
    ],
    schedules: [
      { schedule_ref: "sch-1", lease_ref: "lease-2", owner_ref: "owner-a", collection_mode: "forge", forge_cutover_date: "2026-01-01", currency: "USD" },
      { schedule_ref: "sch-2", lease_ref: "lease-2", owner_ref: "owner-a", collection_mode: "external", forge_cutover_date: null, currency: "USD" },
    ],
  };
}

function ownerB() {
  return {
    properties: [{ property_ref: "prop-1", owner_ref: "owner-b", display_name: "CANARY-NAME-BETA" }],
    units: [{ unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-b", status: "occupied" }],
    leases: [
      { lease_ref: "lease-1", unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-b", status: "active", start_date: "2026-01-01", end_date: "2027-06-30", monthly_rent_cents: 99000, currency: "USD", tenant_email: "canary.beta@example.com" },
    ],
    memberships: [{ lease_ref: "lease-1", owner_ref: "owner-b", tenant_id: "tenant-secret-b1" }],
    charges: [
      { charge_ref: "ch-1", lease_ref: "lease-1", schedule_ref: "sch-1", owner_ref: "owner-b", status: "open", due_date: "2026-10-05", amount_cents: 5000, paid_amount_cents: 0, currency: "USD" },
    ],
    schedules: [
      { schedule_ref: "sch-1", lease_ref: "lease-1", owner_ref: "owner-b", collection_mode: "forge", forge_cutover_date: "2026-01-01", currency: "USD" },
    ],
  };
}

function mergeRepos(...repos) {
  const out = {};
  for (const repo of repos) {
    for (const [dataset, rows] of Object.entries(repo)) {
      out[dataset] = [...(out[dataset] ?? []), ...rows];
    }
  }
  return out;
}

export const SYNTHETIC_REPOSITORIES = Object.freeze({
  "preview-basic": () => mergeRepos(ownerA(), ownerB()),
  "preview-owner-a": () => ownerA(),
  "preview-empty": () => ({ properties: [], units: [], leases: [], memberships: [], charges: [], schedules: [] }),
});
