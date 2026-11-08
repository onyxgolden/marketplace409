#!/usr/bin/env node
/**
 * run-evaluator-preview.mjs — INERT synthetic preview harness for P5-B.
 *
 *   node preview/run-evaluator-preview.mjs --fixture <name> --out <dir> [--mode DISABLED|SYNTHETIC_PREVIEW]
 *
 * Loads ONE named synthetic evaluator fixture (manifest-pinned),
 * runs evaluateCandidate against the fixture's frozen local Git
 * mirror in a host-owned temp worktree root under --out, and writes
 * the immutable evaluation record to --out/<fixture>.evaluation.json.
 *
 * What this harness NEVER does: touch a real branch or repo, run
 * candidate tests, reach the network, spawn a shell outside git,
 * write outside --out, or open any adapter/store/source. DISABLED
 * returns before opening any fixture, manifest, mirror, or store
 * (prove it: --mode DISABLED with a nonexistent fixture still
 * exits 10). Exit codes: 0 record written (any terminal status —
 * a BLOCKED/REFUSED fixture is a successful preview run) ·
 * 10 DISABLED · 11 ACTIVATION_REQUIRED · 12 REFUSED · 2 usage error.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVALUATOR = join(HERE, "..");
const SRC_APP = join(HERE, "..", "..", "..", "..", "..", "src", "application", "ai-lab", "programmer");
const SRC_INFRA = join(HERE, "..", "..", "..", "..", "..", "src", "infrastructure", "ai-lab", "programmer");

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function fail(code, message, exitCode) {
  console.log(JSON.stringify({ ok: false, code, error: message }));
  process.exit(exitCode);
}

const fixtureName = arg("fixture");
const outDir = arg("out");
const modeArg = arg("mode") ?? "DISABLED";
if (!fixtureName || !outDir) {
  console.error("usage: node preview/run-evaluator-preview.mjs --fixture <name> --out <dir> [--mode DISABLED|SYNTHETIC_PREVIEW]");
  process.exit(2);
}

const { resolveMode, JobRefusal } = await import(join(SRC_APP, "jobContracts.js"));
let mode;
try {
  mode = resolveMode(modeArg, undefined);
} catch (e) {
  if (e instanceof JobRefusal && e.code === "ACTIVATION_REQUIRED") fail("ACTIVATION_REQUIRED", e.detail || e.message, 11);
  if (e instanceof JobRefusal) fail(e.code, e.detail || e.message, 12);
  throw e;
}
if (mode === "DISABLED") {
  // Returns before opening any fixture, manifest, mirror, or store.
  console.log(
    JSON.stringify({
      ok: false,
      mode: "DISABLED",
      code: "FEATURE_DISABLED",
      error: "programmer worktree evaluator is DISABLED; synthetic preview requires --mode SYNTHETIC_PREVIEW",
    }),
  );
  process.exit(10);
}

const { createMemoryStore, evaluateCandidate } = await import(join(SRC_INFRA, "worktreeHost.js"));
const { detectIsolation } = await import(
  join(HERE, "..", "..", "..", "..", "..", "scripts", "ai-agents", "qa-test-runner", "src", "isolation.js")
);

// Manifest-pinned fixture load: bytes must match the manifest digest.
const manifest = JSON.parse(readFileSync(join(EVALUATOR, "fixtures", "manifest.json"), "utf8"));
const entry = manifest.fixtures?.[fixtureName];
if (!entry) fail("UNKNOWN_FIXTURE", `no fixture named '${fixtureName}'`, 12);
const fixturePath = join(EVALUATOR, "fixtures", entry.file);
const fixtureBytes = readFileSync(fixturePath);
const digest = createHash("sha256").update(fixtureBytes).digest("hex");
if (digest !== entry.sha256) {
  fail("FIXTURE_DIGEST_MISMATCH", `fixture '${fixtureName}' bytes do not match the manifest digest`, 12);
}
let fixture;
try {
  fixture = JSON.parse(fixtureBytes.toString("utf8"));
} catch {
  fail("FIXTURE_MALFORMED", `fixture '${fixtureName}' is not valid JSON`, 12);
}

const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const worktreeRoot = join(out, `${fixtureName}-worktrees`);
const canaryPath = join(out, `${fixtureName}-canary.txt`);
writeFileSync(canaryPath, "p5b-outside-root-canary:do-not-touch\n", "utf8");

const mirrorPath = resolve(join(EVALUATOR, "fixtures", fixture.host.mirror));
if (!existsSync(mirrorPath)) {
  // Mirrors are generated artifacts (see fixtures/.gitignore) —
  // rebuild them deterministically, then re-check.
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [join(EVALUATOR, "fixtures", "make-evaluator-fixtures.mjs")], { stdio: "ignore" });
}
if (!existsSync(mirrorPath)) {
  fail("MIRROR_MISSING", `fixture mirror '${fixture.host.mirror}' is missing after regeneration`, 12);
}

const store = createMemoryStore();
let record;
try {
  record = await evaluateCandidate(
    { job: fixture.job, task: fixture.task, candidate: fixture.candidate },
    {
      mirrorPath,
      worktreeRoot,
      taskConstraints: fixture.task.constraints,
      allowedProfileIds: fixture.host.allowed_profile_ids,
      canaryPaths: [canaryPath],
      store,
      hostMode: "SYNTHETIC_PREVIEW",
      isolationProber: async () => detectIsolation(),
    },
  );
} catch (e) {
  fail(e?.code ?? "EVALUATION_REFUSED", e?.message ?? String(e), 12);
}

const recordPath = join(out, `${fixtureName}.evaluation.json`);
writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify({
    ok: true,
    mode: "SYNTHETIC_PREVIEW",
    fixture: fixtureName,
    status: record.status,
    reason_codes: record.reason_codes,
    expected_status: fixture.expected.status,
    expected_reason_codes: fixture.expected.reason_codes,
    patch_sha256: record.plan?.patch_sha256 ?? null,
    candidate_tree_digest: record.plan?.candidate_tree_digest ?? null,
    worktree_removed: record.worktree.removed,
    canaries: record.canaries,
    record_path: recordPath,
  }),
);
process.exit(0);
