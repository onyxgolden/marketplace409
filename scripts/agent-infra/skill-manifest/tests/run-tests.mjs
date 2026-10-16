#!/usr/bin/env node
/**
 * run-tests.mjs — official test entrypoint for the skill-manifest linter.
 *
 * Invoke DIRECTLY, never via npm:
 *   node tests/run-tests.mjs
 *
 * Runs the linter over all 36 frozen fixtures and requires a 100% match
 * between each fixture's emitted diagnostic codes and its expected.json.
 * Also asserts: deterministic byte-identical output across runs, bounded
 * output, no script execution (sentinel check), Skill Spectre
 * composition passthrough, full-set conformance derivation (SM-001),
 * containment on every path use (SM-004), and CLI option/attachment
 * handling (SM-005).
 *
 * Pure Node 24 ESM, node:fs / node:path / node:os / node:crypto /
 * node:child_process only.
 * Exits 0 when every check passes, 1 otherwise.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync, symlinkSync, unlinkSync, lstatSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { lintSkill, readBoundedUtf8, MAX_SPECTRE_BYTES } from "../src/linter.mjs";
import { inventoryOne } from "../src/inventory.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const FIXTURES = join(ROOT, "fixtures");
const LINTER = join(ROOT, "src", "linter.mjs");

let passed = 0;
let failed = 0;
const failures = [];

// The f14 fixture needs a real escaping symlink, which cannot be stored
// reliably through the API-based push path (it arrives as a regular file).
// Create it transiently at test time and remove it afterwards.
const F14_LINK = join(FIXTURES, "f14-escaping-symlink", "evil");
let f14Created = false;
// f33-hidden-chain: visible -> .excluded -> outside. Same transient-symlink
// rule: created at test time, removed afterwards. The outside dir holds a
// forbidden body marker used to prove it is never read.
const F33_OUTSIDE = join(tmpdir(), "skill-manifest-f33-outside");
const F33_LINKS = [
  join(FIXTURES, "f33-hidden-chain", ".excluded"),
  join(FIXTURES, "f33-hidden-chain", "visible"),
];
let f33Created = false;
// f35-license-symlink: LICENSE as a symlink (transient, target unresolved).
const F35_LINK = join(FIXTURES, "f35-license-symlink", "LICENSE");
let f35Created = false;
const FORBIDDEN_MARKER = "FORBIDDEN-BODY-MARKER-never-read-7f3a";

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
  // Remove stale transient links from a crashed earlier run (lstat, not
  // existsSync: a dangling symlink is invisible to existsSync).
  for (const p of [F14_LINK, ...F33_LINKS, F35_LINK]) {
    try {
      if (lstatSync(p).isSymbolicLink()) unlinkSync(p);
    } catch { /* nothing to clean */ }
  }
  rmSync(F33_OUTSIDE, { recursive: true, force: true });

  // Transient symlinks for fixtures that cannot store them (f14, f33, f35).
  symlinkSync("/tmp", F14_LINK);
  f14Created = true;
  mkdirSync(F33_OUTSIDE, { recursive: true });
  writeFileSync(join(F33_OUTSIDE, "x.md"), FORBIDDEN_MARKER + "\n");
  symlinkSync(F33_OUTSIDE, F33_LINKS[0]);
  symlinkSync(".excluded", F33_LINKS[1]);
  f33Created = true;
  symlinkSync("LICENSE.real", F35_LINK);
  f35Created = true;

  try {
// --- 1. Fixture conformance: 100% expected-diagnostic match -----------------
const fixtureDirs = readdirSync(FIXTURES).sort();
check("fixture-count", fixtureDirs.length === 36, `expected 36 fixtures, found ${fixtureDirs.length}`);

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

// --- 7. SM-001: conformance from the FULL diagnostic set (API + CLI) ---------
// A note flood must never erase a later-sorting error/review from the
// conformance decision.
function makeFloodRoot(nNotes, { withError = false, withReview = false } = {}) {
  const dir = join(tmpdir(), "skill-manifest-flood-test");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const links = [];
  for (let i = 0; i < nNotes; i++) links.push(`[n${i}](https://example.com/${i})`);
  if (withError) links.push("[bad](../../escape.md)");
  const licenseLine = withReview ? "" : "license: MIT\n";
  const forgeBlock = `forge:
  owner: "Muse"
  provenance: "forge-internal"
  license_status: "verified"
  input_contract: "x"
  output_contract: "y"
  permitted_data_classes:
    - "synthetic-engineering"
  requested_capabilities:
    - "fs.read"
  completion_evidence: "t"
  retirement_policy: "r"
`;
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: skill-manifest-flood-test\ndescription: Flood probe.\n${licenseLine}${forgeBlock}---\n\n${links.join("\n")}\n`
  );
  return dir;
}

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [LINTER, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || "", stderr: e.stderr || "" };
  }
}

// note-flood + error: 205 EXTERNAL_LINK notes sort before the
// PATH_TRAVERSAL_LINK error; the error must still decide conformance.
{
  const dir = makeFloodRoot(205, { withError: true });
  const rep = lintSkill(dir);
  check("sm001-api-flood-error-conformance", rep.conformance === "nonconformant", `flood+error conformance was ${rep.conformance}`);
  check("sm001-api-flood-error-truncated", rep.diagnostics_truncated === true, "flood+error should truncate presentation");
  check("sm001-api-flood-error-omitted", rep.diagnostics_omitted.total === 6 && rep.diagnostics_omitted.by_severity.error === 1, `omitted totals wrong: ${JSON.stringify(rep.diagnostics_omitted)}`);
  check("sm001-api-flood-error-code", rep.diagnostics_omitted.by_code.PATH_TRAVERSAL_LINK === 1, "omitted error code not preserved in summary");
  const cli = runCli([dir]);
  check("sm001-cli-flood-error-exit", cli.code === 1, `CLI flood+error exit was ${cli.code}`);
  const cliRep = JSON.parse(cli.stdout);
  check("sm001-cli-flood-error-conformance", cliRep.conformance === "nonconformant", "CLI flood+error not nonconformant");
  check("sm001-cli-flood-error-omitted", cliRep.diagnostics_omitted.by_severity.error === 1, "CLI omitted error total lost");
  rmSync(dir, { recursive: true, force: true });
}
// note-flood + license review: review must survive the flood.
{
  const dir = makeFloodRoot(205, { withReview: true });
  const rep = lintSkill(dir);
  check("sm001-api-flood-review-conformance", rep.conformance === "review_required", `flood+review conformance was ${rep.conformance}`);
  check("sm001-api-flood-review-omitted", rep.diagnostics_omitted.by_severity.review === 1, "omitted review total lost");
  const cli = runCli([dir]);
  check("sm001-cli-flood-review-exit", cli.code === 1, `CLI flood+review exit was ${cli.code}`);
  check("sm001-cli-flood-review-conformance", JSON.parse(cli.stdout).conformance === "review_required", "CLI flood+review not review_required");
  rmSync(dir, { recursive: true, force: true });
}
// exact-200 boundary: 200 diagnostics are not truncated; 201 are.
{
  const d200 = makeFloodRoot(200);
  const r200 = lintSkill(d200);
  check("sm001-exact200", r200.diagnostics_truncated === false && r200.diagnostics_omitted.total === 0, "exactly 200 diagnostics must not truncate");
  rmSync(d200, { recursive: true, force: true });
  const d201 = makeFloodRoot(201);
  const r201 = lintSkill(d201);
  check("sm001-plus1", r201.diagnostics_truncated === true && r201.diagnostics_omitted.total === 1, "201 diagnostics must truncate exactly one");
  rmSync(d201, { recursive: true, force: true });
}
// deterministic output through the real CLI entrypoint as well.
{
  const out1 = runCli([join(FIXTURES, "f02-valid-full")]);
  const out2 = runCli([join(FIXTURES, "f02-valid-full")]);
  check("sm001-cli-determinism", out1.code === 0 && out1.stdout === out2.stdout, "two CLI runs differed");
}

// --- 8. SM-004: containment on every path use --------------------------------
// Symlinked skill root is refused outright.
{
  const realDir = join(tmpdir(), "skill-manifest-root-real");
  const linkDir = join(tmpdir(), "skill-manifest-root-link");
  rmSync(realDir, { recursive: true, force: true });
  rmSync(linkDir, { force: true });
  mkdirSync(realDir, { recursive: true });
  writeFileSync(join(realDir, "SKILL.md"), "---\nname: skill-manifest-root-real\ndescription: Root probe.\nlicense: MIT\n---\n\nBody.\n");
  symlinkSync(realDir, linkDir);
  const rep = lintSkill(linkDir);
  check("sm004-symlink-root", rep.conformance === "nonconformant" && rep.diagnostics.some((d) => /symlink/i.test(d.message)), "symlinked root not refused");
  const cli = runCli([linkDir]);
  check("sm004-symlink-root-cli", cli.code === 2, `symlinked root CLI exit was ${cli.code}, expected 2`);
  rmSync(linkDir, { force: true });
  rmSync(realDir, { recursive: true, force: true });
}
// Forbidden target bodies are never read: the f33 outside dir holds a
// marker that must not appear anywhere in the report.
{
  const rep = lintSkill(join(FIXTURES, "f33-hidden-chain"));
  const blob = JSON.stringify(rep);
  check("sm004-forbidden-body-never-read", !blob.includes(FORBIDDEN_MARKER), "forbidden outside-root body leaked into the report");
  check("sm004-hidden-chain-refused", rep.diagnostics.some((d) => d.code === "ESCAPING_SYMLINK" && /symlink component|excluded/i.test(d.message)), "hidden chain not refused with a precise diagnostic");
}
// Safe in-root multi-hop links stay clean.
{
  const dir = join(tmpdir(), "skill-manifest-safe-links");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: skill-manifest-safe-links\ndescription: Safe link probe.\nlicense: MIT\nforge:\n  owner: "Muse"\n  provenance: "forge-internal"\n  license_status: "verified"\n  input_contract: "x"\n  output_contract: "y"\n  permitted_data_classes:\n    - "synthetic-engineering"\n  requested_capabilities:\n    - "fs.read"\n  completion_evidence: "t"\n  retirement_policy: "r"\n---\n\nSee [d](docs/guide.md).\n`);
  writeFileSync(join(dir, "docs", "guide.md"), "Guide.\n");
  const rep = lintSkill(dir);
  check("sm004-safe-in-root", rep.conformance === "conformant", `safe in-root links broke conformance: ${JSON.stringify(codesOf(rep))}`);
  rmSync(dir, { recursive: true, force: true });
}
// Bounded enumeration: a directory tree deeper than MAX_DIR_DEPTH is
// refused before the linter is exhausted.
{
  const dir = join(tmpdir(), "skill-manifest-deepdir");
  rmSync(dir, { recursive: true, force: true });
  let cur = dir;
  for (let i = 0; i < 20; i++) {
    cur = join(cur, `level${i}`);
    mkdirSync(cur, { recursive: true });
  }
  writeFileSync(join(cur, "SKILL.md"), "---\nname: deep\ndescription: Deep dir probe.\nlicense: MIT\n---\n\nBody.\n");
  const rep = lintSkill(dir);
  check("sm004-enum-depth-bound", rep.diagnostics.some((d) => d.code === "ENUM_DIR_TOO_DEEP"), "deep directory tree not bounded");
  rmSync(dir, { recursive: true, force: true });
}

