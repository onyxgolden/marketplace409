import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const RENTAL_MIGRATIONS = Object.freeze([
  "20260812001800_create_rental_maintenance_requests.sql",
  "20260812001900_create_rental_document_library.sql",
  "20260812002000_create_rental_notification_outbox.sql",
  "20260812002100_post_rental_payments_to_financial_events.sql",
  "20260812002200_create_rental_document_acknowledgements.sql",
  "20260812002300_create_rental_security_deposit_ledger.sql",
  "20260812002400_create_rental_inspections.sql",
  "20260812002500_create_rental_lease_lifecycle_controls.sql",
  "20260813002600_create_rental_maintenance_work_orders.sql",
  "20260813002700_create_rental_lease_preparation_versions.sql",
  "20260813002800_create_rental_autopay_controls.sql",
  "20260813002900_add_rental_reminder_retry_controls.sql",
  "20260813003000_reconcile_rental_payment_reversals.sql",
  "20260813003100_ingest_rental_stripe_settlements.sql",
  "20260813003200_add_renters_insurance_evidence_workflow.sql",
  "20260813003300_add_rental_animal_workflow.sql",
  "20260813003400_add_rental_contractor_tax_ledger.sql",
  "20260813003500_add_rental_support_cases.sql",
  "20260813003600_activate_rental_autopay_execution.sql",
  "20260813003700_activate_rental_email_delivery_controls.sql",
]);

const CORE_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const STRIPE_ENV = ["STRIPE_SECRET_KEY", "STRIPE_CONNECT_WEBHOOK_SECRET", "RENTAL_AUTOPAY_EXECUTION_SECRET"];
const EMAIL_ENV = ["RENTAL_NOTIFICATION_DELIVERY_SECRET", "RENTAL_EMAIL_PROVIDER_URL", "RENTAL_EMAIL_PROVIDER_TOKEN"];

const missing = (names, env) => names.filter((name) => typeof env[name] !== "string" || env[name].trim() === "");

export function inspectFirstTenantReadiness({ root = process.cwd(), env = process.env, schemaOnly = false } = {}) {
  const missingMigrations = RENTAL_MIGRATIONS.filter((file) => !existsSync(path.join(root, "supabase", "migrations", file)));
  const blockers = missingMigrations.map((file) => `Missing required migration: ${file}`);
  const warnings = [];
  if (!schemaOnly) {
    blockers.push(...missing(CORE_ENV, env).map((name) => `Missing core server configuration: ${name}`));
    if (missing(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"], env).length === 2)
      blockers.push("Missing core server configuration: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const stripeMissing = missing(STRIPE_ENV, env);
    if (stripeMissing.length) warnings.push(`Stripe/autopay must remain disabled; missing: ${stripeMissing.join(", ")}`);
    const emailMissing = missing(EMAIL_ENV, env);
    if (emailMissing.length) warnings.push(`Email delivery must remain paused; missing: ${emailMissing.join(", ")}`);
  }
  return Object.freeze({ ready: blockers.length === 0, schemaOnly, migrationCount: RENTAL_MIGRATIONS.length, missingMigrations, blockers, warnings });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = inspectFirstTenantReadiness({ schemaOnly: process.argv.includes("--schema-only") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ready) process.exitCode = 1;
}
