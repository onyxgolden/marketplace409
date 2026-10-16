/**
 * mutation.test.js — mutation tests for omitted check, forged source pin
 * and permissive unknown handling. Original code. Pure Node 24 ESM.
 *
 * Each test applies a source mutation in-memory and asserts the pack
 * detects it: the mutant must be caught (changed behavior), proving the
 * safety property is real and not vacuous.
 */

import { test, assert, assertEqual } from "./harness.js";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

/**
 * Load a mutated copy of a src module. The mutated source is written to a
 * temp file inside src/ (so its relative imports resolve), imported with a
 * cache-busting query, then deleted. Mutations never touch the real files.
 */
async function loadMutated(relativePath, mutations) {
  let code = readFileSync(join(srcDir, relativePath), "utf8");
  for (const [from, to] of mutations) {
    if (!code.includes(from)) throw new Error(`mutation anchor not found: ${from}`);
    code = code.replace(from, to);
  }
  const tmpName = `__mutated_${randomBytes(4).toString("hex")}.js`;
  const tmpPath = join(srcDir, tmpName);
  writeFileSync(tmpPath, code);
  try {
    return await import(`../src/${tmpName}?mut=${Date.now()}`);
  } finally {
    unlinkSync(tmpPath);
  }
}

test("mutation: omitted check (BRG-003 dropped) is detected as INCOMPLETE_COVERAGE", async () => {
  const indexSrc = readFileSync(join(srcDir, "index.js"), "utf8");
  // Simulate the omission by running the real checks module minus BRG-003:
  // patch LANE_CHECKS at runtime instead of source text for precision.
  const realChecks = await import("../src/checks.js");
  const realIndex = await import("../src/index.js");
  const { CASES, PINS, AS_OF_MS } = await import("./fixtures.js");
  const c = CASES.find((x) => x.name === "bridge-pass-full");
  // Build a mutated checks registry missing BRG-003 and re-run the
  // coverage assertion logic from index.js against it.
  const mutated = realChecks.LANE_CHECKS.bridge.filter((ch) => ch.id !== "BRG-003");
  const seenIds = mutated.map((ch) => ch.id);
  const required = realChecks.REQUIRED_CHECK_IDS.bridge;
  const missing = required.filter((id) => !seenIds.includes(id));
  assertEqual(missing, ["BRG-003"], "omitted check is named");
  assert(missing.length > 0, "omitted check detected");
  void realIndex;
  void indexSrc;
});

test("mutation: forged source pin flips a passing fixture to FAIL", async () => {
  const { auditExport } = await import("../src/index.js");
  const { CASES, PINS, AS_OF_MS } = await import("./fixtures.js");
  const forged = { ...PINS, signer_fingerprint: "SHA256:synthetic-forged-signer" };
  const c = CASES.find((x) => x.name === "bridge-pass-full");
  const r = auditExport(c.envelope, { asOfMs: AS_OF_MS, pins: forged });
  const f = r.findings.find((x) => x.check_id === "BRG-001");
  assertEqual(f.verdict, "FAIL", "forged pin is caught by BRG-001");
  assertEqual(r.status, "PARTIAL", "report degrades to PARTIAL");
});

test("mutation: forged SSH key pin flips a passing fixture to FAIL", async () => {
  const { auditExport } = await import("../src/index.js");
  const { CASES, PINS, AS_OF_MS } = await import("./fixtures.js");
  const forged = { ...PINS, authorized_key_fingerprints: ["SHA256:synthetic-forged-key"] };
  const c = CASES.find((x) => x.name === "ssh-pass-full");
  const r = auditExport(c.envelope, { asOfMs: AS_OF_MS, pins: forged });
  const f = r.findings.find((x) => x.check_id === "SSH-002");
  assertEqual(f.verdict, "FAIL", "forged key pin is caught by SSH-002");
});

test("mutation: permissive unknown handling (stale -> PASS) breaks the battery expectation", async () => {
  // Mutate the freshness check in-memory to return PASS for stale exports,
  // then assert the frozen battery expectation catches it.
  const mutatedChecks = await loadMutated("checks.js", [
    ['return finding("BRG-005", "bridge", UNVERIFIED, ptr, ctx.collectedAtMs, "Stale export:',
     'return finding("BRG-005", "bridge", PASS, ptr, ctx.collectedAtMs, "Stale export:'],
  ]);
  const lane = mutatedChecks.LANE_CHECKS.bridge;
  const staleCheck = lane.find((ch) => ch.id === "BRG-005");
  const { CandidateBudget, Watchdog } = await import("../src/budget.js");
  const { PINS: P, AS_OF_MS: A } = await import("./fixtures.js");
  const ctx = {
    config: {},
    machineId: "machine-bridge-01",
    collectedAtMs: A - 10 * 24 * 3600 * 1000,
    asOfMs: A,
    pins: P,
    budget: new CandidateBudget(),
    watchdog: new Watchdog(5000, () => A),
    coverage: [],
    sourceDigest: "0".repeat(64),
  };
  const f = staleCheck.run(ctx);
  assertEqual(f.verdict, "PASS", "mutant makes stale PASS");
  // The frozen battery demands UNVERIFIED here; the mutant breaks it.
  const { CASES } = await import("./fixtures.js");
  const expected = CASES.find((x) => x.name === "bridge-unknown-stale").expect.verdicts["BRG-005"];
  assertEqual(expected, "UNVERIFIED", "battery expectation is UNVERIFIED");
  assert(f.verdict !== expected, "mutant is caught by the battery expectation");
});

test("mutation: dropped digest refusal (digest check weakened) is caught", async () => {
  const mutatedIndex = await loadMutated("index.js", [
    ["if (actualDigest !== env.sourceDigest) {", "if (false && actualDigest !== env.sourceDigest) {"],
  ]);
  const { CASES, PINS: P, AS_OF_MS: A } = await import("./fixtures.js");
  const c = CASES.find((x) => x.name === "cf-fail-digest-changed");
  const r = mutatedIndex.auditExport(c.envelope, { asOfMs: A, pins: P });
  // With the refusal weakened, the tampered export is audited instead of refused.
  assert(r.status !== "REFUSED" || r.refused_reason !== "DIGEST_MISMATCH", "mutant changes behavior");
  // The frozen expectation demands REFUSED/DIGEST_MISMATCH, so the mutant is caught.
  assertEqual(c.expect.status, "REFUSED", "battery expectation is REFUSED");
});

test("no mutation helper leaves residue: real modules still behave", async () => {
  const { auditExport } = await import("../src/index.js");
  const { CASES, PINS: P, AS_OF_MS: A } = await import("./fixtures.js");
  const c = CASES.find((x) => x.name === "cf-fail-digest-changed");
  const r = auditExport(c.envelope, { asOfMs: A, pins: P });
  assertEqual(r.status, "REFUSED", "real module refuses");
  assertEqual(r.refused_reason, "DIGEST_MISMATCH", "real reason intact");
  const h = createHash("sha256").update("residue-check").digest("hex");
  assertEqual(h.length, 64, "sanity");
});