// --- 9. SM-005: CLI option parsing + attachment lifecycle --------------------
{
  const root = join(FIXTURES, "f02-valid-full");
  const work = join(tmpdir(), "skill-manifest-cli-test");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const findings = join(work, "findings.json");
  writeFileSync(findings, JSON.stringify({ tool: "skill-spectre", findings: [{ class: "PROMPT_INJECTION", severity: "LOW" }] }));

  // option after root (documented form)
  let r = runCli([root, "--spectre-findings", findings]);
  check("sm005-cli-opt-after", r.code === 0 && JSON.parse(r.stdout).security_composition.spectre_findings.tool === "skill-spectre", `option-after-root failed (exit ${r.code})`);
  check("sm005-cli-opt-after-status", JSON.parse(r.stdout).security_composition.attachment_status === "attached", "attachment_status not attached");
  // option before root
  r = runCli(["--spectre-findings", findings, root]);
  check("sm005-cli-opt-before", r.code === 0 && JSON.parse(r.stdout).security_composition.spectre_findings.tool === "skill-spectre", `option-before-root failed (exit ${r.code})`);
  // missing option value
  r = runCli([root, "--spectre-findings"]);
  check("sm005-cli-missing-value", r.code === 2 && /Usage/.test(r.stderr), `missing option value exit was ${r.code}`);
  // value that looks like an option is not silently consumed
  r = runCli([root, "--spectre-findings", "--bogus"]);
  check("sm005-cli-value-is-option", r.code === 2, `option-looking value exit was ${r.code}`);
  // unknown option
  r = runCli([root, "--bogus"]);
  check("sm005-cli-unknown-option", r.code === 2, `unknown option exit was ${r.code}`);
  // unreadable attachment: honest unavailable outcome, not conformant
  r = runCli([root, "--spectre-findings", join(work, "nope.json")]);
  {
    const rep = JSON.parse(r.stdout);
    check("sm005-cli-unreadable", r.code === 1 && rep.conformance === "nonconformant" && rep.diagnostics.some((d) => d.code === "SPECTRE_INPUT_UNREADABLE"), "unreadable attachment not honestly nonconformant");
    check("sm005-cli-unreadable-status", rep.security_composition.attachment_status === "unavailable", "attachment_status not unavailable");
  }
  // malformed attachment
  writeFileSync(join(work, "bad.json"), "not json{{");
  r = runCli([root, "--spectre-findings", join(work, "bad.json")]);
  {
    const rep = JSON.parse(r.stdout);
    check("sm005-cli-malformed", r.code === 1 && rep.conformance === "nonconformant" && rep.diagnostics.some((d) => d.code === "SPECTRE_INPUT_MALFORMED"), "malformed attachment not honestly nonconformant");
  }
  // oversize attachment: bounded, not copied verbatim
  const bigPath = join(work, "big.json");
  writeFileSync(bigPath, JSON.stringify({ pad: "x".repeat(300 * 1024) }));
  r = runCli([root, "--spectre-findings", bigPath]);
  {
    const rep = JSON.parse(r.stdout);
    check("sm005-cli-oversize", r.code === 1 && rep.diagnostics.some((d) => d.code === "SPECTRE_INPUT_TOO_LARGE") && rep.security_composition.spectre_findings === null, "oversize attachment not bounded");
    check("sm005-cli-oversize-no-verbatim", !r.stdout.includes("x".repeat(1000)), "oversize attachment copied verbatim into output");
  }
  // API-level attachment lifecycle mirrors the CLI
  const apiRep = lintSkill(root, { spectreFindingsPath: join(work, "nope.json") });
  check("sm005-api-unreadable", apiRep.conformance === "nonconformant" && apiRep.diagnostics.some((d) => d.code === "SPECTRE_INPUT_UNREADABLE"), "API unreadable attachment not nonconformant");
  rmSync(work, { recursive: true, force: true });
}

