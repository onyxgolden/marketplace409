/**
 * evaluator.test.js — P5-B integration tests (node:test).
 *
 * Runs the real preview harness as a subprocess against every frozen
 * fixture, plus in-process crash/retry, idempotency, base-mutation
 * replay, and reconciler tests against real synthetic git mirrors.
 * No real branch, no network, no candidate execution anywhere here:
 * P5-B validates + applies to scratch only; candidate tests are
 * P5-C's job, gated on its own isolation probe.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVALUATOR = join(HERE, "..");
const FIXTURES = join(EVALUATOR, "fixtures");
const PREVIEW = join(EVALUATOR, "preview", "run-evaluator-preview.mjs");
const SRC_APP = join(HERE, "..", "..", "..", "..", "..", "src", "application", "ai-lab", "programmer");
const SRC_INFRA = join(HERE, "..", "..", "..", "..", "..", "src", "infrastructure", "ai-lab", "programmer");
const QA_RUNNER = join(HERE, "..", "..", "..", "..", "..", "scripts", "ai-agents", "qa-test-runner", "src", "isolation.js");

const { createMemoryStore, evaluateCandidate, reconcileStaleWorktrees } = await import(join(SRC_INFRA, "worktreeHost.js"));
const { buildEvaluationRecord } = await import(join(SRC_APP, "worktreeEvaluator.js"));
const { detectIsolation } = await import(QA_RUNNER);

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// Mirrors are generated artifacts (see fixtures/.gitignore), not
// committed files: regenerate them when missing so a fresh checkout
// runs green. The generator is deterministic (fixed git identity),
// so regenerated mirrors match the committed fixture JSONs.
if (!existsSync(join(FIXTURES, "repos", "clean-propose"))) {
  execFileSync(process.execPath, [join(FIXTURES, "make-evaluator-fixtures.mjs")], { stdio: "ignore" });
}

const manifest = JSON.parse(readFileSync(join(FIXTURES, "manifest.json"), "utf8"));
const FIXTURE_NAMES = Object.keys(manifest.fixtures);
const EXPECTED = {
  "clean-propose": { status: "PROPOSED", reason_codes: ["OK"] },
  "drifted-base": { status: "BLOCKED", reason_codes: ["BASE_UNAVAILABLE"] },
  "forged-hook": { status: "BLOCKED", reason_codes: ["MIRROR_UNTRUSTED"] },
  "forged-auth": { status: "BLOCKED", reason_codes: ["MIRROR_UNTRUSTED"] },
  "malicious-filter": { status: "BLOCKED", reason_codes: ["MIRROR_UNTRUSTED"] },
  "symlink-tree": { status: "BLOCKED", reason_codes: ["MIRROR_UNTRUSTED"] },
  "traversal-diff": { status: "BLOCKED", reason_codes: ["PATH_REJECTED"] },
  "oversized-diff": { status: "BLOCKED", reason_codes: ["BUDGET_EXCEEDED"] },
  "hostile-capability": { status: "REFUSED", reason_codes: ["INJECTION_FORBIDDEN_CAPABILITY"] },
};

function loadFixture(name) {
  const entry = manifest.fixtures[name];
  const bytes = readFileSync(join(FIXTURES, entry.file));
  assert.equal(sha256(bytes), entry.sha256, `fixture ${name} digest mismatch`);
  return JSON.parse(bytes.toString("utf8"));
}

function runPreview(name, outDir) {
  const r = spawnSync(process.execPath, [PREVIEW, "--fixture", name, "--out", outDir, "--mode", "SYNTHETIC_PREVIEW"], {
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(r.status, 0, `preview ${name} exited ${r.status}: ${r.stderr?.slice(0, 400)}`);
  const summary = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(summary.ok, true, `preview ${name} summary not ok`);
  return summary;
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("manifest integrity: every fixture file matches its SHA-256 and parses", () => {
  assert.deepEqual(FIXTURE_NAMES.sort(), Object.keys(EXPECTED).sort());
  for (const name of FIXTURE_NAMES) {
    const fixture = loadFixture(name);
    assert.equal(fixture.fixture, name);
    assert.equal(fixture.expected.status, EXPECTED[name].status);
    assert.deepEqual(fixture.expected.reason_codes, EXPECTED[name].reason_codes);
    assert.ok(fixture.job.base_sha.length === 40 || name === "drifted-base");
  }
});

test("DISABLED mode exits 10 before opening any fixture", () => {
  const outDir = mkdtempSync(join(tmpdir(), "p5b-disabled-"));
  const r = spawnSync(process.execPath, [PREVIEW, "--fixture", "does-not-exist", "--out", outDir], { encoding: "utf8" });
  assert.equal(r.status, 10);
  assert.match(r.stdout, /FEATURE_DISABLED/);
  assert.equal(readdirSync(outDir).length, 0, "DISABLED run must write nothing");
});

for (const name of FIXTURE_NAMES) {
  test(`preview fixture ${name} -> ${EXPECTED[name].status} ${EXPECTED[name].reason_codes}`, () => {
    const outDir = mkdtempSync(join(tmpdir(), `p5b-preview-${name}-`));
    const summary = runPreview(name, outDir);
    assert.equal(summary.status, EXPECTED[name].status);
    assert.deepEqual(summary.reason_codes, EXPECTED[name].reason_codes);
    const record = JSON.parse(readFileSync(summary.record_path, "utf8"));
    assert.equal(record.evaluation_version, "programmer-worktree-evaluation@1");
    assert.equal(record.evaluator_version, "programmer-worktree-evaluator@1");
    assert.equal(record.job_id, manifest.fixtures[name].job_id);
    // The worktree root under --out holds no leftover worktree.
    const wtRoot = join(outDir, `${name}-worktrees`);
    assert.equal(existsSync(wtRoot) ? readdirSync(wtRoot).length : 0, 0, `${name}: worktree root not empty after run`);
    if (name === "clean-propose") {
      assert.match(record.plan.patch_sha256, /^[0-9a-f]{64}$/);
      assert.match(record.plan.candidate_tree_digest, /^[0-9a-f]{64}$/);
      assert.equal(record.worktree.removed, true);
      assert.equal(record.canaries.refs_unchanged, true);
      assert.equal(record.canaries.head_unchanged, true);
      assert.equal(record.canaries.index_unchanged, true);
      assert.equal(record.canaries.outside_root_unchanged, true);
      assert.deepEqual(record.plan.files, [{ path: "lib/alpha.js", operation: "modify", added_lines: 1, removed_lines: 1 }]);
    }
  });
}

test("forged-hook: the malicious post-checkout hook never runs", () => {
  const outDir = mkdtempSync(join(tmpdir(), "p5b-hook-"));
  runPreview("forged-hook", outDir);
  assert.equal(existsSync(join(FIXTURES, "repos", "forged-hook", "hook-payload.txt")), false);
});

test("clean-propose leaves the mirror refs and working tree untouched", () => {
  const mirror = join(FIXTURES, "repos", "clean-propose");
  const refsBefore = git(mirror, ["for-each-ref"]);
  const outDir = mkdtempSync(join(tmpdir(), "p5b-mirror-"));
  runPreview("clean-propose", outDir);
  assert.equal(git(mirror, ["for-each-ref"]), refsBefore);
  assert.equal(git(mirror, ["status", "--porcelain"]), "");
});

test("isolation is attested on the record and execution stays gated on P5-C", async () => {
  const mechanism = await detectIsolation();
  const outDir = mkdtempSync(join(tmpdir(), "p5b-iso-"));
  const summary = runPreview("clean-propose", outDir);
  const record = JSON.parse(readFileSync(summary.record_path, "utf8"));
  assert.equal(record.isolation.mechanism, mechanism);
  assert.equal(record.isolation.attested_by, "qa-test-runner-isolation@detectIsolation");
  if (mechanism === null) {
    assert.match(record.isolation.execution_gate, /P5-C must prove isolation/);
    assert.ok(record.risks.some((r) => r.startsWith("no-os-isolation-on-host:")));
  }
});

test("idempotency: same key + job + candidate returns the identical record, no second execution", async () => {
  const fixture = loadFixture("clean-propose");
  const store = createMemoryStore();
  const worktreeRoot = mkdtempSync(join(tmpdir(), "p5b-idem-"));
  const host = {
    mirrorPath: join(FIXTURES, fixture.host.mirror),
    worktreeRoot,
    taskConstraints: fixture.task.constraints,
    allowedProfileIds: fixture.host.allowed_profile_ids,
    store,
    hostMode: "SYNTHETIC_PREVIEW",
  };
  const input = { job: fixture.job, task: fixture.task, candidate: fixture.candidate };
  const first = await evaluateCandidate(input, host);
  assert.equal(first.status, "PROPOSED");
  const second = await evaluateCandidate(input, host);
  assert.deepEqual(second, first);
  assert.equal(readdirSync(worktreeRoot).length, 0);
});

test("crash/retry: a PREPARING record becomes INTERRUPTED, its worktree is removed, and the terminal record is stable", async () => {
  const fixture = loadFixture("clean-propose");
  const mirror = join(FIXTURES, fixture.host.mirror);
  const worktreeRoot = mkdtempSync(join(tmpdir(), "p5b-crash-"));
  const store = createMemoryStore();
  const host = {
    mirrorPath: mirror,
    worktreeRoot,
    taskConstraints: fixture.task.constraints,
    allowedProfileIds: fixture.host.allowed_profile_ids,
    store,
    hostMode: "SYNTHETIC_PREVIEW",
  };
  const input = { job: fixture.job, task: fixture.task, candidate: fixture.candidate };
  // Seed the crash: a real job-owned worktree + a PREPARING record.
  const jobScopedId = `p5b-${createHash("sha256").update(fixture.job.idempotency_key, "utf8").digest("hex").slice(0, 16)}`;
  const wtPath = join(worktreeRoot, jobScopedId);
  git(mirror, ["worktree", "add", "--detach", wtPath, fixture.job.base_sha]);
  assert.ok(existsSync(wtPath));
  const gitDir = git(mirror, ["rev-parse", "--git-dir"]);
  const seeded = buildEvaluationRecord({
    evaluation_version: "programmer-worktree-evaluation@1",
    evaluator_version: "programmer-worktree-evaluator@1",
    job_id: fixture.job.job_id,
    idempotency_key: fixture.job.idempotency_key,
    task_digest: fixture.job.task_digest,
    candidate_diff_sha256: sha256(fixture.candidate.proposed_diff),
    operator_ref: "op:evaluator-fixture",
    status: "PREPARING",
    reason_codes: [],
    detail: "seeded crash: evaluation interrupted mid-flight",
    mirror: {
      repo_id: fixture.job.repo_id,
      mirror_realpath: mirror,
      git_dir: join(mirror, gitDir),
      base_sha: fixture.job.base_sha,
      base_tree_sha: null,
      refs_before: null,
      refs_after: null,
      head_before: null,
      head_after: null,
      index_before: null,
      index_after: null,
    },
    worktree: { job_scoped_id: jobScopedId, diagnostic_location: `worktrees/${jobScopedId}`, path: wtPath, created: true, removed: false },
    isolation: { mechanism: null, detail: "not-probed", attested_by: "qa-test-runner-isolation@detectIsolation" },
    plan: null,
    budgets: null,
    canaries: {},
    risks: [],
    audit: [{ event: "created", at: "2026-11-07T00:00:00.000Z", actor: "op:evaluator-fixture", detail: "seeded" }],
    created_at: "2026-11-07T00:00:00.000Z",
    completed_at: null,
  });
  store.save(fixture.job.idempotency_key, seeded);
  const first = await evaluateCandidate(input, host);
  assert.equal(first.status, "BLOCKED");
  assert.ok(first.reason_codes.includes("INTERRUPTED"));
  assert.equal(existsSync(wtPath), false, "crashed worktree must be removed");
  const second = await evaluateCandidate(input, host);
  assert.deepEqual(second, first, "INTERRUPTED record is terminal: no second evaluation runs");
});

test("base mutation: replaying the same key against a changed base is refused, original record untouched", async () => {
  const fixture = loadFixture("clean-propose");
  const store = createMemoryStore();
  const worktreeRoot = mkdtempSync(join(tmpdir(), "p5b-replay-"));
  const host = {
    mirrorPath: join(FIXTURES, fixture.host.mirror),
    worktreeRoot,
    taskConstraints: fixture.task.constraints,
    allowedProfileIds: fixture.host.allowed_profile_ids,
    store,
    hostMode: "SYNTHETIC_PREVIEW",
  };
  const input = { job: fixture.job, task: fixture.task, candidate: fixture.candidate };
  const first = await evaluateCandidate(input, host);
  assert.equal(first.status, "PROPOSED");
  const mutatedJob = { ...fixture.job, base_sha: "e".repeat(40) };
  await assert.rejects(
    evaluateCandidate({ job: mutatedJob, task: fixture.task, candidate: fixture.candidate }, host),
    (e) => e.code === "STALE_DIGEST",
  );
  assert.deepEqual(store.load(fixture.job.idempotency_key), first, "original record unchanged by the refused replay");
});

test("reconciler removes only job-owned stale worktrees, never foreign ones", () => {
  const fixture = loadFixture("clean-propose");
  const mirror = join(FIXTURES, fixture.host.mirror);
  const worktreeRoot = mkdtempSync(join(tmpdir(), "p5b-reconcile-"));
  const staleId = "p5b-0123456789abcdef";
  const stalePath = join(worktreeRoot, staleId);
  const foreignPath = join(worktreeRoot, "other-worktree");
  git(mirror, ["worktree", "add", "--detach", stalePath, fixture.job.base_sha]);
  git(mirror, ["worktree", "add", "--detach", foreignPath, fixture.job.base_sha]);
  const receipt = reconcileStaleWorktrees({ mirrorPath: mirror, worktreeRoot, operatorRef: "op:reconciler-test" });
  assert.equal(receipt.removed.length, 1);
  assert.equal(receipt.removed[0].job_scoped_id, staleId);
  assert.equal(existsSync(stalePath), false);
  // skipped_foreign always includes the mirror's own main checkout,
  // plus this run's foreign worktree (and any stale foreign
  // worktrees left by earlier runs): assert containment, not count.
  assert.ok(receipt.skipped_foreign.some((s) => s.path === foreignPath), "foreign worktree must be listed as skipped");
  assert.equal(existsSync(foreignPath), true, "foreign worktree must be left alone");
  // Clean up the foreign worktree the reconciler correctly refused to touch.
  git(mirror, ["worktree", "remove", "--force", foreignPath]);
});
