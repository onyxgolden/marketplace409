#!/usr/bin/env node
/**
 * run-battery.js — official battery CLI.
 *
 * Authenticates the pinned manifest against the separately trusted
 * GOV_APPROVED_ROOT (host input), runs all 120 frozen cases through the
 * agent under the host watchdog, and prints the per-class acceptance
 * report. Exit 0 only on 120/120.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyManifest, runBattery, acceptanceMetrics } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const APPROVED_ROOT = process.env.GOV_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("battery: missing GOV_APPROVED_ROOT — refusing to run");
  process.exit(3);
}

const v = await verifyManifest(ROOT);
if (v.corpusDigest !== APPROVED_ROOT) {
  console.error("battery: corpus digest is not the separately trusted approved root");
  process.exit(3);
}

const { outputs, corpusDigest } = await runBattery(ROOT, { timeoutMs: 5000 });
const m = acceptanceMetrics(outputs);
console.log(`corpus_digest=${corpusDigest}`);
console.log(`battery: ${m.match}/${m.total} match`);
for (const [cls, s] of Object.entries(m.perClass).sort()) {
  console.log(`  ${cls}: ${s.match}/${s.total}${s.mismatches.length ? ` MISMATCH ${s.mismatches.join(",")}` : ""}`);
}
// Zero-gate summary: unregistered-policy ALLOWED, ungrounded ALLOWED.
let bad = 0;
for (const o of outputs) {
  if (o.structural.classification === "ALLOWED" && o.structural.validity !== "GROUNDED") { bad++; console.log(`  ZERO-GATE FAIL: ${o.case_id} ALLOWED but ${o.structural.validity}`); }
  if (o.structural.classification === "ALLOWED" && o.structural.complete !== true) { bad++; console.log(`  ZERO-GATE FAIL: ${o.case_id} ALLOWED but incomplete`); }
}
process.exit(m.match === m.total && bad === 0 ? 0 : 1);
