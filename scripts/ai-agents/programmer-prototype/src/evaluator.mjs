/**
 * evaluator.mjs — the trusted evaluator / host.
 * Orchestrates the brief's fixed sequence: authenticate/validate task ->
 * verified snapshot -> candidate proposal -> host records plan+digest ->
 * validate patch/scope/budgets -> apply once to fresh disposable copies ->
 * run immutable baseline/candidate oracles in OS-enforced isolation ->
 * package advisory evidence -> cleanup -> audit.
 *
 * The candidate agent (generators) is pure; every capability here (read via
 * git objects, write to disposable/output dirs, execute fixed profiles) is
 * host-owned and bounded. Git operations are object reads only; no checkout
 * of product code, no commit/push machinery is imported or reachable.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  RESULT_SCHEMA_VERSION,
  REASON,
  STATUS,
  PROFILES,
  BUDGETS,
} from "./constants.mjs";
import { validateTaskEnvelope, classifyAdversarial, detectAmbiguity } from "./task-schema.mjs";
import { BudgetTracker, lowerBudgets } from "./budget.mjs";
import { readSnapshot } from "./fixture-store.mjs";
import { generateCandidate, sha256 } from "./generators.mjs";
import { validatePlan } from "./plan-validator.mjs";
import { applyDiffExact, parseUnifiedDiff } from "./diff.mjs";
import { profileArgv } from "./profiles.mjs";
import { runIsolated, probeIsolation, MECHANISM } from "./isolation.mjs";
import { AuditWriter } from "./audit.mjs";

const nodeVersion = (() => {
  try {
    return execFileSync("/usr/bin/node", ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return "unknown";
  }
})();

function treeDigest(files /* Map path->content or {path:content} */) {
  const h = createHash("sha256");
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files);
  for (const [p, c] of entries.sort(([a], [b]) => (a < b ? -1 : 1))) {
    const content = typeof c === "string" ? c : c.content;
    h.update(p, "utf8").update("\0", "utf8").update(content, "utf8").update("\0", "utf8");
  }
  return h.digest("hex");
}

function checkRecord(status, extra = {}) {
  return { status, tool_version: nodeVersion, ...extra };
}

function briefRefMatches(a, b) {
  return a.repo === b.repo && a.path === b.path && a.commit === b.commit && a.blob === b.blob && a.algorithm === b.algorithm;
}

/**
 * Run one task. `trusted` = { policy_version, authorized_briefs, authorized_fixtures,
 * allowed_profile_ids, budgets, output_root }. `corpus` = { reposRoot, manifest, oracleDir }.
 * `expectations` = { baseline: "PASS"|"FAIL"|"SKIP", candidate: "PASS"|"FAIL"|"SKIP" } | null.
 * `execute` false => stop after plan validation (battery validation mode).
 */
