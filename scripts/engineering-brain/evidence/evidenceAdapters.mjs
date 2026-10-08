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

// Attribution kinds (Slice 3 restriction: evidence must be attributable to
// the specific capability — a shared workflow run or an unrelated row
// proves nothing):
// - "sweep-exclusive": the table is written only by this capability's
//   sweep; rows in the window ARE its execution.
// - "discriminator": a shared table plus filters that isolate this
//   capability's rows.
// - "workflow-exclusive": one workflow file per capability; a run of that
//   file IS the capability executing.
// - "corroborating-only": supports but never proves (shared workflow).
// - "unverified": no verified attribution; the evaluator must not call
//   this capability covered from this source.

export const ADAPTER_SPECS = Object.freeze([
  {
    capability_id: "rental-generate-charges",
    adapters: [
      {
        type: "supabase-table",
        table: "rent_charges",
        timeColumn: "created_at",
        windowHours: DAILY_WINDOW_HOURS,
        filters: [{ column: "source_key", op: "like", value: "rent:%" }],
        attribution: "discriminator",
        attribution_basis:
          "The sweep writes source_key 'rent:<schedule>:<period>'; proration and late-fee writes use other prefixes.",
      },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml", attribution: "corroborating-only" },
    ],
  },
  {
    capability_id: "rental-autopay-sweep",
    adapters: [
      {
        type: "supabase-table",
        table: "rental_sweep_runs",
        timeColumn: "started_at",
        windowHours: DAILY_WINDOW_HOURS,
        filters: [
          { column: "sweep_name", op: "eq", value: "rental-autopay" },
          { column: "triggered_by", op: "eq", value: "schedule" },
        ],
        attribution: "discriminator",
        attribution_basis: "The sweep records its own run rows with its sweep_name and trigger.",
      },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml", attribution: "corroborating-only" },
    ],
  },
  {
    capability_id: "pf-autopay-sweep",
    adapters: [
      {
        type: "supabase-table",
        table: "private_financing_autopay_attempts",
        timeColumn: "created_at",
        windowHours: DAILY_WINDOW_HOURS,
        attribution: "sweep-exclusive",
        attribution_basis: "Only the autopay sweep writes attempt rows.",
      },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml", attribution: "corroborating-only" },
    ],
  },
  {
    capability_id: "rental-settlement-reconciliation",
    adapters: [
      {
        type: "supabase-table",
        table: "rental_settlements",
        timeColumn: "created_at",
        windowHours: DAILY_WINDOW_HOURS,
        attribution: "unverified",
        attribution_basis:
          "The sweep only reads this table; no verified write marker ties rows to its execution.",
      },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml", attribution: "corroborating-only" },
    ],
  },
  {
    capability_id: "pf-payment-due-reminders",
    adapters: [
      {
        type: "supabase-table",
        table: "private_financing_payment_reminder_deliveries",
        timeColumn: "created_at",
        windowHours: DAILY_WINDOW_HOURS,
        attribution: "sweep-exclusive",
        attribution_basis: "Only the reminder sweep writes delivery rows.",
      },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml", attribution: "corroborating-only" },
    ],
  },
  {
    capability_id: "rental-rent-due-reminders",
    adapters: [
      {
        type: "supabase-table",
        table: "rental_rent_reminder_deliveries",
        timeColumn: "created_at",
        windowHours: DAILY_WINDOW_HOURS,
        attribution: "sweep-exclusive",
        attribution_basis: "Only the reminder sweep writes delivery rows.",
      },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml", attribution: "corroborating-only" },
    ],
  },
  {
    capability_id: "rental-late-fee-posting",
    adapters: [
      {
        type: "supabase-table",
        table: "rent_charges",
        timeColumn: "created_at",
        windowHours: DAILY_WINDOW_HOURS,
        filters: [{ column: "source_key", op: "like", value: "latefee:%" }],
        attribution: "discriminator",
        attribution_basis: "The sweep writes source_key 'latefee:<rule>:<charge>'; other writers use other prefixes.",
      },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml", attribution: "corroborating-only" },
    ],
  },
  {
    capability_id: "rental-owner-payment-notifications",
    adapters: [
      {
        type: "supabase-table",
        table: "rental_owner_notifications",
        timeColumn: "created_at",
        windowHours: DAILY_WINDOW_HOURS,
        attribution: "sweep-exclusive",
        attribution_basis: "Only the notification sweep writes these rows.",
      },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml", attribution: "corroborating-only" },
    ],
  },
  {
    capability_id: "rental-tenant-invite",
    adapters: [
      {
        type: "supabase-table",
        table: "rental_tenants",
        timeColumn: "invited_at",
        windowHours: DAILY_WINDOW_HOURS,
        attribution: "sweep-exclusive",
        attribution_basis: "Only the invite sweep stamps invited_at; the time column IS the discriminator.",
      },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml", attribution: "corroborating-only" },
    ],
  },
  {
    capability_id: "pf-payment-receipt-notifications",
    adapters: [
      {
        type: "supabase-table",
        table: "private_financing_payment_receipt_deliveries",
        timeColumn: "first_attempted_at",
        windowHours: DAILY_WINDOW_HOURS,
        attribution: "sweep-exclusive",
        attribution_basis: "Only the receipt sweep writes delivery rows.",
      },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml", attribution: "corroborating-only" },
    ],
  },
  {
    capability_id: "rental-tenant-payment-receipts",
    adapters: [
      {
        type: "supabase-table",
        table: "rental_tenant_receipt_deliveries",
        timeColumn: "first_attempted_at",
        windowHours: DAILY_WINDOW_HOURS,
        attribution: "sweep-exclusive",
        attribution_basis: "Only the receipt sweep writes delivery rows.",
      },
      { type: "github-actions", workflowFile: "rental-cron-sweeps.yml", attribution: "corroborating-only" },
    ],
  },
  {
    capability_id: "rental-autopay-sweep-watchdog",
    adapters: [
      {
        type: "supabase-table",
        table: "rental_sweep_runs",
        timeColumn: "started_at",
        windowHours: 72,
        filters: [
          { column: "sweep_name", op: "eq", value: "rental-autopay" },
          { column: "triggered_by", op: "eq", value: "watchdog" },
        ],
        attribution: "discriminator",
        attribution_basis:
          "Watchdog-triggered runs land in the same table; only triggered_by='watchdog' proves the watchdog fired (review restriction).",
      },
    ],
  },
  {
    capability_id: "brain-nightly-sync",
    adapters: [
      { type: "github-actions", workflowFile: "engineering-brain-sync.yml", attribution: "workflow-exclusive" },
    ],
  },
  {
    capability_id: "brain-undiscovered-errors",
    adapters: [
      { type: "github-actions", workflowFile: "engineering-brain-undiscovered-errors.yml", attribution: "workflow-exclusive" },
    ],
  },
  {
    capability_id: "brain-doc-drift-nightly",
    adapters: [
      { type: "github-actions", workflowFile: "engineering-brain-doc-drift-nightly.yml", attribution: "workflow-exclusive" },
    ],
  },
  {
    capability_id: "brain-nightly-selfheal",
    adapters: [
      { type: "github-actions", workflowFile: "engineering-brain-nightly-selfheal.yml", attribution: "workflow-exclusive" },
    ],
  },
  {
    capability_id: "forge-governance-refresh",
    adapters: [
      { type: "github-actions", workflowFile: "forge-governance-refresh.yml", attribution: "workflow-exclusive" },
    ],
  },
]);

