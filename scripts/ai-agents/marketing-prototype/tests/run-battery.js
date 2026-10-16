#!/usr/bin/env node
/**
 * run-battery.js — official battery entrypoint. Invoke DIRECTLY, never via npm:
 *
 *   MK_APPROVED_ROOT=<64-hex> node tests/run-battery.js
 *
 * `npm run battery` must NEVER be the official path: npm executes candidate
 * lifecycle scripts BEFORE this file runs. Direct node invocation guarantees
 * the builtins-only authenticator runs first. Verifies the corpus root,
 * runs all frozen cases, and prints the acceptance summary. Any trust
 * mismatch stops the run before a single case executes.
 *
 * Bootstrap order: the approved root is a SEPARATELY TRUSTED host input
 * (MK_APPROVED_ROOT env, supplied by the reviewer or CI pipeline at
 * invocation time — never by this package's own scripts or any file in
 * the candidate tree). The full corpus digest, covering EVERY pinned file
 * including package.json, is recomputed with node:fs / node:crypto ONLY
 * and authenticated against that root BEFORE the agent module or any
 * scored code is imported. Refuse (exit 3) on any mismatch: no import, no
 * case execution.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { normalize } from "node:path/posix";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const APPROVED_ROOT = process.env.MK_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("bootstrap: missing separately trusted approval root (MK_APPROVED_ROOT) — refusing to run");
  process.exit(3);
}

{
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  let bad = null;
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  } catch {
    bad = "corpus/manifest.json unreadable";
  }
  const files = manifest?.files ?? [];
  const seen = new Set();
  if (!bad) {
    for (const e of files) {
      const p = e?.path;
      if (
        typeof p !== "string" || p.length === 0 || p.startsWith("/") || p.includes("\\") ||
        normalize(p) !== p || p.startsWith("..") || p.includes("../") || seen.has(p)
      ) { bad = `bad manifest entry: ${String(p)}`; break; }
      seen.add(p);
      let bytes;
      try { bytes = readFileSync(join(ROOT, p)); } catch { bad = `missing pinned file: ${p}`; break; }
      if (sha(bytes) !== e.sha256) { bad = `hash mismatch: ${p}`; break; }
    }
  }
  if (!bad) {
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
    for (const p of want.sort()) {
      if (!seen.has(p)) { bad = `unlisted file: ${p}`; break; }
    }
  }
  if (!bad) {
    const canonical = JSON.stringify(
      files.map((e) => ({ path: e.path, sha256: e.sha256 }))
    );
    const digest = sha(Buffer.from(canonical, "utf8"));
    if (digest !== manifest.corpus_digest) bad = "manifest corpus_digest does not match recomputed digest";
    else if (readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim() !== manifest.corpus_digest) bad = "corpus_digest.txt does not match manifest digest";
    else if (digest !== APPROVED_ROOT) bad = "corpus digest is not the separately trusted approved root";
  }
  if (bad) {
    console.error(`bootstrap: trust failure — ${bad}`);
    process.exit(3);
  }
}

// Only now import scored code.
await import(pathToFileURL(join(ROOT, "src", "index.js")).href);
const harness = await import(pathToFileURL(join(ROOT, "tests", "harness.js")).href);

const { outputs, corpusDigest } = await harness.runBattery(ROOT, { timeoutMs: 5000 });
const m = harness.acceptanceMetrics(outputs);
const slow = outputs.filter((o) => o.elapsedMs > 5000).map((o) => o.case_id);
const refusedNoDomain = outputs
  .filter((o) => o.result.status === "REFUSED")
  .filter((o) => {
    const r = o.result.report;
    return r.campaigns.length !== 0 || r.metrics.length !== 0 || r.header_comparisons.length !== 0 || (r.unattached_drafts ?? []).length !== 0;
  })
  .map((o) => o.case_id);

console.log(`corpus digest: ${corpusDigest}`);
console.log(`cases: ${m.total}, structural match: ${m.match}/${m.total}`);
if (m.mismatches.length > 0) console.log(`MISMATCH: ${m.mismatches.join(", ")}`);
console.log(`refusals carry no domain payload: ${refusedNoDomain.length === 0 ? "yes" : "NO: " + refusedNoDomain.join(",")}`);
console.log(`cases over 5s: ${slow.length === 0 ? "none" : slow.join(",")}`);
const ok = m.match === m.total && refusedNoDomain.length === 0 && slow.length === 0;
console.log(ok ? "BATTERY: ALL GATES PASS" : "BATTERY: FAILURES PRESENT");
process.exit(ok ? 0 : 1);