export async function runTask({ taskJson, trusted, corpus, expectations = null, execute = true, runId = null }) {
  const startedAt = Date.now();
  const rid = runId || `${Date.now().toString(36)}-${process.pid.toString(36)}`;
  const budgets = lowerBudgets(BUDGETS, trusted.budgets);
  const budget = new BudgetTracker(budgets, startedAt);
  const outRoot = trusted.output_root;
  fs.mkdirSync(path.join(outRoot, "audits"), { recursive: true });
  const audit = new AuditWriter(path.join(outRoot, "audits", `${taskJson?.task_id || "unknown"}-${rid}.jsonl`));
  const reasonCodes = [];
  const uncertainty = ["oracle-verdicts-are-functional-not-adversarial-attestation"];
  const verification = {
    patch_applicability: checkRecord("NOT_RUN"),
    syntax: checkRecord("NOT_RUN"),
    baseline_tests: checkRecord("NOT_RUN"),
    candidate_tests: checkRecord("NOT_RUN"),
    oracle_results: [],
    isolation_status: "NOT_RUN",
  };

  const finish = (status, extra = {}) => {
    const auditRef = audit.finalize();
    if (!auditRef.ok) {
      reasonCodes.push(REASON.AUDIT_FAILED);
      status = STATUS.FAILED_VERIFICATION;
    }
    return {
      schema_version: RESULT_SCHEMA_VERSION,
      task_id: taskJson?.task_id || null,
      brief_ref: taskJson?.brief_ref || null,
      fixture_ref: taskJson?.fixture_ref || null,
      policy_ref: trusted.policy_version,
      advisory: true,
      authorization: "PROPOSAL_ONLY",
      status,
      reason_codes: [...new Set(reasonCodes)],
      uncertainty_flags: uncertainty,
      plan: extra.plan || null,
      proposed_diff: extra.proposed_diff || null,
      proposal_sha256: extra.proposal_sha256 || null,
      evidence_refs: extra.evidence_refs || [],
      verification,
      audit_ref: auditRef.ok ? { path: auditRef.path, sha256: auditRef.sha256, events: auditRef.events } : null,
      budget_usage: budget.usage(),
      run_id: rid,
      ...extra.rest,
    };
  };

  audit.event("TASK_RECEIVED", { task_id: taskJson?.task_id });

  // 1. Envelope validation.
  const envV = validateTaskEnvelope(taskJson);
  if (!envV.ok) {
    audit.event("ENVELOPE_REJECTED", { reason_codes: envV.reason_codes, detail: envV.detail });
    reasonCodes.push(...envV.reason_codes);
    return finish(envV.status);
  }
  const task = envV.task;

  // 2. Authorization: brief binding + fixture revision binding (trusted config only).
  const briefOk = (trusted.authorized_briefs || []).some((b) => briefRefMatches(b, task.brief_ref));
  if (!briefOk) {
    audit.event("AUTH_REJECTED", { what: "brief_ref" });
    reasonCodes.push(REASON.AUTH_MISMATCH);
    return finish(STATUS.BLOCKED);
  }
  const fixtureAuth = (trusted.authorized_fixtures || []).find(
    (f) => f.fixture_id === task.fixture_ref.fixture_id && f.base_commit === task.fixture_ref.base_commit,
  );
  if (!fixtureAuth) {
    audit.event("AUTH_REJECTED", { what: "fixture_revision" });
    reasonCodes.push(REASON.AUTH_MISMATCH);
    return finish(STATUS.BLOCKED);
  }
  if (fixtureAuth.repo_id !== task.fixture_ref.repo_id) {
    reasonCodes.push(REASON.REPO_UNKNOWN);
    return finish(STATUS.BLOCKED);
  }
  if (fixtureAuth.status === "revoked") {
    audit.event("AUTH_REJECTED", { what: "fixture_revision_revoked" });
    reasonCodes.push(REASON.AUTH_REVOKED);
    return finish(STATUS.BLOCKED);
  }
  if (fixtureAuth.manifest_sha256 !== task.fixture_ref.manifest_sha256) {
    reasonCodes.push(REASON.AUTH_MISMATCH);
    return finish(STATUS.BLOCKED);
  }
  audit.event("AUTHORIZED", { fixture_id: fixtureAuth.fixture_id, base_commit: fixtureAuth.base_commit });

  // 3. Adversarial classification before any snapshot read.
  const adv = classifyAdversarial(task);
  if (adv) {
    audit.event("ADVERSARIAL_REFUSED", { reason_codes: adv.reason_codes, detail: adv.detail });
    reasonCodes.push(...adv.reason_codes);
    return finish(adv.status);
  }
  const amb = detectAmbiguity(task);
  if (amb) {
    audit.event("AMBIGUITY_BLOCKED", { reason_codes: amb.reason_codes, detail: amb.detail });
    reasonCodes.push(...amb.reason_codes);
    return finish(amb.status);
  }

  // 4. Verified snapshot read (git objects only, budgeted).
  const gitDir = path.join(corpus.reposRoot, `${fixtureAuth.fixture_id}.git`);
  const fixtureRecord = corpus.manifest.fixtures[fixtureAuth.fixture_id];
  if (!fixtureRecord) {
    reasonCodes.push(REASON.BASE_UNAVAILABLE);
    return finish(STATUS.BLOCKED);
  }
  const expectedManifest = {
    fixture_id: fixtureAuth.fixture_id,
    base_commit: fixtureAuth.base_commit,
    manifest_sha256: fixtureAuth.manifest_sha256,
    files: Object.fromEntries(Object.entries(fixtureRecord.files).map(([p, e]) => [p, e.sha256])),
  };
  const snapR = readSnapshot(gitDir, expectedManifest, budget);
  if (!snapR.ok) {
    audit.event("SNAPSHOT_REJECTED", { reason: snapR.reason, detail: snapR.detail });
    reasonCodes.push(snapR.reason);
    return finish(STATUS.BLOCKED);
  }
  const snapshot = snapR.snapshot;
  audit.event("SNAPSHOT_VERIFIED", { files: snapshot.files.size, base_commit: fixtureAuth.base_commit });
  if (budget.failed) {
    reasonCodes.push(budget.failed.reason);
    return finish(STATUS.BLOCKED);
  }

  // 5. Candidate proposal (pure).
  const gen = generateCandidate(task, snapshot);
  if (!gen.ok) {
    audit.event("GENERATION_BLOCKED", { reason_codes: gen.reason_codes, detail: gen.detail });
    reasonCodes.push(...gen.reason_codes);
    return finish(gen.status);
  }
  audit.event("PLAN_RECORDED", {
    plan: gen.plan,
    proposal_sha256: gen.proposal_sha256,
    evidence_refs: gen.evidence_refs,
  });

  // 6. Plan/patch validation (scope, budgets, dry-run apply, hostile tripwire).
  const planV = validatePlan({ task, plan: gen.plan, proposedDiff: gen.proposed_diff, snapshot, trusted: { ...trusted, budgets } });
  if (!planV.ok) {
    audit.event("PLAN_REJECTED", { reason_codes: planV.reason_codes, detail: planV.detail });
    reasonCodes.push(...planV.reason_codes);
    return finish(planV.status, {
      plan: gen.plan,
      proposed_diff: gen.proposed_diff,
      proposal_sha256: gen.proposal_sha256,
      evidence_refs: gen.evidence_refs,
    });
  }
  verification.patch_applicability = checkRecord("PASSED", {
    profile: "plan-validator",
    added_removed: planV.stats.addedRemoved,
    files: planV.stats.files,
  });
  const hostile = planV.hostileHits;
  const capabilityHits = hostile.capabilityHits;
  if (capabilityHits.length > 0) {
    audit.event("HOSTILE_TRIPWIRE", { hits: capabilityHits });
    uncertainty.push("candidate-diff-matched-hostile-capability-patterns");
  }
  if (hostile.resourceHits.length > 0) {
    audit.event("RESOURCE_RISK_FLAG", { hits: hostile.resourceHits });
    uncertainty.push("candidate-diff-matched-resource-exhaustion-patterns");
  }

  const common = {
    plan: gen.plan,
    proposed_diff: gen.proposed_diff,
    proposal_sha256: gen.proposal_sha256,
    evidence_refs: gen.evidence_refs,
  };
  if (!execute) {
    audit.event("VALIDATION_MODE_DEFER", {});
    return finish("AWAITING_EXECUTION", common);
  }

  // 7. Disposable workspaces: base/ (unpatched) + work/ (patched).
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa2-eval-"));
  const baseDir = path.join(runDir, "base");
  const workDir = path.join(runDir, "work");
  const destroy = () => {
    try {
      fs.rmSync(runDir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  };
  try {
    const parsed = parseUnifiedDiff(gen.proposed_diff);
    const contentMap = new Map([...snapshot.files.entries()].map(([p, e]) => [p, e.content]));
    const applied = applyDiffExact(parsed, contentMap);
    if (!applied.ok) throw new Error(`late-apply:${applied.reason}`);
    const baseFiles = {};
    const workFiles = {};
    for (const [p, e] of snapshot.files) baseFiles[p] = e.content;
    for (const [p, e] of snapshot.files) workFiles[p] = e.content;
    for (const [p, c] of applied.files) workFiles[p] = c;
    const baseTreeDigest = treeDigest(baseFiles);
    const workTreeDigest = treeDigest(workFiles);

    // Oracle integrity: verify host oracle digests, then copy into both trees.
    const oracleRec = corpus.manifest.fixtures[fixtureAuth.fixture_id];
    if (!oracleRec) throw new Error("oracle-record-missing");
    const oracleSrc = path.join(corpus.oracleDir, oracleRec.oracle_file);
    const libSrc = path.join(corpus.oracleDir, "_lib.mjs");
    const oracleText = fs.readFileSync(oracleSrc, "utf8");
    const libText = fs.readFileSync(libSrc, "utf8");
    const { createHash: ch } = await import("node:crypto");
    if (ch("sha256").update(oracleText, "utf8").digest("hex") !== oracleRec.oracle_sha256) {
      throw new Error("oracle-digest-mismatch");
    }
    const seed = (expectations && expectations.seed) || 0;
    const writeTree = (dir, files) => {
      for (const [p, content] of Object.entries(files)) {
        const fp = path.join(dir, p);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, content, "utf8");
      }
      const od = path.join(dir, "oracle");
      fs.mkdirSync(od, { recursive: true });
      fs.writeFileSync(path.join(od, oracleRec.oracle_file), oracleText, "utf8");
      fs.writeFileSync(path.join(od, "_lib.mjs"), libText, "utf8");
    };
    writeTree(baseDir, baseFiles);
    writeTree(workDir, workFiles);

    // 8. Isolation gate.
    const probe = await probeIsolation();
    verification.isolation_status = probe.available ? "ISOLATED" : "BLOCKED_ISOLATION";
    audit.event("ISOLATION_PROBE", { available: probe.available, mechanism: probe.mechanism || MECHANISM, detail: probe.detail });
    if (!probe.available) {
      reasonCodes.push(REASON.ISOLATION_BLOCKED);
      if (!destroy()) reasonCodes.push(REASON.CLEANUP_FAILED);
      return finish(STATUS.BLOCKED, common);
    }

    // Host canary: marker file outside every sandbox + oracle sources.
    const hostCanary = path.join(outRoot, `canary-${rid}.txt`);
    fs.writeFileSync(hostCanary, `pa2-host-canary ${rid}\n`, "utf8");
    const canaryPaths = [hostCanary, oracleSrc, libSrc];

    const scratchFor = (files, withOracle) => {
      const s = { ...files };
      s[`oracle/${oracleRec.oracle_file}`] = oracleText;
      s["oracle/_lib.mjs"] = libText;
      void withOracle;
      return s;
    };

    const runProfile = async (profileId, files, treeD) => {
      const over = budget.chargeProfile();
      if (over) return { check: checkRecord("BLOCKED", { profile: profileId }), error: over };
      budget.checkWall();
      if (budget.failed) return { check: checkRecord("BLOCKED", { profile: profileId }), error: budget.failed };
      let argv;
      try {
        argv =
          profileId === PROFILES.SYNTAX
            ? profileArgv(profileId, { targetRels: gen.plan.target_files.map((t) => t.path) })
            : profileArgv(profileId, { oracleRel: `oracle/${oracleRec.oracle_file}`, seed, treeDigest: treeD });
      } catch (e) {
        return { check: checkRecord("BLOCKED", { profile: profileId }), error: { reason: REASON.PROFILE_TAMPER, detail: e.message } };
      }
      const r = await runIsolated({
        scratchFiles: scratchFor(files, true),
        argv,
        timeoutMs: budgets.profileTimeoutMs,
        canaryPaths,
      });
      if (!r.ok) return { check: checkRecord("BLOCKED", { profile: profileId, isolation_status: r.isolation_status }), error: { reason: r.reason, detail: r.detail } };
      if (!r.canaryOk) {
        return { check: checkRecord("FAILED", { profile: profileId, detail: r.canaryDetail }), error: { reason: REASON.OPERATION_FORBIDDEN, detail: r.canaryDetail } };
      }
      return { check: null, raw: r, argv };
    };

    // syntax on the patched tree
    const workFilesForSyntax = workFiles;
    const sRes = await runProfile(PROFILES.SYNTAX, workFilesForSyntax, workTreeDigest);
    if (sRes.error) {
      reasonCodes.push(sRes.error.reason);
      verification.syntax = sRes.check;
      audit.event("PROFILE_BLOCKED", { profile: PROFILES.SYNTAX, error: sRes.error });
      if (!destroy()) reasonCodes.push(REASON.CLEANUP_FAILED);
      return finish(STATUS.BLOCKED, common);
    }
    {
      const r = sRes.raw;
      const logDigest = ch("sha256").update(r.stdout + r.stderr, "utf8").digest("hex");
      if (r.timedOut) {
        verification.syntax = checkRecord("FAILED", { profile: PROFILES.SYNTAX, exit: r.exitCode, log_digest: logDigest });
        reasonCodes.push(REASON.TIMEOUT);
      } else if (r.truncated) {
        verification.syntax = checkRecord("FAILED", { profile: PROFILES.SYNTAX, exit: r.exitCode, log_digest: logDigest });
        reasonCodes.push(REASON.OUTPUT_OVERRUN);
      } else if (r.exitCode === 0) {
        verification.syntax = checkRecord("PASSED", { profile: PROFILES.SYNTAX, exit: 0, log_digest: logDigest, tree_digest: workTreeDigest });
      } else {
        verification.syntax = checkRecord("FAILED", { profile: PROFILES.SYNTAX, exit: r.exitCode, log_digest: logDigest });
        reasonCodes.push(REASON.TEST_FAILED);
      }
      audit.event("PROFILE_RUN", { profile: PROFILES.SYNTAX, exit: r.exitCode, timedOut: r.timedOut, log_digest: logDigest });
    }

    const parseOracle = (r, profileId, treeD) => {
      const lines = r.stdout.split("\n").filter((l) => l.startsWith("ORACLE_RESULT "));
      const logDigest = ch("sha256").update(r.stdout + r.stderr, "utf8").digest("hex");
      if (r.timedOut) return { verdict: null, check: checkRecord("FAILED", { profile: profileId, log_digest: logDigest }), timeout: true };
      if (r.truncated) return { verdict: null, check: checkRecord("FAILED", { profile: profileId, log_digest: logDigest }), overrun: true };
      if (lines.length === 0) {
        return { verdict: null, check: checkRecord("FAILED", { profile: profileId, exit: r.exitCode, log_digest: logDigest, detail: "no-oracle-result" }) };
      }
      let v = null;
      try {
        v = JSON.parse(lines[lines.length - 1].slice("ORACLE_RESULT ".length));
      } catch {
        return { verdict: null, check: checkRecord("FAILED", { profile: profileId, log_digest: logDigest, detail: "oracle-result-unparseable" }) };
      }
      const ok = v.status === "PASS" && r.exitCode === 0 && v.tree_digest === treeD;
      return {
        verdict: v,
        check: checkRecord(ok ? "PASSED" : "FAILED", {
          profile: profileId,
          exit: r.exitCode,
          log_digest: logDigest,
          tree_digest: treeD,
          seed: v.seed,
          assertions: v.assertions,
        }),
      };
    };

    // baseline on the unpatched tree
    let baselineVerdict = null;
    if (!expectations || expectations.baseline !== "SKIP") {
      const bRes = await runProfile(PROFILES.BASELINE, baseFiles, baseTreeDigest);
      if (bRes.error) {
        reasonCodes.push(bRes.error.reason);
        verification.baseline_tests = bRes.check;
        if (!destroy()) reasonCodes.push(REASON.CLEANUP_FAILED);
        return finish(STATUS.BLOCKED, common);
      }
      const p = parseOracle(bRes.raw, PROFILES.BASELINE, baseTreeDigest);
      verification.baseline_tests = p.check;
      verification.oracle_results.push({ profile: PROFILES.BASELINE, ...(p.verdict || {}) });
      baselineVerdict = p.verdict;
      audit.event("PROFILE_RUN", { profile: PROFILES.BASELINE, verdict: p.verdict && p.verdict.status });
      if (p.timeout) reasonCodes.push(REASON.TIMEOUT);
      if (p.overrun) reasonCodes.push(REASON.OUTPUT_OVERRUN);
    }

    // candidate on the patched tree
    let candidateVerdict = null;
    if (!expectations || expectations.candidate !== "SKIP") {
      const cRes = await runProfile(PROFILES.CANDIDATE, workFiles, workTreeDigest);
      if (cRes.error) {
        reasonCodes.push(cRes.error.reason);
        verification.candidate_tests = cRes.check;
        if (!destroy()) reasonCodes.push(REASON.CLEANUP_FAILED);
        return finish(STATUS.BLOCKED, common);
      }
      const p = parseOracle(cRes.raw, PROFILES.CANDIDATE, workTreeDigest);
      verification.candidate_tests = p.check;
      verification.oracle_results.push({ profile: PROFILES.CANDIDATE, ...(p.verdict || {}) });
      candidateVerdict = p.verdict;
      audit.event("PROFILE_RUN", { profile: PROFILES.CANDIDATE, verdict: p.verdict && p.verdict.status });
      if (p.timeout) reasonCodes.push(REASON.TIMEOUT);
      if (p.overrun) reasonCodes.push(REASON.OUTPUT_OVERRUN);
    }

    // 9. Verdict.
    let status;
    const exp = expectations || {};
    const timedOut = reasonCodes.includes(REASON.TIMEOUT);
    const overrun = reasonCodes.includes(REASON.OUTPUT_OVERRUN);
    if (capabilityHits.length > 0) {
      reasonCodes.push(REASON.INJECTION_FORBIDDEN_CAPABILITY, REASON.ESCAPE_CONTAINED);
      status = STATUS.FAILED_VERIFICATION;
      uncertainty.push("hostile-capability-attempt-contained-by-isolation-canaries-clean");
    } else if (verification.syntax.status !== "PASSED" || timedOut || overrun) {
      if (verification.syntax.status !== "PASSED" && !timedOut && !overrun) reasonCodes.push(REASON.TEST_FAILED);
      status = STATUS.FAILED_VERIFICATION;
    } else if (exp.baseline && baselineVerdict && baselineVerdict.status !== exp.baseline) {
      reasonCodes.push(REASON.BASELINE_UNEXPECTED);
      status = STATUS.FAILED_VERIFICATION;
    } else if (exp.candidate && candidateVerdict && candidateVerdict.status !== exp.candidate) {
      reasonCodes.push(REASON.ORACLE_FAILED);
      status = STATUS.FAILED_VERIFICATION;
    } else if (exp.candidate && !candidateVerdict) {
      // Expected a candidate verdict but got none (e.g. early exit, no result line).
      reasonCodes.push(REASON.ORACLE_FAILED);
      status = STATUS.FAILED_VERIFICATION;
    } else if (exp.baseline === undefined && exp.candidate === undefined) {
      // No expectations: READY only on clean candidate pass.
      if (candidateVerdict && candidateVerdict.status === "PASS") {
        status = STATUS.READY_FOR_REVIEW;
        reasonCodes.push(REASON.OK);
      } else {
        reasonCodes.push(REASON.ORACLE_FAILED);
        status = STATUS.FAILED_VERIFICATION;
      }
    } else {
      // Expectations provided and met. READY_FOR_REVIEW still requires the
      // candidate oracle to PASS: a met FAIL expectation (wrong-fix negative
      // control) is FAILED_VERIFICATION, never "ready".
      if (candidateVerdict && candidateVerdict.status === "PASS") {
        status = STATUS.READY_FOR_REVIEW;
        reasonCodes.push(REASON.OK);
      } else {
        reasonCodes.push(REASON.ORACLE_FAILED);
        status = STATUS.FAILED_VERIFICATION;
      }
    }

    try {
      fs.rmSync(hostCanary, { force: true });
    } catch {}
    audit.event("VERDICT", { status, reason_codes: [...new Set(reasonCodes)] });
    if (!destroy()) {
      reasonCodes.push(REASON.CLEANUP_FAILED);
      status = status === STATUS.READY_FOR_REVIEW ? STATUS.FAILED_VERIFICATION : status;
    }
    return finish(status, { ...common, rest: { tree_digests: { base: baseTreeDigest, work: workTreeDigest } } });
  } catch (e) {
    try {
      destroy();
    } catch {}
    audit.event("EVAL_ERROR", { message: String(e.message || e).slice(0, 200) });
    reasonCodes.push(REASON.AUDIT_FAILED);
    return finish(STATUS.FAILED_VERIFICATION, {});
  }
}
