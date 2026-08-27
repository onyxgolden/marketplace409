// Plain-language Rental Manager operating guidance. Keep this separate from the modal so
// workflows and button explanations can evolve without changing rendering logic.

export const RENTAL_DAILY_WORKFLOW = Object.freeze([
  "Open Summary and review anything due, late, failed, unresolved, or awaiting approval.",
  "Check Rent & Payments for money received, overdue charges, failures, and offline payments that need recording.",
  "Review Maintenance, Communications, and Support for new tenant requests or follow-up work.",
  "Check upcoming lease changes, inspections, insurance expirations, and animal reviews.",
  "Finish with Reconciliation so recorded payments and provider activity agree before relying on reports.",
]);

export const RENTAL_COMMON_WORKFLOWS = Object.freeze([
  Object.freeze({
    id: "new-rental",
    title: "Set up a property and tenant",
    steps: Object.freeze([
      "Add the property and unit under Property & Unit.",
      "Add the renter under Tenants.",
      "Create the lease under Leases using the saved unit and tenant.",
      "Prepare the lease terms in Lease Editor and review them before activation.",
      "Complete billing setup under Rent & Payments only when collection is ready.",
    ]),
  }),
  Object.freeze({
    id: "collect-rent",
    title: "Handle rent and payments",
    steps: Object.freeze([
      "Open Rent & Payments and select the correct lease or tenant.",
      "Review the charge, due date, balance, and collection method before recording anything.",
      "Record cash, cashier's check, or other offline payment only after it is actually received.",
      "Use Reconciliation to compare recorded payments with Stripe or imported provider evidence.",
      "Use Reports to confirm the tenant ledger and rent roll after reconciliation.",
    ]),
  }),
  Object.freeze({
    id: "late-or-failed",
    title: "Handle late or failed rent",
    steps: Object.freeze([
      "Open Summary or Rent & Payments and inspect the specific late or failed charge.",
      "Confirm whether the failure is real, pending, reversed, or already paid outside FORGE.",
      "Record verified offline payment when applicable; never create a second payment to make the balance look right.",
      "Use Lease Changes for owner-controlled late-fee decisions and Communications for the notice trail.",
      "Reconcile the final result before relying on reports.",
    ]),
  }),
  Object.freeze({
    id: "maintenance",
    title: "Handle a maintenance request",
    steps: Object.freeze([
      "Open Maintenance and select the request or create the owner-side record.",
      "Confirm the property, tenant, urgency, description, and access instructions.",
      "Track work-order status and contractor follow-up without marking work complete before field confirmation.",
      "Store supporting invoices or photos in Documents when appropriate.",
      "Close the request only after completion is verified.",
    ]),
  }),
  Object.freeze({
    id: "move-in-out",
    title: "Complete move-in or move-out",
    steps: Object.freeze([
      "Confirm the correct tenant, unit, lease, and effective date.",
      "Use Inspections to document condition; an inspection never creates a deduction by itself.",
      "Use Documents for signed records, photos, and notices.",
      "Use Deposits to record liability and approved disposition separately from rent.",
      "Use Lease Changes to preserve the lease-history trail.",
    ]),
  }),
  Object.freeze({
    id: "pet-or-assistance-animal",
    title: "Review an animal request",
    steps: Object.freeze([
      "Open Animals and identify whether the request is a pet or an assistance-animal review.",
      "Review supporting information without treating an assistance animal as a pet.",
      "Record owner approval or denial and the effective date.",
      "Apply pet fees only to approved pets; assistance animals can never receive a pet fee.",
    ]),
  }),
]);

