/**
 * oracle.js — INDEPENDENT reference implementation of the Validation
 * Agent Phase 2 slice 1 decision rules, authored directly from the
 * implementation brief (NOT by importing the candidate or reusing its
 * helpers). Used by corpus/make-battery.js to derive expected battery
 * outcomes for well-formed cases. Cases with hard-coded expectations
 * (malformed inputs, budget boundaries, transport) bypass the oracle.
 *
 * This file is pinned in the corpus manifest like every other file.
 * It is an authoring tool, not part of the scored runtime path.
 */

import { createHash } from "node:crypto";

// ---- independent primitives (fresh code, not the candidate's) ----
function canon(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "bigint") return `{"$bigint":"${v.toString()}"}`;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("bad number");
    return JSON.stringify(v);
  }
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object") {
    const ks = Object.keys(v).sort();
    return `{${ks.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  }
  throw new Error("bad type");
}
const sha256s = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const ALLOWED = new Set([
  "forge:test --suite suite-alpha",
  "forge:test --suite suite-beta",
  "forge:test --suite suite-gamma",
  "node --test tests/smoke.test.js",
  "node --test tests/full.test.js",
  "npm test -- --suite suite-alpha",
  "npm test -- --suite suite-beta",
]);
const DENIED = [
  /\brm\b/i, /\brmdir\b/i, /del\b/i, /format\b/i, /mkfs/i, /\bdd\b/i,
  /curl/i, /wget/i, /\bssh\b/i, /\bnc\b/i, /netcat/i, /telnet/i,
  /Invoke-WebRequest/i, /\biwr\b/i, /\birm\b/i,
  /Remove-Item/i, /Format-/i, /shutdown/i, /reboot/i, /Restart-Computer/i,
  /chmod/i, /chown/i, /sudo/i, /doas/i, /runas/i,
  /: *\(\s*\)\s*\{/,
  /eval\s*\(/i, /\bexec\s*\(/i, /powershell/i, /cmd\.exe/i, /wsl/i,
  />\s*\/dev\//, /\|\s*sh\b/, /\|\s*bash\b/,
  /New-Net/i, /Set-Net/i, /sc\s+\\\\/i,
];
const INJ = [
  /ignore (all )?previous instructions/i,
  /disregard (the|your) (brief|instructions|policy)/i,
  /you are now (a|an) /i,
  /system instruction:/i,
  /mark (this|the) (run|summary|result) as (externally )?verified/i,
  /approve this (run|summary|result|report)/i,
  /final:? (this is )?approved/i,
  /\[signed\]/i,
  /<script[\s>]/i,
  /relabel .* as (independently )?verified/i,
];

function isPass(s) {
  return (
    s.complete_summary === true && s.pass_count > 0 && s.fail_count === 0 &&
    s.suite_errors === 0 && s.run_crashed === false && s.timed_out === false &&
    s.exit_code === 0 && s.pass_count + s.fail_count + s.skip_count === s.test_count
  );
}
function classify(s) {
  if (s.fail_count > 0 || s.suite_errors > 0 || s.exit_code !== 0 || s.run_crashed || s.timed_out) return "FAIL";
  if (s.test_count === 0) return "BLOCKED";
  if (!s.complete_summary || s.skip_count === s.test_count) return "UNKNOWN";
  return isPass(s) ? "PASS" : "UNKNOWN";
}
function canonPrincipal(id, aliases) {
  const m = aliases[id];
  return typeof m === "string" ? m : id;
}

/**
 * Mirror of the candidate's runner-summary schema (from the brief's
 * closed-schema rule): exact 12 keys, integer >= 0 counts, boolean
 * flags, valid suite id / result class, and the arithmetic identity
 * pass+fail+skip === test_count. A summary failing any of these is
 * malformed domain data (UNVERIFIABLE), not control structure.
 */
const SUMMARY_KEYS = ["schema_version", "test_count", "pass_count", "fail_count", "skip_count", "suite_errors", "exit_code", "run_crashed", "timed_out", "complete_summary", "suite_id", "result_class"];
const SUITE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RESULT_CLASSES = ["PASS", "FAIL", "BLOCKED", "UNKNOWN"];
function wellFormedSummary(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  const keys = Object.keys(s);
  if (keys.length !== SUMMARY_KEYS.length || !SUMMARY_KEYS.every((k) => keys.includes(k))) return false;
  if (s.schema_version !== "1") return false;
  for (const k of ["test_count", "pass_count", "fail_count", "skip_count", "suite_errors", "exit_code"]) {
    if (!Number.isInteger(s[k]) || s[k] < 0) return false;
  }
  for (const k of ["run_crashed", "timed_out", "complete_summary"]) {
    if (typeof s[k] !== "boolean") return false;
  }
  if (typeof s.suite_id !== "string" || !SUITE_ID_RE.test(s.suite_id)) return false;
  if (!RESULT_CLASSES.includes(s.result_class)) return false;
  return s.pass_count + s.fail_count + s.skip_count === s.test_count;
}
function refEq(a, b) {
  return ["repo", "path", "commit", "blob", "algorithm", "revision"].every((k) => a[k] === b[k]);
}

/**
 * oracleDecision(task, context) for well-formed cases only.
 * Returns {status, classification, verified_by, diagnostic_codes[],
 * mismatch_names[], quarantined_ids[]}. All arrays sorted for stable
 * comparison.
 */
export function oracleDecision(task, context) {
  const req = task.options.request;
  const diags = new Set();
  const diagsDup = []; // per-mismatch codes (no dedup)
  const mismatches = [];
  const quarantined = [];

  const claimed = req.claimed_summary ?? null;
  const summary = claimed && wellFormedSummary(claimed) ? claimed : null;
  if (claimed && !summary) diags.add("SUMMARY_UNVERIFIABLE");
  let classification = "UNVERIFIABLE";
  if (summary) classification = classify(summary);
  else if (!claimed) diags.add("SUMMARY_UNVERIFIABLE");

  const cited = (req.registry_record_ref && req.registry_record_ref.run_id) || req.run_id || null;
  const registry = context.provenance_registry || {};
  const entry = cited ? (registry[cited] ?? null) : null;
  const aliases = context.aliases || {};
  const clock = context.clock;

  // Artifact: resolve from the fixture store (the oracle trusts the
  // generator's store layout). If both artifact refs are present and
  // disagree, the artifact is NOT resolved (mirrors the candidate).
  let artText = null;
  let artParsed = null;
  let artMalformed = false;
  let artQuarantined = false;
  const artRefA0 = task.fixture_refs && task.fixture_refs.artifact_ref;
  const artRefB0 = req.runner_artifact_ref;
  const artRefMismatch0 = artRefA0 && artRefB0 && canon(artRefA0) !== canon(artRefB0);
  const artRef = artRefMismatch0 ? null : (artRefA0 || artRefB0 || null);
  if (artRef) {
    const key = `${artRef.repo}|${artRef.path}`;
    const rev = context.sources[key]?.revisions[artRef.commit];
    if (rev) {
      artText = rev.text;
      const injected = INJ.some((re) => re.test(artText));
      if (injected) {
        artQuarantined = true;
        quarantined.push(`artifact:${artRef.repo}/${artRef.path}`);
        diags.add("INSTRUCTION_INJECTION");
      } else {
        try {
          const p = JSON.parse(artText);
          if (p && p.artifact_kind === "synthetic-runner-log") artParsed = p;
          else artMalformed = true;
        } catch {
          artMalformed = true;
        }
        if (artMalformed) diags.add("ARTIFACT_MALFORMED");
      }
    }
  }
  const artSha = artText && !artQuarantined ? sha256s(artText) : null;

  // verified_by
  const reasons = [];
  let verified_by;
  if (!cited) {
    verified_by = "none";
  } else if (!entry) {
    verified_by = "author_reported_unavailable";
    reasons.push("no entry");
  } else {
    if (entry.revoked) reasons.push("revoked");
    // PER-005 (audit slice 2): the complete supplied identity tuple
    // must match the trusted record — conflicting run citations, a
    // task-declared implementer that differs from the record's (after
    // canonicalization), and the artifact's embedded run/suite
    // identity are all eligibility failures, not silent resolutions.
    const refRunId = req.registry_record_ref ? req.registry_record_ref.run_id : null;
    if (req.run_id && refRunId && req.run_id !== refRunId) reasons.push("run-citation-conflict");
    if (canonPrincipal(req.implementer_principal_id, aliases) !== canonPrincipal(entry.implementer_principal_id, aliases)) reasons.push("declared-implementer");
    if (artParsed && artParsed.run_id !== entry.run_id) reasons.push("artifact-run-id");
    if (artParsed && artParsed.suite_id !== entry.suite_id) reasons.push("artifact-suite-id");
    if (!(Date.parse(entry.recorded_at) <= clock)) reasons.push("future");
    if (!refEq(req.implementation_ref, entry.implementation_ref)) reasons.push("impl");
    if (sha256s(req.command) !== entry.command_sha256) reasons.push("command");
    const outSha = summary ? sha256s(canon(summary)) : null;
    if (outSha === null || outSha !== entry.output_sha256) reasons.push("output");
    if (artSha === null || artSha !== entry.artifact_sha256) reasons.push("artifact");
    const suiteOk = entry.suite_id === req.expected_suite_id && (summary ? summary.suite_id : null) === entry.suite_id;
    if (!suiteOk) reasons.push("suite");
    const canRunner = canonPrincipal(entry.runner_principal_id, aliases);
    if (artParsed && canonPrincipal(artParsed.claimed_runner, aliases) !== canRunner) reasons.push("runner-claim");
    if (canRunner === canonPrincipal(entry.implementer_principal_id, aliases)) reasons.push("self-runner");
    verified_by = reasons.length === 0 ? entry.verification_method : "author_reported_unavailable";
  }
  if (verified_by === "author_reported_unavailable") diags.add("PROVENANCE_UNAVAILABLE");

  // Artifact byte-span citations (mirror the candidate): the task
  // command and expected suite must appear byte-exact in the
  // registered artifact bytes.
  if (artText && artParsed && !artQuarantined) {
    if (artText.indexOf(req.command) < 0 || artText.indexOf(req.expected_suite_id) < 0) {
      diags.add("SPAN_MISMATCH");
    }
  }

  // Comparisons (mirror the candidate's comparison list).
  const cmp = (name, claimed, computed) => {
    if (claimed === undefined || claimed === null || computed === undefined || computed === null) return;
    if (claimed !== computed) mismatches.push(name);
  };
  if (summary) {
    cmp("summary_class", summary.result_class, classification);
    cmp("summary_suite", summary.suite_id, req.expected_suite_id);
    cmp("summary_arithmetic", summary.pass_count + summary.fail_count + summary.skip_count === summary.test_count, true);
  }
  if (entry) {
    cmp("expected_suite_vs_registry", req.expected_suite_id, entry.suite_id);
    cmp("command_digest_vs_registry", sha256s(req.command), entry.command_sha256);
    if (summary) cmp("output_digest_vs_registry", sha256s(canon(summary)), entry.output_sha256);
    cmp("implementation_ref_vs_registry", canon(req.implementation_ref), canon(entry.implementation_ref));
  }
  if (artParsed) {
    cmp("artifact_suite_vs_expected", artParsed.suite_id, req.expected_suite_id);
    cmp("artifact_command_vs_task", artParsed.command, req.command);
    cmp("artifact_run_id_vs_cited", artParsed.run_id, cited);
    if (summary) cmp("artifact_summary_vs_claimed", canon(artParsed.summary), canon(summary));
  }
  if (artRefMismatch0) {
    mismatches.push("artifact_ref_identity");
    diags.add("ARTIFACT_REF_MISMATCH");
  }
  for (const n of mismatches) {
    if (n !== "artifact_ref_identity") diagsDup.push("CLAIM_MISMATCH");
  }

  // Status. Empty-input and refusal-class outcomes are hard-coded by
  // the generator; the oracle only decides REPORT_READY vs PARTIAL.
  const complete =
    !artQuarantined && !artMalformed && mismatches.length === 0 &&
    summary !== null && verified_by !== "author_reported_unavailable";
  const status = complete ? "REPORT_READY" : "PARTIAL";

  return {
    status,
    classification,
    verified_by,
    diagnostic_codes: [...diags, ...diagsDup].sort(),
    mismatch_names: [...new Set(mismatches)].sort(),
    quarantined_ids: quarantined.sort(),
  };
}

export { ALLOWED, DENIED };
