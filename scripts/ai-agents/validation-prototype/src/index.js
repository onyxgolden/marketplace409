/**
 * index.js — public entry for the Validation Agent prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. A synthetic test-evidence/provenance
 * verifier over THREE INDEPENDENT AXES: observed_test_result
 * (summary arithmetic + classification), artifact_consistency
 * (registered artifact bytes vs pins/hashes/identities), and
 * independent_provenance (the host-injected synthetic
 * TrustedProvenanceRegistry, MOCK_INDEPENDENT_RUN only). The agent
 * never runs a command, never authenticates real people, and its
 * output is advisory JSON only — never a merge/approval token.
 *
 * Budget discipline: every candidate object — the task, EVERY element
 * of the injected trusted context (sources, revisions, grants,
 * principal, aliases, criteria, provenance registry entries) — is
 * charged as the FIRST statement before any of its own fields are
 * read. Attempt 65 refuses before that candidate (or any later one)
 * is inspected at all. After the grant gate, only the selected
 * source/revision and required provenance metadata are admitted; a
 * denied source's bytes are never touched.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength } from "./canonical.js";
import {
  validateTask, validateGrantGateContext, validateSelectedSourceEntry,
  validateProvenanceRegistry, validateArtifactRecord,
  admitGraph, implementationRefEquals, SchemaError,
} from "./schemas.js";
import { resolveSourceRef, hasReadGrant, makeBudget, verifySpan, BudgetError, ResolutionError, BUDGET_LIMITS } from "./resolver.js";
import { scanTexts } from "./injection.js";
import {
  isPassSummary, classifySummary, checkCommandDescriptor,
  deriveVerifiedBy, buildClaimComparisons,
} from "./verify.js";
import { types } from "node:util";

export const AGENT_ID = "validation-agent";
export const SCHEMA_VERSION = "1";

/** Proxy-safe, byte-bounded pre-validation task_id fallback. */
function requestTaskId(task) {
  if (task !== null && typeof task === "object" && !types.isProxy(task)) {
    const desc = Object.getOwnPropertyDescriptor(task, "task_id");
    if (desc && typeof desc.get !== "function" && typeof desc.set !== "function" && typeof desc.value === "string") {
      if (Buffer.byteLength(desc.value, "utf8") > 256) {
        return "[task-id-exceeds-256-bytes]";
      }
      return desc.value;
    }
  }
  return "unavailable";
}

function envelope(taskId, { status, complete, source_refs = [], diagnostics = [], quarantined_sources = [], routing_flags = [], report = null }) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskId,
    status,
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete,
    source_refs,
    diagnostics,
    quarantined_sources,
    routing_flags,
    report: report === undefined ? emptyReport() : report,
  };
}

function refused(taskId, code, severity, reason, extra = {}) {
  return envelope(taskId, {
    status: "REFUSED",
    complete: false,
    diagnostics: [{ code, severity, source_ref: null, record_id: null, reason }],
    report: null,
    ...extra,
  });
}

function boundedRefused(taskId, code, severity, reason, extra = {}) {
  const env = refused(taskId, code, severity, reason, extra);
  if (canonicalByteLength(env) <= BUDGET_LIMITS.maxOutputBytes) return env;
  const minimal = refused("[refusal-exceeds-output-cap]", code, severity, String(reason).slice(0, 500));
  if (canonicalByteLength(minimal) > BUDGET_LIMITS.maxOutputBytes) {
    minimal.diagnostics[0].reason = String(reason).slice(0, 100);
  }
  return minimal;
}

function emptyReport() {
  return {
    artifact_consistency: {
      state: "empty",
      artifact_found: false,
      artifact_sha256: null,
      artifact_suite_id: null,
      artifact_run_id: null,
      artifact_malformed: false,
    },
    provenance: {
      claimed_runner: null,
      canonical_runner: null,
      verified_by: "none",
      reasons: ["no verification content in request"],
      registry_ref: null,
    },
    test_result: {
      is_pass: false,
      classification: "EMPTY",
      counts: null,
      limitations: ["no verification content in request"],
    },
    claim_comparisons: [],
    citations: [],
  };
}

