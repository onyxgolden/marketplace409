// Rental Manager admin permissions — slice 1: capability catalog, starter
// roles, and the key -> enforcement manifest.
//
// The catalog is the single JS source of truth for the admin page. It MUST
// match the database catalog in the migration
// `supabase/migrations/20261110010000_rental_admin_roles_slice1.sql`
// (`rental_admin_catalog_keys()`, `rental_admin_owner_only_keys()`,
// `rental_admin_starter_role_keys()`). The migration test asserts the counts
// agree; keep both in sync when the catalog changes.
//
// Enforcement (where each key is actually checked):
//   * DB predicate: `has_rental_permission(owner_id, key)` — the
//     `rental.*` keys resolve ONLY through an active role assignment.
//   * RLS: additive policies on rental_tenants and
//     rental_maintenance_requests / rental_maintenance_work_orders.
//   * API: the reports route gates on rental.reports.read (view) and
//     rental.reports.export (CSV) on top of the existing visibility
//     behavior; the invite action gates on rental.tenants.invite.
//   * Keys with no slice-1 enforcement are marked `enforced: "later"` —
//     they are cataloged and assignable, but their surfaces are not yet
//     re-policied. Do not present them as enforced.

export const RENTAL_ADMIN_APP_KEY = "rental";

// Owner/co-owner-only finance keys. They can never be put on a role (the
// RPCs reject them) and the DB predicate never returns them for staff,
// even if a role lists them. Billing activation/settings, refunds, and
// credits stay owner/co-owner-only in slice 1.
export const RENTAL_ADMIN_OWNER_ONLY_KEYS = [
  "rental.billing.activate",
  "rental.billing.settings.edit",
  "rental.payments.refund",
  "rental.deposits.refund",
  "rental.credits.issue",
  "rental.credits.apply",
  "rental.credits.void",
];

