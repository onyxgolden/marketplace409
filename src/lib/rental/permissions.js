// R17 (rentec-parity): granular per-task permission model for the Rental Manager team.
//
// The permission KEYS are stable API/DB identifiers. The LABELS are the plain-English copy
// shown in the UI ("Can record rent payments", never "payments:write").
//
// Effective permission = per-user override when present, otherwise the role default.
// Deny-by-default: a permission granted by neither the role default nor an override is denied.
//
// Role defaults (server-side source of truth; the migration's valid_permissions array mirrors
// the key list for override validation):
//   primary_owner   implicit full access (never a workspace_members row)
//   co_owner        full access -- UNCHANGED by R17 (documented explicitly)
//   property_manager / manager (legacy alias): everything except team.manage
//   bookkeeper      money recording + reports, no voids/refunds, no team/settings
//   maintenance     work orders + messaging
//   marketing       properties + messaging
//   read_only       no permissions (reads stay available as before)

export const RENTAL_PERMISSIONS = Object.freeze([
  Object.freeze({
    key: "payments.record",
    label: "Can record rent payments",
    description: "Record rent payments and ledger transactions, including batch entry.",
    category: "Money",
  }),
  Object.freeze({
    key: "payments.void_refund",
    label: "Can void or refund payments",
    description: "Void or refund recorded payments. Destructive -- keep this with trusted staff only.",
    category: "Money",
  }),
  Object.freeze({
    key: "vendor_bills.manage",
    label: "Can manage vendor bills",
    description: "Create, edit, and manage vendor bills against properties.",
    category: "Money",
  }),
  Object.freeze({
    key: "vendor_payments.record",
    label: "Can record vendor payments",
    description: "Record check/ACH payments against vendor bills.",
    category: "Money",
  }),
  Object.freeze({
    key: "transfers.record",
    label: "Can record bank transfers",
    description: "Record transfers between bank accounts.",
    category: "Money",
  }),
  Object.freeze({
    key: "tenants.manage",
    label: "Can manage tenants and leases",
    description: "Add/edit tenants, manage leases, and send tenant invites.",
    category: "Operations",
  }),
  Object.freeze({
    key: "properties.manage",
    label: "Can manage properties and owners",
    description: "Add/edit properties, units, and owner records.",
    category: "Operations",
  }),
  Object.freeze({
    key: "maintenance.manage",
    label: "Can manage work orders",
    description: "Create and manage maintenance work orders and contractors.",
    category: "Operations",
  }),
  Object.freeze({
    key: "messages.send",
    label: "Can send messages and statements",
    description: "Send tenant messages, email statements, and use message templates.",
    category: "Operations",
  }),
  Object.freeze({
    key: "reports.view",
    label: "Can view financial reports",
    description: "View rental financial reports.",
    category: "Visibility",
  }),
  Object.freeze({
    key: "settings.manage",
    label: "Can manage rental settings",
    description: "Change rental settings (late fees, email settings, financial setup).",
    category: "Administration",
  }),
  Object.freeze({
    key: "team.manage",
    label: "Can manage the team",
    description: "Invite team members, assign roles, change permissions, and preview as a team member. Owner and co-owner only.",
    category: "Administration",
  }),
]);

export const RENTAL_PERMISSION_KEYS = Object.freeze(RENTAL_PERMISSIONS.map((p) => p.key));

export const RENTAL_PERMISSION_LABELS = Object.freeze(
  Object.fromEntries(RENTAL_PERMISSIONS.map((p) => [p.key, p.label]))
);

const ALL_KEYS = RENTAL_PERMISSION_KEYS;
const EVERYTHING_EXCEPT_TEAM = Object.freeze(ALL_KEYS.filter((k) => k !== "team.manage"));

export const ROLE_LABELS = Object.freeze({
  primary_owner: "Owner",
  co_owner: "Co-owner",
  property_manager: "Property Manager",
  manager: "Manager",
  bookkeeper: "Bookkeeper",
  maintenance: "Maintenance",
  marketing: "Marketing",
  read_only: "Read only",
});

// The named manager roles mirror Rentec's set (maintenance / marketing / property manager).
export const STAFF_ROLES = Object.freeze([
  "co_owner",
  "manager",
  "property_manager",
  "bookkeeper",
  "maintenance",
  "marketing",
  "read_only",
]);

export const ROLE_DEFAULT_PERMISSIONS = Object.freeze({
  co_owner: ALL_KEYS,
  property_manager: EVERYTHING_EXCEPT_TEAM,
  manager: EVERYTHING_EXCEPT_TEAM,
  bookkeeper: Object.freeze([
    "payments.record",
    "vendor_bills.manage",
    "vendor_payments.record",
    "transfers.record",
    "reports.view",
  ]),
  maintenance: Object.freeze(["maintenance.manage", "messages.send"]),
  marketing: Object.freeze(["properties.manage", "messages.send"]),
  read_only: Object.freeze([]),
});

function normalizeOverrides(overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (ALL_KEYS.includes(key) && typeof value === "boolean") clean[key] = value;
  }
  return clean;
}

// Resolves the effective granted permission keys for a member. Unknown roles grant nothing
// (deny-by-default). Overrides win over role defaults in both directions: true grants, false
// revokes even when the role default would grant.
//
// NO-GO fix 2026-10-01 (finding 2): team.manage is NEVER granted to staff, even via an
// explicit override. Only the primary owner (implicit full access) and co_owner (full-access
// role) hold team management rights. The DB layer enforces the same invariant in
// has_rental_permission() and update_workspace_member().
export function resolveEffectivePermissions({ role, overrides } = {}) {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role] || [];
  const clean = normalizeOverrides(overrides);
  const granted = new Set(defaults);
  for (const [key, value] of Object.entries(clean)) {
    if (value) granted.add(key);
    else granted.delete(key);
  }
  if (!isFullAccessRole(role)) {
    granted.delete("team.manage");
  }
  return Object.freeze([...granted]);
}

export function hasRentalPermission(effectivePermissions, permissionKey) {
  if (!Array.isArray(effectivePermissions)) return false;
  return effectivePermissions.includes(permissionKey);
}

// Full access for the household: the primary owner (implicit, no membership row) and the
// co_owner (unchanged by R17).
export function isFullAccessRole(role) {
  return role === "primary_owner" || role === "co_owner";
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || "Unknown role";
}
