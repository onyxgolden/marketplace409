#!/usr/bin/env node
/**
 * run-tests.mjs — official test entrypoint for the skill-manifest linter.
 *
 * Invoke DIRECTLY, never via npm:
 *   node tests/run-tests.mjs
 *
 * Runs the linter over all 24 frozen fixtures and requires a 100% match
 * between each fixture's emitted diagnostic codes and its expected.json.
 * Also asserts: deterministic byte-identical output across runs, bounded
 * output, no script execution (sentinel check), and Skill Spectre
 * composition passthrough.
 *
 * Pure Node 24 ESM, node:fs / node:path / node:os / node:crypto only.
 * Exits 0 when every check passes, 1 otherwise.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync, symlinkSync, unlinkSync, lstatSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { lintSkill } from "../src/linter.mjs";
import { inventoryOne } from "../src/inventory.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const FIXTURES = join(ROOT, "fixtures");

let passed = 0;
let failed = 0;
const failures = [];

// The f14 fixture needs a real escaping symlink, which cannot be stored
// reliably through the API-based push path (it arrives as a regular file).
// Create it transiently at test time and remove it afterwards.
const F14_LINK = join(FIXTURES, "f14-escaping-symlink", "evil");
let f14Created = false;

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}: ${detail}`);
  }
}

function codesOf(report) {
  return report.diagnostics.map((d) => d.code).sort();
}

function runAll() {
  // The f14 fixture needs a real escaping symlink, which cannot be stored
  // reliably through the API-based push path (it arrives as a regular file).
  // Create it transiently at test time; remove it afterwards.
  if (!existsSync(F14_LINK)) {
    symlinkSync("/tmp", F14_LINK);
    f14Created = true;
  }

  try {
// --- 1. Fixture conformance: 100% expected-diagnostic match -----------------
const fixtureDirs = readdirSync(FIXTURES).sort();
check("fixture-count", fixtureDirs.length === 24, `expected 24 fixtures, found ${fixtureDirs.length}`);

for (const dir of fixtureDirs) {
  const fdir = join(FIXTURES, dir);
  const expected = JSON.parse(readFileSync(join(fdir, "expected.json"), "utf8")).diagnostics.slice().sort();
  const report = lintSkill(fdir);
  const actual = codesOf(report);
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  check(
    `fixture ${dir}`,
    match,
    `expected [${expected.join(", ")}] got [${actual.join(", ")}]`
  );
  // Deterministic ordering: diagnostics already sorted by (code, location).
  const resorted = [...report.diagnostics].sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : a.location < b.location ? -1 : 1
  );
  check(
    `fixture ${dir} ordering`,
    JSON.stringify(report.diagnostics) === JSON.stringify(resorted),
    "diagnostics not in deterministic order"
  );
  // Bounded output.
  check(`fixture ${dir} bounded`, report.diagnostics.length <= 200, "diagnostic cap exceeded");
  for (const d of report.diagnostics) {
    if (d.evidence && d.evidence.length > 200) {
      check(`fixture ${dir} evidence-bound`, false, `evidence exceeds 200 chars in ${d.code}`);
      break;
    }
  }
}

// --- 2. Determinism: two runs byte-identical ---------------------------------
const sample = join(FIXTURES, "f02-valid-full");
const runA = JSON.stringify(lintSkill(sample));
const runB = JSON.stringify(lintSkill(sample));
check("determinism", runA === runB, "two lint runs differed");

// --- 3. No execution: a skill script that would plant a sentinel is never run --
const evilRoot = join(tmpdir(), "skill-manifest-noexec-test");
rmSync(evilRoot, { recursive: true, force: true });
mkdirSync(join(evilRoot, "scripts"), { recursive: true });
const sentinel = join(evilRoot, "scripts", "PWNED");
writeFileSync(
  join(evilRoot, "SKILL.md"),
  '---\nname: skill-manifest-noexec-test\ndescription: No-execution probe.\nlicense: MIT\n---\n\nBody.\n'
);
writeFileSync(
  join(evilRoot, "scripts", "plant.sh"),
  `#!/bin/sh\ntouch "${sentinel}"\n`
);
lintSkill(evilRoot);
check("no-execution", !existsSync(sentinel), "skill script was executed (sentinel planted)");
rmSync(evilRoot, { recursive: true, force: true });

// --- 4. No network: external links are noted, never fetched -------------------
const netRoot = join(tmpdir(), "skill-manifest-nonet-test");
rmSync(netRoot, { recursive: true, force: true });
mkdirSync(netRoot, { recursive: true });
writeFileSync(
  join(netRoot, "SKILL.md"),
  '---\nname: skill-manifest-nonet-test\ndescription: No-network probe.\nlicense: MIT\n---\n\nSee [x](https://127.0.0.1:9/unreachable).\n'
);
const netReport = lintSkill(netRoot);
check(
  "no-network",
  netReport.diagnostics.some((d) => d.code === "EXTERNAL_LINK"),
  "external link not reported as metadata-only"
);
rmSync(netRoot, { recursive: true, force: true });

// --- 5. Skill Spectre composition passthrough --------------------------------
const specRoot = join(tmpdir(), "skill-manifest-spectre-test");
rmSync(specRoot, { recursive: true, force: true });
mkdirSync(specRoot, { recursive: true });
writeFileSync(
  join(specRoot, "SKILL.md"),
  '---\nname: skill-manifest-spectre-test\ndescription: Spectre composition probe.\nlicense: MIT\n---\n\nBody.\n'
);
const findingsPath = join(specRoot, "findings.json");
writeFileSync(
  findingsPath,
  JSON.stringify({ tool: "skill-spectre", findings: [{ class: "PROMPT_INJECTION", severity: "LOW" }] })
);
const specReport = lintSkill(specRoot, { spectreFindingsPath: findingsPath });
check(
  "spectre-composition",
  specReport.security_composition.spectre_findings &&
    specReport.security_composition.spectre_findings.tool === "skill-spectre",
  "spectre findings not composed verbatim"
);
check(
  "no-new-block-categories",
  !specReport.diagnostics.some((d) => d.severity === "error" && /PROMPT_INJECTION|SUPPLY_CHAIN|MALWARE/.test(d.code)),
  "linter invented security block categories"
);
rmSync(specRoot, { recursive: true, force: true });

// --- 6. Pilot inventory sanity (read-only) ------------------------------------
const probe = inventoryOne("probe", FIXTURES + "/f02-valid-full");
check("inventory-readonly", probe.has_skill_md && probe.frontmatter_present, "inventory probe failed");

// --- Report ------------------------------------------------------------------
} finally {
  if (f14Created && existsSync(F14_LINK)) {
    try {
      if (lstatSync(F14_LINK).isSymbolicLink()) unlinkSync(F14_LINK);
    } catch { /* best effort cleanup */ }
  }
}

console.log(`\nskill-manifest tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("ALL GREEN");
}

runAll();
