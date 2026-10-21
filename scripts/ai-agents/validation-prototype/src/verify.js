/**
 * verify.js — Validation Agent domain logic: runner-summary
 * classification, the three independent axes (observed test result,
 * artifact consistency, independent provenance), the inert command
 * descriptor gate, verified_by derivation, and claim comparisons.
 * Pure Node 24 ESM, zero dependencies.
 */

import { sha256HexUtf8, canonicalJson } from "./canonical.js";

/**
 * The v4 is_pass predicate (retained from Phase 1):
 * complete_summary && pass_count>0 && fail_count==0 && suite_errors==0
 * && !run_crashed && !timed_out && exit_code==0 && pass+fail+skip==test_count.
 */
export function isPassSummary(s) {
  return (
    s.complete_summary === true &&
    s.pass_count > 0 &&
    s.fail_count === 0 &&
    s.suite_errors === 0 &&
    s.run_crashed === false &&
    s.timed_out === false &&
    s.exit_code === 0 &&
    s.pass_count + s.fail_count + s.skip_count === s.test_count
  );
}

/**
 * Classification precedence for a structurally valid summary
 * (October 19 clarification):
 *   any fail_count>0, suite_errors>0, nonzero exit, crash or timeout => FAIL
 *   otherwise test_count=0 => BLOCKED
 *   otherwise incomplete/all-skipped => UNKNOWN
 *   otherwise is_pass => PASS
 * A structurally malformed summary (null/non-object/wrong shape) is
 * UNVERIFIABLE; that determination is made by the caller.
 */