/**
 * One bounded final-envelope record walk implementing the brief's
 * public-record taxonomy. Counts every returned record once per
 * emitted occurrence:
 *
 *   report record ................... the report object itself
 *   axis records ..................... artifact_consistency, provenance,
 *                                      test_result
 *   counts record .................... test_result.counts (when non-null)
 *   registry-ref record .............. provenance.registry_ref (when non-null)
 *   comparison records ............... each claim_comparisons[] element
 *   citation records ................. every emitted citation
 *   span records ..................... every span nested in a citation
 *   source-ref records ............... every emitted source_ref
 *   diagnostic records ............... each diagnostics[] entry
 *   exclusion records ................ each quarantined_sources[] entry
 *
 * Per-occurrence counting: the walk runs over the SERIALIZED envelope
 * (the live graph may share objects; canonical serialization emits
 * each occurrence separately). `$bigint` markers are leaf encodings,
 * never records. Unserializable input fails closed to +Infinity.
 */
const OUTPUT_WALK_NODE_CAP = 200000;
export function countFinalEnvelopeRecords(env) {
  let tree;
  try {
    tree = JSON.parse(canonicalJson(env));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  let count = 0;
  let nodes = 0;
  const rec = () => { count += 1; };
  const isBigintMarker = (v) =>
    v !== null && typeof v === "object" && !Array.isArray(v) &&
    Object.keys(v).length === 1 && typeof v.$bigint === "string";
  function obj(v, fn) {
    if (v === null || typeof v !== "object" || isBigintMarker(v)) return;
    if (++nodes > OUTPUT_WALK_NODE_CAP) { count = Number.POSITIVE_INFINITY; return; }
    fn(v);
  }
  const walkCitation = (c) => obj(c, (o) => {
    rec(); // citation record
    obj(o.source_ref, () => rec()); // source-ref record
    obj(o.span, () => rec()); // span record
  });
  obj(tree?.report, (r) => {
    rec(); // report record
    obj(r.artifact_consistency, () => rec()); // axis record
    obj(r.provenance, (p) => {
      rec(); // axis record
      obj(p.registry_ref, () => rec()); // registry-ref record
    });
    obj(r.test_result, (t) => {
      rec(); // axis record
      obj(t.counts, () => rec()); // counts record
    });
    obj(r.claim_comparisons, () => {
      for (const c of r.claim_comparisons ?? []) obj(c, () => rec()); // comparison records
    });
    obj(r.citations, () => {
      for (const c of r.citations ?? []) walkCitation(c);
    });
  });
  obj(tree?.source_refs, () => {
    for (const s of tree.source_refs ?? []) obj(s, () => rec()); // source-ref records
  });
  obj(tree?.diagnostics, () => {
    for (const d of tree.diagnostics ?? []) obj(d, () => rec()); // diagnostic records
  });
  obj(tree?.quarantined_sources, () => {
    for (const q of tree.quarantined_sources ?? []) obj(q, () => rec()); // exclusion records
  });
  return count;
}

function sourceRefOut(r) {
  return { repo: r.repo, path: r.path, commit: r.commit, blob: r.blob, algorithm: r.algorithm, revision: r.revision };
}

export function run(task, context) {
  const budget = makeBudget();
  try {
    // PER-008: ONE charged admission traversal. The old uncharged
    // assertNoNativeProxies(task) pre-sweep walked the whole task graph
    // without the invocation budget, inspecting descriptors of
    // candidates past the 64-object limit (e.g. an accessor sentinel
    // smuggled into an unknown options.padding array). admitGraph
    // already integrates the trap-free native-Proxy check, the
    // own-descriptor accessor/function/symbol checks, the prototype
    // check and the depth bound: each distinct object is charged BEFORE
    // any of its descriptor fields is examined, so candidate #65
    // refuses with BUDGET_EXCEEDED before that candidate (or any later
    // one) is inspected at all. Unknown control keys are still rejected
    // by the schema layer without their values being decoded. A Proxy
    // task still refuses here with INVALID_INPUT and zero trap
    // executions.
    admitGraph(task, "task", budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(requestTaskId(task), e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(requestTaskId(task), "INVALID_INPUT", "error", e.message);
    throw e;
  }

  if (context !== null && typeof context === "object" && types.isProxy(context)) {
    return boundedRefused(requestTaskId(task), "INVALID_INPUT", "error", "context must not be a native Proxy; refusing without invoking its traps");
  }

  const clockDesc = context !== null && typeof context === "object"
    ? Object.getOwnPropertyDescriptor(context, "clock")
    : undefined;
  const clockRaw = clockDesc && typeof clockDesc.get !== "function" && typeof clockDesc.set !== "function"
    ? clockDesc.value
    : undefined;
  if (!Number.isFinite(clockRaw)) return boundedRefused(requestTaskId(task), "INVALID_INPUT", "error", "context.clock must be a finite number");

  let validatedTask;
  try {
    validatedTask = validateTask(task, budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(requestTaskId(task), e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(requestTaskId(task), "INVALID_INPUT", "error", e.message);
    throw e;
  }
  const taskId = validatedTask.task_id;
  const req = validatedTask.request;

  try {
    budget.countPayload(canonicalJson(task), "task payload");
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    throw e;
  }

  if (validatedTask.kind === "prohibited") {
    return boundedRefused(
      taskId,
      "ACTION_DENIED",
      "critical",
      `prohibited operation '${validatedTask.operation}': this agent only supports 'analyze' (verify a synthetic test-evidence claim and return an advisory report); it cannot execute commands, browse, publish, or mutate any record`
    );
  }

  // ---- Grant-gate admission FIRST. Only bounded grant/principal/
  // control metadata is inspected — no source revision metadata, no
  // payload bytes. ----
  let gate;
  try {
    gate = validateGrantGateContext(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", `context: ${e.message}`);
    throw e;
  }

  // Host-only span prefill: validated by the gate, applied before the
  // first span check (all span checks run post-gate).
  try {
    budget.applySpanPrefill(gate.test_hooks?.prefill_spans ?? 0);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    throw e;
  }

  if (gate.principal.revoked) {
    return boundedRefused(taskId, "ACTION_DENIED", "critical", `principal '${gate.principal.principal_id}' is revoked; no request authority`);
  }
  const validFrom = Date.parse(gate.principal.valid_from);
  const expiresAt = Date.parse(gate.principal.expires_at);
  if (!(validFrom <= gate.clock && gate.clock <= expiresAt)) {
    return boundedRefused(taskId, "ACTION_DENIED", "critical", `principal '${gate.principal.principal_id}' is not valid at the current clock; no request authority`);
  }

  // ---- Empty input: no command, no claimed summary, no run citation
  // => EMPTY / verified_by none. Not verified test absence. ----
  const citedRunId = req.registry_record_ref?.run_id ?? req.run_id ?? null;
  if (
    req.command === "" &&
    req.claimed_summary === undefined &&
    !req.summary_malformed &&
    citedRunId === null
  ) {
    const result = envelope(taskId, {
      status: "EMPTY",
      complete: true,
      source_refs: [],
      diagnostics: [],
      quarantined_sources: [],
      report: emptyReport(),
    });
    const prefill = gate.test_hooks?.prefill_output_records ?? 0;
    const records = prefill + countFinalEnvelopeRecords(result);
    if (records > BUDGET_LIMITS.maxOutputRecords || canonicalByteLength(result) > BUDGET_LIMITS.maxOutputBytes) {
      return boundedRefused(taskId, "OUTPUT_LIMIT", "error", `final output envelope exceeds the ${BUDGET_LIMITS.maxOutputRecords}-record / ${BUDGET_LIMITS.maxOutputBytes}-byte output bounds`);
    }
    return result;
  }

  // ---- Inert command gate. The descriptor is data; nothing executes. ----
  const cmdCheck = checkCommandDescriptor(req.command);
  if (cmdCheck.decision === "denied") {
    return boundedRefused(
      taskId,
      "ACTION_DENIED",
      "critical",
      `command descriptor contains a prohibited delete/network operation; the agent never executes commands and refuses this descriptor outright`
    );
  }
  if (cmdCheck.decision === "unknown") {
    return boundedRefused(
      taskId,
      "INVALID_INPUT",
      "error",
      `command descriptor is not an allowlisted fixture descriptor; the agent only recognizes inert fixture descriptors`
    );
  }

  // ---- Post-grant admission: provenance registry (required metadata,
  // carries no source bytes). ----
  let provenance_registry;
  try {
    provenance_registry = validateProvenanceRegistry(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", `context: ${e.message}`);
    throw e;
  }

  const diagnostics = [];
  const quarantined_sources = [];

  // ---- Artifact resolution (registered bytes, grant-gated). ----
  // The artifact bytes ref: fixture_refs.artifact_ref, else the
  // request's runner_artifact_ref. Both present and unequal => the
  // artifact is inconsistent; bytes are not resolved.
  let artifactRef = validatedTask.artifact_ref ?? req.runner_artifact_ref ?? null;
  let artifactRefMismatch = false;
  if (validatedTask.artifact_ref && req.runner_artifact_ref && !implementationRefEquals(validatedTask.artifact_ref, req.runner_artifact_ref)) {
    artifactRefMismatch = true;
    // Reported once below as ARTIFACT_REF_MISMATCH (not CLAIM_MISMATCH).
  }

  let artifactResolved = null; // {bytes, text}
  let artifactQuarantined = false;
  let artifact = null; // parsed runner log
  let artifactMalformed = false;
  let artifactSha256 = null;

  if (artifactRef && !artifactRefMismatch) {
    if (!hasReadGrant(artifactRef, gate.readGrants)) {
      return boundedRefused(taskId, "READ_DENIED", "error", `read grant missing for runner artifact ${artifactRef.repo}/${artifactRef.path}`);
    }
    const key = `${artifactRef.repo}|${artifactRef.path}`;
    if (!Object.prototype.hasOwnProperty.call(context.sources, key)) {
      return boundedRefused(taskId, "SOURCE_UNVERIFIED", "error", `source key not registered: ${artifactRef.repo}/${artifactRef.path}`);
    }
    try {
      validateSelectedSourceEntry(context, budget, key);
      artifactResolved = resolveSourceRef(artifactRef, context.sources, budget, "runner artifact source");
    } catch (e) {
      if (e instanceof ResolutionError) return boundedRefused(taskId, e.code, "error", `runner artifact: ${e.message}`);
      if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
      if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", `context: ${e.message}`);
      throw e;
    }
    artifactSha256 = sha256HexUtf8(artifactResolved.text);
    // Quarantine: seeded directive families in the artifact bytes make
    // the artifact unusable as evidence. Its bytes are excluded; the
    // parse below does not happen. The scan covers the FULL resolved
    // text (V654-001): the artifact is already bounded by the 256 KiB
    // aggregate input budget, so a 64 KiB window would leave the tail
    // of a large artifact unscanned.
    const scan = scanTexts([artifactResolved.text]);
    if (scan.injected) {
      artifactQuarantined = true;
      const qid = `artifact:${artifactRef.repo}/${artifactRef.path}`;
      quarantined_sources.push({ record_id: qid, reason: "INSTRUCTION_INJECTION_SEEDED_FAMILY" });
      diagnostics.push({
        code: "INSTRUCTION_INJECTION",
        severity: "critical",
        source_ref: null,
        record_id: qid,
        reason: `runner artifact text carries a seeded directive family (families ${scan.families.join(",")}); quarantined and excluded from evidence`,
      });
      artifactSha256 = null;
    } else {
      try {
        const parsed = JSON.parse(artifactResolved.text);
        artifact = validateArtifactRecord(parsed, "runner artifact");
      } catch {
        artifactMalformed = true;
        artifact = null;
        diagnostics.push({
          code: "ARTIFACT_MALFORMED",
          severity: "error",
          source_ref: null,
          record_id: req.claim_id,
          reason: "registered artifact bytes are not a well-formed schema-versioned synthetic runner log",
        });
      }
    }
  }

  // ---- Axis 1: observed test result from the claimed summary. ----
  const summary = req.claimed_summary ?? null;
  let classification;
  let is_pass = false;
  const limitations = [];
  if (summary) {
    classification = classifySummary(summary);
    is_pass = isPassSummary(summary);
    if (summary.skip_count > 0 && summary.skip_count < summary.test_count) {
      limitations.push(`partial skips disclosed: skip_count=${summary.skip_count} of test_count=${summary.test_count}`);
    }
    if (summary.skip_count > 0 && summary.skip_count === summary.test_count) {
      limitations.push("all tests skipped; never a PASS");
    }
  } else {
    classification = "UNVERIFIABLE";
    limitations.push("no well-formed claimed summary; test result is UNVERIFIABLE, not a verified absence of tests");
    diagnostics.push({
      code: "SUMMARY_UNVERIFIABLE",
      severity: "warning",
      source_ref: null,
      record_id: req.claim_id,
      reason: req.summary_malformed
        ? "claimed summary is malformed; observed_test_result is UNVERIFIABLE"
        : "claimed summary missing; observed_test_result is UNVERIFIABLE",
    });
  }

  // ---- Axes 2+3: artifact consistency + independent provenance. ----
  const entry = citedRunId ? (provenance_registry[citedRunId] ?? null) : null;
  const outputSha256 = summary ? sha256HexUtf8(canonicalJson(summary)) : null;
  const suiteMatches = entry
    ? entry.suite_id === req.expected_suite_id && (summary?.suite_id ?? null) === entry.suite_id
    : false;
  const implRefMatches = entry ? implementationRefEquals(req.implementation_ref, entry.implementation_ref) : false;
  // Claim comparisons are computed ONCE, before provenance: the
  // artifact_* entries are fed into the eligibility decision below
  // (PER-005 round 2) and the same list is emitted in the report,
  // so the comparison path and the provenance path cannot drift.
  const comparisons = buildClaimComparisons(req, artifact, entry, classification, outputSha256);
  const prov = deriveVerifiedBy({
    citedRunId,
    entry,
    artifactSha256: artifactQuarantined ? null : artifactSha256,
    artifact,
    taskCommandSha256: sha256HexUtf8(req.command),
    outputSha256,
    implRefMatches,
    suiteMatches,
    aliases: gate.aliases,
    clock: gate.clock,
    // PER-005: the complete supplied identity tuple, compared
    // against the trusted record inside the eligibility predicate.
    declaredImplementer: req.implementer_principal_id,
    requestRunId: req.run_id ?? null,
    registryRefRunId: req.registry_record_ref?.run_id ?? null,
    // PER-005 round 2: parsed-artifact validity and semantic
    // consistency are prerequisites of independent provenance.
    artifactComparisons: comparisons.filter((c) => c.name.startsWith("artifact_")),
    artifactMalformed,
  });
  if (prov.verified_by === "author_reported_unavailable") {
    diagnostics.push({
      code: "PROVENANCE_UNAVAILABLE",
      severity: "warning",
      source_ref: null,
      record_id: req.claim_id,
      reason: `cited run '${citedRunId}' is author-reported only, not independently verified: ${prov.reasons.join("; ")}`,
    });
  }

  // ---- Claim comparison diagnostics (claimed vs computed). ----
  if (artifactRefMismatch) {
    comparisons.push({
      name: "artifact_ref_identity",
      claimed: canonicalJson(req.runner_artifact_ref),
      computed: canonicalJson(validatedTask.artifact_ref),
      match: false,
    });
  }
  for (const c of comparisons) {
    if (c.match === false) {
      diagnostics.push({
        code: c.name === "artifact_ref_identity" ? "ARTIFACT_REF_MISMATCH" : "CLAIM_MISMATCH",
        severity: "error",
        source_ref: null,
        record_id: req.claim_id,
        reason: `claim comparison '${c.name}' mismatch: claimed ${JSON.stringify(c.claimed)} vs computed ${JSON.stringify(c.computed)}`,
      });
    }
  }

  // ---- Citations. The artifact citations carry byte-exact verified
  // spans (command + suite) into the registered artifact bytes; the
  // implementation citation is explicitly unavailable (identity is
  // compared against the registry pin only — bytes are never read). ----
  const citations = [];
  citations.push({
    source_ref: sourceRefOut(req.implementation_ref),
    quoted_span: null,
    span: null,
    verification: "unavailable",
    reason: "implementation bytes are never read by this agent; identity is compared against the TrustedProvenanceRegistry pin only",
  });
  if (artifactResolved && artifact && !artifactQuarantined) {
    for (const [label, needle] of [["command", req.command], ["suite", req.expected_suite_id]]) {
      try {
        budget.countSpan(`artifact ${label} citation`);
        const span = verifySpan(artifactResolved.bytes, needle, `artifact ${label}`);
        citations.push({
          source_ref: sourceRefOut(artifactRef),
          quoted_span: needle,
          span,
          verification: "verified",
        });
      } catch (e) {
        if (e instanceof ResolutionError) {
          diagnostics.push({
            code: "SPAN_MISMATCH",
            severity: "error",
            source_ref: null,
            record_id: req.claim_id,
            reason: `artifact ${label} span verification failed: ${e.message}`,
          });
          citations.push({
            source_ref: sourceRefOut(artifactRef),
            quoted_span: null,
            span: null,
            verification: "unavailable",
            reason: `artifact ${label} not found byte-exact in the registered artifact bytes`,
          });
        } else if (e instanceof BudgetError) {
          return boundedRefused(taskId, e.code, "error", e.message);
        } else {
          throw e;
        }
      }
    }
  }

  // ---- Artifact consistency axis. ----
  let consistencyState;
  if (artifactQuarantined) consistencyState = "quarantined";
  else if (artifactMalformed) consistencyState = "malformed";
  else if (!artifactRef) consistencyState = "unavailable";
  else if (!artifact) consistencyState = "unavailable";
  else {
    const artifactComparisonsOk = comparisons
      .filter((c) => c.name.startsWith("artifact_"))
      .every((c) => c.match);
    consistencyState = artifactRefMismatch || !artifactComparisonsOk ? "inconsistent" : "consistent";
  }

  const report = {
    artifact_consistency: {
      state: consistencyState,
      artifact_found: artifactResolved !== null && !artifactQuarantined,
      artifact_sha256: artifactQuarantined ? null : artifactSha256,
      artifact_suite_id: artifact?.suite_id ?? null,
      artifact_run_id: artifact?.run_id ?? null,
      artifact_malformed: artifactMalformed,
    },
    provenance: {
      claimed_runner: prov.claimed_runner,
      canonical_runner: prov.canonical_runner,
      verified_by: prov.verified_by,
      reasons: prov.reasons,
      registry_ref: prov.registry_ref,
    },
    test_result: {
      is_pass,
      classification,
      counts: summary
        ? {
            test_count: summary.test_count,
            pass_count: summary.pass_count,
            fail_count: summary.fail_count,
            skip_count: summary.skip_count,
            suite_errors: summary.suite_errors,
            exit_code: summary.exit_code,
          }
        : null,
      limitations,
    },
    claim_comparisons: comparisons,
    citations,
  };

  const hasMismatch = comparisons.some((c) => c.match === false);
  const complete =
    !artifactQuarantined &&
    !artifactMalformed &&
    !hasMismatch &&
    summary !== null &&
    prov.verified_by !== "author_reported_unavailable";
  const status = complete ? "REPORT_READY" : "PARTIAL";

  const envelopeSourceRefs = artifactRef && !artifactQuarantined ? [sourceRefOut(artifactRef)] : [];
  const result = envelope(taskId, {
    status,
    complete,
    source_refs: envelopeSourceRefs,
    diagnostics,
    quarantined_sources,
    routing_flags: [],
    report,
  });

  const prefill = gate.test_hooks?.prefill_output_records ?? 0;
  const outputRecords = prefill + countFinalEnvelopeRecords(result);
  if (outputRecords > BUDGET_LIMITS.maxOutputRecords || canonicalByteLength(result) > BUDGET_LIMITS.maxOutputBytes) {
    return boundedRefused(taskId, "OUTPUT_LIMIT", "error", `final output envelope exceeds the ${BUDGET_LIMITS.maxOutputRecords}-record / ${BUDGET_LIMITS.maxOutputBytes}-byte output bounds`);
  }
  return result;
}

export { validateTask, validateGrantGateContext, validateSelectedSourceEntry, validateProvenanceRegistry, BUDGET_LIMITS, canonicalJson, sha256HexUtf8, makeBudget };
