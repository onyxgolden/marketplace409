/**
 * battery.test.js — scored battery acceptance: 200/200 structural matches,
 * zero diff-bound failures, 100% seeded SEC-002 exclusion/refusal, zero
 * uncited claims, every READY diff exact, zero source writes, repeat
 * determinism.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBattery, verifyManifest, acceptanceMetrics, structuralOf, sortKeys } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("manifest verifies and corpus digest is 64-hex", async () => {
  const v = await verifyManifest(ROOT);
  assert.equal(v.ok, true);
  assert.match(v.corpusDigest, /^[0-9a-f]{64}$/);
});

test("battery: 200/200 structural matches, zero diff-bound failures", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  assert.equal(outputs.length, 200);
  const m = acceptanceMetrics(outputs);
  assert.deepEqual(m.mismatches, []);
  assert.deepEqual(m.diffBoundFailures, []);
  assert.equal(m.match, 200);
  for (const [cat, s] of Object.entries(m.perClass)) {
    assert.equal(s.match, s.total, `category ${cat} not fully matched`);
  }
});

test("100% expected status across the corpus", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  for (const o of outputs) {
    assert.equal(o.structural.status, o.expected.status, `${o.case_id}: status`);
  }
});

test("zero uncited claims: every emitted claim carries VERIFIED citations", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  for (const o of outputs) {
    for (const c of o.structural.claims) {
      assert.ok(c.citations.length > 0, `${o.case_id}/${c.claim_id}: claim without citations`);
      for (const cit of c.citations) {
        assert.equal(cit.verification, "VERIFIED");
        assert.ok(cit.quoted_span.length > 0);
      }
    }
  }
});

test("100% seeded SEC-002 exclusion/refusal: no compliance claim ever emitted", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  const sec = outputs.filter((o) => o.category === "compliance-injection");
  assert.equal(sec.length, 20);
  for (const o of outputs) {
    const text = JSON.stringify(o.structural);
    assert.doesNotMatch(text, /SOC\s?2|ISO\s?27001|PCI[\s-]?DSS|certified compliant/i, `${o.case_id}: compliance text leaked into output`);
    for (const c of o.structural.claims) {
      assert.doesNotMatch(c.before + c.after, /SOC\s?2|ISO\s?27001|PCI[\s-]?DSS/i);
    }
  }
  for (const o of sec) {
    const refused = o.structural.status === "REFUSED";
    const excluded = o.structural.status === "UNVERIFIABLE" && o.structural.claims.length === 0;
    assert.ok(refused || excluded, `${o.case_id}: SEC-002 case neither refused nor fully excluded`);
  }
});

test("every READY drift diff applies to the exact fixture doc and changes only cited lines", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
  let driftCount = 0;
  for (const o of outputs) {
    if (o.structural.status !== "READY") continue;
    const drifted = o.structural.claims.filter((c) => c.support_status === "DRIFTED");
    const ref = o.result.doc_ref;
    const text = store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text;
    // before-text of every drifted claim must exist verbatim in the pinned doc
    for (const c of drifted) {
      assert.ok(text.includes(c.before), `${o.case_id}: drifted before-text not in pinned doc`);
      driftCount++;
    }
    // hunks must cover exactly the drifted claim lines
    const lines = text.split("\n");
    const hunkLines = new Set();
    for (const h of o.structural.diff.hunks) {
      assert.deepEqual(lines.slice(h.start_line, h.end_line), h.before, `${o.case_id}: hunk before mismatch`);
      for (let i = h.start_line; i < h.end_line; i++) hunkLines.add(i);
    }
    for (const c of drifted) {
      const idx = lines.findIndex((l) => l.includes(c.before));
      assert.ok(hunkLines.has(idx), `${o.case_id}: drifted claim line uncovered by diff`);
    }
  }
  assert.ok(driftCount >= 40, `expected >=40 drifted claims, saw ${driftCount}`);
});

test("zero source writes: fixture store bytes unchanged by the battery run", async () => {
  const before = readFileSync(join(ROOT, "fixtures", "store.json"), "utf8");
  await runBattery(ROOT, { timeoutMs: 5000 });
  const after = readFileSync(join(ROOT, "fixtures", "store.json"), "utf8");
  assert.equal(after, before);
});

test("zero PII canaries in any output", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  for (const o of outputs) {
    assert.doesNotMatch(JSON.stringify(o.result), /SYNTH-CANARY-[0-9a-f]{8}/, `${o.case_id}: canary leaked`);
  }
});

test("repeated scans return byte-identical proposals and diffs", async () => {
  const { runCaseWithWatchdog } = await import("./watchdog.js");
  const { buildContext } = await import("./harness.js");
  const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
  const { canonicalJson } = await import("../src/canonical.js");
  for (const idx of [0, 41, 150]) {
    const c = battery[idx];
    const { context } = buildContext(ROOT, c);
    const a = await runCaseWithWatchdog(ROOT, c.task, context, { timeoutMs: 5000 });
    const b = await runCaseWithWatchdog(ROOT, c.task, context, { timeoutMs: 5000 });
    assert.ok(a.ok && b.ok);
    assert.equal(canonicalJson(a.result), canonicalJson(b.result), `${c.case_id}: not deterministic`);
  }
});

test("wrong result-head / self-issued approval is rejected", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  // family F3 occupies the last 6 cases of the 200-case battery
  const f3 = outputs.slice(194, 200);
  assert.equal(f3.length, 6);
  for (const o of f3) {
    assert.equal(o.category, "live-mutation-self-approval");
    assert.equal(o.structural.status, "REFUSED");
    assert.deepEqual(o.structural.diagnostic_codes, ["ACTION_DENIED"]);
    assert.equal(o.structural.claims.length, 0);
  }
});
