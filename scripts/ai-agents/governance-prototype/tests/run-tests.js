#!/usr/bin/env node
/**
 * run-tests.js — `npm test` entrypoint: builtins-only trust authentication
 * BEFORE any scored test/helper is imported (GOV_APPROVED_ROOT).
 *
 * The separately trusted approval root is a host input
 * (GOV_APPROVED_ROOT env) — never read from the candidate tree. The full
 * corpus digest, covering EVERY pinned file including the scored tests
 * themselves, is recomputed with node:fs / node:crypto ONLY and
 * authenticated against that root BEFORE the real `node --test`
 * entrypoints are spawned.
 *
 * Refuse (exit 3) on any mismatch: no test file is imported, no helper
 * executes, no canary can fire. A tampered helper/source/expectation —
 * even with a re-pinned candidate manifest — fails here because the
 * digest no longer equals the ORIGINAL host-fixed root. Attack tests must
 * keep the original GOV_APPROVED_ROOT fixed; they may not switch to the
 * candidate's newly edited npm root.
 *
 * This file imports node builtins only. It never imports scored code.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 1. Separately trusted approval root: host input, never the candidate tree.
const APPROVED_ROOT = process.env.GOV_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("bootstrap: missing separately trusted approval root (GOV_APPROVED_ROOT) — refusing to run");
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

// 3. Only now spawn the real node --test on the actual scored entrypoints.
//    The original host root stays fixed in the child environment.
const testFiles = readdirSync(join(ROOT, "tests"))
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => join(ROOT, "tests", f));
if (testFiles.length === 0) {
  console.error("bootstrap: no scored test entrypoints found");
  process.exit(3);
}
const child = spawnSync(process.execPath, ["--test", ...testFiles], {
  env: process.env,
  stdio: "inherit",
});
process.exit(child.status ?? 3);