export const RENTAL_FUNCTION_HELP = Object.freeze({
  overview: Object.freeze({ title: "Summary", summary: "Your exception-first daily starting point.", actions: Object.freeze(["Review due, late, failed, unresolved, and approval-needed work.", "Open the affected function instead of changing records from the summary."]) }),
  setup: Object.freeze({ title: "Property & Unit", summary: "Create and maintain the rental portfolio records that other workflows depend on.", actions: Object.freeze(["Add or select a property and its rentable units.", "Use property actions to open related financial setup or operating work."]) }),
  tenants: Object.freeze({ title: "Tenants", summary: "Create and manage renter identity records.", actions: Object.freeze(["Add a tenant before creating a lease.", "Select a tenant to work with leases, payments, documents, and communications in context."]) }),
  leases: Object.freeze({ title: "Leases", summary: "Connect a saved tenant to a saved unit and maintain rent schedules.", actions: Object.freeze(["Choose persisted unit and tenant records; do not enter internal IDs manually.", "Review dates, rent, deposit, and schedule before activation."]) }),
  "rentec-migration": Object.freeze({ title: "Rentec Migration", summary: "Preview and prepare migration of Rentec rental records.", actions: Object.freeze(["Resolve exceptions before committing any approved import.", "Preview steps do not write Rentec data."]) }),
  "rentec-files": Object.freeze({ title: "Rentec Files", summary: "Inspect available Rentec file metadata without exposing file contents unnecessarily.", actions: Object.freeze(["Use the inventory to identify documents that require deliberate migration.", "File names and contents are not automatically returned."]) }),
  charges: Object.freeze({ title: "Rent & Payments", summary: "Manage charges, balances, payment records, and billing setup.", actions: Object.freeze(["Confirm the tenant, lease, amount, and payment status before recording money.", "Consent or a saved payment method alone does not authorize a debit."]) }),
  reconciliation: Object.freeze({ title: "Reconciliation", summary: "Compare FORGE payment records with provider and settlement evidence.", actions: Object.freeze(["Investigate mismatches instead of forcing balances to agree.", "Finish reconciliation before treating reports as final."]) }),
  "rentec-payment-import": Object.freeze({ title: "Rentec Payment Import", summary: "Preview externally collected Rentec payments for controlled recording in FORGE.", actions: Object.freeze(["Review matched, ambiguous, ignored, and conflict classifications.", "Never approve an ambiguous transaction by guessing."]) }),
  "rentec-financial-history-import": Object.freeze({ title: "Rentec Financial History Import", summary: "Resume historical financial-event import using current Rentec evidence.", actions: Object.freeze(["Preview classifications and resolve conflicts first.", "This records financial history; it does not create rent charges or Stripe payments."]) }),
  "financial-setup": Object.freeze({ title: "Financial Setup", summary: "Assign property-specific financial treatment and reporting setup.", actions: Object.freeze(["Open it from the correct property context.", "Review accounting treatment before saving changes that affect reporting."]) }),
  deposits: Object.freeze({ title: "Deposits", summary: "Track security-deposit liability separately from rental income.", actions: Object.freeze(["Record receipt, holding, approved deductions, and disposition with evidence.", "Deposits are never rent or NOI."]) }),
  reports: Object.freeze({ title: "Reports", summary: "Review rent roll, tenant ledger, and rental operating results.", actions: Object.freeze(["Confirm the reporting period and scope.", "Resolve payment or reconciliation exceptions before relying on totals."]) }),
  maintenance: Object.freeze({ title: "Maintenance", summary: "Track requests, work orders, contractors, and verified completion.", actions: Object.freeze(["Record urgency and access instructions clearly.", "Field confirmation remains authoritative for completed work."]) }),
  inspections: Object.freeze({ title: "Inspections", summary: "Document move-in, move-out, and periodic property condition.", actions: Object.freeze(["Use the correct tenant, unit, date, photos, and notes.", "Inspection findings never create a deposit deduction automatically."]) }),
  insurance: Object.freeze({ title: "Insurance", summary: "Track renter-insurance requirements and verification.", actions: Object.freeze(["Record policy evidence and expiration follow-up.", "FORGE tracks compliance; it does not collect insurance premiums."]) }),
  documents: Object.freeze({ title: "Documents", summary: "Store leases, notices, invoices, photos, and other controlled rental records.", actions: Object.freeze(["Choose the correct property, tenant, lease, category, and visibility.", "Verify the file before making it available through a tenant-facing workflow."]) }),
  communications: Object.freeze({ title: "Communications", summary: "Maintain the auditable notification and reminder outbox.", actions: Object.freeze(["Confirm recipient, message, and delivery state.", "Queued does not mean delivered; email delivery may not yet be active."]) }),
  "lease-lifecycle": Object.freeze({ title: "Lease Changes", summary: "Record renewals, amendments, prorating, notices, and owner-controlled late fees.", actions: Object.freeze(["Use a dated, auditable change instead of silently rewriting history.", "Review money and effective dates before confirming."]) }),
  "lease-preparation": Object.freeze({ title: "Lease Editor", summary: "Prepare editable terms and preserve immutable draft versions.", actions: Object.freeze(["Review every term before saving a version.", "The editor does not claim to provide a licensed Texas REALTORS® form."]) }),
  autopay: Object.freeze({ title: "Autopay", summary: "Review tenant authorization and owner-side collection readiness.", actions: Object.freeze(["Confirm authorization, payment method, lease, and amount controls.", "Authorization alone never activates a debit."]) }),
  animals: Object.freeze({ title: "Animals", summary: "Separate pet approval and fees from assistance-animal review.", actions: Object.freeze(["Record each animal and owner decision.", "Never charge a pet fee for an assistance animal."]) }),
  support: Object.freeze({ title: "Support", summary: "Track incidents and support cases without silently changing money records.", actions: Object.freeze(["Document the issue, evidence, owner, and resolution.", "A support action never moves money automatically."]) }),
});

export const RENTAL_HELP_GROUPS = Object.freeze([
  Object.freeze({ title: "Overview", ids: Object.freeze(["overview"]) }),
  Object.freeze({ title: "Portfolio", ids: Object.freeze(["setup", "tenants", "leases", "rentec-migration", "rentec-files"]) }),
  Object.freeze({ title: "Money", ids: Object.freeze(["charges", "reconciliation", "rentec-payment-import", "rentec-financial-history-import", "financial-setup", "deposits", "reports"]) }),
  Object.freeze({ title: "Operations", ids: Object.freeze(["maintenance", "inspections", "insurance", "documents", "communications"]) }),
  Object.freeze({ title: "Controls", ids: Object.freeze(["lease-lifecycle", "lease-preparation", "autopay", "animals", "support"]) }),
]);

export function getRentalFunctionHelp(activeFunctionId) {
  return RENTAL_FUNCTION_HELP[activeFunctionId] ?? RENTAL_FUNCTION_HELP.overview;
}
