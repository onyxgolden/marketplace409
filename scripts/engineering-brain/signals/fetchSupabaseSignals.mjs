#!/usr/bin/env node
/**
 * fetchSupabaseSignals.mjs — collect runtime signals from Supabase operational tables.
 *
 * Read-only. Scans the delivery/outbox tables behind FORGE's money-movement notifications
 * and emits one signal per anomalous row:
 *   - status = 'failed'            -> severity error, kind delivery_failed
 *   - status in ('queued','sending') older than --stuck-after-hours -> severity warning, kind delivery_stuck
 *
 * A "failed" delivery nobody asked about is the canonical undiscovered error: the system
 * already knows something is wrong, but no human has looked. detectUndiscoveredErrors.mjs
 * (pure) turns this file's output into the ranked report; runUndiscoveredErrorsCli.mjs renders it.
 *
 * Usage:
 *   node scripts/engineering-brain/signals/fetchSupabaseSignals.mjs [--out <signals.json>] [--stuck-after-hours <n>]
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same as the manifest sync).
 * Exit codes: 0 = signals written; 1 = missing env / query failure; 2 = bad arguments.
 */

import { writeFileSync } from "node:fs";
import { createSupabaseServiceClient } from "../persistence/syncManifestToSupabase.mjs";

// One entry per watched table. Columns must exist on the table; the fetcher selects exactly
// these, so a schema change fails loudly here instead of silently returning empty signals.
const WATCHED_TABLES = [
  {
    table: "private_financing_payment_receipt_deliveries",
    idColumn: "id",
    statusColumn: "status",
    reasonColumn: "failure_reason",
    attemptedAtColumn: "last_attempted_at",
    createdAtColumn: "created_at",
    label: "Payment receipt",
    correlationQuery: "payment receipt delivery failed",
    attemptCountColumn: "attempt_count",
  },
  {
    table: "rental_tenant_receipt_deliveries",
    idColumn: "id",
    statusColumn: "status",
    reasonColumn: "failure_reason",
    attemptedAtColumn: "last_attempted_at",
    createdAtColumn: "created_at",
    label: "Rent receipt",
    correlationQuery: "rent receipt delivery failed",
    attemptCountColumn: "attempt_count",
  },
  {
    table: "rental_notification_outbox",
    idColumn: "id",
    statusColumn: "status",
    reasonColumn: "failure_message",
    attemptedAtColumn: "created_at",
    createdAtColumn: "created_at",
    label: "Rental notification",
    correlationQuery: "rental notification delivery failed",
    attemptCountColumn: null,
  },
];

const STUCK_STATUSES = ["queued", "sending"];
const FAILED_STATUS = "failed";
const MAX_ROWS_PER_TABLE = 100;

function parseArgs(argv) {
  const args = { out: null, stuckAfterHours: 2 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") args.out = argv[++i];
    else if (arg === "--stuck-after-hours") args.stuckAfterHours = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.out) throw new Error("--out <signals.json> is required");
  if (!Number.isFinite(args.stuckAfterHours) || args.stuckAfterHours < 0) {
    throw new Error("--stuck-after-hours must be a non-negative number");
  }
  return args;
}

function toSignal({ watched, row, kind, severity }) {
  const rowId = String(row[watched.idColumn]);
  const groupTitle = kind === "delivery_failed"
    ? `${watched.label} delivery failed`
    : `${watched.label} delivery stuck in '${row[watched.statusColumn]}'`;
  return {
    signal_id: `supabase:${watched.table}:${kind}:${rowId}`,
    source: "supabase",
    kind,
    severity,
    title: groupTitle,
    group_title: groupTitle,
    detected_at: new Date().toISOString(),
    correlation_query: watched.correlationQuery,
    evidence: {
      table: watched.table,
      row_id: rowId,
      status: row[watched.statusColumn],
      failure_reason: row[watched.reasonColumn] || null,
      attempt_count: watched.attemptCountColumn ? (row[watched.attemptCountColumn] ?? null) : null,
      last_attempted_at: row[watched.attemptedAtColumn] || null,
    },
  };
}

async function fetchTableSignals(supabase, watched, stuckCutoffIso) {
  const columns = [watched.idColumn, watched.statusColumn, watched.reasonColumn, watched.attemptedAtColumn]
    .concat(watched.attemptCountColumn ? [watched.attemptCountColumn] : [])
    .join(",");
  const signals = [];
  let truncated = false;

  const { data: failed, error: failedError } = await supabase
    .from(watched.table)
    .select(columns)
    .eq(watched.statusColumn, FAILED_STATUS)
    .order(watched.attemptedAtColumn, { ascending: false })
    .limit(MAX_ROWS_PER_TABLE);
  if (failedError) throw new Error(`${watched.table} (failed): ${failedError.message}`);
  truncated = truncated || (failed || []).length >= MAX_ROWS_PER_TABLE;
  for (const row of failed || []) signals.push(toSignal({ watched, row, kind: "delivery_failed", severity: "error" }));

  // Stuck = attempted long ago OR never attempted and queued long ago. The NULL branch
  // matters: a row queued but never attempted has last_attempted_at NULL, and
  // `NULL < cutoff` is never true in PostgREST — without the fallback it escapes forever.
  const stuckFilter = buildStuckFilter(watched, stuckCutoffIso);
  const { data: stuck, error: stuckError } = await supabase
    .from(watched.table)
    .select(columns)
    .in(watched.statusColumn, STUCK_STATUSES)
    .or(stuckFilter)
    .order(watched.attemptedAtColumn, { ascending: true, nullsFirst: true })
    .limit(MAX_ROWS_PER_TABLE);
  if (stuckError) throw new Error(`${watched.table} (stuck): ${stuckError.message}`);
  truncated = truncated || (stuck || []).length >= MAX_ROWS_PER_TABLE;
  for (const row of stuck || []) signals.push(toSignal({ watched, row, kind: "delivery_stuck", severity: "warning" }));

  return { signals, truncated };
}

// Pure: PostgREST filter matching rows stuck past the cutoff, including rows that were
// never attempted (attemptedAt NULL) but have been queued since before the cutoff.
export function buildStuckFilter(watched, stuckCutoffIso) {
  const attempted = watched.attemptedAtColumn;
  const created = watched.createdAtColumn;
  return `${attempted}.lt.${stuckCutoffIso},and(${attempted}.is.null,${created}.lt.${stuckCutoffIso})`;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(2);
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }

  const stuckCutoffIso = new Date(Date.now() - args.stuckAfterHours * 3600 * 1000).toISOString();
  const signals = [];
  let truncated = false;
  try {
    for (const watched of WATCHED_TABLES) {
      const result = await fetchTableSignals(supabase, watched, stuckCutoffIso);
      signals.push(...result.signals);
      truncated = truncated || result.truncated;
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }

  const payload = {
    schema_version: "1.0",
    collected_at: new Date().toISOString(),
    source: "supabase",
    truncated,
    signals,
  };
  writeFileSync(args.out, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${signals.length} signals to ${args.out}${truncated ? " (truncated: a table hit the row cap)" : ""}.`);
}

const invokedAsScript =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`, "file://").href;
if (invokedAsScript) main();
