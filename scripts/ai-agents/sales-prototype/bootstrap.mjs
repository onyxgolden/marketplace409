#!/usr/bin/env node
/**
 * bootstrap.mjs — the ONE host-pinned trust anchor for this prototype.
 *
 * S653-009: authentication must happen BEFORE any candidate-controlled
 * code executes. Previously the auth block lived inside tests/run-tests.js
 * itself, so a tampered launcher ran its canary before the digest check
 * could refuse. Now the host pins THIS file out-of-band (sha256 published
 * in the review request and README) and invokes it; it authenticates the
 * full corpus with node:fs / node:crypto ONLY, and only then imports the
 * real entrypoint. A tampered candidate file can never execute first.
 *
 * This file is intentionally NOT listed in corpus/manifest.json — it is
 * the trust root, not scored corpus. The unlisted-file scan below covers
 * the scored subdirectories; this anchor lives outside them.
 *
 * Usage:
 *   SALES_APPROVED_ROOT=<digest> node bootstrap.mjs test     # unit tests
 *   SALES_APPROVED_ROOT=<digest> node bootstrap.mjs battery   # 120-case battery
 *
 * The host MUST verify `sha256sum bootstrap.mjs` against the pinned value
 * before running. Exit 3 on any authentication failure.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { normalize } from "node:path/posix";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

const APPROVED_ROOT = process.env.SALES_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("bootstrap: missing separately trusted approval root (SALES_APPROVED_ROOT) — refusing to run");
  process.exit(3);
}

const mode = process.argv[2];
if (mode !== "test" && mode !== "battery") {
  console.error("bootstrap: usage: node bootstrap.mjs <test|battery>");
  process.exit(3);
}

// ---- trust authentication (builtins only) ----
// Manifest root first, then every transitive candidate/helper/oracle/
// scorer/registry/package byte. Refuse (exit 3) on any mismatch — BEFORE
// importing anything from the corpus.
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
    const SUPPORTED_EXEC = new Set([".js", ".mjs", ".cjs"]);
    const extOf = (p) => { const i = p.lastIndexOf("."); return i < 0 ? "" : p.slice(i); };
    const walk = (dir, out = []) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        // S653-009: symlinks are never legitimate corpus members.
        if (e.isSymbolicLink()) { bad = `symlink rejected: ${p.slice(ROOT.length + 1)}`; break; }
        if (e.isDirectory()) walk(p, out);
        else out.push(p);
      }
      return out;
    };
    for (const sub of ["src", "tests", "runner", "fixtures", "corpus"]) {
      for (const p of walk(join(ROOT, sub))) {
        if (bad) break;
        const rel = p.slice(ROOT.length + 1).replace(/\\/g, "/");
        if (rel === "corpus/manifest.json" || rel === "corpus/corpus_digest.txt") continue;
        if (!seen.has(rel)) { bad = `unlisted file: ${rel}`; break; }
        // Explicit supported-extension policy for executable files.
        if (!rel.startsWith("fixtures/") && !rel.startsWith("corpus/") && !SUPPORTED_EXEC.has(extOf(rel))) {
          bad = `unsupported executable extension: ${rel}`; break;
        }
      }
      if (bad) break;
    }
    for (const f of ["package.json", "README.md"]) {
      if (!seen.has(f)) { bad = `unlisted file: ${f}`; break; }
    }
  }
  if (!bad) {
    const digest = sha(JSON.stringify(manifest));
    if (digest !== APPROVED_ROOT) bad = `corpus digest mismatch: recomputed ${digest.slice(0, 16)}… vs approved ${APPROVED_ROOT.slice(0, 16)}…`;
  }
  if (bad) {
    console.error(`bootstrap: trust authentication failed — ${bad} — refusing to run`);
    process.exit(3);
  }
  console.log("bootstrap: trust authentication OK");
}

// ---- dispatch (only after successful authentication) ----
if (mode === "test") {
  await import("./tests/run-tests.js");
} else {
  await import("./tests/run-battery.js");
}