// --- 10. SM-002: parser hardening — quoted scalars + mixed depth (API + CLI)
function makeParserRoot(dirName, frontmatter) {
  const dir = join(tmpdir(), dirName);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}---\n\nBody.\n`);
  return dir;
}
{
  // trailing tokens after the closing quote are malformed (API + CLI)
  const dir = makeParserRoot(
    "skill-manifest-quote-test",
    `name: skill-manifest-quote-test\ndescription: "safe" "trailing"\nlicense: MIT\n`
  );
  const rep = lintSkill(dir);
  check(
    "sm002-api-trailing-quote",
    rep.conformance === "nonconformant" &&
      rep.diagnostics.some((d) => d.code === "MALFORMED_SCALAR") &&
      rep.diagnostics.some((d) => d.code === "MISSING_DESCRIPTION"),
    `trailing-quote not refused: ${JSON.stringify(codesOf(rep))}`
  );
  const cli = runCli([dir]);
  check(
    "sm002-cli-trailing-quote",
    cli.code === 1 && JSON.parse(cli.stdout).diagnostics.some((d) => d.code === "MALFORMED_SCALAR"),
    `CLI trailing-quote exit was ${cli.code}`
  );
  rmSync(dir, { recursive: true, force: true });
}
{
  // unescaped interior quotes are malformed
  const dir = makeParserRoot(
    "skill-manifest-quote-test",
    `name: skill-manifest-quote-test\ndescription: "sa"fe"\nlicense: MIT\n`
  );
  const rep = lintSkill(dir);
  check(
    "sm002-api-interior-quote",
    rep.conformance === "nonconformant" && rep.diagnostics.some((d) => d.code === "MALFORMED_SCALAR"),
    `interior-quote not refused: ${JSON.stringify(codesOf(rep))}`
  );
  rmSync(dir, { recursive: true, force: true });
}
{
  // positives: escaped quotes and single-quote doubling stay accepted
  const dir = makeParserRoot(
    "skill-manifest-quote-test",
    `name: skill-manifest-quote-test\ndescription: "say \\"hi\\""\nlicense: MIT\n`
  );
  const rep = lintSkill(dir);
  check(
    "sm002-api-escaped-quote-positive",
    !rep.diagnostics.some((d) => d.code === "MALFORMED_SCALAR"),
    `escaped quotes wrongly refused: ${JSON.stringify(codesOf(rep))}`
  );
  rmSync(dir, { recursive: true, force: true });
  const dir2 = makeParserRoot(
    "skill-manifest-quote-test",
    `name: skill-manifest-quote-test\ndescription: 'it''s ok'\nlicense: MIT\n`
  );
  const rep2 = lintSkill(dir2);
  check(
    "sm002-api-single-quote-positive",
    !rep2.diagnostics.some((d) => d.code === "MALFORMED_SCALAR"),
    `single-quote doubling wrongly refused: ${JSON.stringify(codesOf(rep2))}`
  );
  rmSync(dir2, { recursive: true, force: true });
}
{
  // mixed block/flow nesting shares the single MAX_DEPTH budget (verdict probe)
  const flow8 = `[`.repeat(8) + "x" + `]`.repeat(8);
  const dir = makeParserRoot(
    "skill-manifest-mixed-test",
    `name: skill-manifest-mixed-test\ndescription: Mixed probe.\nlicense: MIT\nk0:\n  k1:\n    k2:\n      k3:\n        k4:\n          k5:\n            k6:\n              k7: ${flow8}\n`
  );
  const rep = lintSkill(dir);
  check(
    "sm002-api-mixed-depth-negative",
    rep.conformance === "nonconformant" && rep.diagnostics.some((d) => d.code === "DEEP_STRUCTURE"),
    `mixed block/flow depth not refused: ${JSON.stringify(codesOf(rep))}`
  );
  const cli = runCli([dir]);
  check(
    "sm002-cli-mixed-depth-negative",
    cli.code === 1 && JSON.parse(cli.stdout).diagnostics.some((d) => d.code === "DEEP_STRUCTURE"),
    `CLI mixed-depth exit was ${cli.code}`
  );
  rmSync(dir, { recursive: true, force: true });
}
{
  // positive: standalone 8-deep flow at top level stays within budget
  const flow8 = `[`.repeat(8) + "x" + `]`.repeat(8);
  const dir = makeParserRoot(
    "skill-manifest-mixed-test",
    `name: skill-manifest-mixed-test\ndescription: Mixed probe.\nlicense: MIT\nextra: ${flow8}\n`
  );
  const rep = lintSkill(dir);
  check(
    "sm002-api-flow8-positive",
    !rep.diagnostics.some((d) => d.code === "DEEP_STRUCTURE"),
    `top-level 8-flow wrongly refused: ${JSON.stringify(codesOf(rep))}`
  );
  rmSync(dir, { recursive: true, force: true });
}

