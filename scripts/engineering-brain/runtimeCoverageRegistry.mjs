// Runtime Coverage Registry (Slice 1) — deterministic production-capability
// inventory plus the registry contract.
//
// This is INVENTORY, not monitoring. Each entry records what a production
// capability is, where it executes, whether it moves money, what durable
// evidence proves an execution happened, how often it should run, and the
// registry's current monitoring-status claim. Nothing here changes what the
// Brain indexes, how it ranks, or what it monitors — Slice 1 is discovery
// only. Evidence adapters (Slice 2) and coverage evaluation against live
// evidence (Slice 3) come later.
//
// Determinism rules (same as the canonical-knowledge registry):
// - entries are sorted by id; no timestamps anywhere;
// - every value is a literal in this file — nothing is read from the
//   environment, the network, or the current clock;
// - the report builder consumes only this registry (plus its own validation).

/**
 * Allowed monitoring-status values. Exactly one per entry, never inferred:
 * - "covered": an independent check verifies executions against evidence.
 * - "partially-covered": some verification exists (e.g. firing is checked)
 *   but the full outcome is not verified against durable evidence.
 * - "uncovered": no verification is known to exist.
 * - "unable-to-verify": the evidence available to the surveyor was
 *   insufficient to decide. Uncertainty is recorded, never upgraded.
 */
export const MONITORING_STATUSES = Object.freeze([
  "covered",
  "partially-covered",
  "uncovered",
  "unable-to-verify",
]);

/** Registry schema version. validateRuntimeCoverageRegistry rejects unknown versions. */
export const RUNTIME_COVERAGE_SCHEMA_VERSION = 1;

/**
 * Required fields per entry. `trigger` is one of:
 *   { kind: "schedule", cron: "<utc cron>", chicago_label: "<readable>" }
 *   { kind: "event", description: "<what fires it>" }
 * `durable_evidence` lists evidence sources; entries marked "unverified" were
 * not traced to a table during the survey (see the survey report).
 */
export const REQUIRED_FIELDS = Object.freeze([
  "id",
  "name",
  "execution_path",
  "trigger",
  "moves_money",
  "durable_evidence",
  "expected_cadence",
  "monitoring_status",
]);

