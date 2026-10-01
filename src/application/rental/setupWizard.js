// Guided setup wizard (Rentec-parity slice R16) — pure domain layer.
//
// Rentec's "Basic Setup Steps" is an ordered first-run tour: Settings ->
// Banking -> Owners -> Managers -> Properties -> Tenants, with a plain-English
// explanation of why the order matters. FORGE never had one. This module is the
// single source of truth for the wizard's steps, their order, and their
// completion predicates.
//
// Completion is always derived from real data — never from a click — so a step
// that shows "done" means the underlying record actually exists. The workspace
// data shape consumed by the predicates is documented below; the API route
// (/api/rental/setup-wizard-status) builds it from cheap count queries.

export const SETUP_WIZARD_WORKFLOW_ID = "rental.setup-wizard";
export const SETUP_WIZARD_VERSION = "1.0";

// A workspace is "unsetup" when it has zero non-archived rental properties.
// Properties are the anchor record of the Rental Manager: a brand-new workspace
// has none, and every other step (tenants, charges, deposits) hangs off them.
// This deliberately ignores banking/settings progress — a workspace with bank
// accounts but no properties is still mid-setup and still gets the tour. An
// archived-only workspace (every unit status "inactive") counts as unsetup too:
// archived units are invisible in active lists, so there is nothing to manage.
const ARCHIVED_UNIT_STATUSES = new Set(["inactive"]);

export function countActiveProperties(units) {
  return (units || []).filter((unit) => !ARCHIVED_UNIT_STATUSES.has(String(unit?.status || "").toLowerCase())).length;
}

export function isWorkspaceUnsetup(workspaceData) {
  return countActiveProperties(workspaceData?.units) === 0;
}

// Each step deep-links to the REAL existing surface — the wizard never rebuilds
// forms. `actions` may carry an in-shell function id (RentalApplicationShell's
// buildRentalSurface vocabulary) or an external href for surfaces that live
// outside the Rental Manager (workspace members at /forge/workspace).
//
// "optional" steps never block the tour: they are informational tiles the user
// can act on or ignore. Owners: FORGE models ownership at the workspace level,
// so the signed-in owner IS the owner record — the step is complete by
// definition, and co-owner invites are optional enrichment. Managers: detailed
// manager roles with limited access arrive with R17; until then the workspace
// members directory (shared with Owners) is where helpers get invited.
export const SETUP_WIZARD_STEPS = Object.freeze([
  Object.freeze({
    id: "settings",
    title: "Company settings",
    whyOrder:
      "Start here because everything below reads these settings: late-fee rules, billing, and the name tenants see on their emails. Set them once now and you never touch them again.",
    optional: false,
    actions: Object.freeze([
      Object.freeze({ label: "Late-fee automation", kind: "function", functionId: "lease-lifecycle" }),
      Object.freeze({ label: "Email identity", kind: "function", functionId: "communications" }),
    ]),
  }),
  Object.freeze({
    id: "banking",
    title: "Bank accounts",
    whyOrder:
      "Add your bank accounts before properties so rent has somewhere to land. Every deposit, expense, and owner payout posts to one of these accounts.",
    optional: false,
    actions: Object.freeze([
      Object.freeze({ label: "Open the bank ledger", kind: "function", functionId: "bank-ledger" }),
    ]),
  }),
  Object.freeze({
    id: "owners",
    title: "Owners",
    whyOrder:
      "Every dollar collected belongs to someone — that is why owners come before properties. You are the owner, so this is already handled. If you co-own with a spouse or partner, invite them so they see the same books.",
    optional: true,
    actions: Object.freeze([
      Object.freeze({ label: "Invite a co-owner", kind: "href", href: "/forge/workspace" }),
    ]),
  }),
  Object.freeze({
    id: "managers",
    title: "Managers",
    whyOrder:
      "Property managers and helpers come before properties so you know who can touch what. Invite them with the manager role and this step checks off; finer permission levels are coming in a later update.",
    optional: true,
    actions: Object.freeze([
      Object.freeze({ label: "Invite a manager", kind: "href", href: "/forge/workspace" }),
    ]),
  }),
  Object.freeze({
    id: "properties",
    title: "Properties",
    whyOrder:
      "Now the fun part. Each property is a separate bucket with its own rent, its own expenses, and its own books.",
    optional: false,
    actions: Object.freeze([
      Object.freeze({ label: "Add your first property", kind: "function", functionId: "setup" }),
    ]),
  }),
  Object.freeze({
    id: "tenants",
    title: "Tenants",
    whyOrder:
      "Last on purpose: tenants attach to properties, and move-in dates, rent amounts, and balances only make sense once the property is on the books. Add tenants after the property exists.",
    optional: false,
    actions: Object.freeze([
      Object.freeze({ label: "Add your first tenant", kind: "function", functionId: "tenants" }),
    ]),
  }),
]);

export const SETUP_WIZARD_STEP_IDS = Object.freeze(SETUP_WIZARD_STEPS.map((step) => step.id));

// The workspace data shape the predicates consume (built by the API route):
// {
//   units: [{ status }],            // rental_units rows (RLS-scoped)
//   tenants: [{}],                  // rental_tenants rows (RLS-scoped)
//   bankAccountCount: number,       // active financial_accounts of depository/credit/loan type
//   settingsConfigured: boolean,    // any rental_billing_settings / rental_email_settings / rental_late_fee_rules row
//   members: [{ role, status }],    // non-suspended workspace_members rows visible to the caller (RLS-scoped)
// }
const STEP_PREDICATES = Object.freeze({
  settings: (data) => data?.settingsConfigured === true,
  banking: (data) => Number(data?.bankAccountCount || 0) >= 1,
  // The workspace always has exactly one primary owner (the signed-in owner),
  // so there is nothing to fill in — complete by definition.
  owners: () => true,
  // A step named "Managers" is done only when a manager actually exists: at
  // least one non-suspended member with the manager role. A co-owner,
  // bookkeeper, or read-only member does not satisfy it — the invite screen
  // offers every role, so counting heads would mark this step done for the
  // wrong team. (The primary owner never has a workspace_members row.)
  managers: (data) => (data?.members || []).some((member) => member?.role === "manager"),
  properties: (data) => countActiveProperties(data?.units) >= 1,
  tenants: (data) => (data?.tenants || []).length >= 1,
});

export function evaluateSetupWizardStep(stepId, workspaceData) {
  const predicate = STEP_PREDICATES[stepId];
  if (!predicate) throw new Error(`Unknown setup wizard step: ${stepId}`);
  return predicate(workspaceData) === true;
}

export function buildSetupWizardStatus(workspaceData) {
  const steps = SETUP_WIZARD_STEPS.map((step) => ({
    ...step,
    complete: evaluateSetupWizardStep(step.id, workspaceData),
  }));
  const required = steps.filter((step) => !step.optional);
  return {
    workflowId: SETUP_WIZARD_WORKFLOW_ID,
    version: SETUP_WIZARD_VERSION,
    unsetup: isWorkspaceUnsetup(workspaceData),
    steps,
    completeCount: required.filter((step) => step.complete).length,
    totalCount: required.length,
  };
}