// The capability catalog: key, plain-English label + description, and the
// surface it belongs to (the admin page groups the grid by surface).
export const RENTAL_ADMIN_CAPABILITIES = [
  // Dashboard / properties
  { key: "rental.dashboard.read", label: "View the dashboard", description: "See the rental dashboard and totals.", surface: "Dashboard & properties" },
  { key: "rental.properties.read", label: "View properties", description: "See the property list and details.", surface: "Dashboard & properties" },
  { key: "rental.properties.create", label: "Add properties", description: "Add a new property.", surface: "Dashboard & properties" },
  { key: "rental.properties.edit", label: "Edit properties", description: "Change property details.", surface: "Dashboard & properties" },
  { key: "rental.properties.archive", label: "Archive properties", description: "Archive a property so it no longer shows as active.", surface: "Dashboard & properties" },
  // Billing
  { key: "rental.billing.read", label: "View billing", description: "See billing settings and the collection state.", surface: "Billing" },
  { key: "rental.billing.activate", label: "Turn on FORGE billing", description: "Switch a lease from outside billing to FORGE billing. Owner or co-owner only.", surface: "Billing" },
  { key: "rental.billing.settings.edit", label: "Edit billing settings", description: "Change billing, late-fee, payment-policy, and convenience-fee settings. Owner or co-owner only.", surface: "Billing" },
  // Payments / credits
  { key: "rental.payments.read", label: "View payments", description: "See payments and receipts.", surface: "Payments & credits" },
  { key: "rental.payments.record_offline", label: "Record a payment received outside FORGE", description: "Record cash, check, or other offline payments.", surface: "Payments & credits" },
  { key: "rental.payments.refund", label: "Refund a payment", description: "Return a payment to a tenant. Owner or co-owner only.", surface: "Payments & credits" },
  { key: "rental.credits.issue", label: "Issue a credit", description: "Give a tenant a credit on their account. Owner or co-owner only.", surface: "Payments & credits" },
  { key: "rental.credits.apply", label: "Apply a credit", description: "Use a tenant's credit against a charge. Owner or co-owner only.", surface: "Payments & credits" },
  { key: "rental.credits.void", label: "Void a credit", description: "Cancel a credit that was issued. Owner or co-owner only.", surface: "Payments & credits" },
  // Tenants
  { key: "rental.tenants.read", label: "View tenants", description: "See the tenant list and details.", surface: "Tenants" },
  { key: "rental.tenants.create", label: "Add tenants", description: "Add a new tenant.", surface: "Tenants" },
  { key: "rental.tenants.edit", label: "Edit tenants", description: "Change tenant details.", surface: "Tenants" },
  { key: "rental.tenants.remove", label: "Remove tenants", description: "Remove a tenant from a lease.", surface: "Tenants" },
  { key: "rental.tenants.invite", label: "Invite tenants to the portal", description: "Send a tenant their portal invite.", surface: "Tenants" },
  // Leases
  { key: "rental.leases.read", label: "View leases", description: "See leases and their terms.", surface: "Leases" },
  { key: "rental.leases.create", label: "Add leases", description: "Create a new lease.", surface: "Leases" },
  { key: "rental.leases.terms.edit", label: "Edit lease terms", description: "Change the rent, dates, or terms of a lease.", surface: "Leases" },
  { key: "rental.leases.end", label: "End leases", description: "End a lease.", surface: "Leases" },
  // Charges / schedules
  { key: "rental.charges.read", label: "View charges", description: "See rent charges and what is due.", surface: "Charges & schedules" },
  { key: "rental.schedules.read", label: "View rent schedules", description: "See the rent schedule for a lease.", surface: "Charges & schedules" },
  { key: "rental.charges.generate", label: "Generate charges", description: "Create the next rent charges.", surface: "Charges & schedules" },
  { key: "rental.charges.adjust", label: "Adjust charges", description: "Change the amount of a charge.", surface: "Charges & schedules" },
  { key: "rental.charges.void", label: "Void charges", description: "Cancel a charge.", surface: "Charges & schedules" },
  { key: "rental.schedules.edit", label: "Edit rent schedules", description: "Change a rent schedule.", surface: "Charges & schedules" },
  // Deposits
  { key: "rental.deposits.read", label: "View deposits", description: "See security deposits held.", surface: "Deposits" },
  { key: "rental.deposits.record", label: "Record a deposit", description: "Record a security deposit received.", surface: "Deposits" },
  { key: "rental.deposits.adjust", label: "Adjust a deposit", description: "Change the amount of a deposit held.", surface: "Deposits" },
  { key: "rental.deposits.refund", label: "Refund a deposit", description: "Return a security deposit. Owner or co-owner only.", surface: "Deposits" },
  // Maintenance
  { key: "rental.maintenance.read", label: "View maintenance", description: "See maintenance requests and work orders.", surface: "Maintenance" },
  { key: "rental.maintenance.create", label: "Add maintenance requests", description: "Create a maintenance request.", surface: "Maintenance" },
  { key: "rental.maintenance.edit", label: "Edit maintenance", description: "Change a maintenance request or work order.", surface: "Maintenance" },
  { key: "rental.maintenance.assign", label: "Assign maintenance", description: "Assign a request or work order to someone.", surface: "Maintenance" },
  { key: "rental.maintenance.close", label: "Close maintenance", description: "Mark a request or work order done.", surface: "Maintenance" },
  // Documents
  { key: "rental.documents.read", label: "View documents", description: "See leases, notices, and other documents.", surface: "Documents" },
  { key: "rental.documents.upload", label: "Upload documents", description: "Add a document.", surface: "Documents" },
  { key: "rental.documents.edit", label: "Edit documents", description: "Change a document's details.", surface: "Documents" },
  { key: "rental.documents.delete", label: "Delete documents", description: "Delete a document.", surface: "Documents" },
  // Reports / settings
  { key: "rental.reports.read", label: "View reports", description: "See rental reports.", surface: "Reports & settings" },
  { key: "rental.settings.read", label: "View settings", description: "See rental settings.", surface: "Reports & settings" },
  { key: "rental.reports.export", label: "Download reports", description: "Download reports as a file.", surface: "Reports & settings" },
  { key: "rental.settings.edit", label: "Edit settings", description: "Change rental settings.", surface: "Reports & settings" },
  // Staff / admin
  { key: "rental.staff.read", label: "View the team", description: "See who is on the team and their roles.", surface: "Team & roles" },
  { key: "rental.roles.read", label: "View roles", description: "See the roles and what each one can do.", surface: "Team & roles" },
  { key: "rental.audit.read", label: "View the role change log", description: "See who changed a role, and when.", surface: "Team & roles" },
  { key: "rental.staff.invite", label: "Invite team members", description: "Invite someone to join the team.", surface: "Team & roles" },
  { key: "rental.roles.manage", label: "Manage roles", description: "Create, edit, assign, and retire roles. Given only by the owner or co-owner.", surface: "Team & roles" },
  // Shared client -> site -> project hierarchy (foundation migration
  // 20261112010000): read on every starter role, manage on Rental Admin
  // only. These keys resolve through the rental role framework in
  // has_forge_hierarchy_permission — never through has_rental_permission's
  // legacy R17 branch, which would over-grant them.
  { key: "forge.hierarchy.read", label: "View clients, sites, and projects", description: "See the shared client, site, and project hierarchy in the selector.", surface: "Hierarchy" },
  { key: "forge.hierarchy.manage", label: "Manage clients, sites, and projects", description: "Create, edit, archive, reparent, and delete clients, sites, and projects.", surface: "Hierarchy" },
];

