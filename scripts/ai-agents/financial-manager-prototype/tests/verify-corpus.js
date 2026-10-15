/**
 * verify-corpus.js — builtins-only trust authentication (node:fs / node:crypto
 * only; never imports scored code). Verifies the pinned manifest against the
 * separately trusted approval root BEFORE any scored test/helper is imported.
 *
 * Returns {ok:true} or {ok:false, reason}. run-tests.js refuses (exit 3) on
 * any mismatch: no test file is imported, no helper executes, no canary can
 * fire. Mutation tests reuse this module against tampered copies.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

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

export function verifyCorpus(rootDir, approvedRoot) {
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
  // digest chain: digest covers every pinned file except package.json
  const canonical = JSON.stringify(
    files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))
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
