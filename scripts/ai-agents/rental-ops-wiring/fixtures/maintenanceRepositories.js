/**
 * Named synthetic Maintenance Manager repositories (closed registry —
 * a job request can never name a path or URL; the host harness
 * selects one of these by ID). Every row is invented. Raw rows
 * deliberately carry PII-shaped fields (tenant names, scope-of-work
 * prose, contractor phones) OUTSIDE the projection allowlist, so the
 * preview run proves those bytes are dropped at projection and never
 * reach a snapshot, report or item.
 *
 * owner-a and owner-b deliberately reuse the same record refs
 * (prop-1, unit-1, wo-1) with different facts, so scope tests can
 * prove there is no cross-owner bleed or join.
 */
export const MM_PII_CANARIES = Object.freeze([
  "CANARY-MM-NAME-ALPHA", "CANARY-MM-SCOPE", "CANARY-MM-PHONE-555-0201",
  "CANARY-MM-NAME-BETA",
]);

function mmOwnerA() {
  return {
    properties: [
      { property_ref: "prop-1", owner_ref: "owner-a", display_name: "CANARY-MM-NAME-ALPHA" },
    ],
    units: [
      { unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-a", status: "occupied" },
      { unit_ref: "unit-2", property_ref: "prop-1", owner_ref: "owner-a", status: "vacant" },
    ],
    leases: [],
    memberships: [],
    charges: [],
    schedules: [],
    work_orders: [
      {
        work_order_ref: "wo-1", request_ref: "req-1", unit_ref: "unit-1", property_ref: "prop-1",
        owner_ref: "owner-a", status: "assigned", created_date: "2026-10-10", priority: "high",
        due_date: "2026-10-25", completed_date: null,
        tenant_name: "CANARY-MM-NAME-ALPHA", scope_of_work: "CANARY-MM-SCOPE", contractor_phone: "CANARY-MM-PHONE-555-0201",
      },
      {
        work_order_ref: "wo-2", request_ref: "req-2", unit_ref: "unit-2", property_ref: "prop-1",
        owner_ref: "owner-a", status: "in_progress", created_date: "2026-09-01", priority: "urgent",
        due_date: "2026-10-20", completed_date: null,
      },
      {
        work_order_ref: "wo-3", request_ref: "req-3", unit_ref: "unit-1", property_ref: "prop-1",
        owner_ref: "owner-a", status: "completed", created_date: "2026-08-15", priority: "normal",
        due_date: "2026-09-01", completed_date: "2026-08-30",
      },
    ],
  };
}

function mmOwnerB() {
  return {
    properties: [{ property_ref: "prop-1", owner_ref: "owner-b", display_name: "CANARY-MM-NAME-BETA" }],
    units: [{ unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-b", status: "occupied" }],
    leases: [],
    memberships: [],
    charges: [],
    schedules: [],
    work_orders: [
      {
        work_order_ref: "wo-1", request_ref: "req-9", unit_ref: "unit-1", property_ref: "prop-1",
        owner_ref: "owner-b", status: "scheduled", created_date: "2026-10-18", priority: "low",
        due_date: null, completed_date: null, tenant_name: "CANARY-MM-NAME-BETA",
      },
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

export const MM_SYNTHETIC_REPOSITORIES = Object.freeze({
  "mm-preview-basic": () => mergeRepos(mmOwnerA(), mmOwnerB()),
  "mm-preview-owner-a": () => mmOwnerA(),
  "mm-preview-empty": () => ({
    properties: [], units: [], leases: [], memberships: [], charges: [], schedules: [], work_orders: [],
  }),
});
