// Work Package Planner admin permissions, slice 1.
//
// This module is UI AFFORDANCE ONLY (what to show/hide/enable). It never
// decides what a request may actually do -- every write goes through the
// `has_planner_permission` SQL gate and the transactional RPCs in
// supabase/migrations/20261110000000_forge_planner_admin_permissions_slice1.sql,
// which re-check server-side regardless of what this module computes. Keep
// this catalog and the five starter-role capability sets byte-for-byte in
// sync with that migration (and with the scope brief's "Editable starter
// roles" table) -- a drift here only misleads the UI, it doesn't weaken
// enforcement, but a misleading UI is still a real bug.
//
// THE HARD RULE: no `planner.drawings.edit` capability exists anywhere in
// this catalog, and never will. Controlled IFC isometrics, P&IDs, and cut
// sheets may never be edited in-tool by any role, including Owner.

export const PLANNER_CAPABILITIES = Object.freeze([
  Object.freeze({ key: "planner.packages.read", label: "View work packages", category: "Packages" }),
  Object.freeze({ key: "planner.packages.create", label: "Create work packages", category: "Packages" }),
  Object.freeze({ key: "planner.packages.edit", label: "Edit work packages", category: "Packages" }),
  Object.freeze({ key: "planner.packages.close", label: "Close work packages", category: "Packages" }),
  Object.freeze({ key: "planner.packages.cancel", label: "Cancel work packages", category: "Packages" }),

  Object.freeze({ key: "planner.drawings.read", label: "View drawings", category: "Drawings" }),
  Object.freeze({ key: "planner.drawings.upload", label: "Upload drawings", category: "Drawings" }),
  Object.freeze({ key: "planner.drawings.link", label: "Link drawings", category: "Drawings" }),
  Object.freeze({ key: "planner.drawings.unlink", label: "Unlink drawings", category: "Drawings" }),
  Object.freeze({ key: "planner.drawings.delete", label: "Delete drawings", category: "Drawings" }),

  Object.freeze({ key: "planner.steps.read", label: "View work steps", category: "Steps" }),
  Object.freeze({ key: "planner.steps.create", label: "Create work steps", category: "Steps" }),
  Object.freeze({ key: "planner.steps.edit", label: "Edit work steps", category: "Steps" }),
  Object.freeze({ key: "planner.steps.reorder", label: "Reorder work steps", category: "Steps" }),
  Object.freeze({ key: "planner.steps.retire", label: "Retire work steps", category: "Steps" }),

  // Planning-process checklist (Josh's Packaged Planning Process PDF):
  // .read views the checklist; .update changes statuses (except
  // Reviewed); .review marks a step Reviewed. Starter grants mirror
  // the migration: Planner Admin holds all three, Planner holds read
  // + update, Scheduler and Read-only hold read, Reviewer holds read
  // + review.
  Object.freeze({ key: "planner.planning_steps.read", label: "View planning-process checklist", category: "Planning process" }),
  Object.freeze({ key: "planner.planning_steps.update", label: "Change planning-process statuses", category: "Planning process" }),
  Object.freeze({ key: "planner.planning_steps.review", label: "Mark planning-process steps Reviewed", category: "Planning process" }),

  Object.freeze({ key: "planner.crafts.read", label: "View craft assignments", category: "Crafts" }),
  Object.freeze({ key: "planner.crafts.assign", label: "Assign crafts", category: "Crafts" }),
  Object.freeze({ key: "planner.crafts.reassign", label: "Reassign crafts", category: "Crafts" }),
  Object.freeze({ key: "planner.crafts.clear", label: "Clear craft assignments", category: "Crafts" }),

  Object.freeze({ key: "planner.manpower.read", label: "View manpower curve", category: "Manpower" }),
  Object.freeze({ key: "planner.manpower.placements.edit", label: "Edit manpower placements", category: "Manpower" }),

  Object.freeze({ key: "planner.baselines.read", label: "View baselines", category: "Baselines" }),
  Object.freeze({ key: "planner.baselines.freeze", label: "Freeze baselines", category: "Baselines" }),
  Object.freeze({ key: "planner.baselines.select", label: "Select baselines", category: "Baselines" }),

  Object.freeze({ key: "planner.progress.read", label: "View progress", category: "Progress" }),
  Object.freeze({ key: "planner.progress.add", label: "Add progress", category: "Progress" }),
  Object.freeze({ key: "planner.progress.correct", label: "Correct progress", category: "Progress" }),
  Object.freeze({ key: "planner.progress.void", label: "Void progress", category: "Progress" }),

  Object.freeze({ key: "planner.permits.read", label: "View permits", category: "Permits" }),
  Object.freeze({ key: "planner.permits.annotations.link", label: "Link permit annotations", category: "Permits" }),
  Object.freeze({ key: "planner.permits.annotations.unlink", label: "Unlink permit annotations", category: "Permits" }),

  Object.freeze({ key: "planner.reports.read", label: "View reports", category: "Reports" }),
  Object.freeze({ key: "planner.reports.export", label: "Export reports", category: "Reports" }),

  Object.freeze({ key: "planner.settings.read", label: "View planner settings", category: "Administration" }),
  Object.freeze({ key: "planner.settings.edit", label: "Edit planner settings", category: "Administration" }),
  Object.freeze({ key: "planner.staff.read", label: "View staff", category: "Administration" }),
  Object.freeze({ key: "planner.staff.invite", label: "Invite staff", category: "Administration" }),
  Object.freeze({ key: "planner.roles.read", label: "View roles", category: "Administration" }),
  Object.freeze({ key: "planner.roles.manage", label: "Manage roles", category: "Administration" }),
  Object.freeze({ key: "planner.audit.read", label: "View audit log", category: "Administration" }),
]);

