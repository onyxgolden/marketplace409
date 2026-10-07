// Evidence adapter specs (Slice 2) — which adapters back each registry
// capability's durable evidence.
//
// One spec per capability that has verifiable evidence. Capabilities with
// monitoring_status "unable-to-verify" get NO spec: there is nothing to
// adapt yet, and inventing one would upgrade uncertainty. The uncovered
// webhook gets no spec either — Slice 2 records the absence honestly.
//
// Spec validation (validateAdapterSpecs, fail-closed):
// - every spec's capability_id exists in the shipped registry;
// - every adapter type is known;
// - no duplicate capability ids.

import { ADAPTER_TYPES } from "./adapterTypes.mjs";
import { getCapability } from "../runtimeCoverageRegistry.mjs";

const GITHUB_OWNER_REPO = "onyxgolden/marketplace409";

// windowHours is generous relative to daily cadence: a missed day must
// still leave the previous day's evidence visible, so "no rows" means a
// real gap rather than a tight window.
const DAILY_WINDOW_HOURS = 36;

export const ADAPTER_SPECS = Object.freeze([
  {
    capability_id: "rental-generate-charges",
    adapters: [
      { type: "supabase-table", table: "rent_charges", timeColumn: "created_at", windowHours: DAILY_WINDOW_HOURS },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml" },
    ],
  },
  {
    capability_id: "rental-autopay-sweep",
    adapters: [
      { type: "supabase-table", table: "rental_sweep_runs", timeColumn: "started_at", windowHours: DAILY_WINDOW_HOURS },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml" },
    ],
  },
  {
    capability_id: "pf-autopay-sweep",
    adapters: [
      { type: "supabase-table", table: "private_financing_online_payments", timeColumn: "created_at", windowHours: DAILY_WINDOW_HOURS },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml" },
    ],
  },
  {
    capability_id: "rental-settlement-reconciliation",
    adapters: [
      { type: "supabase-table", table: "rental_settlements", timeColumn: "created_at", windowHours: DAILY_WINDOW_HOURS },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml" },
    ],
  },
  {
    capability_id: "pf-payment-due-reminders",
    adapters: [
      { type: "supabase-table", table: "private_financing_payment_reminder_deliveries", timeColumn: "created_at", windowHours: DAILY_WINDOW_HOURS },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml" },
    ],
  },
  {
    capability_id: "rental-rent-due-reminders",
    adapters: [
      { type: "supabase-table", table: "rental_rent_reminder_deliveries", timeColumn: "created_at", windowHours: DAILY_WINDOW_HOURS },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml" },
    ],
  },
  {
    capability_id: "rental-late-fee-posting",
    adapters: [
      { type: "supabase-table", table: "rent_charges", timeColumn: "created_at", windowHours: DAILY_WINDOW_HOURS },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml" },
    ],
  },
  {
    capability_id: "rental-owner-payment-notifications",
    adapters: [
      { type: "supabase-table", table: "rental_owner_notifications", timeColumn: "created_at", windowHours: DAILY_WINDOW_HOURS },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml" },
    ],
  },
  {
    capability_id: "rental-tenant-invite",
    adapters: [
      { type: "supabase-table", table: "rental_tenants", timeColumn: "updated_at", windowHours: DAILY_WINDOW_HOURS },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml" },
    ],
  },
  {
    capability_id: "pf-payment-receipt-notifications",
    adapters: [
      { type: "supabase-table", table: "private_financing_payment_receipt_deliveries", timeColumn: "first_attempted_at", windowHours: DAILY_WINDOW_HOURS },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml" },
    ],
  },
  {
    capability_id: "rental-tenant-payment-receipts",
    adapters: [
      { type: "supabase-table", table: "rental_tenant_receipt_deliveries", timeColumn: "first_attempted_at", windowHours: DAILY_WINDOW_HOURS },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml" },
    ],
  },
  {
    capability_id: "rental-autopay-sweep-watchdog",
    adapters: [
      // Same table as the primary sweep; a watchdog-triggered run lands
      // here with triggered_by='watchdog'. Slice 3 evaluates the filter.
      { type: "supabase-table", table: "rental_sweep_runs", timeColumn: "started_at", windowHours: 72 },
    ],
  },
  {
    capability_id: "brain-nightly-sync",
    adapters: [{ type: "github-actions", workflowFile: "engineering-brain-sync.yml" }],
  },
  {
    capability_id: "brain-undiscovered-errors",
    adapters: [{ type: "github-actions", workflowFile: "engineering-brain-undiscovered-errors.yml" }],
  },
  {
    capability_id: "brain-doc-drift-nightly",
    adapters: [{ type: "github-actions", workflowFile: "engineering-brain-doc-drift-nightly.yml" }],
  },
  {
    capability_id: "brain-nightly-selfheal",
    adapters: [{ type: "github-actions", workflowFile: "engineering-brain-nightly-selfheal.yml" }],
  },
  {
    capability_id: "forge-governance-refresh",
    adapters: [{ type: "github-actions", workflowFile: "forge-governance-refresh.yml" }],
  },
]);

/** Capabilities deliberately left without adapters (honest absence). */
export const UNSPECIFIED_CAPABILITIES = Object.freeze([
  { capability_id: "stripe-rental-payment-webhook", reason: "uncovered: no durable adapter defined yet" },
  { capability_id: "stripe-connect-account-webhook", reason: "unable-to-verify: evidence tables not traced" },
  { capability_id: "stripe-financial-connections-webhook", reason: "unable-to-verify: evidence tables not traced" },
  { capability_id: "rental-reservation-finance-webhook", reason: "unable-to-verify: evidence tables not traced" },
]);

export function validateAdapterSpecs() {
  const errors = [];
  const seen = new Set();
  for (const spec of ADAPTER_SPECS) {
    if (!spec || typeof spec !== "object") {
      errors.push("adapter spec must be an object");
      continue;
    }
    const id = spec.capability_id;
    if (typeof id !== "string" || id.length === 0) {
      errors.push("adapter spec needs a non-empty capability_id");
      continue;
    }
    if (seen.has(id)) errors.push(`duplicate adapter spec for ${id}`);
    seen.add(id);
    if (!getCapability(id)) {
      errors.push(`adapter spec references unknown capability "${id}"`);
    }
    if (!Array.isArray(spec.adapters) || spec.adapters.length === 0) {
      errors.push(`${id}: adapters must be a non-empty array`);
      continue;
    }
    for (const a of spec.adapters) {
      if (!a || !ADAPTER_TYPES[a.type]) {
        errors.push(`${id}: unknown adapter type "${a && a.type}"`);
      }
    }
  }
  for (const u of UNSPECIFIED_CAPABILITIES) {
    if (!getCapability(u.capability_id)) {
      errors.push(`unspecified entry references unknown capability "${u.capability_id}"`);
    }
    if (seen.has(u.capability_id)) {
      errors.push(`"${u.capability_id}" is both specified and unspecified`);
    }
  }
  errors.sort();
  return { ok: errors.length === 0, errors };
}

export function getAdapterSpec(capabilityId) {
  return ADAPTER_SPECS.find((s) => s.capability_id === capabilityId);
}

export { GITHUB_OWNER_REPO };
