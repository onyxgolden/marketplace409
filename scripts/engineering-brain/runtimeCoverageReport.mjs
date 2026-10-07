#!/usr/bin/env node
// Runtime Coverage report (Slice 1) — deterministic view of the registry.
//
// A view, never an authority source: it validates the shipped registry and
// prints a stable summary (counts by monitoring status, the money-moving
// list). Same inputs always produce the same output: entries are already
// sorted by id, no timestamps are emitted.
//
// Usage: node scripts/engineering-brain/runtimeCoverageReport.mjs [--json]
// Exit code 1 when the registry fails validation.

import { getRegistry, MONITORING_STATUSES } from "./runtimeCoverageRegistry.mjs";
import { validateShippedRegistry } from "./validateRuntimeCoverageRegistry.mjs";

function pad(s, n) {
  return String(s).padEnd(n).slice(0, n);
}

function textReport(capabilities) {
  const lines = [];
  lines.push("Runtime Coverage Registry — Slice 1 (inventory, not monitoring)");
  lines.push(`Capabilities: ${capabilities.length}`);
  lines.push("");
  lines.push("By monitoring status:");
  for (const status of MONITORING_STATUSES) {
    const n = capabilities.filter((c) => c.monitoring_status === status).length;
    lines.push(`  ${pad(status, 18)} ${n}`);
  }
  lines.push("");
  lines.push("Money-moving capabilities (flagged, never acted on by this slice):");
  for (const c of capabilities.filter((c) => c.moves_money)) {
    const trig =
      c.trigger.kind === "schedule"
        ? `schedule ${c.trigger.cron} (${c.trigger.chicago_label})`
        : "event-triggered";
    lines.push(`  - ${c.id}: ${c.name} — ${trig}`);
  }
  lines.push("");
  lines.push("Unable-to-verify (uncertainty recorded, not upgraded):");
  for (const c of capabilities.filter((c) => c.monitoring_status === "unable-to-verify")) {
    lines.push(`  - ${c.id}: ${c.monitoring_note}`);
  }
  return lines.join("\n") + "\n";
}

function main() {
  const { ok, errors } = validateShippedRegistry();
  if (!ok) {
    for (const e of errors) console.error(`registry error: ${e}`);
    process.exit(1);
  }
  const capabilities = getRegistry();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(capabilities, null, 2));
  } else {
    process.stdout.write(textReport(capabilities));
  }
}

main();