export const CAPABILITIES = Object.freeze([
  {
    id: "brain-doc-drift-nightly",
    name: "Engineering Brain nightly doc-drift",
    execution_path:
      "GitHub Actions .github/workflows/engineering-brain-doc-drift-nightly.yml (DST-aware guard picks one of the two slots)",
    trigger: {
      kind: "schedule",
      cron: "0 6,7 * * *",
      chicago_label: "1:00 AM America/Chicago daily (DST pair)",
    },
    moves_money: false,
    durable_evidence: ["GitHub Actions run log", "fix commits on main"],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note: "Run logs exist; no independent execution check.",
  },
  {
    id: "brain-nightly-selfheal",
    name: "Engineering Brain nightly self-heal",
    execution_path: "GitHub Actions .github/workflows/engineering-brain-nightly-selfheal.yml",
    trigger: {
      kind: "event",
      description: "Fires on workflow_run completion of the undiscovered-errors workflow (not on a cron).",
    },
    moves_money: false,
    durable_evidence: ["GitHub Actions run log", "opened fix PRs"],
    expected_cadence: "on-event (after each undiscovered-errors run)",
    monitoring_status: "partially-covered",
    monitoring_note: "Chained to the collector workflow; no independent check that it ran.",
  },
  {
    id: "brain-nightly-sync",
    name: "Engineering Brain nightly sync",
    execution_path:
      "GitHub Actions .github/workflows/engineering-brain-sync.yml → node scripts/engineering-brain/runEngineeringBrainIndexer.mjs",
    trigger: {
      kind: "schedule",
      cron: "0 9,10 * * *",
      chicago_label: "3:00 AM America/Chicago daily (DST pair: 0 9 UTC in CDT, 0 10 UTC in CST)",
    },
    moves_money: false,
    durable_evidence: ["GitHub Actions run log", "engineering-brain/ index files committed to repo"],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note: "Actions run logs exist; no independent execution check.",
  },
  {
    id: "brain-undiscovered-errors",
    name: "Engineering Brain undiscovered-errors collector",
    execution_path:
      "GitHub Actions .github/workflows/engineering-brain-undiscovered-errors.yml → signals/fetchSupabaseSignals.mjs plus failed-CI collection",
    trigger: {
      kind: "schedule",
      cron: "0 10,11 * * *",
      chicago_label: "5:00 AM America/Chicago daily (DST pair)",
    },
    moves_money: false,
    durable_evidence: ["GitHub Actions run log", "signals artifacts (signals-supabase.json)"],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note: "Read-only by design (workflow never commits); run logs exist, no independent check.",
  },
  {
    id: "forge-governance-refresh",
    name: "FORGE governance document refresh",
    execution_path:
      "GitHub Actions .github/workflows/forge-governance-refresh.yml → npm run forge:session, node scripts/governance/verifyShadowGovernance.mjs",
    trigger: {
      kind: "schedule",
      cron: "0 7,8 * * *",
      chicago_label: "2:00 AM America/Chicago daily (DST pair)",
    },
    moves_money: false,
    durable_evidence: ["GitHub Actions run log"],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note: "Run logs exist; no independent execution check.",
  },
  {
    id: "pf-autopay-sweep",
    name: "Private-financing autopay sweep",
    execution_path:
      "GitHub Actions .github/workflows/rental-cron-sweeps.yml → GET /api/private-financing/cron/autopay-sweep (src/app/api/private-financing/cron/autopay-sweep/route.js → src/application/private-financing/executePfAutopayAttempt.js)",
    trigger: { kind: "schedule", cron: "30 7 * * *", chicago_label: "2:30 AM CDT daily" },
    moves_money: true,
    money_note: "Creates Stripe PaymentIntents (paymentIntentId recorded on the payment row).",
    durable_evidence: [
      "private_financing_online_payments (Supabase, verified)",
      "private_financing_autopay_attempts (Supabase, verified)",
      "private_financing_autopay_enrollments (Supabase, verified)",
      "landlord_payment_accounts (Supabase, verified)",
      "GitHub Actions run log",
    ],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note: "Firing is checked daily; per-payment settlement is not independently verified here.",
  },
  {
    id: "pf-payment-due-reminders",
    name: "Private-financing payment-due reminders",
    execution_path:
      "GitHub Actions .github/workflows/rental-cron-sweeps.yml → GET /api/private-financing/cron/payment-due-reminders",
    trigger: { kind: "schedule", cron: "0 9 * * *", chicago_label: "4:00 AM CDT daily" },
    moves_money: false,
    durable_evidence: [
      "private_financing_payment_reminder_deliveries (Supabase, verified)",
      "GitHub Actions run log",
    ],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note: "Firing is checked daily; delivery outcomes are not independently verified.",
  },
  {
    id: "pf-payment-receipt-notifications",
    name: "Private-financing payment-receipt notifications",
    execution_path:
      "GitHub Actions .github/workflows/rental-cron-sweeps.yml → GET /api/private-financing/cron/payment-receipt-notifications",
    trigger: { kind: "schedule", cron: "0 16 * * *", chicago_label: "11:00 AM CDT daily" },
    moves_money: false,
    durable_evidence: [
      "private_financing_payment_receipt_deliveries (Supabase, verified)",
      "GitHub Actions run log",
    ],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note: "Firing is checked daily; delivery outcomes are not independently verified.",
  },
  {
    id: "rental-autopay-sweep",
    name: "Rental autopay sweep",
    execution_path:
      "GitHub Actions .github/workflows/rental-cron-sweeps.yml → GET /api/rental/cron/autopay-sweep (src/app/api/rental/cron/autopay-sweep/route.js → src/application/rental/executeAutopayAttempt.js)",
    trigger: { kind: "schedule", cron: "23 8 * * *", chicago_label: "3:23 AM CDT daily" },
    moves_money: true,
    money_note: "Creates Stripe PaymentIntents (ACH debits) via the billing provider.",
    durable_evidence: [
      "rental_sweep_runs (Supabase, verified)",
      "rental_sweep_claims (Supabase, verified; atomic daily claim)",
      "rental_payments (Supabase, verified)",
      "rental_autopay_attempts (Supabase, verified)",
      "rental_autopay_enrollments (Supabase, verified)",
      "landlord_payment_accounts (Supabase, verified)",
      "GitHub Actions run log",
    ],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note:
      "Firing is checked daily; the workflow itself fails on per-item failures. Settlement of each debit is not independently verified here.",
  },
  {
    id: "rental-autopay-sweep-watchdog",
    name: "Rental autopay sweep watchdog (recovery)",
    execution_path:
      "GET /api/rental/cron/autopay-sweep-watchdog (src/app/api/rental/cron/autopay-sweep-watchdog/route.js) — runs the same sweep with triggered_by='watchdog'; must acquire the same atomic rental_sweep_claims claim",
    trigger: {
      kind: "event",
      description:
        "Fired from an independent scheduler (deliberately not GitHub Actions; correlated-failure risk). The independent scheduler's identity is not in this repo — unverified.",
    },
    moves_money: true,
    money_note: "Same Stripe-charge path as the rental autopay sweep.",
    durable_evidence: [
      "rental_sweep_runs with triggered_by='watchdog' (Supabase, verified)",
      "rental_sweep_claims (Supabase, verified)",
    ],
    expected_cadence: "on-event (only when the primary 3:23 AM sweep is detected missing)",
    monitoring_status: "unable-to-verify",
    monitoring_note:
      "The watchdog's trigger path could not be verified from this repo; its scheduler lives outside it.",
  },
  {
    id: "rental-generate-charges",
    name: "Rental charge generation",
    execution_path:
      "GitHub Actions .github/workflows/rental-cron-sweeps.yml → GET /api/rental/cron/generate-charges (src/app/api/rental/cron/generate-charges/route.js), bearer CRON_SECRET",
    trigger: { kind: "schedule", cron: "0 6 * * *", chicago_label: "1:00 AM CDT daily" },
    moves_money: true,
    money_note: "Posts rent-charge debits to the tenant ledger (rent_charges); no Stripe call, but ledger debits count as money movement.",
    durable_evidence: [
      "rent_charges (Supabase, verified)",
      "rent_schedules (Supabase, verified)",
      "rental_billing_settings (Supabase, verified)",
      "rental_leases (Supabase, verified)",
      "GitHub Actions run log",
    ],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note:
      "Firing is checked daily by the cron-fire checker; per-charge correctness is not independently verified.",
  },
  {
    id: "rental-late-fee-posting",
    name: "Late-fee posting",
    execution_path:
      "GitHub Actions .github/workflows/rental-cron-sweeps.yml → GET /api/rental/cron/late-fee-posting",
    trigger: { kind: "schedule", cron: "0 11 * * *", chicago_label: "6:00 AM CDT daily" },
    moves_money: true,
    money_note: "Posts late-fee debits to the tenant ledger (rent_charges); no Stripe call, but ledger debits count as money movement.",
    durable_evidence: [
      "rent_charges (Supabase, verified)",
      "rental_late_fee_tenant_overrides (Supabase, verified)",
      "GitHub Actions run log",
    ],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note: "Firing is checked daily; per-fee correctness is not independently verified.",
  },
  {
    id: "rental-owner-payment-notifications",
    name: "Owner payment notifications",
    execution_path:
      "GitHub Actions .github/workflows/rental-cron-sweeps.yml → GET /api/rental/cron/owner-payment-notifications",
    trigger: { kind: "schedule", cron: "0 14 * * *", chicago_label: "9:00 AM CDT daily" },
    moves_money: false,
    durable_evidence: [
      "rental_owner_notifications (Supabase, verified)",
      "GitHub Actions run log",
    ],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note: "Firing is checked daily; delivery outcomes are not independently verified.",
  },
  {
    id: "rental-rent-due-reminders",
    name: "Rent-due reminders",
    execution_path:
      "GitHub Actions .github/workflows/rental-cron-sweeps.yml → GET /api/rental/cron/rent-due-reminders",
    trigger: { kind: "schedule", cron: "0 10 * * *", chicago_label: "5:00 AM CDT daily" },
    moves_money: false,
    durable_evidence: [
      "rental_rent_reminder_deliveries (Supabase, verified)",
      "GitHub Actions run log",
    ],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note: "Firing is checked daily; delivery outcomes are not independently verified.",
  },
  {
    id: "rental-reservation-finance-webhook",
    name: "Reservation finance webhook",
    execution_path: "POST /api/rental/reservation-finance-webhook — handles balance.available and payout.* events",
    trigger: { kind: "event", description: "Stripe webhook delivery." },
    moves_money: false,
    durable_evidence: ["unverified (writes not traced during survey)"],
    expected_cadence: "on-event",
    monitoring_status: "unable-to-verify",
    monitoring_note: "Evidence tables not traced; kept as unable-to-verify rather than guessed.",
  },
  {
    id: "rental-settlement-reconciliation",
    name: "Settlement reconciliation",
    execution_path:
      "GitHub Actions .github/workflows/rental-cron-sweeps.yml → GET /api/rental/cron/settlement-reconciliation",
    trigger: { kind: "schedule", cron: "0 8 * * *", chicago_label: "3:00 AM CDT daily" },
    moves_money: false,
    durable_evidence: [
      "rental_settlements (Supabase, verified)",
      "rental_payments (Supabase, verified)",
      "GitHub Actions run log",
    ],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note: "Firing is checked daily; reconciliation completeness is not independently verified.",
  },
  {
    id: "rental-tenant-invite",
    name: "Tenant invite sweep",
    execution_path:
      "GitHub Actions .github/workflows/rental-cron-sweeps.yml → GET /api/rental/cron/tenant-invite",
    trigger: { kind: "schedule", cron: "0 15 * * *", chicago_label: "10:00 AM CDT daily" },
    moves_money: false,
    durable_evidence: [
      "rental_tenants (Supabase, verified; invite state columns)",
      "rental_lease_tenants (Supabase, verified)",
      "GitHub Actions run log",
    ],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note: "Firing is checked daily; the exact write column was not traced (gap noted for Slice 2).",
  },
  {
    id: "rental-tenant-payment-receipts",
    name: "Tenant payment receipts",
    execution_path:
      "GitHub Actions .github/workflows/rental-cron-sweeps.yml → GET /api/rental/cron/tenant-payment-receipts",
    trigger: { kind: "schedule", cron: "0 18 * * *", chicago_label: "1:00 PM CDT daily" },
    moves_money: false,
    durable_evidence: [
      "rental_tenant_receipt_deliveries (Supabase, verified)",
      "GitHub Actions run log",
    ],
    expected_cadence: "daily",
    monitoring_status: "partially-covered",
    monitoring_note: "Firing is checked daily; delivery outcomes are not independently verified.",
  },
  {
    id: "stripe-connect-account-webhook",
    name: "Stripe Connect account webhook",
    execution_path: "POST /api/rental/stripe-account-webhook — Stripe Connect account events (separate secret from the payment webhook)",
    trigger: { kind: "event", description: "Stripe webhook delivery." },
    moves_money: false,
    durable_evidence: ["unverified (writes not traced during survey)"],
    expected_cadence: "on-event",
    monitoring_status: "unable-to-verify",
    monitoring_note: "Evidence tables not traced; kept as unable-to-verify rather than guessed.",
  },
  {
    id: "stripe-financial-connections-webhook",
    name: "Stripe Financial Connections webhook",
    execution_path: "POST /api/stripe/financial-connections/webhook — bank-connection events",
    trigger: { kind: "event", description: "Stripe webhook delivery." },
    moves_money: false,
    durable_evidence: ["unverified (writes not traced during survey)"],
    expected_cadence: "on-event",
    monitoring_status: "unable-to-verify",
    monitoring_note: "Evidence tables not traced; kept as unable-to-verify rather than guessed.",
  },
  {
    id: "stripe-rental-payment-webhook",
    name: "Rental Stripe payment webhook",
    execution_path:
      "POST /api/rental/stripe-webhook (src/app/api/rental/stripe-webhook/route.js) — invoked by Stripe on payment_intent.succeeded / payment_intent.payment_failed / processing",
    trigger: { kind: "event", description: "Stripe webhook delivery." },
    moves_money: false,
    money_note: "Processes settlement events and updates payment records; initiates no charges.",
    durable_evidence: [
      "payment_webhook_events (Supabase, verified)",
      "rental_payments (Supabase, verified)",
      "private_financing_online_payments (Supabase, verified)",
    ],
    expected_cadence: "on-event",
    monitoring_status: "uncovered",
    monitoring_note: "No known monitoring of webhook delivery or processing.",
  },
]);

/** The registry, sorted by id. `CAPABILITIES` above is already in id order. */
export function getRegistry() {
  return CAPABILITIES;
}

/** Look up one capability by id; returns undefined when unknown. */
export function getCapability(id) {
  return CAPABILITIES.find((c) => c.id === id);
}
