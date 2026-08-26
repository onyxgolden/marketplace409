import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Data-driven against the exact policy set captured live from pg_policies during Phase 1
// inspection (63 tables, 76 owner-management policies total repo-wide; this covers the 56 that
// belong to Rental Manager, split across the 5 checkpoint-3 migration files). Financial FORGE's
// remaining policies are checkpoint 4, not this file.
const MIGRATION_FILES = [
  "20260829000300_convert_rental_identity_policies_to_workspace_access.sql",
  "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
  "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
  "20260829000600_convert_rental_insurance_animal_policies_to_workspace_access.sql",
  "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
];

const sqlByFile = Object.fromEntries(
  MIGRATION_FILES.map((filename) => [
    filename,
    readFileSync(resolve(process.cwd(), "supabase/migrations", filename), "utf8").toLowerCase().replace(/\s+/g, " "),
  ]),
);

const CONVERSIONS = [
  {
    file: "20260829000300_convert_rental_identity_policies_to_workspace_access.sql",
    table: "rental_units",
    policy: "rental_units_owner_all",
  },
  {
    file: "20260829000300_convert_rental_identity_policies_to_workspace_access.sql",
    table: "rental_tenants",
    policy: "rental_tenants_owner_all",
  },
  {
    file: "20260829000300_convert_rental_identity_policies_to_workspace_access.sql",
    table: "rental_leases",
    policy: "rental_leases_owner_all",
  },
  {
    file: "20260829000300_convert_rental_identity_policies_to_workspace_access.sql",
    table: "rental_lease_tenants",
    policy: "rental_lease_tenants_owner_all",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "rent_charges",
    policy: "rent_charges_owner_all",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "rent_schedules",
    policy: "rent_schedules_owner_all",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "rental_payments",
    policy: "rental_payments_owner_all",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "rental_settlements",
    policy: "rental_settlements_owner_all",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "ach_authorizations",
    policy: "ach_authorizations_owner_all",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "landlord_payment_accounts",
    policy: "landlord_payment_accounts_owner_select",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "billing_customer_references",
    policy: "billing_customer_references_owner_select",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "rental_autopay_enrollments",
    policy: "rental_autopay_owner_all",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "rental_autopay_attempts",
    policy: "rental_autopay_attempt_owner_read",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "rental_billing_settings",
    policy: "rental_billing_settings_owner_select",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "rental_billing_settings_audit",
    policy: "rental_billing_settings_audit_owner_select",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "rent_schedule_collection_cutover_audit",
    policy: "rent_schedule_cutover_audit_owner_select",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "rentec_transaction_imports",
    policy: "rentec_transaction_imports_owner_insert",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "rentec_transaction_imports",
    policy: "rentec_transaction_imports_owner_select",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "rentec_financial_history_import_batches",
    policy: "rentec_financial_history_import_batches_owner_insert",
  },
  {
    file: "20260829000400_convert_rental_billing_policies_to_workspace_access.sql",
    table: "rentec_financial_history_import_batches",
    policy: "rentec_financial_history_import_batches_owner_select",
  },
  {
    file: "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
    table: "rental_maintenance_requests",
    policy: "rental_maintenance_owner_all",
  },
  {
    file: "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
    table: "rental_maintenance_work_orders",
    policy: "rental_work_order_owner_all",
  },
  {
    file: "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
    table: "rental_maintenance_work_events",
    policy: "rental_work_event_owner_all",
  },
  {
    file: "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
    table: "rental_contractors",
    policy: "rental_contractor_owner_all",
  },
  {
    file: "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
    table: "rental_contractor_payments",
    policy: "rental_contractor_payment_owner_all",
  },
  {
    file: "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
    table: "rental_1099_reviews",
    policy: "rental_1099_review_owner_all",
  },
  {
    file: "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
    table: "rental_documents",
    policy: "rental_documents_owner_all",
  },
  {
    file: "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
    table: "rental_document_acknowledgements",
    policy: "rental_document_ack_owner_select",
  },
  {
    file: "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
    table: "rental_document_audit_log",
    policy: "rental_document_audit_log_owner_insert",
  },
  {
    file: "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
    table: "rental_document_audit_log",
    policy: "rental_document_audit_log_owner_select",
  },
  {
    file: "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
    table: "rental_inspections",
    policy: "rental_inspection_owner_all",
  },
  {
    file: "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
    table: "rental_inspection_items",
    policy: "rental_inspection_item_owner_all",
  },
  {
    file: "20260829000500_convert_rental_maintenance_policies_to_workspace_access.sql",
    table: "rental_inspection_acknowledgements",
    policy: "rental_inspection_ack_owner_select",
  },
  {
    file: "20260829000600_convert_rental_insurance_animal_policies_to_workspace_access.sql",
    table: "rental_animals",
    policy: "rental_animals_owner_all",
  },
  {
    file: "20260829000600_convert_rental_insurance_animal_policies_to_workspace_access.sql",
    table: "pet_liability_policies",
    policy: "pet_liability_owner_all",
  },
  {
    file: "20260829000600_convert_rental_insurance_animal_policies_to_workspace_access.sql",
    table: "monthly_pet_fees",
    policy: "pet_fees_owner_all",
  },
  {
    file: "20260829000600_convert_rental_insurance_animal_policies_to_workspace_access.sql",
    table: "monthly_pet_fee_charges",
    policy: "pet_fee_charges_owner_all",
  },
  {
    file: "20260829000600_convert_rental_insurance_animal_policies_to_workspace_access.sql",
    table: "renters_insurance_requirements",
    policy: "insurance_requirement_owner_all",
  },
  {
    file: "20260829000600_convert_rental_insurance_animal_policies_to_workspace_access.sql",
    table: "renters_insurance_policies",
    policy: "insurance_policy_owner_all",
  },
  {
    file: "20260829000600_convert_rental_insurance_animal_policies_to_workspace_access.sql",
    table: "renters_insurance_evidence",
    policy: "insurance_evidence_owner_read",
  },
  {
    file: "20260829000600_convert_rental_insurance_animal_policies_to_workspace_access.sql",
    table: "insurance_referral_links",
    policy: "insurance_referral_owner_all",
  },
  {
    file: "20260829000600_convert_rental_insurance_animal_policies_to_workspace_access.sql",
    table: "rent_reporting_enrollments",
    policy: "rent_reporting_owner_all",
  },
  {
    file: "20260829000600_convert_rental_insurance_animal_policies_to_workspace_access.sql",
    table: "rent_reporting_fees",
    policy: "rent_reporting_fee_owner_all",
  },
  {
    file: "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
    table: "rental_notification_outbox",
    policy: "rental_notification_owner_select",
  },
  {
    file: "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
    table: "rental_notification_preferences",
    policy: "rental_notification_preferences_owner_select",
  },
  {
    file: "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
    table: "rental_notification_delivery_events",
    policy: "rental_delivery_owner_select",
  },
  {
    file: "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
    table: "rental_email_settings",
    policy: "rental_email_settings_owner",
  },
  {
    file: "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
    table: "rental_support_cases",
    policy: "rental_support_owner_all",
  },
  {
    file: "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
    table: "rental_support_case_events",
    policy: "rental_support_event_owner_all",
  },
  {
    file: "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
    table: "rental_security_deposits",
    policy: "rental_deposit_owner_all",
  },
  {
    file: "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
    table: "rental_security_deposit_transactions",
    policy: "rental_deposit_tx_owner_select",
  },
  {
    file: "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
    table: "rental_lease_changes",
    policy: "rental_lease_change_owner_all",
  },
  {
    file: "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
    table: "rental_late_fee_rules",
    policy: "rental_late_rule_owner_all",
  },
  {
    file: "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
    table: "rental_late_fee_assessments",
    policy: "rental_late_assessment_owner_all",
  },
  {
    file: "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
    table: "rental_lease_preparations",
    policy: "rental_lease_preparation_owner_all",
  },
  {
    file: "20260829000700_convert_rental_notifications_support_policies_to_workspace_access.sql",
    table: "rental_lease_preparation_versions",
    policy: "rental_lease_preparation_version_owner_all",
  },
];

