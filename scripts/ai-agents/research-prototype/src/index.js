/**
 * index.js — public entry for the Research Agent prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. Deterministic claim-by-claim attribution
 * over preloaded registered synthetic passages: separate fidelity and
 * corroboration axes, precedence-based research status
 * (contradicted > supported > attributed-only > unsupported), and
 * complete contradiction evidence. Closed-world evidence gathering —
 * never browsing, never retrieval, never real-world truth assertions.
 * The agent returns a detached advisory JSON snapshot; it cannot approve,
 * merge, deploy, activate, or reinterpret authorization.
 *
 * Budget discipline: every candidate object — the task, EVERY element of
 * the injected trusted context (sources, revisions, grants, principal,
 * criteria, provenance registry), each document record, each passage,
 * each assertion and each citation — is charged with budget.countObject()
 * (or chargeObjectOnce for shared admission) as the FIRST statement
 * before any of its own fields are read. Attempt 65 refuses before that
 * candidate (or any later one) is inspected at all. After the grant
 * gate, only the selected source/revision and required provenance
 * metadata are admitted (RA652-006); non-selected sources stay
 * untouched.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength } from "./canonical.js";
import {
  validateTask, validateGrantGateContext, validateSelectedSourceEntry,
  validateProvenanceRegistry, validateDocumentRecord, splitTopLevelArray,
  admitGraph, renderAssertionText, SchemaError,
} from "./schemas.js";
import { resolveSourceRef, hasReadGrant, makeBudget, BudgetError, ResolutionError, BUDGET_LIMITS } from "./resolver.js";
import { scanTexts } from "./injection.js";
import { verifyAssertionSpan, evaluateAtom, detectCitationCycles, ResearchSpanError } from "./research.js";

export const AGENT_ID = "research-agent";
export const SCHEMA_VERSION = "1";

/**
 * Pre-validation task_id fallback. Preserves the caller's raw task_id
 * when it is a string; otherwise the documented "unavailable" marker.
 * Byte-bounded: an oversized ID becomes a documented marker, never a
 * 300KB refusal envelope. Descriptor-safe: a single own-data-descriptor
 * read, never invoking accessors.
 */
