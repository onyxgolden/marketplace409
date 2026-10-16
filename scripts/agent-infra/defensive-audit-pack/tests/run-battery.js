/**
 * run-battery.js — official 36-case battery entrypoint.
 * Usage: node tests/run-battery.js
 *
 * Runs the frozen 36-case fixture set and reports structural match:
 * every case must produce the expected status, complete flag and
 * per-check verdicts. No case may exceed 5s.
 */

import { auditExport } from "../src/index.js";
import { canonicalJson, sha256HexUtf8 } from "../src/canonical.js";
import { CASES, PINS, AS_OF_MS } from "./fixtures.js";

const OPTS = { asOfMs: AS_OF_MS, pins: PINS };

let match = 0;
let mismatch = 0;
const mismatches = [];
let slowest = 0;

for (const c of CASES) {
  const start = Date.now();
  const r = auditExport(c.envelope, OPTS);
  const elapsed = Date.now() - start;
  if (elapsed > slowest) slowest = elapsed;

  const problems = [];
  if (r.status !== c.expect.status) problems.push(`status ${r.status} != ${c.expect.status}`);
  if (r.complete !== c.expect.complete) problems.push(`complete ${r.complete} != ${c.expect.complete}`);
  if (c.expect.status !== "REFUSED") {
    if (r.findings.length !== 6) problems.push(`findings ${r.findings.length} != 6`);
    for (const f of r.findings) {
      if (f.verdict !== c.expect.verdicts[f.check_id]) {
        problems.push(`${f.check_id} ${f.verdict} != ${c.expect.verdicts[f.check_id]}`);
      }
    }
  }
  if (elapsed > 5000) problems.push(`over 5s: ${elapsed}ms`);

  if (problems.length === 0) match++;
  else {
    mismatch++;
    mismatches.push({ name: c.name, problems });
  }
}

// Determinism digest: canonical rendering of all verdicts.
const digestRows = CASES.map((c) => {
  const r = auditExport(c.envelope, OPTS);
  return { name: c.name, status: r.status, complete: r.complete, verdicts: r.findings.map((f) => [f.check_id, f.verdict]) };
});
const digest = sha256HexUtf8(canonicalJson(digestRows));

console.log(`battery: ${match}/36 match, slowest case ${slowest}ms`);
console.log(`battery digest: ${digest}`);
for (const m of mismatches) {
  console.log(`MISMATCH ${m.name}: ${m.problems.join("; ")}`);
}
process.exit(mismatch === 0 ? 0 : 1);