export const RENTAL_ADMIN_CAPABILITY_KEYS = RENTAL_ADMIN_CAPABILITIES.map((c) => c.key);

export const RENTAL_ADMIN_CAPABILITY_BY_KEY = new Map(
  RENTAL_ADMIN_CAPABILITIES.map((c) => [c.key, c]),
);

export const RENTAL_ADMIN_SURFACES = [...new Set(RENTAL_ADMIN_CAPABILITIES.map((c) => c.surface))];

// Starter roles (must match rental_admin_starter_role_keys() in the
// migration). Owner/co-owner are implicit and never rows. Starter roles
// are materialized lazily by rental_ensure_starter_roles — the migration
// alone creates no roles and grants nobody anything.
export const RENTAL_ADMIN_STARTER_ROLES = [
  {
    name: "rental_admin",
    displayName: "Rental Admin",
    description: "Runs the day-to-day rental work. Cannot turn on billing, refund, issue credits, or manage roles.",
    keys: [
      "rental.dashboard.read", "rental.properties.read", "rental.properties.create",
      "rental.properties.edit", "rental.properties.archive",
      "rental.billing.read", "rental.payments.read", "rental.payments.record_offline",
      "rental.tenants.read", "rental.tenants.create", "rental.tenants.edit",
      "rental.tenants.remove", "rental.tenants.invite",
      "rental.leases.read", "rental.leases.create", "rental.leases.terms.edit", "rental.leases.end",
      "rental.charges.read", "rental.schedules.read", "rental.charges.generate",
      "rental.charges.adjust", "rental.charges.void", "rental.schedules.edit",
      "rental.deposits.read", "rental.deposits.record", "rental.deposits.adjust",
      "rental.maintenance.read", "rental.maintenance.create", "rental.maintenance.edit",
      "rental.maintenance.assign", "rental.maintenance.close",
      "rental.documents.read", "rental.documents.upload", "rental.documents.edit", "rental.documents.delete",
      "rental.reports.read", "rental.settings.read", "rental.reports.export", "rental.settings.edit",
      "rental.staff.read", "rental.roles.read", "rental.audit.read",
      "forge.hierarchy.read", "forge.hierarchy.manage",
    ],
  },
  {
    name: "manager",
    displayName: "Manager",
    description: "Handles properties, tenants, leases, and maintenance. No deletes and no money moves.",
    keys: [
      "rental.dashboard.read", "rental.properties.read", "rental.properties.create", "rental.properties.edit",
      "rental.tenants.read", "rental.tenants.create", "rental.tenants.edit",
      "rental.leases.read", "rental.leases.create", "rental.leases.terms.edit",
      "rental.charges.read", "rental.schedules.read", "rental.charges.generate",
      "rental.charges.adjust", "rental.schedules.edit",
      "rental.maintenance.read", "rental.maintenance.create", "rental.maintenance.edit", "rental.maintenance.assign",
      "rental.documents.read", "rental.documents.upload", "rental.documents.edit",
      "rental.reports.read",
      "forge.hierarchy.read",
    ],
  },
  {
    name: "bookkeeper",
    displayName: "Bookkeeper",
    description: "Reads the books and records payments received outside FORGE. No refunds, credits, or billing changes.",
    keys: [
      "rental.dashboard.read", "rental.properties.read", "rental.tenants.read", "rental.leases.read",
      "rental.billing.read", "rental.payments.read", "rental.charges.read", "rental.schedules.read",
      "rental.deposits.read", "rental.reports.read", "rental.settings.read",
      "rental.payments.record_offline", "rental.deposits.record",
      "forge.hierarchy.read",
    ],
  },
  {
    name: "read_only",
    displayName: "Read-only",
    description: "Looks, does not touch. No writes and no money details.",
    keys: [
      "rental.dashboard.read", "rental.properties.read", "rental.tenants.read",
      "rental.leases.read", "rental.maintenance.read", "rental.reports.read",
      "forge.hierarchy.read",
    ],
  },
];

