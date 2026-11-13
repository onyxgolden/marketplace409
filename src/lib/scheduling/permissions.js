// Scheduling Tool admin permissions, slice 1.
//
// This module is UI AFFORDANCE ONLY (what to show/hide/enable). It never
// decides what a request may actually do -- every write goes through the
// `has_scheduling_permission` SQL gate and the transactional RPCs in
// supabase/migrations/20261110080000_forge_scheduling_admin_permissions_slice1.sql,
// which re-check server-side regardless of what this module computes. Keep
// this catalog and the four starter-role capability sets byte-for-byte in
// sync with that migration (and with its own header note on the brief's
// unsupported "jobs"/"crews"/"TV" groups) -- a drift here only misleads the
// UI, it doesn't weaken enforcement, but a misleading UI is still a real
// bug.
//
// THE HARD RULE (Scheduling's equivalent of Planner's drawing-edit ban):
// no `scheduling.tv.*` capability exists anywhere in this catalog. No
// TV/kiosk route or component exists anywhere in this app today; if one is
// ever built, it must be re-verified against this rule before any
// scheduling.tv.* key is added.
//
// GROUNDED CATALOG, NOT THE BRIEF'S VERBATIM TABLE: "jobs" and "crews" are
// not entities anywhere in the current Scheduling code (projects,
// activities/WBS, and labor/nonlabor/material resources are) and
// "publish/unpublish/archive" is not a state any schedule carries today --
// see the migration's own header for the full verification. 21 keys
// across 8 groups, not the brief's 11 groups.

export const SCHEDULING_CAPABILITIES = Object.freeze([
  Object.freeze({ key: "scheduling.schedules.read", label: "View schedules", category: "Schedules" }),
  Object.freeze({ key: "scheduling.schedules.create", label: "Create schedules", category: "Schedules" }),
  Object.freeze({ key: "scheduling.schedules.edit", label: "Edit schedules", category: "Schedules" }),

  Object.freeze({ key: "scheduling.activities.read", label: "View activities", category: "Activities" }),
  Object.freeze({ key: "scheduling.activities.create", label: "Create activities", category: "Activities" }),
  Object.freeze({ key: "scheduling.activities.edit", label: "Edit activities", category: "Activities" }),
  Object.freeze({ key: "scheduling.activities.resequence", label: "Resequence activities", category: "Activities" }),

  Object.freeze({ key: "scheduling.resources.read", label: "View resources", category: "Resources" }),
  Object.freeze({ key: "scheduling.resources.create", label: "Create resources", category: "Resources" }),
  Object.freeze({ key: "scheduling.resources.edit", label: "Edit resources", category: "Resources" }),
  Object.freeze({ key: "scheduling.resources.allocate", label: "Allocate resources", category: "Resources" }),
  Object.freeze({ key: "scheduling.resources.release", label: "Release resources", category: "Resources" }),

  Object.freeze({ key: "scheduling.calendars.read", label: "View calendars", category: "Calendars" }),
  Object.freeze({ key: "scheduling.calendars.configure", label: "Configure calendars", category: "Calendars" }),

  Object.freeze({ key: "scheduling.settings.read", label: "View scheduling settings", category: "Administration" }),
  Object.freeze({ key: "scheduling.settings.edit", label: "Edit scheduling settings", category: "Administration" }),
  Object.freeze({ key: "scheduling.staff.read", label: "View staff", category: "Administration" }),
  Object.freeze({ key: "scheduling.staff.invite", label: "Invite staff", category: "Administration" }),
  Object.freeze({ key: "scheduling.roles.read", label: "View roles", category: "Administration" }),
  Object.freeze({ key: "scheduling.roles.manage", label: "Manage roles", category: "Administration" }),
  Object.freeze({ key: "scheduling.audit.read", label: "View audit log", category: "Administration" }),

  // Shared client -> site -> project hierarchy (foundation migration
  // 20261112010000): read on every starter role, manage on Admin only.
  // The .read key flows into ALL_READS below, so the ALL_READS-based
  // admin set picks it up automatically.
  Object.freeze({ key: "forge.hierarchy.read", label: "View clients, sites, and projects", category: "Hierarchy" }),
  Object.freeze({ key: "forge.hierarchy.manage", label: "Manage clients, sites, and projects", category: "Hierarchy" }),
]);

export const SCHEDULING_CAPABILITY_KEYS = Object.freeze(SCHEDULING_CAPABILITIES.map((c) => c.key));

export const SCHEDULING_CAPABILITY_LABELS = Object.freeze(
  Object.fromEntries(SCHEDULING_CAPABILITIES.map((c) => [c.key, c.label]))
);

if (SCHEDULING_CAPABILITY_KEYS.some((k) => k.startsWith("scheduling.tv."))) {
  throw new Error("FORBIDDEN: no scheduling.tv.* capability may exist until a real TV/kiosk view is built and re-verified");
}

const ALL_READS = Object.freeze(SCHEDULING_CAPABILITY_KEYS.filter((k) => k.endsWith(".read")));

export const STARTER_ROLE_LABELS = Object.freeze({
  admin: "Admin",
  scheduler: "Scheduler",
  crew_lead: "Crew Lead",
  viewer: "Viewer",
});

// Mirrors forge_scheduling_roles_provision_starter_set's v_starter literal
// exactly -- keep both in sync by hand, same tradeoff this directory's
// sibling slices (Rental, Planner) both already carry.
export const STARTER_ROLE_CAPABILITIES = Object.freeze({
  admin: Object.freeze([
    ...ALL_READS,
    "scheduling.schedules.create", "scheduling.schedules.edit",
    "scheduling.activities.create", "scheduling.activities.edit", "scheduling.activities.resequence",
    "scheduling.resources.create", "scheduling.resources.edit", "scheduling.resources.allocate", "scheduling.resources.release",
    "scheduling.calendars.configure",
    "forge.hierarchy.manage",
  ]),
  scheduler: Object.freeze([
    "scheduling.schedules.read", "scheduling.activities.read", "scheduling.resources.read", "scheduling.calendars.read",
    "scheduling.schedules.edit", "scheduling.activities.edit", "scheduling.activities.resequence",
    "scheduling.resources.allocate", "scheduling.resources.release",
    "forge.hierarchy.read",
  ]),
  // Default read-only until per-job scoping is proven safe (per-job
  // scoping is explicitly OUT of slice 1) -- identical to Viewer today.
  crew_lead: Object.freeze([
    "scheduling.schedules.read", "scheduling.activities.read", "scheduling.calendars.read",
    "forge.hierarchy.read",
  ]),
  viewer: Object.freeze([
    "scheduling.schedules.read", "scheduling.activities.read", "scheduling.calendars.read",
    "forge.hierarchy.read",
  ]),
});

export function starterRoleLabel(roleKey) {
  return STARTER_ROLE_LABELS[roleKey] || roleKey || "Unknown role";
}

// Pure, affordance-only check -- never used to gate a write, see the
// module header.
export function hasSchedulingPermission(effectiveCapabilities, capabilityKey) {
  if (!Array.isArray(effectiveCapabilities)) return false;
  return effectiveCapabilities.includes(capabilityKey);
}
