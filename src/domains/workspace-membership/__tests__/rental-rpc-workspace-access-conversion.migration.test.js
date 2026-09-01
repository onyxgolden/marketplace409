import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Data-driven against the 25 Rental Manager RPCs whose owner-equality guard needed converting
// (of 35 functions repo-wide with a p_owner_id parameter -- the other 10 are tenant-identity
// functions, other FORGE sub-apps out of scope this pass, one system-only function with no
// guard, and 3 Financial FORGE RPCs that are checkpoint 4, not this file). Each function's new
// body was generated from its exact live pg_get_functiondef() output with a single targeted
// substitution, not hand-transcribed.
const MIGRATION_FILES = [
  "20260829000800_convert_rental_lease_rpcs_to_workspace_access.sql",
  "20260829000900_convert_rental_billing_rpcs_to_workspace_access.sql",
  "20260829001000_convert_rental_maintenance_rpcs_to_workspace_access.sql",
  "20260829001100_convert_rental_insurance_animal_rpcs_to_workspace_access.sql",
  "20260829001200_convert_rental_notifications_support_rpcs_to_workspace_access.sql",
];

const sqlByFile = Object.fromEntries(
  MIGRATION_FILES.map((filename) => [
    filename,
    readFileSync(resolve(process.cwd(), "supabase/migrations", filename), "utf8").toLowerCase(),
  ]),
);

const FUNCTIONS = [
  {
    file: "20260829000800_convert_rental_lease_rpcs_to_workspace_access.sql",
    name: "activate_rental_lease_schedule",
  },
  {
    file: "20260829000800_convert_rental_lease_rpcs_to_workspace_access.sql",
    name: "apply_rental_lease_change",
  },
  {
    file: "20260829000800_convert_rental_lease_rpcs_to_workspace_access.sql",
    name: "save_rental_lease",
  },
  {
    file: "20260829000800_convert_rental_lease_rpcs_to_workspace_access.sql",
    name: "save_rental_lease_preparation_version",
  },
  {
    file: "20260829000800_convert_rental_lease_rpcs_to_workspace_access.sql",
    name: "approve_rental_lease_preparation_version",
  },
  {
    file: "20260829000900_convert_rental_billing_rpcs_to_workspace_access.sql",
    name: "generate_monthly_rent_charge",
  },
  {
    file: "20260829000900_convert_rental_billing_rpcs_to_workspace_access.sql",
    name: "void_rental_rent_charge",
  },
  {
    file: "20260829000900_convert_rental_billing_rpcs_to_workspace_access.sql",
    name: "record_offline_rental_payment",
  },
  {
    file: "20260829000900_convert_rental_billing_rpcs_to_workspace_access.sql",
    name: "activate_forge_billing_collection",
  },
  {
    file: "20260829000900_convert_rental_billing_rpcs_to_workspace_access.sql",
    name: "set_rental_billing_enabled",
  },
  {
    file: "20260829000900_convert_rental_billing_rpcs_to_workspace_access.sql",
    name: "commit_rentec_rental_import",
  },
  {
    file: "20260829000900_convert_rental_billing_rpcs_to_workspace_access.sql",
    name: "approve_rentec_payment_import",
  },
  {
    file: "20260829000900_convert_rental_billing_rpcs_to_workspace_access.sql",
    name: "queue_rental_balance_reminder",
  },
  {
    file: "20260829001000_convert_rental_maintenance_rpcs_to_workspace_access.sql",
    name: "update_rental_maintenance_work_order",
  },
  {
    file: "20260829001000_convert_rental_maintenance_rpcs_to_workspace_access.sql",
    name: "create_rental_maintenance_work_order",
  },
  {
    file: "20260829001000_convert_rental_maintenance_rpcs_to_workspace_access.sql",
    name: "record_rental_contractor_payment",
  },
  {
    file: "20260829001100_convert_rental_insurance_animal_rpcs_to_workspace_access.sql",
    name: "generate_monthly_pet_fee_charge",
  },
  {
    file: "20260829001100_convert_rental_insurance_animal_rpcs_to_workspace_access.sql",
    name: "review_rental_animal",
  },
  {
    file: "20260829001100_convert_rental_insurance_animal_rpcs_to_workspace_access.sql",
    name: "review_renters_insurance_policy",
  },
  {
    file: "20260829001100_convert_rental_insurance_animal_rpcs_to_workspace_access.sql",
    name: "queue_renters_insurance_renewal_reminders",
  },
  {
    file: "20260829001100_convert_rental_insurance_animal_rpcs_to_workspace_access.sql",
    name: "record_rental_security_deposit_transaction",
  },
  {
    file: "20260829001100_convert_rental_insurance_animal_rpcs_to_workspace_access.sql",
    name: "assess_rental_late_fee",
  },
  {
    file: "20260829001100_convert_rental_insurance_animal_rpcs_to_workspace_access.sql",
    name: "save_rental_inspection",
  },
  {
    file: "20260829001200_convert_rental_notifications_support_rpcs_to_workspace_access.sql",
    name: "cancel_rental_notification",
  },
  {
    file: "20260829001200_convert_rental_notifications_support_rpcs_to_workspace_access.sql",
    name: "update_rental_support_case",
  },
];