function requestTaskId(task) {
  if (task !== null && typeof task === "object") {
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

/**
 * Explicit unavailable citation for values that carry no bundle source
 * span (task-input claims). The brief permits an explicit unavailable
 * state where no verified span exists.
 */
function unavailableCitation(reason) {
  return {
    quoted_span: null,
    span: null,
    verification: "unavailable",
    reason,
  };
}

/** Positional span verification under the live span budget. */
export function verifyRecordSpan(bytes, startByte, endByte, expectedText, budget, what) {
  budget.countSpan(what);
  if (!Number.isInteger(startByte) || !Number.isInteger(endByte) || startByte < 0 || endByte < startByte || endByte > bytes.length) {
    throw new ResolutionError("SPAN_MISMATCH", `span byte range [${startByte}, ${endByte}) is outside the source bytes`);
  }
  const slice = bytes.subarray(startByte, endByte).toString("utf8");
  if (slice !== expectedText) {
    throw new ResolutionError("SPAN_MISMATCH", "span bytes do not decode to the expected span text");
  }
  return { start_byte: startByte, end_byte: endByte, quoted_text: expectedText };
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
  // Overrun/refusal contract: bounded REFUSED, complete:false,
  // report:null — no partial domain artifact, ever.
  return envelope(taskId, {
    status: "REFUSED",
    complete: false,
    diagnostics: [{ code, severity, source_ref: null, record_id: null, reason }],
    report: null,
    ...extra,
  });
}

/** Byte-bounded refusal: every exit path respects the output byte cap. */
function boundedRefused(taskId, code, severity, reason, extra = {}) {
  const env = refused(taskId, code, severity, reason, extra);
  if (canonicalByteLength(env) <= BUDGET_LIMITS.maxOutputBytes) return env;
  const minimal = refused(
    "[refusal-exceeds-output-cap]",
    code,
    severity,
    String(reason).slice(0, 500)
  );
  if (canonicalByteLength(minimal) > BUDGET_LIMITS.maxOutputBytes) {
    minimal.diagnostics[0].reason = String(reason).slice(0, 100);
  }
  return minimal;
}

function emptyReport() {
  return {
    claims: [],
    coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0 },
    summary: null,
  };
}

/**
 * RA652-004 (fix round 3): one bounded final-envelope record walk
 * implementing the brief's public-record taxonomy. Counts every returned
 * record once per emitted occurrence:
 *
 *   report record ...................... the report object itself
 *   item records ....................... each claims[] element
 *   nested basis records ................ each claim's atom and origin
 *   citation records .................... every emitted citation
 *   span records ........................ every span nested in a citation
 *   source-ref records .................. every emitted source_ref
 *   resource records .................... each corroboration evidence /
 *                                         same-group / unregistered /
 *                                         derivation-linked /
 *                                         cycle-defeated entry
 *   corroboration records ................ each claim's corroboration
 *                                         object itself (RA652-004)
 *   conflict records ................... each contradictions[] entry
 *   completeness record ................ coverage
 *   summary record ..................... summary (when non-null)
 *   exclusion records .................. each quarantined_sources entry
 *   diagnostic records ................. each diagnostics[] entry
 *
 * Per-occurrence counting (fix round 3): the walk runs over the
 * SERIALIZED envelope, not the live object graph. The live graph may
 * share citation / source_ref / span objects across claims (e.g. one
 * origin citation referenced from several corroboration entries);
 * canonical JSON serialization emits each occurrence separately, so an
 * identity-deduplicated walk undercounts the actual public records
 * (a claimed 256-record envelope serialized to 259). Parsing the
 * canonical bytes breaks all shared identity: every emitted occurrence
 * becomes a distinct object in the parsed tree, and the walk below
 * counts each one. Unserializable (cyclic) input fails closed to
 * +Infinity, which the caller turns into an OUTPUT_LIMIT refusal.
 * `$bigint` markers produced by canonicalJson are leaf encodings, not
 * records: they are never counted and never descended into.
 *
 * Scalars and collection arrays are not records; internal work objects
 * are never counted — only the exact final envelope. Bounded: aborts
 * to +Infinity past a generous node cap so a corrupt envelope cannot
 * hang the counter.
 */
const OUTPUT_WALK_NODE_CAP = 200000;
export function countFinalEnvelopeRecords(env) {
  let tree;
  try {
    tree = JSON.parse(canonicalJson(env));
  } catch {
    return Number.POSITIVE_INFINITY; // cyclic/unserializable: fail closed
  }
  let count = 0;
  let nodes = 0;
  const rec = () => { count += 1; };
  const isBigintMarker = (v) =>
    v !== null && typeof v === "object" && !Array.isArray(v) &&
    Object.keys(v).length === 1 && typeof v.$bigint === "string";
  // Visit one envelope object; count it as a record only when the
  // caller classifies it so. Arrays are traversed, never counted.
  // The parsed tree is acyclic by construction (JSON.parse output),
  // so no identity dedup: shared references were already expanded by
  // serialization and each emitted occurrence counts.
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
  const walkResourceEntry = (e) => obj(e, (o) => {
    rec(); // resource record (evidence / same-group / unregistered /
           // derivation-linked / cycle-defeated)
    walkCitation(o.citation);
  });
  const walkClaim = (c) => obj(c, (o) => {
    rec(); // claim item record
    obj(o.atom, () => rec()); // nested basis: atom
    obj(o.origin, (og) => {
      rec(); // nested basis: origin
      walkCitation(og.citation);
    });
    obj(o.corroboration, (cor) => {
      rec(); // corroboration record itself (RA652-004): the claim's
             // corroboration object is a public emitted occurrence
      for (const e of cor.evidence ?? []) walkResourceEntry(e);
      for (const e of cor.same_group_occurrences ?? []) walkResourceEntry(e);
      for (const e of cor.unregistered_candidates ?? []) walkResourceEntry(e);
      for (const e of cor.derivation_linked_candidates ?? []) walkResourceEntry(e);
      for (const e of cor.cycle_defeated_candidates ?? []) walkResourceEntry(e);
    });
    obj(o.contradictions, () => {
      for (const k of o.contradictions ?? []) obj(k, () => {
        rec(); // conflict record
        walkCitation(k.citation);
      });
    });
  });
  obj(tree?.report, (r) => {
    rec(); // report record
    obj(r.coverage, () => rec()); // completeness record
    if (r.summary !== null && r.summary !== undefined) obj(r.summary, () => rec()); // summary record
    obj(r.claims, () => {
      for (const c of r.claims ?? []) walkClaim(c);
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
  // The monotonic object budget exists BEFORE any admission or
  // validation. admitGraph charges each distinct task object BEFORE its
  // descriptor fields are examined, so candidate #65 refuses with
  // BUDGET_EXCEEDED without touching that candidate at all.
  //
  // RA652-006: the context is NOT admitted wholesale. Admission is
  // split: the grant gate inspects only bounded grant/principal/control
  // metadata (never source revision metadata or payload bytes); the
  // denied-source grant is checked next; only after an exact grant
  // succeeds are the selected source/revision and the required
  // provenance metadata admitted.
  const budget = makeBudget();
  try {
    admitGraph(task, "task", budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(requestTaskId(task), e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(requestTaskId(task), "INVALID_INPUT", "error", e.message);
    throw e;
  }

  // Clock must be an own data property; validateContext enforces this,
  // but the early gate must not read through a prototype either.
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
      `prohibited operation '${validatedTask.operation}': this agent only supports 'analyze' (read a fixture-only evidence bundle and return an advisory attribution report); it cannot browse, retrieve, publish, or mutate any record`
    );
  }

  // ---- RA652-006: grant-gate admission FIRST. Only bounded
  // grant/principal/control metadata is inspected here — no source
  // revision metadata, no payload bytes. ----
  let gate;
  try {
    gate = validateGrantGateContext(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", `context: ${e.message}`);
    throw e;
  }

  // Authenticated request authority: Jason or his registered Muse relay.
  if (gate.principal.revoked) {
    return boundedRefused(taskId, "ACTION_DENIED", "critical", `principal '${gate.principal.principal_id}' is revoked; no request authority`);
  }
  const validFrom = Date.parse(gate.principal.valid_from);
  const expiresAt = Date.parse(gate.principal.expires_at);
  if (!(validFrom <= gate.clock && gate.clock <= expiresAt)) {
    return boundedRefused(taskId, "ACTION_DENIED", "critical", `principal '${gate.principal.principal_id}' is not valid at the current clock; no request authority`);
  }

  // RA652-006: the denied-source grant is checked BEFORE any source
  // byte or payload metadata is accessed. A missing grant refuses here;
  // the selected source's revision metadata and payload are never
  // touched.
  if (!hasReadGrant(validatedTask.evidence_bundle_ref, gate.readGrants)) {
    return boundedRefused(taskId, "READ_DENIED", "error", `read grant missing for evidence bundle ${validatedTask.evidence_bundle_ref.repo}/${validatedTask.evidence_bundle_ref.path}`);
  }

  // ---- RA652-006: post-grant admission. Only the selected registered
  // source/revision and the required provenance metadata are admitted
  // and charged. Non-selected source entries stay untouched. ----
  const selectedKey = `${validatedTask.evidence_bundle_ref.repo}|${validatedTask.evidence_bundle_ref.path}`;
  // Key presence is control metadata (sources-map lookup, not entry
  // inspection). An unregistered key is a resolution failure with the
  // same SOURCE_UNVERIFIED code the resolver reports — never a grant
  // bypass and never an entry read.
  if (!Object.prototype.hasOwnProperty.call(context.sources, selectedKey)) {
    return boundedRefused(taskId, "SOURCE_UNVERIFIED", "error", `source key not registered: ${validatedTask.evidence_bundle_ref.repo}/${validatedTask.evidence_bundle_ref.path}`);
  }
  let ctx;
  try {
    validateSelectedSourceEntry(context, budget, selectedKey);
    const provenance_registry = validateProvenanceRegistry(context, budget);
    ctx = {
      clock: gate.clock,
      sources: context.sources,
      readGrants: gate.readGrants,
      principal: gate.principal,
      criteria: gate.criteria,
      provenance_registry,
      test_hooks: gate.test_hooks,
    };
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", `context: ${e.message}`);
    throw e;
  }

  // Resolve the evidence bundle.
  let bundleResolved;
  try {
    bundleResolved = resolveSourceRef(validatedTask.evidence_bundle_ref, ctx.sources, budget, "evidence bundle source");
  } catch (e) {
    if (e instanceof ResolutionError) return boundedRefused(taskId, e.code, "error", `evidence bundle: ${e.message}`);
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    throw e;
  }

  // Bounded-container preflight FIRST — raw spans, no field decoding.
  let spans;
  try {
    spans = splitTopLevelArray(bundleResolved.text, "evidence bundle");
  } catch (e) {
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  // ---- Charged pass: one countObject() per document, passage,
  // assertion and citation, strictly before that candidate's fields are
  // decoded or read. Each document's original UTF-8 byte range is
  // verified under the live span budget before decoding. ----
  const bundleBytes = bundleResolved.bytes;
  const provisional = [];
  const diagnostics = [];
  const quarantined_sources = [];
  let budgetExceeded = false;
  for (let i = 0; i < spans.length; i++) {
    try {
      budget.countObject(`document[${i}]`);
    } catch (e) {
      if (e instanceof BudgetError) { budgetExceeded = true; break; }
      throw e;
    }
    const spanText = spans[i].text;
    try {
      verifyRecordSpan(bundleBytes, spans[i].startByte, spans[i].endByte, spanText, budget, `document[${i}] span`);
    } catch (e) {
      if (e instanceof ResolutionError) {
        return boundedRefused(taskId, "SPAN_MISMATCH", "error", `evidence bundle entry ${i} span verification failed: ${e.message}`);
      }
      if (e instanceof BudgetError) { budgetExceeded = true; break; }
      throw e;
    }
    let raw;
    try {
      raw = JSON.parse(spanText);
    } catch {
      return boundedRefused(taskId, "INVALID_INPUT", "error", `evidence bundle entry ${i} is not valid JSON`);
    }
    let doc;
    try {
      // validateDocumentRecord charges every nested passage/assertion/
      // citation object idempotently against the same live budget.
      doc = validateDocumentRecord(raw, `evidence bundle[${i}]`, budget);
    } catch (e) {
      if (e instanceof SchemaError) {
        return boundedRefused(taskId, "INVALID_INPUT", "error", `malformed document record at index ${i}: ${e.message}`);
      }
      if (e instanceof BudgetError) { budgetExceeded = true; break; }
      throw e;
    }
    doc._citation = {
      quoted_span: spanText,
      span: { start_byte: spans[i].startByte, end_byte: spans[i].endByte, quoted_text: spanText },
      verification: "verified",
    };
    provisional.push(doc);
  }

  if (budgetExceeded) {
    return boundedRefused(taskId, "BUDGET_EXCEEDED", "error", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}; refusing before inspecting the remaining records`);
  }

  // Duplicate doc_ids are rejected outright — no first-wins, no dedup.
  const seenDocIds = new Map();
  for (const d of provisional) {
    if (seenDocIds.has(d.doc_id)) {
      return boundedRefused(taskId, "INVALID_INPUT", "error", `duplicate doc_id '${d.doc_id}'; duplicates are rejected outright`);
    }
    seenDocIds.set(d.doc_id, true);
  }

  // Quarantine: passages whose free text carries a seeded directive
  // family are quarantined and excluded from all evidence. Quarantine is
  // explicit; clean passages still support unaffected claims.
  const quarantinedPassages = new Set();
  for (const d of provisional) {
    for (const p of d.passages) {
      const scan = scanTexts([p.text]);
      if (scan.injected) {
        const qid = `${d.doc_id}#${p.passage_id}`;
        quarantinedPassages.add(qid);
        quarantined_sources.push({ record_id: qid, reason: "INSTRUCTION_INJECTION_SEEDED_FAMILY" });
        diagnostics.push({
          code: "INSTRUCTION_INJECTION",
          severity: "critical",
          source_ref: null,
          record_id: qid,
          reason: `passage '${qid}' text carries a seeded directive family; quarantined and excluded from evidence`,
          evidence_state: "verified",
          evidence: { record_id: qid, families: scan.families },
        });
      }
    }
  }

  const totalRecords = spans.length;
  // Population completeness is host-established, never task-asserted.
  // The host declares expected_records on the registered revision; the
  // task's own declared_total/complete must ALSO agree.
  const hostExpectedRecords = bundleResolved.expected_records;
  const populationVerified =
    Number.isInteger(hostExpectedRecords) &&
    hostExpectedRecords === totalRecords &&
    validatedTask.population.complete === true &&
    validatedTask.population.declared_total === totalRecords;
  const admittedCount = provisional.length;
  const excludedCount = 0; // documents are admitted or the run refuses; passages quarantine explicitly

  if (provisional.length === 0) {
    const report = emptyReport();
    report.coverage = {
      state: populationVerified ? "COMPLETE_EMPTY" : "UNKNOWN_EMPTY",
      admitted_count: 0,
      excluded_count: 0,
    };
    return envelope(taskId, {
      status: "EMPTY",
      complete: populationVerified && quarantinedPassages.size === 0,
      source_refs: [sourceRefOut(validatedTask.evidence_bundle_ref)],
      diagnostics,
      quarantined_sources,
      report,
    });
  }

  // ---- Verified assertion index: every assertion's byte span is
  // reconstructed from its structured fields and checked against the
  // passage bytes under the live span budget. A span mismatch excludes
  // that assertion from all evidence (PARTIAL with affected claims
  // unverified — never a faithful attribution from a bad span). ----
  const verifiedIndex = [];
  const spanMismatchDocs = new Set();
  for (const d of provisional) {
    for (const p of d.passages) {
      const qid = `${d.doc_id}#${p.passage_id}`;
      if (quarantinedPassages.has(qid)) continue;
      const passageBytes = Buffer.from(p.text, "utf8");
      for (const a of p.assertions) {
        let verified;
        try {
          verified = verifyAssertionSpan(passageBytes, a, budget, `${qid} assertion ${a.assertion_id}`);
        } catch (e) {
          if (e instanceof ResearchSpanError) {
            spanMismatchDocs.add(qid);
            diagnostics.push({
              code: "SPAN_MISMATCH",
              severity: "error",
              source_ref: null,
              record_id: `${qid}:${a.assertion_id}`,
              reason: `assertion '${a.assertion_id}' in passage '${qid}' failed span verification and is excluded from evidence: ${e.message}`,
              evidence_state: "unavailable",
              evidence: null,
            });
            continue;
          }
          if (e instanceof BudgetError) {
            return boundedRefused(taskId, e.code, "error", e.message);
          }
          throw e;
        }
        verifiedIndex.push({
          doc_id: d.doc_id,
          passage_id: p.passage_id,
          assertion_id: a.assertion_id,
          atom: { subject: a.subject, predicate: a.predicate, value: a.value, value_type: a.value_type, scope: a.scope, polarity: a.polarity },
          span: verified,
          quoted_text: verified.quoted_text,
          citation: {
            source_ref: sourceRefOut(validatedTask.evidence_bundle_ref),
            quoted_span: verified.quoted_text,
            span: { start_byte: verified.start_byte, end_byte: verified.end_byte, quoted_text: verified.quoted_text },
            verification: "verified",
          },
        });
      }
    }
  }

  // Citation graph for cycle detection (doc-level, from validated citations).
  const docCitations = new Map();
  for (const d of provisional) {
    const targets = new Set();
    for (const p of d.passages) {
      for (const c of p.citations) targets.add(c.target_doc);
    }
    docCitations.set(d.doc_id, targets);
  }
  const citationCycles = detectCitationCycles(docCitations);

  // ---- Evaluate each requested claim, atom by atom. ----
  const claims = [];
  const sortedClaims = [...validatedTask.requested_claims].sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1));
  for (const rc of sortedClaims) {
    for (let ai = 0; ai < rc.atoms.length; ai++) {
      const atom = rc.atoms[ai];
      const res = evaluateAtom(atom, rc.origin_passage_refs, verifiedIndex, ctx.provenance_registry, citationCycles, docCitations);
      res.claim_id = `${rc.claim_id}#${ai + 1}`;
      // A quarantined or span-mismatched origin can never yield a
      // faithful attribution; surface the coverage change explicitly.
      const originQid = rc.origin_passage_refs.length > 0 ? `${rc.origin_passage_refs[0].doc_id}#${rc.origin_passage_refs[0].passage_id}` : null;
      if (originQid && (quarantinedPassages.has(originQid) || spanMismatchDocs.has(originQid)) && res.fidelity === "NOT_FAITHFUL") {
        diagnostics.push({
          code: "EVIDENCE_WITHHELD",
          severity: "error",
          source_ref: null,
          record_id: res.claim_id,
          reason: `origin passage '${originQid}' is ${quarantinedPassages.has(originQid) ? "quarantined" : "span-unverified"}; claim '${res.claim_id}' cannot be faithfully attributed`,
          evidence_state: "unavailable",
          evidence: null,
        });
      }
      // A citation cycle around the origin lends no corroboration; flag it
      // when the claim lands at attributed-only on cycle-adjacent evidence.
      if (res.citation_cycle && res.research_status === "attributed-only") {
        diagnostics.push({
          code: "CITATION_CYCLE_NO_SUPPORT",
          severity: "info",
          source_ref: null,
          record_id: res.claim_id,
          reason: `origin passage of claim '${res.claim_id}' lies on a citation cycle; the cycle contributes zero corroboration`,
          evidence_state: "verified",
          evidence: { origin_doc: res.origin.doc_id ?? null },
        });
      }
      claims.push(res);
    }
  }

  const contradictedCount = claims.filter((c) => c.research_status === "contradicted").length;
  const unsupportedCount = claims.filter((c) => c.research_status === "unsupported").length;
  const hasQuarantine = quarantinedPassages.size > 0;
  const hasSpanMismatch = spanMismatchDocs.size > 0;

  let status;
  if (contradictedCount > 0 || unsupportedCount > 0 || hasQuarantine || hasSpanMismatch) status = "PARTIAL";
  else if (!populationVerified) status = "PARTIAL";
  else status = "REPORT_READY";

  let coverageState;
  if (populationVerified) {
    coverageState = (contradictedCount === 0 && unsupportedCount === 0 && !hasQuarantine && !hasSpanMismatch) ? "COMPLETE" : "PARTIAL";
  } else {
    coverageState = "UNKNOWN";
  }

  let summary = null;
  if (status === "REPORT_READY" && populationVerified && !hasQuarantine && !hasSpanMismatch) {
    const byStatus = {};
    for (const c of claims) byStatus[c.research_status] = (byStatus[c.research_status] || 0) + 1;
    summary = {
      claim_count: claims.length,
      status_counts: byStatus,
      derivation_note: "synthetic bundle attribution only; never a real-world truth assertion",
    };
  }

  const report = {
    claims,
    coverage: { state: coverageState, admitted_count: admittedCount, excluded_count: excludedCount },
    summary,
  };

  const result = envelope(taskId, {
    status,
    complete: status === "REPORT_READY" && populationVerified && !hasQuarantine && !hasSpanMismatch,
    source_refs: [sourceRefOut(validatedTask.evidence_bundle_ref)],
    diagnostics,
    quarantined_sources,
    routing_flags: [],
    report,
  });

  // RA652-004: exact final-envelope output accounting via the single
  // bounded, cycle-safe record walk implementing the brief's taxonomy
  // (see countFinalEnvelopeRecords). The host-only prefill
  // (context.test_hooks) shifts the base for the 256/257 boundary test;
  // it is zero in production.
  const prefill = ctx.test_hooks?.prefill_output_records ?? 0;
  const outputRecords = prefill + countFinalEnvelopeRecords(result);
  if (outputRecords > BUDGET_LIMITS.maxOutputRecords || canonicalByteLength(result) > BUDGET_LIMITS.maxOutputBytes) {
    return boundedRefused(taskId, "OUTPUT_LIMIT", "error", `final output envelope exceeds the ${BUDGET_LIMITS.maxOutputRecords}-record / ${BUDGET_LIMITS.maxOutputBytes}-byte output bounds`);
  }
  return result;
}

export { validateTask, validateGrantGateContext, validateSelectedSourceEntry, validateProvenanceRegistry, BUDGET_LIMITS, canonicalJson, sha256HexUtf8, makeBudget };
