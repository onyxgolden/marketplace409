/**
 * fixture-store.mjs — git-backed synthetic fixture corpus + verified snapshot
 * reader. Host-side module (fs + child_process allowed here; the candidate
 * agent never touches this). Only git OBJECT READS are used at runtime
 * (cat-file / ls-tree / rev-parse); the fixture repos are never checked out
 * and no commit/push machinery is reachable from here.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { REASON } from "./constants.mjs";

export const FIXTURE_AUTHOR = {
  name: "pa2-fixture-builder",
  email: "pa2-fixture@example.invalid",
  date: "2026-01-01T00:00:00+00:00",
};
export const FIXTURE_MESSAGE = "pa2 fixture base (synthetic, deterministic)";

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function git(gitDir, args) {
  return execFileSync("git", ["--git-dir", gitDir, ...args], { encoding: "utf8", timeout: 15000 });
}

/** Canonical manifest JSON (sorted keys) — shared by builder and verifier. */
export function canonicalManifest(fixtureId, baseCommit, files /* {path: sha256} sorted */) {
  const sorted = {};
  for (const k of Object.keys(files).sort()) sorted[k] = files[k];
  return JSON.stringify({ fixture_id: fixtureId, base_commit: baseCommit, files: sorted });
}

export function manifestSha256(fixtureId, baseCommit, files) {
  return sha256(canonicalManifest(fixtureId, baseCommit, files));
}

/**
 * Build a deterministic fixture git repo. `files` is { path -> content }.
 * Returns { gitDir, baseCommit, files: { path -> { sha256, gitBlobSha } } }.
 */
export function buildFixtureRepo(reposRoot, fixtureId, files) {
  const gitDir = path.join(reposRoot, `${fixtureId}.git`);
  fs.rmSync(gitDir, { recursive: true, force: true });
  fs.mkdirSync(gitDir, { recursive: true });
  const work = path.join(reposRoot, `.build-${fixtureId}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  try {
    execFileSync("git", ["init", "-q", "--separate-git-dir", path.resolve(gitDir)], { cwd: work, timeout: 15000 });
    for (const [p, content] of Object.entries(files)) {
      const fp = path.join(work, p);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, content, "utf8");
      fs.chmodSync(fp, 0o644);
    }
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: FIXTURE_AUTHOR.name,
      GIT_AUTHOR_EMAIL: FIXTURE_AUTHOR.email,
      GIT_AUTHOR_DATE: FIXTURE_AUTHOR.date,
      GIT_COMMITTER_NAME: FIXTURE_AUTHOR.name,
      GIT_COMMITTER_EMAIL: FIXTURE_AUTHOR.email,
      GIT_COMMITTER_DATE: FIXTURE_AUTHOR.date,
    };
    execFileSync("git", ["-c", "core.autocrlf=false", "add", "-A"], { cwd: work, env, timeout: 15000 });
    execFileSync("git", ["-c", "core.autocrlf=false", "commit", "-q", "-m", FIXTURE_MESSAGE], {
      cwd: work,
      env,
      timeout: 15000,
    });
    const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: work, encoding: "utf8", timeout: 15000 }).trim();
    const out = {};
    const ls = git(gitDir, ["ls-tree", "-r", baseCommit]);
    for (const line of ls.split("\n")) {
      if (!line) continue;
      const m = line.match(/^(\d+) (\w+) ([0-9a-f]{40})\t(.*)$/);
      if (!m) throw new Error(`ls-tree parse: ${line}`);
      const [, mode, , blob, p] = m;
      if (mode !== "100644") throw new Error(`non-regular fixture file: ${p} mode ${mode}`);
      out[p] = { sha256: sha256(files[p]), gitBlobSha: blob };
    }
    return { gitDir, baseCommit, files: out };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Verified snapshot reader. `expected` comes from the TRUSTED corpus manifest
 * (never from the task): { fixture_id, base_commit, manifest_sha256, files }.
 * Verifies: commit exists and equals the designated base; every manifest
 * path resolves to a regular blob with the recorded digest.
 * Returns { ok:true, snapshot } or { ok:false, reason, detail }.
 * snapshot = { files: Map(path -> { content, sha256, gitBlobSha }), dirs: Set }.
 */
export function readSnapshot(gitDir, expected, budget) {
  const fail = (reason, detail) => ({ ok: false, reason, detail });
  try {
    if (!fs.existsSync(path.join(gitDir, "HEAD"))) return fail(REASON.REPO_UNKNOWN, "git-dir-missing");
    let commit;
    try {
      commit = git(gitDir, ["rev-parse", "--verify", `${expected.base_commit}^{commit}`]).trim();
    } catch {
      return fail(REASON.BASE_UNAVAILABLE, "base-commit-unknown");
    }
    if (commit !== expected.base_commit) return fail(REASON.BASE_DRIFT, "base-commit-mismatch");
    // Manifest integrity: recompute from git-resolved file digests.
    const ls = git(gitDir, ["ls-tree", "-r", commit]);
    const tree = new Map();
    for (const line of ls.split("\n")) {
      if (!line) continue;
      const m = line.match(/^(\d+) (\w+) ([0-9a-f]{40})\t(.*)$/);
      if (!m) return fail(REASON.BASE_DRIFT, "ls-tree-parse");
      const [, mode, , blob, p] = m;
      if (mode !== "100644") return fail(REASON.OPERATION_FORBIDDEN, `non-regular-tree-entry:${p}`);
      tree.set(p, blob);
    }
    const files = new Map();
    const digests = {};
    const expectedPaths = Object.keys(expected.files).sort();
    for (const p of expectedPaths) {
      const wantBlob = tree.get(p);
      if (!wantBlob) return fail(REASON.BASE_DRIFT, `manifest-path-missing:${p}`);
      let content;
      try {
        content = git(gitDir, ["cat-file", "-p", `${commit}:${p}`]);
      } catch {
        return fail(REASON.BASE_UNAVAILABLE, `blob-unreadable:${p}`);
      }
      const digest = sha256(content);
      if (digest !== expected.files[p]) return fail(REASON.BASE_DRIFT, `digest-mismatch:${p}`);
      const over = budget.chargeRead(Buffer.byteLength(content, "utf8"));
      if (over) return fail(over.reason, over.detail);
      files.set(p, { content, sha256: digest, gitBlobSha: wantBlob });
      digests[p] = digest;
    }
    // No extra files beyond the manifest (frozen base).
    if (tree.size !== expectedPaths.length) return fail(REASON.BASE_DRIFT, "tree-has-extra-entries");
    const recomputed = manifestSha256(expected.fixture_id, commit, digests);
    if (recomputed !== expected.manifest_sha256) return fail(REASON.BASE_DRIFT, "manifest-digest-mismatch");
    const dirs = new Set();
    for (const p of files.keys()) {
      const i = p.lastIndexOf("/");
      if (i > 0) dirs.add(p.slice(0, i));
    }
    return { ok: true, snapshot: { files, dirs } };
  } catch (e) {
    return fail(REASON.BASE_UNAVAILABLE, `snapshot-error:${String(e.message || e).slice(0, 120)}`);
  }
}