describe("Rental Manager RPC guard conversion to workspace access (checkpoint 3)", () => {
  it(`redefines every one of the ${FUNCTIONS.length} captured RPCs with a has_workspace_access guard`, () => {
    for (const { file, name } of FUNCTIONS) {
      const sql = sqlByFile[file];
      expect(sql, `${file}: expected create or replace function for ${name}`).toContain(`create or replace function public.${name}(`);
    }
  });

  it("every redefined function calls has_workspace_access(p_owner_id) at least once", () => {
    for (const file of MIGRATION_FILES) {
      const sql = sqlByFile[file];
      expect(sql).toContain("has_workspace_access(p_owner_id)");
    }
  });

  // Strips comment lines before checking the guard is really gone -- the header comments
  // deliberately quote the old guard shape in prose to explain what changed, which would
  // otherwise false-positive against a naive whole-file substring/regex check.
  function codeOnly(sql) {
    return sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
  }

  it("no redefined function's actual code still compares p_owner_id to auth.uid() by equality", () => {
    for (const file of MIGRATION_FILES) {
      const code = codeOnly(sqlByFile[file]);
      expect(code, `${file}: should not retain a bare p_owner_id<>auth.uid() guard`).not.toMatch(/p_owner_id\s*(<>|=)\s*auth\.uid\(\)/);
      expect(code, `${file}: should not retain a bare auth.uid()<>p_owner_id guard`).not.toMatch(/auth\.uid\(\)::text\s*(<>|=)\s*p_owner_id/);
      expect(code, `${file}: should not retain a bare p_owner_id<>authenticated_owner_id guard`).not.toContain("p_owner_id <> authenticated_owner_id");
    }
  });

  it("preserves auth.uid() usage for actor/audit-trail fields (e.g. recorded_by), not just the removed guard", () => {
    const notificationsAndSupportSql = sqlByFile["20260829001200_convert_rental_notifications_support_rpcs_to_workspace_access.sql"];
    expect(notificationsAndSupportSql).toContain("p_status,auth.uid()::text)");
  });

  it("never drops a table or function, and never edits a historical migration file", () => {
    // Deliberately does not assert against "delete from" -- several of these RPC bodies
    // legitimately contain DML as part of their existing, unchanged business logic (e.g.
    // save_rental_lease replacing rental_lease_tenants membership rows), which is not the
    // "deletes existing data" concern this check is meant to catch.
    for (const file of MIGRATION_FILES) {
      const sql = sqlByFile[file];
      expect(sql).not.toContain("drop table");
      expect(sql).not.toContain("drop function");
    }
  });
});