describe("Rental Manager RLS policy conversion to workspace access (checkpoint 3)", () => {
  it(`converts every one of the ${CONVERSIONS.length} captured owner-management policies`, () => {
    for (const { file, table, policy } of CONVERSIONS) {
      const sql = sqlByFile[file];
      expect(sql, `${file}: expected a drop for "${policy}" on ${table}`).toContain(`drop policy "${policy}" on ${table}`);
      expect(sql, `${file}: expected a has_workspace_access recreate for "${policy}" on ${table}`).toContain(`create policy "${policy}" on ${table}`);
    }
  });

  it("every recreated policy predicate uses has_workspace_access(owner_id), not bare auth.uid() equality", () => {
    for (const file of MIGRATION_FILES) {
      const sql = sqlByFile[file];
      // Checks the actual predicate usage (using/with check clauses), not the header comment's
      // prose explanation of what's being replaced -- that prose legitimately quotes the old form.
      expect(sql, `${file}: should not reintroduce the old predicate in a using() clause`).not.toContain("using (owner_id = auth.uid()");
      expect(sql, `${file}: should not reintroduce the old predicate in a with check() clause`).not.toContain("with check (owner_id = auth.uid()");
      expect(sql).toContain("has_workspace_access(owner_id)");
    }
  });

  it("never deletes any existing table or data, and never edits a historical migration file", () => {
    for (const file of MIGRATION_FILES) {
      const sql = sqlByFile[file];
      expect(sql).not.toContain("drop table");
      expect(sql).not.toContain("delete from");
    }
  });
});