// Where each key is actually enforced in slice 1. `enforced: "rls"` means an
// additive RLS policy checks the key; `enforced: "api"` means an API route
// or server action checks it; `enforced: "predicate"` means the DB
// predicate knows it but no surface checks it yet; `enforced: "later"`
// means the key is cataloged for the admin page but its surface is not
// re-policied in slice 1. The admin page shows the enforcement state so an
// admin is never misled about what a key does.
export const RENTAL_ADMIN_ENFORCEMENT = {
  "rental.dashboard.read": { enforced: "later", where: "Dashboard reads are governed by workspace visibility in slice 1." },
  "rental.properties.read": { enforced: "later", where: "Property reads are governed by workspace visibility in slice 1." },
  "rental.properties.create": { enforced: "later", where: "Property writes are owner/co-owner only until the properties surface is migrated." },
  "rental.properties.edit": { enforced: "later", where: "Property writes are owner/co-owner only until the properties surface is migrated." },
  "rental.properties.archive": { enforced: "later", where: "Property writes are owner/co-owner only until the properties surface is migrated." },
  "rental.billing.read": { enforced: "later", where: "Billing reads are governed by workspace visibility in slice 1." },
  "rental.billing.activate": { enforced: "predicate", where: "Owner/co-owner only. The activation RPC still requires workspace access; the key is never effective for staff." },
  "rental.billing.settings.edit": { enforced: "predicate", where: "Owner/co-owner only. The billing settings RPCs still require workspace access; the key is never effective for staff." },
  "rental.payments.read": { enforced: "later", where: "Payment reads are governed by workspace visibility in slice 1." },
  "rental.payments.record_offline": { enforced: "later", where: "Payment recording is owner/co-owner only until the payments surface is migrated." },
  "rental.payments.refund": { enforced: "predicate", where: "Owner/co-owner only. The key is never effective for staff." },
  "rental.credits.issue": { enforced: "predicate", where: "Owner/co-owner only. The key is never effective for staff." },
  "rental.credits.apply": { enforced: "predicate", where: "Owner/co-owner only. The key is never effective for staff." },
  "rental.credits.void": { enforced: "predicate", where: "Owner/co-owner only. The key is never effective for staff." },
  "rental.tenants.read": { enforced: "rls", where: "RLS policy rental_tenants_admin_read on rental_tenants (SELECT)." },
  "rental.tenants.create": { enforced: "rls", where: "RLS policy rental_tenants_admin_insert on rental_tenants (INSERT)." },
  "rental.tenants.edit": { enforced: "rls", where: "RLS policy rental_tenants_admin_update on rental_tenants (UPDATE)." },
  "rental.tenants.remove": { enforced: "later", where: "No DELETE policy in slice 1: deletes stay owner/co-owner only." },
  "rental.tenants.invite": { enforced: "api", where: "The invite action requires this key (or workspace access); the tenant UPDATE policy permits edit OR invite. Known gap: a direct database call holding only this key could update other tenant columns — column-level enforcement is a follow-on." },
  "rental.leases.read": { enforced: "later", where: "Lease reads are governed by workspace visibility in slice 1." },
  "rental.leases.create": { enforced: "later", where: "Lease writes are owner/co-owner only until the leases surface is migrated." },
  "rental.leases.terms.edit": { enforced: "later", where: "Lease writes are owner/co-owner only until the leases surface is migrated." },
  "rental.leases.end": { enforced: "later", where: "Lease writes are owner/co-owner only until the leases surface is migrated." },
  "rental.charges.read": { enforced: "later", where: "Charge reads are governed by workspace visibility in slice 1." },
  "rental.schedules.read": { enforced: "later", where: "Schedule reads are governed by workspace visibility in slice 1." },
  "rental.charges.generate": { enforced: "later", where: "Charge writes are owner/co-owner only until the charges surface is migrated." },
  "rental.charges.adjust": { enforced: "later", where: "Charge writes are owner/co-owner only until the charges surface is migrated." },
  "rental.charges.void": { enforced: "later", where: "Charge writes are owner/co-owner only until the charges surface is migrated." },
  "rental.schedules.edit": { enforced: "later", where: "Schedule writes are owner/co-owner only until the schedules surface is migrated." },
  "rental.deposits.read": { enforced: "later", where: "Deposit reads are governed by workspace visibility in slice 1." },
  "rental.deposits.record": { enforced: "later", where: "Deposit writes are owner/co-owner only until the deposits surface is migrated." },
  "rental.deposits.adjust": { enforced: "later", where: "Deposit writes are owner/co-owner only until the deposits surface is migrated." },
  "rental.deposits.refund": { enforced: "predicate", where: "Owner/co-owner only. The key is never effective for staff." },
  "rental.maintenance.read": { enforced: "rls", where: "RLS policy rental_maintenance_requests_admin_read on rental_maintenance_requests (SELECT)." },
  "rental.maintenance.create": { enforced: "rls", where: "RLS policies rental_maintenance_requests_admin_insert and rental_maintenance_work_orders_admin_insert (INSERT)." },
  "rental.maintenance.edit": { enforced: "rls", where: "RLS policies rental_maintenance_requests_admin_update and rental_maintenance_work_orders_admin_update (UPDATE)." },
  "rental.maintenance.assign": { enforced: "rls", where: "RLS policies rental_maintenance_requests_admin_update and rental_maintenance_work_orders_admin_update (UPDATE)." },
  "rental.maintenance.close": { enforced: "rls", where: "RLS policies rental_maintenance_requests_admin_update and rental_maintenance_work_orders_admin_update (UPDATE)." },
  "rental.documents.read": { enforced: "later", where: "Document reads are governed by workspace visibility in slice 1." },
  "rental.documents.upload": { enforced: "later", where: "Document writes are owner/co-owner only until the documents surface is migrated." },
  "rental.documents.edit": { enforced: "later", where: "Document writes are owner/co-owner only until the documents surface is migrated." },
  "rental.documents.delete": { enforced: "later", where: "Document writes are owner/co-owner only until the documents surface is migrated." },
  "rental.reports.read": { enforced: "api", where: "The reports route requires this key (or existing workspace visibility) to view a report." },
  "rental.settings.read": { enforced: "later", where: "Settings reads are governed by workspace visibility in slice 1." },
  "rental.reports.export": { enforced: "api", where: "The reports route requires this key (or existing workspace visibility) to download a report." },
  "rental.settings.edit": { enforced: "later", where: "Settings writes are owner/co-owner only until the settings surface is migrated." },
  "rental.staff.read": { enforced: "later", where: "Team reads use the existing team panel in slice 1." },
  "rental.roles.read": { enforced: "api", where: "The role RPCs require this key (or owner/co-owner) to list roles and look users up." },
  "rental.audit.read": { enforced: "api", where: "The audit RPC requires this key (or owner/co-owner) to read the role change log." },
  "rental.staff.invite": { enforced: "later", where: "Team invites use the existing team panel in slice 1." },
  "rental.roles.manage": { enforced: "api", where: "The role RPCs require this key (or owner/co-owner) to create, edit, assign, and retire roles. Staff admins are bound by a fixed ceiling: they can only grant keys they hold, never this key, and never an owner-only finance key." },
  "forge.hierarchy.read": { enforced: "api", where: "The hierarchy selector and validate-selection RPCs require this key (or owner/co-owner) to read the shared hierarchy." },
  "forge.hierarchy.manage": { enforced: "api", where: "The hierarchy mutation RPCs require this key (or owner/co-owner) to create, edit, archive, reparent, and delete clients, sites, and projects." },
};

// Plain-English labels for a set of keys (used by the admin page and by
// save confirmations: "added X, removed Y").
export function rentalAdminKeyLabels(keys) {
  return (keys || []).map((key) => RENTAL_ADMIN_CAPABILITY_BY_KEY.get(key)?.label || key);
}

export function isRentalAdminOwnerOnlyKey(key) {
  return RENTAL_ADMIN_OWNER_ONLY_KEYS.includes(key);
}

// The effective permissions for a role's capability list: owner-only finance
// keys are never effective for staff, even if a role lists them (the DB
// predicate enforces the same rule — this is the JS mirror for display).
export function rentalAdminEffectiveKeys(keys) {
  return (keys || []).filter((key) => !RENTAL_ADMIN_OWNER_ONLY_KEYS.includes(key));
}
