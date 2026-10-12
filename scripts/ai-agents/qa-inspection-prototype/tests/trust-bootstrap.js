/**
 * trust-bootstrap.js — pre-import trust verification (QAI-004, round 2).
 *
 * Uses ONLY node:fs / node:crypto / node:path — never the harness, never
 * scored modules. Entry points verify THIS file's bytes against its pinned
 * manifest entry before importing it (a few lines each), then call
 * verifyTrustRoot(moduleRoot), which authenticates the whole corpus against
 * the separately trusted host input QA_APPROVED_ROOT before any scorer or
 * scored code is loaded.
 *
 * The approved root is a host input (env), never an in-corpus anchor. The
 * recomputed digest covers EVERY pinned file including the scorer/verifier
 * itself; the only exclusion is package.json, which carries QA_APPROVED_ROOT
 * in its npm scripts and therefore cannot be covered by the value it
 * carries (circularity). package.json is still hash-pinned.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, normalize } from "node:path";

export class TrustError extends Error {
  constructor(message) {
    super(message);
    this.name = "TrustError";
  }
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The separately trusted approval root: host input, fail closed if absent. */
export function approvedRoot() {
  const v = process.env.QA_APPROVED_ROOT;
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) {
    throw new TrustError(
      "no separately trusted approval root: QA_APPROVED_ROOT must be a 64-hex digest supplied by the reviewed invocation"
    );
  }
  return v;
}

/**
 * Verify the corpus at moduleRoot against the separately trusted root.
 * Throws TrustError on any failure. Uses node builtins only.
 */
export function verifyTrustRoot(moduleRoot) {
  const approved = approvedRoot();
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(moduleRoot, "corpus", "manifest.json"), "utf8"));
  } catch {
    throw new TrustError("corpus/manifest.json unreadable");
  }
  const files = manifest.files;
  if (!Array.isArray(files)) throw new TrustError("manifest shape invalid");
  const seen = new Set();
  for (const e of files) {
    const p = e?.path;
    if (
      typeof p !== "string" || p.length === 0 || p.startsWith("/") || p.includes("\\") ||
      normalize(p) !== p || p.startsWith("..") || p.includes("../") || seen.has(p)
    ) {
      throw new TrustError(`bad manifest entry: ${String(p)}`);
    }
    seen.add(p);
    let bytes;
    try {
      bytes = readFileSync(join(moduleRoot, p));
    } catch {
      throw new TrustError(`missing pinned file: ${p}`);
    }
    if (sha256Bytes(bytes) !== e.sha256) throw new TrustError(`hash mismatch: ${p}`);
  }
  // Complete file membership.
  const want = ["package.json", "README.md"];
  for (const dir of ["corpus", "src", "runner", "fixtures", "tests"]) {
    for (const f of readdirSync(join(moduleRoot, dir)).filter((x) => !x.startsWith("."))) {
      if (dir === "fixtures" ? f.endsWith(".json") : f.endsWith(".js")) want.push(`${dir}/${f}`);
    }
  }
  for (const p of want.sort()) {
    if (!seen.has(p)) throw new TrustError(`unlisted file: ${p}`);
  }
  // Full digest (every pinned file except package.json) must equal the
  // manifest digest, the recorded digest, and the separately trusted root.
  const canonical = JSON.stringify(
    files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))
  );
  const digest = sha256Bytes(Buffer.from(canonical, "utf8"));
  if (digest !== manifest.corpus_digest) throw new TrustError("manifest corpus_digest does not match recomputed digest");
  let recorded;
  try {
    recorded = readFileSync(join(moduleRoot, "corpus", "corpus_digest.txt"), "utf8").trim();
  } catch {
    throw new TrustError("corpus/corpus_digest.txt missing");
  }
  if (recorded !== manifest.corpus_digest) throw new TrustError("corpus_digest.txt does not match manifest digest");
  if (digest !== approved) throw new TrustError("corpus digest is not the separately trusted approved root");
  return { ok: true, root: digest, files: files.length };
}