// --- 11. SM-005: bounded attachment admission (API + CLI) ----------------------
{
  const dir = makeParserRoot(
    "skill-manifest-attach-test",
    `name: skill-manifest-attach-test\ndescription: Attachment probe.\nlicense: MIT\n`
  );
  // exact nested-JSON probe from the review: 20,014 bytes, within the byte cap
  const nestedPath = join(dir, "nested.json");
  writeFileSync(nestedPath, `{"findings":` + `[`.repeat(10000) + "0" + `]`.repeat(10000) + `}`);
  const rep = lintSkill(dir, { spectreFindingsPath: nestedPath });
  check(
    "sm005-api-nested-overdeep",
    rep.conformance === "nonconformant" &&
      rep.security_composition.attachment_status === "rejected_overdeep" &&
      rep.diagnostics.some((d) => d.code === "SPECTRE_INPUT_TOO_DEEP") &&
      rep.security_composition.spectre_findings === null,
    `nested attachment not refused: status=${rep.security_composition.attachment_status}`
  );
  // CLI: structured bounded report, never an uncaught RangeError/stack trace
  const cli = runCli([dir, "--spectre-findings", nestedPath]);
  const cliRep = JSON.parse(cli.stdout);
  check(
    "sm005-cli-nested-structured",
    cli.code === 1 &&
      cliRep.conformance === "nonconformant" &&
      cliRep.security_composition.attachment_status === "rejected_overdeep",
    `CLI nested probe exit was ${cli.code}`
  );
  check(
    "sm005-cli-nested-no-trace",
    !/RangeError|Maximum call stack/.test(cli.stdout + cli.stderr),
    "CLI leaked a stack trace for the nested attachment"
  );
  // >cap read-bound sentinel: a 3,000,000-byte file is admitted on at most cap+1 bytes
  const bigPath = join(dir, "big.json");
  writeFileSync(bigPath, JSON.stringify({ pad: "x".repeat(3 * 1024 * 1024) }));
  const bounded = readBoundedUtf8(bigPath, MAX_SPECTRE_BYTES);
  check(
    "sm005-read-bound-sentinel",
    bounded.ok && bounded.truncated && Buffer.byteLength(bounded.text, "utf8") === MAX_SPECTRE_BYTES + 1,
    `bounded read returned ${bounded.ok ? Buffer.byteLength(bounded.text, "utf8") : "error"} bytes`
  );
  const bigRep = lintSkill(dir, { spectreFindingsPath: bigPath });
  check(
    "sm005-api-oversize-bounded",
    bigRep.conformance === "nonconformant" &&
      bigRep.security_composition.attachment_status === "rejected_oversize" &&
      bigRep.diagnostics.some((d) => d.code === "SPECTRE_INPUT_TOO_LARGE") &&
      bigRep.security_composition.spectre_findings === null,
    `oversize attachment status was ${bigRep.security_composition.attachment_status}`
  );
  // in-budget passthrough controls: exactly cap bytes attaches; cap+1 refuses
  const mkExact = (totalBytes) => {
    const prefix = `{"pad":"`;
    const suffix = `"}`;
    return prefix + "x".repeat(totalBytes - Buffer.byteLength(prefix + suffix, "utf8")) + suffix;
  };
  const exactPath = join(dir, "exact.json");
  writeFileSync(exactPath, mkExact(MAX_SPECTRE_BYTES));
  const exactRep = lintSkill(dir, { spectreFindingsPath: exactPath });
  check(
    "sm005-exact-cap-attached",
    exactRep.security_composition.attachment_status === "attached" &&
      exactRep.security_composition.spectre_findings !== null,
    `exactly-cap attachment status was ${exactRep.security_composition.attachment_status}`
  );
  const overPath = join(dir, "over.json");
  writeFileSync(overPath, mkExact(MAX_SPECTRE_BYTES + 1));
  const overRep = lintSkill(dir, { spectreFindingsPath: overPath });
  check(
    "sm005-cap-plus-one-refused",
    overRep.security_composition.attachment_status === "rejected_oversize",
    `cap+1 attachment status was ${overRep.security_composition.attachment_status}`
  );
  // SM-005: pipe-flush regression — a near-limit ACCEPTED report captured
  // through a real pipe must arrive complete. A forced process.exit()
  // discards the unwritten tail of a large piped stdout write, emitting
  // truncated JSON at exit 0; the CLI stages the status via
  // process.exitCode so the event loop drains the full write first.
  // 15000 findings nested 90 deep: 30,194-byte attachment, ~2.9MB report
  // (inside the 4MiB serialized-output bound), structurally shallow enough
  // to attach.
  const pipePath = join(dir, "pipe-findings.json");
  let pipeFindings = Array.from({ length: 15000 }, () => 0);
  for (let i = 0; i < 90; i++) pipeFindings = [pipeFindings];
  const pipeInput = { findings: pipeFindings };
  writeFileSync(pipePath, JSON.stringify(pipeInput));
  const pipeCli = runCli([join(FIXTURES, "f02-valid-full"), "--spectre-findings", pipePath]);
  check(
    "sm005-pipe-flush-exit",
    pipeCli.code === 0 && pipeCli.stderr === "",
    `pipe-flush probe exit was ${pipeCli.code}, stderr ${pipeCli.stderr.length} bytes`
  );
  let pipeParsed = null;
  try { pipeParsed = JSON.parse(pipeCli.stdout); } catch { /* captured below */ }
  check(
    "sm005-pipe-flush-complete",
    pipeParsed !== null &&
      pipeParsed.conformance === "conformant" &&
      pipeParsed.security_composition.attachment_status === "attached",
    `pipe-flush report incomplete/unparseable: ${pipeCli.stdout.length} bytes captured`
  );
  check(
    "sm005-pipe-flush-verbatim",
    pipeParsed !== null &&
      JSON.stringify(pipeParsed.security_composition.spectre_findings) === JSON.stringify(pipeInput),
    "pipe-flush attachment not attached verbatim"
  );
  rmSync(dir, { recursive: true, force: true });
}

// --- Report ------------------------------------------------------------------
} finally {
  const unlinkIfLink = (p) => {
    try {
      if (lstatSync(p).isSymbolicLink()) unlinkSync(p);
    } catch { /* best effort cleanup */ }
  };
  if (f14Created) unlinkIfLink(F14_LINK);
  if (f33Created) {
    // Unlink `visible` BEFORE `.excluded`: existsSync follows symlinks, so a
    // dangling `visible` would be missed after `.excluded` is gone.
    unlinkIfLink(F33_LINKS[1]);
    unlinkIfLink(F33_LINKS[0]);
    rmSync(F33_OUTSIDE, { recursive: true, force: true });
  }
  if (f35Created) unlinkIfLink(F35_LINK);
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
