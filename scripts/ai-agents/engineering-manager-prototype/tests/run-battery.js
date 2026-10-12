#!/usr/bin/env node
/**
 * run-battery.js — `npm run battery`: verify the corpus root, run all 100
 * frozen cases, and print the acceptance summary. Any trust mismatch stops
 * the run before a single case executes.
 *
 * Bootstrap order: the approved root is a SEPARATELY TRUSTED host input
 * (EM_APPROVED_ROOT env, set by the reviewed npm script) — never an
 * in-corpus anchor. The full corpus digest, covering EVERY pinned file
 * including the planner/verifier itself, is recomputed with node:fs /
 * node:crypto ONLY and authenticated against that root BEFORE the planner
 * module or any scored code is imported. Refuse (exit 3) on any mismatch:
 * no import, no case execution.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 1. Separately trusted approval root: host input, never read from the corpus.
const APPROVED_ROOT = process.env.EM_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("bootstrap: missing separately trusted approval root (EM_APPROVED_ROOT) — refusing to run");
  process.exit(3);
}

// 2. Full pre-import verification with node builtins only.
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
      files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))
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

// 3. Only now import scored code.
const planner = await import(pathToFileURL(join(ROOT, "src", "index.js")).href);
const harness = await import(pathToFileURL(join(ROOT, "tests", "harness.js")).href);

const { outputs, corpusDigest } = await harness.runBattery(ROOT, planner);
const m = harness.acceptanceMetrics(outputs);
const topoBad = outputs
  .filter((o) => !(o.expected.diag_codes ?? []).includes("CYCLE_DETECTED"))
  .filter((o) => !o.topoValid)
  .map((o) => o.case_id);
const slow = outputs.filter((o) => o.elapsedMs > 5000).map((o) => o.case_id);

console.log(`corpus digest: ${corpusDigest}`);
console.log(`cases: ${m.total}, structural match: ${m.match}/${m.total}`);
if (m.mismatches.length > 0) console.log(`MISMATCH: ${m.mismatches.join(", ")}`);
console.log(`topological order valid: ${topoBad.length === 0 ? "yes" : "NO: " + topoBad.join(",")}`);
console.log(`cases over 5s: ${slow.length === 0 ? "none" : slow.join(",")}`);
const ok = m.match === m.total && topoBad.length === 0 && slow.length === 0;
console.log(ok ? "BATTERY: ALL GATES PASS" : "BATTERY: FAILURES PRESENT");
process.exit(ok ? 0 : 1);
