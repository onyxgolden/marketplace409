#!/usr/bin/env node
/**
 * run-tests.js — the authenticated test entrypoint.
 *
 * FM-004: this file imports node builtins ONLY (node:fs, node:crypto,
 * node:path, node:url, node:child_process) and NEVER imports a scored
 * helper before trust authentication completes. The full corpus
 * verification is inlined here — tests/verify-corpus.js is a candidate
 * file and must not execute before its bytes are authenticated.
 *
 * The separately trusted approval root is a host input (FM_APPROVED_ROOT
 * env) — never read from the candidate tree. The full corpus digest,
 * covering EVERY pinned file INCLUDING package.json, is recomputed with
 * node:fs / node:crypto ONLY and authenticated against that root BEFORE
 * the real `node --test` entrypoints are spawned. (package.json carries
 * no embedded root, so there is no self-carry circularity to exclude.)
 *
 * Refuse (exit 3) on any mismatch: no test file is imported, no helper
 * executes, no canary can fire. A tampered helper/source/expectation —
 * even with a re-pinned candidate manifest — fails here because the
 * digest no longer equals the ORIGINAL host-fixed root. Attack tests must
 * keep the original FM_APPROVED_ROOT fixed; they may not switch to the
 * candidate's newly edited npm root.
 *
 * TRUST BOUNDARY NOTE: the authenticated entrypoint is
 * `node tests/run-tests.js` invoked directly with FM_APPROVED_ROOT set.
 * `npm test` merely delegates to this file; npm itself authenticates
 * nothing, so candidate-controlled npm metadata (package.json scripts)
 * can never be a trust entrypoint. A host that delegates to npm MUST
 * authenticate the candidate package bytes first (e.g. by running this
 * launcher, which covers package.json in the digest). See README.md.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Platform-independent manifest-path check. Manifest entries are always
 * forward-slash relative paths; node:path.normalize is platform-dependent
 * (on Windows it rewrites "/" to "\\"), so validation uses POSIX segment
 * rules directly. Backslashes, dot segments, empty segments, absolute
 * paths and escapes are rejected on every platform.
 */
function isCleanManifestPath(p) {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.startsWith("/") || p.includes("\\") || p.startsWith("..") || p.includes("../")) return false;
  const segs = p.split("/");
  for (const s of segs) {
    if (s === "" || s === "." || s === "..") return false;
  }
  return true;
}

/**
 * Builtins-only corpus verification. Returns {ok:true} or
 * {ok:false, reason}. Reads bytes with node:fs; authenticates hashes with
 * node:crypto; imports nothing.
 */
function verifyCorpusInline(rootDir, approvedRoot) {
  if (typeof approvedRoot !== "string" || !/^[0-9a-f]{64}$/.test(approvedRoot)) {
    return { ok: false, reason: "missing separately trusted approval root (FM_APPROVED_ROOT)" };
  }
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(join(rootDir, "corpus", "manifest.json"), "utf8"));
  } catch {
    return { ok: false, reason: "corpus/manifest.json unreadable" };
  }
  const files = manifest?.files ?? [];
  const seen = new Set();
  for (const e of files) {
    const p = e?.path;
    if (!isCleanManifestPath(p) || seen.has(p))
      return { ok: false, reason: `bad manifest entry: ${String(p)}` };
    seen.add(p);
    let bytes;
    try {
      bytes = readFileSync(join(rootDir, p));
    } catch {
      return { ok: false, reason: `missing pinned file: ${p}` };
    }
    if (sha(bytes) !== e.sha256) return { ok: false, reason: `hash mismatch: ${p}` };
  }
  // every on-disk candidate file must be pinned (no unlisted files)
  const want = ["package.json", "README.md"];
  for (const dir of ["corpus", "src", "runner", "fixtures", "tests"]) {
    const dirPath = join(rootDir, dir);
    if (!existsSync(dirPath)) return { ok: false, reason: `missing directory: ${dir}` };
    for (const f of readdirSync(dirPath).filter((x) => !x.startsWith("."))) {
      const p2 = `${dir}/${f}`;
      if (p2 === "corpus/manifest.json" || p2 === "corpus/corpus_digest.txt") continue;
      if (dir === "fixtures" || dir === "corpus") {
        if (f.endsWith(".json") || f.endsWith(".js") || f.endsWith(".md")) want.push(p2);
      } else if (f.endsWith(".js")) {
        want.push(p2);
      }
    }
  }
  for (const p of want.sort()) {
    if (!seen.has(p)) return { ok: false, reason: `unlisted file: ${p}` };
  }
  // digest chain: the digest covers EVERY pinned file, including
  // package.json (no embedded root, no circularity exclusion).
  const canonical = JSON.stringify(
    files.map((e) => ({ path: e.path, sha256: e.sha256 }))
  );
  const digest = sha(Buffer.from(canonical, "utf8"));
  if (digest !== manifest.corpus_digest) return { ok: false, reason: "manifest corpus_digest does not match recomputed digest" };
  let txt;
  try {
    txt = readFileSync(join(rootDir, "corpus", "corpus_digest.txt"), "utf8").trim();
  } catch {
    return { ok: false, reason: "corpus_digest.txt unreadable" };
  }
  if (txt !== manifest.corpus_digest) return { ok: false, reason: "corpus_digest.txt does not match manifest digest" };
  if (digest !== approvedRoot) return { ok: false, reason: "corpus digest is not the separately trusted approved root" };
  return { ok: true, digest };
}

// 1. Separately trusted approval root: host input, never the candidate tree.
const APPROVED_ROOT = process.env.FM_APPROVED_ROOT;

// 2. Full pre-import verification with node builtins only. No scored
//    helper is imported before this returns ok.
const v = verifyCorpusInline(ROOT, APPROVED_ROOT);
if (!v.ok) {
  console.error(`bootstrap: trust failure — ${v.reason}`);
  process.exit(3);
}

// 3. Only now spawn the real node --test on the actual scored entrypoints.
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
