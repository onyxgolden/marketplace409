/**
 * determinism.test.js — repeat runs are byte-identical; permutations of
 * independent fixture declarations yield the same report.
 *
 * Trust: same pre-import authentication as battery.test.js (builtins only,
 * before any scored import).
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function authenticateTrustRoot() {
  const approved = process.env.MK_APPROVED_ROOT;
  assert.ok(typeof approved === "string" && /^[0-9a-f]{64}$/.test(approved), "trust: missing MK_APPROVED_ROOT");
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  const files = manifest.files;
  const seen = new Set();
  for (const e of files) {
    const p = e?.path;
    assert.ok(typeof p === "string" && p.length > 0 && !p.startsWith("/") && !p.includes("\\") && normalize(p) === p && !p.startsWith("..") && !p.includes("../") && !seen.has(p));
    seen.add(p);
    assert.equal(sha(readFileSync(join(ROOT, p))), e.sha256, `trust: hash mismatch: ${p}`);
  }
  const want = ["package.json", "README.md"];
  for (const dir of ["corpus", "src", "runner", "fixtures", "tests"]) {
    for (const f of readdirSync(join(ROOT, dir)).filter((x) => !x.startsWith("."))) {
      const p2 = `${dir}/${f}`;
      if (p2 === "corpus/manifest.json" || p2 === "corpus/corpus_digest.txt") continue;
      if (dir === "fixtures" || dir === "corpus") {
        if (f.endsWith(".json") || f.endsWith(".js")) want.push(p2);
      } else if (f.endsWith(".js")) {
        want.push(p2);
      }
    }
  }
  for (const p of want.sort()) assert.ok(seen.has(p), `trust: unlisted file: ${p}`);
  const digest = sha(Buffer.from(JSON.stringify(files.map((e) => ({ path: e.path, sha256: e.sha256 }))), "utf8"));
  assert.equal(digest, manifest.corpus_digest);
  assert.equal(readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim(), manifest.corpus_digest);
  assert.equal(digest, approved);
  return digest;
}

let run;
let canonicalJson;
let harness;

function contextFor(c) {
  return {
    clock: c.fixture.clock,
    principal: c.fixture.principal,
    relays: c.fixture.relays ?? [],
    grants: c.fixture.grants,
    fixtures: c.fixture.fixtures,
  };
}

before(async () => {
  authenticateTrustRoot();
  const agent = await import(pathToFileURL(join(ROOT, "src", "index.js")).href);
  const canon = await import(pathToFileURL(join(ROOT, "src", "canonical.js")).href);
  harness = await import(pathToFileURL(join(ROOT, "tests", "harness.js")).href);
  run = agent.run;
  canonicalJson = canon.canonicalJson;
});

function shuffled(arr, seed) {
  const a = [...arr];
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe("determinism", () => {
  it("three consecutive runs of every case are byte-identical", () => {
    const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
    for (const c of battery) {
      const ctx = contextFor(c);
      const r1 = canonicalJson(run(c.task, ctx));
      const r2 = canonicalJson(run(c.task, ctx));
      const r3 = canonicalJson(run(c.task, ctx));
      assert.equal(r1, r2, `${c.case_id}: run 1 vs 2 differ`);
      assert.equal(r2, r3, `${c.case_id}: run 2 vs 3 differ`);
    }
  });

  it("permutations of independent row declarations yield the same report", () => {
    const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
    // nom-01: shuffle the events fixture row order; the report must not move.
    const c = battery.find((x) => x.case_id === "nom-01");
    const base = harness.project(run(c.task, contextFor(c)));
    for (let s = 1; s <= 3; s++) {
      const fixtures2 = JSON.parse(JSON.stringify(c.fixture.fixtures));
      const entry = fixtures2["events-01"];
      const parsed = JSON.parse(entry.bytes);
      parsed.rows = shuffled(parsed.rows, s * 7919);
      entry.bytes = JSON.stringify(parsed);
      // re-pin the blob: the shuffled bytes are a NEW fixture version the
      // host registers; the old pin must not be reused for altered bytes.
      const b = Buffer.from(entry.bytes, "utf8");
      const header = Buffer.from(`blob ${b.length}\0`, "utf8");
      entry.source_ref.blob = createHash("sha1").update(header).update(b).digest("hex");
      const ctx2 = { ...contextFor(c), fixtures: fixtures2 };
      const r2 = run(c.task, ctx2);
      assert.equal(r2.status, "REPORT_READY", `nom-01 permutation ${s} did not stay REPORT_READY`);
      assert.deepEqual(harness.project(r2), base, `nom-01 permutation ${s} changed the report`);
    }
  });

  it("caller mutation of a returned report cannot affect later runs (detached snapshots)", () => {
    const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
    const c = battery.find((x) => x.case_id === "nom-01");
    const ctx = contextFor(c);
    const before = canonicalJson(run(c.task, ctx));
    const r = run(c.task, ctx);
    r.report.metrics[0].ctr.display = "MUTATED";
    r.report.campaigns[0].drafts.push({ text: "MUTATED" });
    r.diagnostics.push({ code: "MUTATED" });
    const after = canonicalJson(run(c.task, ctx));
    assert.equal(before, after, "mutating a returned report changed a later run");
  });
});
