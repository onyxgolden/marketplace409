/**
 * taxonomy.js — the 12 rental dimensions from contract §2, decomposed into
 * atomic propositions. Each proposition has a stable ID; the rubric (§7)
 * scores per proposition, never per vague feature name.
 *
 * These are research questions, not assertions that any vendor supports them.
 */

export const RENTAL_DIMENSIONS = [
  {
    id: "identity",
    name: "Property/unit/tenant identities and supported portfolio scope",
    propositions: [
      { id: "identity.property-hierarchy", text: "Supports a property → unit → tenant hierarchy with distinct identities at each level." },
      { id: "identity.multi-property-portfolio", text: "A single account can manage multiple properties as one portfolio." },
      { id: "identity.unit-types", text: "Distinguishes unit types (e.g. residential vs commercial) within one portfolio." },
    ],
  },
  {
    id: "ledger",
    name: "Ledger/accounting visibility and separation of rent/deposit balances",
    propositions: [
      { id: "ledger.rent-deposit-separation", text: "Rent receivables and security-deposit liabilities are tracked as separate balances." },
      { id: "ledger.tenant-ledger-view", text: "A per-tenant ledger shows charges, payments, and running balance." },
      { id: "ledger.owner-ledger-view", text: "An owner-level ledger aggregates across properties." },
    ],
  },
  {
    id: "payments",
    name: "Online payments/autopay and payment-state reconciliation",
    propositions: [
      { id: "payments.online-payment", text: "Tenants can pay rent online (ACH/card)." },
      { id: "payments.autopay-setup", text: "Tenants can set up recurring automatic payments." },
      { id: "payments.autopay-actor", text: "The tenant (not only staff) can initiate autopay enrollment." },
      { id: "payments.payment-reconciliation", text: "Payment state (pending/settled/failed) is reconciled against the ledger." },
      { id: "payments.failed-payment-retry", text: "Failed payments have defined retry or notification behavior." },
    ],
  },
  {
    id: "portal",
    name: "Tenant portal/self-service",
    propositions: [
      { id: "portal.self-service", text: "Tenants have a self-service portal for account actions." },
      { id: "portal.payment-history", text: "Tenants can view their own payment history in the portal." },
      { id: "portal.maintenance-request", text: "Tenants can submit maintenance requests through the portal." },
    ],
  },
  {
    id: "reporting",
    name: "Owner statements/reporting",
    propositions: [
      { id: "reporting.owner-statement", text: "Generates periodic owner statements." },
      { id: "reporting.financial-reports", text: "Provides profit/loss or cash-flow reporting." },
      { id: "reporting.tax-reports", text: "Provides tax-oriented reports (e.g. Schedule E support)." },
    ],
  },
  {
    id: "expenses",
    name: "Billing/invoice/vendor expense workflow",
    propositions: [
      { id: "expenses.vendor-bills", text: "Vendor bills/invoices can be recorded against properties." },
      { id: "expenses.expense-approval", text: "Expense entries support an approval workflow." },
    ],
  },
  {
    id: "maintenance",
    name: "Maintenance/work orders",
    propositions: [
      { id: "maintenance.work-orders", text: "Maintenance work orders can be created, assigned, and tracked." },
      { id: "maintenance.vendor-assignment", text: "Work orders can be assigned to vendors/contractors." },
    ],
  },
  {
    id: "leasing",
    name: "Leasing/onboarding/renewals",
    propositions: [
      { id: "leasing.application", text: "Rental applications can be collected online." },
      { id: "leasing.esignature", text: "Leases support electronic signature." },
      { id: "leasing.renewal", text: "Lease renewals are supported as a workflow." },
    ],
  },
  {
    id: "communications",
    name: "Receipts/reminders/communications",
    propositions: [
      { id: "communications.payment-receipt", text: "Payment receipts are issued to tenants." },
      { id: "communications.reminders", text: "Automated payment reminders can be sent." },
      { id: "communications.mass-message", text: "Bulk messaging to tenants is supported." },
    ],
  },
  {
    id: "migration",
    name: "Import/export/migration workflow",
    propositions: [
      { id: "migration.data-import", text: "Bulk import of properties/tenants/ledgers is supported." },
      { id: "migration.data-export", text: "Portfolio data can be exported in a portable format." },
    ],
  },
  {
    id: "rbac",
    name: "Roles/permissions/audit trail",
    propositions: [
      { id: "rbac.roles", text: "Multiple user roles with distinct permissions exist." },
      { id: "rbac.granular-permissions", text: "Permissions are granular (least-privilege assignable)." },
      { id: "rbac.audit-trail", text: "An audit trail records who changed what." },
    ],
  },
  {
    id: "mobile",
    name: "Mobile access and public deployment/integration constraints",
    propositions: [
      { id: "mobile.native-or-web", text: "A mobile app or mobile-optimized web experience exists." },
      { id: "mobile.public-api", text: "A public API is documented for integrations." },
    ],
  },
];

/** Flat map of proposition_id -> {dimension_id, text}. */
export const PROPOSITIONS = Object.freeze(
  Object.fromEntries(
    RENTAL_DIMENSIONS.flatMap((d) =>
      d.propositions.map((p) => [p.id, { dimension_id: d.id, dimension_name: d.name, text: p.text }])
    )
  )
);

export const PROPOSITION_IDS = Object.freeze(Object.keys(PROPOSITIONS));

/**
 * Canonical digest of the taxonomy. Admission (compare.js) requires the
 * caller's feature_taxonomy_ref.digest to match exactly — the comparison
 * must run against this taxonomy, not a caller-substituted one.
 */
import { createHash as __createHash } from "node:crypto";
export const TAXONOMY_DIGEST = __createHash("sha256")
  .update(
    JSON.stringify(
      PROPOSITION_IDS.map((id) => [id, PROPOSITIONS[id].text]),
    ),
    "utf8",
  )
  .digest("hex");

/** Known synonym map — preserves the source's weaker exact meaning (§5). */
export const SYNONYM_MAP = Object.freeze({
  "rbac": ["role-based access control", "user roles", "permission levels"],
  "autopay": ["automatic payments", "recurring payments", "auto-pay"],
  "e-signature": ["electronic signature", "digital signature", "e-sign"],
});