/** Capabilities deliberately left without adapters (honest absence). */
export const UNSPECIFIED_CAPABILITIES = Object.freeze([
  { capability_id: "stripe-rental-payment-webhook", reason: "uncovered: no durable adapter defined yet" },
  { capability_id: "stripe-connect-account-webhook", reason: "unable-to-verify: evidence tables not traced" },
  { capability_id: "stripe-financial-connections-webhook", reason: "unable-to-verify: evidence tables not traced" },
  { capability_id: "rental-reservation-finance-webhook", reason: "unable-to-verify: evidence tables not traced" },
]);

export const ATTRIBUTIONS = Object.freeze([
  "sweep-exclusive",
  "discriminator",
  "workflow-exclusive",
  "corroborating-only",
  "unverified",
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
        continue;
      }
      if (!ATTRIBUTIONS.includes(a.attribution)) {
        errors.push(`${id}: adapter "${a.type}" needs an attribution in ${ATTRIBUTIONS.join(", ")}`);
        continue;
      }
      // A discriminator claim without filters proves nothing — fail closed.
      if (a.attribution === "discriminator" && (!Array.isArray(a.filters) || a.filters.length === 0)) {
        errors.push(`${id}: discriminator attribution needs non-empty filters`);
      }
      if (a.type === "supabase-table" && Array.isArray(a.filters)) {
        for (const f of a.filters) {
          if (!f || typeof f.column !== "string" || (f.op !== "eq" && f.op !== "like")) {
            errors.push(`${id}: malformed filter ${JSON.stringify(f)}`);
          }
        }
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
