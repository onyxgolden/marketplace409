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
 * S653-009 (fix round 2): the manifest ROOT digest is authenticated
 * FIRST, before any member path is consulted — a tampered manifest that
 * lists a FIFO/socket/symlink can no longer hang the bootstrap during
 * acquisition. Every member is opened only after lstat proves it is a
 * regular file (no symlinks, FIFOs, sockets, or devices), with a per-file
 * size cap, so acquisition itself is bounded.
 *
 * S653-009 (fix round 3): descriptor-first admission. Files are opened
 * with O_NOFOLLOW|O_NONBLOCK and the OPENED DESCRIPTOR is fstat'd — the
 * old lstat-then-pathname-open had a replacement race. The manifest
 * itself gets the same treatment: a FIFO/symlink/socket/device at
 * corpus/manifest.json is refused promptly instead of blocking the
 * pinned bootstrap before root verification.
 *
 * This file is intentionally NOT listed in corpus/manifest.json — it is
 * the trust root, not scored corpus. The unlisted-file scan below covers
 * the scored subdirectories; this anchor lives outside them.
 *
 * Usage:
 *   SALES_APPROVED_ROOT=<digest> node bootstrap.mjs test            # unit tests
 *   SALES_APPROVED_ROOT=<digest> node bootstrap.mjs battery         # 120-case battery
 *   SALES_APPROVED_ROOT=<digest> node bootstrap.mjs manual [bundle] [outdir]
 *
 * The host MUST verify `sha256sum bootstrap.mjs` against the pinned value
 * before running. Exit 3 on any authentication failure.
 */

import { readdirSync, lstatSync, openSync, readSync, fstatSync, closeSync, constants } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { normalize } from "node:path/posix";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
// S653-009 (fix round 2): bounded acquisition — no single member may
// exceed this; the corpus is small text/JSON by construction.
const MAX_MEMBER_BYTES = 8 * 1024 * 1024;

const APPROVED_ROOT = process.env.SALES_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("bootstrap: missing separately trusted approval root (SALES_APPROVED_ROOT) — refusing to run");
  process.exit(3);
}

const mode = process.argv[2];
if (mode !== "test" && mode !== "battery" && mode !== "manual") {
  console.error("bootstrap: usage: node bootstrap.mjs <test|battery|manual> [args...]");
  process.exit(3);
}

const sha = (b) => createHash("sha256").update(b).digest("hex");

/**
 * S653-009 (fix round 3): bounded regular-file/no-follow descriptor
 * admission. The file is opened FIRST with O_NOFOLLOW|O_NONBLOCK, then
 * the OPENED DESCRIPTOR is fstat'd — never a pathname stat. This closes
 * the lstat-then-open replacement race: a symlink is refused at open
 * (ELOOP), a FIFO/socket/device is refused by the fstat type check
 * without ever blocking (O_NONBLOCK means the open itself cannot hang
 * on a FIFO), and the size cap is enforced with cap+1 reads off the
 * descriptor so a concurrently growing file cannot overrun the bound.
 */
function readBoundedRegularFile(absPath, rel) {
  let fd;
  try {
    fd = openSync(absPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    if (err && (err.code === "ELOOP" || err.code === "ENXIO")) {
      throw new Error(`not a regular file (symlink/device refused): ${rel}`);
    }
    throw new Error(`cannot open pinned file: ${rel}`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) {
      throw new Error(`not a regular file: ${rel}`);
    }
    if (st.size > MAX_MEMBER_BYTES) {
      throw new Error(`member exceeds ${MAX_MEMBER_BYTES} bytes: ${rel}`);
    }
    const buf = Buffer.alloc(MAX_MEMBER_BYTES + 1);
    let total = 0;
    let n;
    // Cap+1 reads off the opened descriptor: a file that grows between
    // the fstat and the read still cannot exceed the bound.
    while (total <= MAX_MEMBER_BYTES && (n = readSync(fd, buf, total, buf.length - total)) > 0) {
      total += n;
    }
    if (total > MAX_MEMBER_BYTES) {
      throw new Error(`member exceeds ${MAX_MEMBER_BYTES} bytes: ${rel}`);
    }
    return buf.subarray(0, total);
  } finally {
    try { closeSync(fd); } catch { /* already closed */ }
  }
}

/** Read a corpus member only after proving it is a bounded regular file. */
function readMemberBytes(absPath, rel) {
  return readBoundedRegularFile(absPath, rel);
}

// ---- trust authentication (builtins only) ----
// S653-009 (fix round 2): manifest ROOT first, then every transitive
// candidate/helper/oracle/scorer/registry/package byte. Refuse (exit 3)
// on any mismatch — BEFORE importing anything from the corpus.
{
  let bad = null;
  let manifest = null;
  try {
    // The manifest itself is read by direct path (not via a manifest
    // listing), so a tampered listing cannot redirect this read.
    // S653-009 (fix round 3): the manifest gets the same bounded
    // regular-file/no-follow descriptor admission as members — a FIFO,
    // socket, symlink or device at the manifest path is refused promptly
    // instead of blocking the pinned bootstrap before root verification.
    const manifestBytes = readBoundedRegularFile(join(ROOT, "corpus", "manifest.json"), "corpus/manifest.json");
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (err) {
    bad = `corpus/manifest.json unreadable: ${err.message}`;
  }
  // ROOT-FIRST: authenticate the manifest digest before consulting ANY
  // member path. A manifest that lists a FIFO/socket/symlink is rejected
  // here, before acquisition touches it.
  if (!bad) {
    const digest = sha(JSON.stringify(manifest));
    if (digest !== APPROVED_ROOT) {
      bad = `corpus digest mismatch: recomputed ${digest.slice(0, 16)}… vs approved ${APPROVED_ROOT.slice(0, 16)}…`;
    }
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
      try {
        bytes = readMemberBytes(join(ROOT, p), p);
      } catch (err) { bad = err.message; break; }
      if (sha(bytes) !== e.sha256) { bad = `hash mismatch: ${p}`; break; }
    }
  }
  if (!bad) {
    const SUPPORTED_EXEC = new Set([".js", ".mjs", ".cjs"]);
    const extOf = (p) => { const i = p.lastIndexOf("."); return i < 0 ? "" : p.slice(i); };
    const walk = (dir, out = []) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        // S653-009 (fix round 2): only regular files and directories are
        // legitimate corpus members — symlinks, FIFOs, sockets and
        // devices are refused without being opened.
        if (!e.isFile() && !e.isDirectory()) { bad = `non-regular file rejected: ${p.slice(ROOT.length + 1)}`; break; }
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
  if (bad) {
    console.error(`bootstrap: trust authentication failed — ${bad} — refusing to run`);
    process.exit(3);
  }
  console.log("bootstrap: trust authentication OK");
}

// ---- dispatch (only after successful authentication) ----
if (mode === "test") {
  await import("./tests/run-tests.js");
} else if (mode === "battery") {
  await import("./tests/run-battery.js");
} else {
  // S653-009 (fix round 2): manual execution routes through this same
  // pinned bootstrap — never a self-authenticating candidate entrypoint.
  const { runManualMain } = await import("./runner/run-manual.js");
  await runManualMain(process.argv.slice(3));
}
