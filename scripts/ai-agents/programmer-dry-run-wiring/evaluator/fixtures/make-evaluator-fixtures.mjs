#!/usr/bin/env node
/**
 * make-evaluator-fixtures.mjs — regenerate the frozen synthetic P5-B
 * evaluator fixtures + manifest.
 *
 *   node fixtures/make-evaluator-fixtures.mjs
 *
 * Builds small deterministic local Git mirrors (fixed author,
 * committer, dates — so base SHAs are stable across runs) plus one
 * fixture JSON per evaluation scenario. Nothing here touches a real
 * branch, a real worktree, or the network. The manifest records the
 * SHA-256 of every fixture JSON; the preview harness and the test
 * suite refuse to run a fixture whose bytes no longer match.
 *
 * Fixtures:
 *   clean-propose     clean base + in-budget modify            → PROPOSED
 *   drifted-base      job.base_sha is not in the mirror        → BLOCKED BASE_UNAVAILABLE
 *   forged-hook       mirror carries a post-checkout hook      → BLOCKED MIRROR_UNTRUSTED
 *   forged-auth       mirror config smuggles a credential helper→ BLOCKED MIRROR_UNTRUSTED
 *   malicious-filter  mirror config smuggles an LFS filter    → BLOCKED MIRROR_UNTRUSTED
 *   symlink-tree      base tree contains a symlink entry      → BLOCKED MIRROR_UNTRUSTED
 *   traversal-diff    candidate diff targets ../escape.js     → BLOCKED PATH_REJECTED
 *   oversized-diff    candidate diff is 201 added lines       → BLOCKED BUDGET_EXCEEDED
 *   hostile-capability candidate diff requires child_process   → REFUSED INJECTION_FORBIDDEN_CAPABILITY
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = HERE;
const REPOS_DIR = join(HERE, "repos");
const SRC = join(HERE, "..", "..", "..", "..", "..", "src", "application", "ai-lab", "programmer");
const SRC_INFRA = join(HERE, "..", "..", "..", "..", "..", "src", "infrastructure", "ai-lab", "programmer");

const { canonicalJson } = await import(join(SRC_INFRA, "worktreeHost.js"));

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const sha256Bytes = (b) => createHash("sha256").update(b).digest("hex");

// Deterministic git identity: fixed author/committer/dates so the
// base commit SHA is stable across regenerations.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "P5-B Fixture",
  GIT_AUTHOR_EMAIL: "fixture@p5b.local",
  GIT_COMMITTER_NAME: "P5-B Fixture",
  GIT_COMMITTER_EMAIL: "fixture@p5b.local",
  GIT_AUTHOR_DATE: "2026-11-07T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-11-07T00:00:00Z",
};

function git(cwd, args, env = GIT_ENV) {
  return execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
}

const ALPHA = 'export const greeting = "hello";\nexport const bye = "bye";\n';
const BETA = "export const beta = 2;\n";
const README = "# P5-B synthetic mirror\n";

const CLEAN_DIFF = [
  "diff --git a/lib/alpha.js b/lib/alpha.js",
  "--- a/lib/alpha.js",
  "+++ b/lib/alpha.js",
  "@@ -1,2 +1,2 @@",
  '-export const greeting = "hello";',
  '+export const greeting = "hi";',
  ' export const bye = "bye";',
].join("\n");

const TRAVERSAL_DIFF = [
  "diff --git a/../escape.js b/../escape.js",
  "--- a/../escape.js",
  "+++ b/../escape.js",
  "@@ -0,0 +1 @@",
  "+export const escaped = true;",
].join("\n");

const BIG_LINES = [
  "diff --git a/lib/alpha.js b/lib/alpha.js",
  "--- a/lib/alpha.js",
  "+++ b/lib/alpha.js",
  "@@ -1,2 +1,203 @@",
  ' export const greeting = "hello";',
  ' export const bye = "bye";',
];
for (let i = 0; i < 201; i += 1) BIG_LINES.push(`+export const generated${i} = ${i};`);
const BIG_DIFF = BIG_LINES.join("\n");

// Hostile capability inside the diff body: must be REFUSED without
// the candidate ever executing.
const HOSTILE_DIFF = [
  "diff --git a/lib/alpha.js b/lib/alpha.js",
  "--- a/lib/alpha.js",
  "+++ b/lib/alpha.js",
  "@@ -1,2 +1,3 @@",
  ' export const greeting = "hello";',
  ' export const bye = "bye";',
  '+export const spawn = require("child_process").spawn;',
].join("\n");

function makeTask() {
  return {
    task_id: "p5b-fixture-task-1",
    family: "literal-correction",
    description: 'Change the greeting constant in lib/alpha.js from "hello" to "hi".',
    brief_digest: sha256("synthetic-brief:literal-correction:p5b-fixture"),
    policy_digest: sha256("pa2-policy-v1"),
    constraints: {
      allowed_paths: ["lib"],
      forbidden_paths: [],
      // Operation vocabulary is the prototype's: "modify" / "add".
      allowed_operations: ["modify", "add"],
    },
  };
}

function buildCleanRepo(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "lib"), { recursive: true });
  git(dir, ["init", "-q", "--initial-branch=main"], { ...GIT_ENV, HOME: dir });
  writeFileSync(join(dir, "lib", "alpha.js"), ALPHA);
  writeFileSync(join(dir, "lib", "beta.js"), BETA);
  writeFileSync(join(dir, "README.md"), README);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "p5b fixture base"]);
  return git(dir, ["rev-parse", "HEAD"]);
}

function buildSymlinkRepo(dir) {
  const base = buildCleanRepo(dir);
  symlinkSync("lib/alpha.js", join(dir, "link"));
  git(dir, ["add", "link"]);
  git(dir, ["commit", "-qm", "p5b fixture base with symlink"]);
  void base;
  return git(dir, ["rev-parse", "HEAD"]);
}

function fixtureJson({ name, repoDir, baseSha, diff, planTarget, expected }) {
  const task = makeTask();
  return {
    fixture: name,
    job: {
      job_id: `p5b-fixture-${name}-001`,
      idempotency_key: `p5b-fixture-${name}-key`,
      operator_ref: "op:evaluator-fixture",
      repo_id: `repo:p5b-synthetic-${name}`,
      base_sha: baseSha,
      task_digest: sha256(canonicalJson(task)),
    },
    task,
    candidate: {
      task: { task_id: task.task_id },
      plan: {
        test_profile_ids: ["syntax"],
        target_files: [planTarget],
      },
      proposed_diff: diff,
    },
    host: {
      mirror: `repos/${name}`,
      allowed_profile_ids: ["syntax"],
    },
    expected,
  };
}

function main() {
  rmSync(REPOS_DIR, { recursive: true, force: true });
  mkdirSync(REPOS_DIR, { recursive: true });
  for (const f of ["manifest.json"]) rmSync(join(FIXTURES_DIR, f), { force: true });
  for (const entry of ["clean-propose", "drifted-base", "forged-hook", "forged-auth", "malicious-filter", "symlink-tree", "traversal-diff", "oversized-diff", "hostile-capability"]) {
    rmSync(join(FIXTURES_DIR, `${entry}.json`), { force: true });
  }

  const alphaTarget = { path: "lib/alpha.js", base_blob_or_null: sha256(ALPHA) };
  const manifest = { manifest_version: "programmer-evaluator-fixtures@1", fixtures: {} };

  const emit = (fixture) => {
    const file = `${fixture.fixture}.json`;
    const bytes = `${JSON.stringify(fixture, null, 2)}\n`;
    writeFileSync(join(FIXTURES_DIR, file), bytes, "utf8");
    manifest.fixtures[fixture.fixture] = {
      file,
      sha256: sha256Bytes(Buffer.from(bytes, "utf8")),
      job_id: fixture.job.job_id,
      status: fixture.expected.status,
      validates: fixture.expected.status !== "BLOCKED" || fixture.fixture !== "clean-propose",
    };
  };

  // Clean base repo, copied for the variants that share it.
  const cleanDir = join(REPOS_DIR, "clean-propose");
  const cleanBase = buildCleanRepo(cleanDir);

  emit(
    fixtureJson({
      name: "clean-propose",
      repoDir: cleanDir,
      baseSha: cleanBase,
      diff: CLEAN_DIFF,
      planTarget: alphaTarget,
      expected: { status: "PROPOSED", reason_codes: ["OK"] },
    }),
  );

  // Drifted base: same clean mirror, job pins a commit that is not in it.
  cpSync(cleanDir, join(REPOS_DIR, "drifted-base"), { recursive: true });
  emit(
    fixtureJson({
      name: "drifted-base",
      repoDir: join(REPOS_DIR, "drifted-base"),
      baseSha: "d".repeat(40),
      diff: CLEAN_DIFF,
      planTarget: alphaTarget,
      expected: { status: "BLOCKED", reason_codes: ["BASE_UNAVAILABLE"] },
    }),
  );

  // Forged hook: a post-checkout hook that would touch a payload file
  // outside the worktree if it ever ran. The evaluator must refuse
  // the mirror at validation and the payload must never appear.
  const hookDir = join(REPOS_DIR, "forged-hook");
  cpSync(cleanDir, hookDir, { recursive: true });
  const hookPath = join(hookDir, ".git", "hooks", "post-checkout");
  writeFileSync(hookPath, `#!/bin/sh\ntouch "${join(hookDir, "hook-payload.txt")}"\n`, { mode: 0o755 });
  emit(
    fixtureJson({
      name: "forged-hook",
      repoDir: hookDir,
      baseSha: cleanBase,
      diff: CLEAN_DIFF,
      planTarget: alphaTarget,
      expected: { status: "BLOCKED", reason_codes: ["MIRROR_UNTRUSTED"] },
    }),
  );

  // Forged auth: mirror config smuggles a credential helper.
  const authDir = join(REPOS_DIR, "forged-auth");
  cpSync(cleanDir, authDir, { recursive: true });
  git(authDir, ["config", "credential.helper", `store --file=${join(authDir, "fake-creds")}`]);
  emit(
    fixtureJson({
      name: "forged-auth",
      repoDir: authDir,
      baseSha: cleanBase,
      diff: CLEAN_DIFF,
      planTarget: alphaTarget,
      expected: { status: "BLOCKED", reason_codes: ["MIRROR_UNTRUSTED"] },
    }),
  );

  // Malicious filter: mirror config smuggles an LFS smudge/clean filter.
  const filterDir = join(REPOS_DIR, "malicious-filter");
  cpSync(cleanDir, filterDir, { recursive: true });
  git(filterDir, ["config", "filter.lfs.clean", "git-lfs clean -- %f"]);
  git(filterDir, ["config", "filter.lfs.smudge", "git-lfs smudge -- %f"]);
  emit(
    fixtureJson({
      name: "malicious-filter",
      repoDir: filterDir,
      baseSha: cleanBase,
      diff: CLEAN_DIFF,
      planTarget: alphaTarget,
      expected: { status: "BLOCKED", reason_codes: ["MIRROR_UNTRUSTED"] },
    }),
  );

  // Symlink tree: the base tree itself carries a symlink entry.
  const symlinkDir = join(REPOS_DIR, "symlink-tree");
  const symlinkBase = buildSymlinkRepo(symlinkDir);
  emit(
    fixtureJson({
      name: "symlink-tree",
      repoDir: symlinkDir,
      baseSha: symlinkBase,
      diff: CLEAN_DIFF,
      planTarget: alphaTarget,
      expected: { status: "BLOCKED", reason_codes: ["MIRROR_UNTRUSTED"] },
    }),
  );

  // Traversal: candidate diff escapes the allowed tree.
  const travDir = join(REPOS_DIR, "traversal-diff");
  cpSync(cleanDir, travDir, { recursive: true });
  emit(
    fixtureJson({
      name: "traversal-diff",
      repoDir: travDir,
      baseSha: cleanBase,
      diff: TRAVERSAL_DIFF,
      planTarget: { path: "../escape.js", base_blob_or_null: null },
      expected: { status: "BLOCKED", reason_codes: ["PATH_REJECTED"] },
    }),
  );

  // Oversized: 201 added lines breaks the 200-line budget.
  const bigDir = join(REPOS_DIR, "oversized-diff");
  cpSync(cleanDir, bigDir, { recursive: true });
  emit(
    fixtureJson({
      name: "oversized-diff",
      repoDir: bigDir,
      baseSha: cleanBase,
      diff: BIG_DIFF,
      planTarget: alphaTarget,
      expected: { status: "BLOCKED", reason_codes: ["BUDGET_EXCEEDED"] },
    }),
  );

  // Hostile capability: a require("child_process") line in the diff.
  const hostileDir = join(REPOS_DIR, "hostile-capability");
  cpSync(cleanDir, hostileDir, { recursive: true });
  emit(
    fixtureJson({
      name: "hostile-capability",
      repoDir: hostileDir,
      baseSha: cleanBase,
      diff: HOSTILE_DIFF,
      planTarget: alphaTarget,
      expected: { status: "REFUSED", reason_codes: ["INJECTION_FORBIDDEN_CAPABILITY"] },
    }),
  );

  writeFileSync(join(FIXTURES_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, fixtures: Object.keys(manifest.fixtures), clean_base: cleanBase }));
}

main();