export const PLANNER_CAPABILITY_KEYS = Object.freeze(PLANNER_CAPABILITIES.map((c) => c.key));

export const PLANNER_CAPABILITY_LABELS = Object.freeze(
  Object.fromEntries(PLANNER_CAPABILITIES.map((c) => [c.key, c.label]))
);

if (PLANNER_CAPABILITY_KEYS.includes("planner.drawings.edit")) {
  throw new Error("FORBIDDEN: planner.drawings.edit must never exist in the capability catalog");
}

const ALL_READS = Object.freeze(PLANNER_CAPABILITY_KEYS.filter((k) => k.endsWith(".read")));

export const STARTER_ROLE_LABELS = Object.freeze({
  planner_admin: "Planner Admin",
  planner: "Planner",
  scheduler: "Scheduler",
  reviewer: "Reviewer",
  read_only: "Read-only",
});

// Mirrors forge_planner_roles_provision_starter_set's v_starter literal
// exactly -- keep both in sync by hand; there's no single source shared
// between SQL and JS in this repo's established pattern (see
// src/lib/rental/permissions.js's own header note on the same tradeoff).
export const STARTER_ROLE_CAPABILITIES = Object.freeze({
  planner_admin: Object.freeze([
    ...ALL_READS,
    "planner.packages.create", "planner.packages.edit", "planner.packages.close", "planner.packages.cancel",
    "planner.steps.create", "planner.steps.edit", "planner.steps.reorder", "planner.steps.retire",
    "planner.crafts.assign", "planner.crafts.reassign", "planner.crafts.clear",
    "planner.manpower.placements.edit",
    "planner.progress.add", "planner.progress.correct", "planner.progress.void",
    "planner.permits.annotations.link", "planner.permits.annotations.unlink",
    "planner.drawings.upload", "planner.drawings.link", "planner.drawings.delete",
    "planner.baselines.freeze", "planner.baselines.select",
    "planner.planning_steps.update", "planner.planning_steps.review",
  ]),
  planner: Object.freeze([
    "planner.packages.read", "planner.drawings.read", "planner.steps.read", "planner.crafts.read",
    "planner.manpower.read", "planner.baselines.read", "planner.progress.read", "planner.permits.read",
    "planner.reports.read",
    "planner.packages.edit", "planner.steps.edit", "planner.crafts.assign",
    "planner.manpower.placements.edit", "planner.progress.add", "planner.drawings.link",
    "planner.planning_steps.read", "planner.planning_steps.update",
  ]),
  scheduler: Object.freeze([
    "planner.packages.read", "planner.steps.read", "planner.crafts.read", "planner.manpower.read",
    "planner.baselines.read",
    "planner.crafts.assign", "planner.manpower.placements.edit",
    "planner.planning_steps.read",
  ]),
  reviewer: Object.freeze([...ALL_READS, "planner.reports.export", "planner.planning_steps.review"]),
  read_only: Object.freeze([...ALL_READS]),
});

export function starterRoleLabel(roleKey) {
  return STARTER_ROLE_LABELS[roleKey] || roleKey || "Unknown role";
}

// Pure, affordance-only check: does this capability set (as returned by
// forge_planner_roles_snapshot / an assignment's role) include the key.
// Never used to gate a write -- see the module header.
export function hasPlannerPermission(effectiveCapabilities, capabilityKey) {
  if (!Array.isArray(effectiveCapabilities)) return false;
  return effectiveCapabilities.includes(capabilityKey);
}