export function classifySummary(s) {
  if (s.fail_count > 0 || s.suite_errors > 0 || s.exit_code !== 0 || s.run_crashed || s.timed_out) {
    return "FAIL";
  }
  if (s.test_count === 0) return "BLOCKED";
  if (!s.complete_summary || s.skip_count === s.test_count) return "UNKNOWN";
  return isPassSummary(s) ? "PASS" : "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Inert command descriptors. The agent never executes a command; the
// descriptor is an exact string matched against a closed allowlist.
// A requested command containing a prohibited delete/network operation
// yields ACTION_DENIED. Anything else off-allowlist is INVALID_INPUT.
// ---------------------------------------------------------------------------

const ALLOWED_COMMANDS = [
  "forge:test --suite suite-alpha",
  "forge:test --suite suite-beta",
  "forge:test --suite suite-gamma",
  "node --test tests/smoke.test.js",
  "node --test tests/full.test.js",
  "npm test -- --suite suite-alpha",
  "npm test -- --suite suite-beta",
];

const PROHIBITED_PATTERNS = [
  /\brm\b/i, /\brmdir\b/i, /del\b/i, /format\b/i, /mkfs/i, /\bdd\b/i,
  /curl/i, /wget/i, /\bssh\b/i, /\bnc\b/i, /netcat/i, /telnet/i,
  /Invoke-WebRequest/i, /\biwr\b/i, /\birm\b/i,
  /Remove-Item/i, /Format-/i, /shutdown/i, /reboot/i, /Restart-Computer/i,
  /chmod/i, /chown/i, /sudo/i, /doas/i, /runas/i,
  /: *\(\s*\)\s*\{/, // fork bomb
  /eval\s*\(/i, /\bexec\s*\(/i, /powershell/i, /cmd\.exe/i, /wsl/i,
  />\s*\/dev\//, /\|\s*sh\b/, /\|\s*bash\b/,
  /New-Net/i, /Set-Net/i, /sc\s+\\\\/i,
];

export function checkCommandDescriptor(command) {
  if (ALLOWED_COMMANDS.includes(command)) return { decision: "allowed" };
  for (const re of PROHIBITED_PATTERNS) {
    if (re.test(command)) return { decision: "denied" };
  }
  return { decision: "unknown" };
}

// ---------------------------------------------------------------------------
// Alias canonicalization. The host's immutable alias table maps an
// alias or principal id to its canonical principal id.
// ---------------------------------------------------------------------------

export function canonicalizePrincipal(id, aliases) {
  if (typeof id !== "string") return null;
  const mapped = aliases[id];
  return typeof mapped === "string" ? mapped : id;
}

// ---------------------------------------------------------------------------
// verified_by derivation. Three independent axes stay separate:
// observed_test_result (classification above), artifact_consistency
// (hashes/identities against registered artifact bytes), and
// independent_provenance (the registry). Only a full match yields the
// registry's MOCK_INDEPENDENT_RUN; everything else with a cited run
// is author_reported_unavailable; no cited run is "none".
//
// Inputs (all pre-charged by the caller):
//   citedRunId        — the run_id the task cites (registry_record_ref.run_id or request.run_id)
//   entry             — validated registry entry or null
//   artifactSha256    — sha256 of the resolved registered artifact bytes, or null
//   artifact          — parsed artifact record or null
//   taskCommandSha256 — sha256Utf8(task.options.request.command)
//   outputSha256      — sha256 of canonicalJson(claimed_summary), or null when no summary
//   implRefMatches    — request.implementation_ref deep-equals entry.implementation_ref
//   suiteMatches      — expected_suite_id == entry.suite_id == (claimed summary suite_id)
//   declaredImplementer — request.implementer_principal_id (task-declared, untrusted)
//   requestRunId      — request.run_id, or null when absent
//   registryRefRunId  — request.registry_record_ref.run_id, or null when absent
//   artifactComparisons — the artifact_* entries of the SAME claim
//                         comparison list the report emits (shared
//                         single source: comparison path and
//                         provenance path cannot drift)
//   artifactMalformed — true when the registered artifact bytes did
//                       not parse into a valid runner log
//   aliases, clock
//
// PER-005: independent provenance derives ONLY from the entire
// matching identity tuple. Every identity the task supplies is
// compared against the trusted record: the declared implementer
// (after alias canonicalization — the trusted implementer is never
// overwritten with task data), both run citations when both are
// supplied (a conflict never silently resolves in either direction),
// and the artifact's embedded run/suite identity. A valid digest
// proves the registered bytes; it does not make conflicting
// identities consistent.
//
// PER-005 round 2: full parsed-artifact validity and semantic
// consistency are prerequisites of independent provenance. The
// named artifact comparisons (command vs task, summary vs claimed,
// embedded run/suite, runner) feed this one eligibility decision,
// and a null/malformed artifact is explicitly unavailable —
// matching raw-byte hashes never stand in for the parsed tuple.
// This is an artifact-consistency requirement, not a requirement
// that tests pass: a genuine independent FAIL still authenticates.
// Returns {verified_by, reasons[], canonical_runner, claimed_runner, registry_ref}.
// ---------------------------------------------------------------------------

export function deriveVerifiedBy(args) {
  const {
    citedRunId, entry, artifactSha256, artifact,
    taskCommandSha256, outputSha256, implRefMatches,
    suiteMatches, aliases, clock,
    declaredImplementer, requestRunId, registryRefRunId,
    artifactComparisons, artifactMalformed,
  } = args;
  const reasons = [];
  const registry_ref = entry ? { run_id: entry.run_id, verification_method: entry.verification_method } : null;

  if (!citedRunId) {
    return { verified_by: "none", reasons: ["no run_id cited"], canonical_runner: null, claimed_runner: null, registry_ref: null };
  }
  const claimed_runner = artifact ? artifact.claimed_runner : null;
  const canonical_runner = entry ? canonicalizePrincipal(entry.runner_principal_id, aliases) : null;

  if (!entry) {
    reasons.push(`no TrustedProvenanceRegistry entry for run_id '${citedRunId}'`);
    return { verified_by: "author_reported_unavailable", reasons, canonical_runner: null, claimed_runner, registry_ref };
  }
  if (entry.revoked) {
    reasons.push(`registry entry for '${citedRunId}' is revoked`);
  }
  // PER-005 identity tuple: conflicting supplied identities are
  // named mismatches, never silently resolved or overwritten.
  if (requestRunId && registryRefRunId && requestRunId !== registryRefRunId) {
    reasons.push(`conflicting run citations: request.run_id '${requestRunId}' does not match registry_record_ref.run_id '${registryRefRunId}'`);
  }
  const canonicalEntryImplementer = canonicalizePrincipal(entry.implementer_principal_id, aliases);
  if (canonicalizePrincipal(declaredImplementer, aliases) !== canonicalEntryImplementer) {
    reasons.push(`task-declared implementer_principal_id '${declaredImplementer}' does not match registry implementer_principal_id '${entry.implementer_principal_id}' after alias canonicalization`);
  }
  const recordedAtMs = Date.parse(entry.recorded_at);
  if (!(recordedAtMs <= clock)) {
    reasons.push(`registry entry for '${citedRunId}' recorded_at is in the future relative to the fixed clock`);
  }
  if (!implRefMatches) {
    reasons.push(`registry implementation_ref does not exactly match the task's implementation_ref`);
  }
  if (taskCommandSha256 !== entry.command_sha256) {
    reasons.push(`task command digest does not match registry command_sha256`);
  }
  if (outputSha256 === null || outputSha256 !== entry.output_sha256) {
    reasons.push(`claimed summary digest does not match registry output_sha256`);
  }
  if (artifactSha256 === null || artifactSha256 !== entry.artifact_sha256) {
    reasons.push(`registered artifact bytes digest does not match registry artifact_sha256`);
  }
  if (!suiteMatches) {
    reasons.push(`suite identity mismatch across expected/registry/claimed summary`);
  }
  // Runner must match the artifact's claimed runner AND differ from the
  // implementer, both after host alias canonicalization.
  if (artifact && canonicalizePrincipal(artifact.claimed_runner, aliases) !== canonical_runner) {
    reasons.push(`artifact claimed_runner '${artifact.claimed_runner}' does not match registry runner_principal_id after alias canonicalization`);
  }
  // PER-005: the artifact's embedded run/suite identity is part of
  // the authenticated tuple. The artifact digest check above proves
  // these are the registered bytes; it does not prove the identity
  // embedded in those bytes agrees with the record that registers
  // them — a registry updated to a forged artifact's digest must not
  // launder a run/suite identity mismatch into independent provenance.
  if (artifact && artifact.run_id !== entry.run_id) {
    reasons.push(`artifact embedded run_id '${artifact.run_id}' does not match registry run_id '${entry.run_id}'`);
  }
  if (artifact && artifact.suite_id !== entry.suite_id) {
    reasons.push(`artifact embedded suite_id '${artifact.suite_id}' does not match registry suite_id '${entry.suite_id}'`);
  }
  // PER-005 round 2: the parsed artifact must be fully valid and
  // semantically consistent — not merely byte-identical to the
  // registered digest. A malformed artifact supplies no parsed
  // tuple at all, and every named artifact comparison that
  // mismatches is an eligibility failure with its own reason.
  if (artifactMalformed) {
    reasons.push(`registered artifact is malformed/unparseable; the parsed artifact tuple is unavailable, so matching raw-byte hashes cannot authenticate independent provenance`);
  }
  for (const c of artifactComparisons ?? []) {
    if (c.match === false) {
      reasons.push(`artifact comparison '${c.name}' mismatch: registered artifact is not semantically consistent with the task/claim`);
    }
  }
  if (canonical_runner !== null && canonical_runner === canonicalEntryImplementer) {
    reasons.push(`registry runner and implementer canonicalize to the same principal ('${canonical_runner}'): self-runner, not independent`);
  }
  if (reasons.length > 0) {
    return { verified_by: "author_reported_unavailable", reasons, canonical_runner, claimed_runner, registry_ref };
  }
  return { verified_by: entry.verification_method, reasons: [], canonical_runner, claimed_runner, registry_ref };
}

/**
 * Build the claim-comparison list: named claimed-vs-computed pairs,
 * each {name, claimed, computed, match}. A comparison is emitted only
 * when both counterparts exist — an absent counterpart is not a
 * mismatch, it is not evidence at all. A mismatch (match === false)
 * is surfaced as a CLAIM_MISMATCH diagnostic by the caller; no
 * comparison upgrades evidence.
 */
export function buildClaimComparisons(req, artifact, entry, computedClass, outputSha256) {
  const out = [];
  const cmp = (name, claimed, computed) => {
    if (claimed === undefined || claimed === null || computed === undefined || computed === null) return;
    out.push({ name, claimed, computed, match: claimed === computed });
  };
  const claimed = req.claimed_summary ?? null;
  if (claimed) {
    cmp("summary_class", claimed.result_class, computedClass);
    cmp("summary_suite", claimed.suite_id, req.expected_suite_id);
    cmp(
      "summary_arithmetic",
      claimed.pass_count + claimed.fail_count + claimed.skip_count === claimed.test_count,
      true
    );
  }
  if (entry) {
    cmp("expected_suite_vs_registry", req.expected_suite_id, entry.suite_id);
    cmp("command_digest_vs_registry", sha256HexUtf8(req.command), entry.command_sha256);
    if (outputSha256 !== null) cmp("output_digest_vs_registry", outputSha256, entry.output_sha256);
    cmp(
      "implementation_ref_vs_registry",
      req.implementation_ref ? canonicalJson(req.implementation_ref) : null,
      canonicalJson(entry.implementation_ref)
    );
  }
  if (artifact) {
    const citedRunId = req.registry_record_ref?.run_id ?? req.run_id ?? null;
    cmp("artifact_suite_vs_expected", artifact.suite_id, req.expected_suite_id);
    cmp("artifact_command_vs_task", artifact.command, req.command);
    cmp("artifact_run_id_vs_cited", artifact.run_id, citedRunId);
    if (claimed) {
      cmp("artifact_summary_vs_claimed", canonicalJson(artifact.summary), canonicalJson(claimed));
    }
  }
  return out;
}
export { ALLOWED_COMMANDS };
