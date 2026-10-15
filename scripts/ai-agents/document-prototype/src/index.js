/**
 * index.js — public entry for the Document Agent prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. Document-set integrity: inventory,
 * exact-duplicate groups (SHA-256 + byte comparison), version-conflict
 * register (parallel versions, timeline mismatches), checklist coverage,
 * cross-reference map (internal existence + cycle detection), and
 * cross-document assertion conflicts, over a fixture-only document set.
 * The agent has no file-write API, no network, no fetch capability
 * (external pointers are NEVER fetched): it returns a detached advisory
 * JSON snapshot. The checklist comes from the trusted, host-injected
 * context — never from task content.
 *
 * Budget discipline (the bug class that has bitten every other agent in
 * this program): every top-level candidate object — the checklist
 * source, the document-set source, EACH document record, EACH assertion
 * record, and EACH resolved content blob — is charged with
 * budget.countObject() as the FIRST statement before any of its own
 * fields are read. Attempt 65 refuses before that candidate (or any
 * later one) is inspected at all. (Scoping note, consistent with the
 * precedent set by this program's Customer Success build under the
 * identical contract clause: a document's own nested sections/markers/
 * references are charged as ONE candidate together with their owning
 * document record, not as separate top-level candidates — this prototype
 * does not model them as independently, individually resolvable fixture
 * objects the way e.g. Financial Manager's sections/basis-records brief
 * did. Each one's byte-SPAN verification against resolved content is
 * still separately charged via countSpan(), a distinct budget line.)
 */

import { canonicalJson, sha256HexUtf8, sha256HexBytes, canonicalByteLength, fullSourceRefKey } from "./canonical.js";
import { validateTask, validateContext, validateDocument, validateAssertion, validateDocumentSetShape, SchemaError } from "./schemas.js";
import { resolveSourceRef, verifySpanBounds, hasReadGrant, makeBudget, BudgetError, ResolutionError, BUDGET_LIMITS } from "./resolver.js";
import { scanAnyDocText } from "./injection.js";
import {
  computeDuplicateGroups,
  computeVersionConflicts,
  computeChecklistResults,
  computeMetadataVerification,
  computeReferenceEdges,
  detectCycles,
  computeCrossDocumentConflicts,
} from "./integrity.js";

export const AGENT_ID = "document-agent";
export const SCHEMA_VERSION = "1";

function emptyReport() {
  return {
    population: { declared_total: 0, complete: false, actual_total: 0, evidence_state: "unverifiable" },
    inventory: [],
    duplicate_groups: [],
    version_conflicts: [],
    checklist_results: { checklist_version: null, required_sections: [], required_companions: [], overall: "UNKNOWN" },
    reference_edges: [],
    cycles: [],
    cross_document_conflicts: [],
    excluded_ids: [],
    excluded_assertions: [],
    coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0 },
  };
}

function taskIdOf(task) {
  try {
    return `doc-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`;
  } catch {
    return "doc-invalid-task";
  }
}

function envelope(task, { status, complete, source_refs = [], diagnostics = [], quarantined_sources = [], routing_flags = [], report = null }) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskIdOf(task),
    status,
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete,
    source_refs,
    diagnostics,
    quarantined_sources,
    routing_flags,
    report: report ?? emptyReport(),
  };
}

function refused(task, code, severity, reason, extra = {}) {
  return envelope(task, {
    status: "REFUSED",
    complete: false,
    diagnostics: [{ code, severity, source_ref: null, record_id: null, reason }],
    ...extra,
  });
}

function refKey(r) {
  return `${r.repo}|${r.path}|${r.commit}|${r.blob}`;
}

export function run(task, context) {
  const clockRaw = context && typeof context === "object" ? context.clock : undefined;
  if (!Number.isFinite(clockRaw)) return refused(task, "INVALID_INPUT", "error", "context.clock must be a finite number");

  let validatedTask;
  try {
    validatedTask = validateTask(task);
  } catch (e) {
    if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  const budget = makeBudget();
  try {
    budget.countPayload(canonicalJson(task), "task payload");
  } catch (e) {
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }

  if (validatedTask.kind === "prohibited") {
    return refused(
      task,
      "ACTION_DENIED",
      "critical",
      `prohibited operation '${validatedTask.operation}': this agent only supports 'analyze' (read fixture-only documents and return an advisory report); it cannot edit, delete, resolve conflicts, fetch external pointers, or mutate any record`
    );
  }

  let ctx;
  try {
    ctx = validateContext(context, budget);
  } catch (e) {
    if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", `context: ${e.message}`);
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }

  // Authenticated request authority: Jason or his registered Muse relay,
  // through the host-injected principal only — task content, arbitrary
  // actor strings, paths or "approved" prose never carry authority.
  if (ctx.principal.revoked) {
    return refused(task, "ACTION_DENIED", "critical", `principal '${ctx.principal.principal_id}' is revoked; no request authority`);
  }
  const validFrom = Date.parse(ctx.principal.valid_from);
  const expiresAt = Date.parse(ctx.principal.expires_at);
  if (!(validFrom <= ctx.clock && ctx.clock <= expiresAt)) {
    return refused(task, "ACTION_DENIED", "critical", `principal '${ctx.principal.principal_id}' is not valid at the current clock; no request authority`);
  }

  // Resolve the trusted checklist document FIRST: nothing can be checked
  // without it, and task content never supplies required sections or
  // companions.
  if (!hasReadGrant(ctx.criteria.checklist_ref, ctx.readGrants)) {
    return refused(task, "READ_DENIED", "error", `read grant missing for checklist source ${ctx.criteria.checklist_ref.repo}/${ctx.criteria.checklist_ref.path}`);
  }
  let checklistResolved;
  try {
    checklistResolved = resolveSourceRef(ctx.criteria.checklist_ref, ctx.sources, budget, "checklist source");
  } catch (e) {
    if (e instanceof ResolutionError) return refused(task, e.code, "error", `checklist source: ${e.message}`);
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }
  const checklistInjection = scanAnyDocText([checklistResolved.text]);
  if (checklistInjection.injected) {
    return refused(task, "INSTRUCTION_INJECTION", "critical", "the trusted checklist source contains a seeded directive family; quarantined, no checklist evaluation is possible without a trustworthy rule source", {
      quarantined_sources: [{ repo: ctx.criteria.checklist_ref.repo, path: ctx.criteria.checklist_ref.path, reason: "INSTRUCTION_INJECTION_SEEDED_FAMILY" }],
    });
  }

  // Resolve the document-set bundle.
  if (!hasReadGrant(validatedTask.document_set_ref, ctx.readGrants)) {
    return refused(task, "READ_DENIED", "error", `read grant missing for document set ${validatedTask.document_set_ref.repo}/${validatedTask.document_set_ref.path}`);
  }
  let bundleResolved;
  try {
    bundleResolved = resolveSourceRef(validatedTask.document_set_ref, ctx.sources, budget, "document set source");
  } catch (e) {
    if (e instanceof ResolutionError) return refused(task, e.code, "error", `document set: ${e.message}`);
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }

  let rawSet;
  try {
    const parsed = JSON.parse(bundleResolved.text);
    rawSet = validateDocumentSetShape(parsed, "document set");
  } catch (e) {
    if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", e.message);
    return refused(task, "INVALID_INPUT", "error", "document set is not valid JSON");
  }

  // ---- Charged pass over documents[]: one countObject() per document,
  // strictly before any field of that document is read. Attempt 65
  // (overall, including the two fixture-source charges above) refuses
  // before that document or any later document is touched at all. ----
  const provisional = [];
  const malformed = [];
  const seenDocIds = new Set();
  let budgetExceeded = false;
  for (let i = 0; i < rawSet.documents.length; i++) {
    try {
      budget.countObject(`document[${i}]`);
    } catch (e) {
      if (e instanceof BudgetError) {
        budgetExceeded = true;
        break;
      }
      throw e;
    }
    const raw = rawSet.documents[i];
    let doc;
    try {
      doc = validateDocument(raw, `document set.documents[${i}]`, budget);
    } catch (e) {
      if (e instanceof BudgetError) {
        budgetExceeded = true;
        break;
      }
      if (e instanceof SchemaError) {
        const fallbackId = raw && typeof raw === "object" && typeof raw.doc_id === "string" ? raw.doc_id : `malformed-index-${i}`;
        malformed.push({ doc_id: fallbackId, reason: "MALFORMED_RECORD" });
        continue;
      }
      throw e;
    }
    // Primary doc IDs duplicated => INVALID_INPUT (whole-task refusal, no
    // partial payload) — distinct from distinct-IDs-identical-content,
    // which is a normal "mismatch" finding (duplicate_groups), not this.
    if (seenDocIds.has(doc.doc_id)) {
      return refused(task, "INVALID_INPUT", "error", `duplicate primary doc_id '${doc.doc_id}'`);
    }
    seenDocIds.add(doc.doc_id);
    provisional.push(doc);
  }
  if (budgetExceeded) {
    return refused(task, "BUDGET_EXCEEDED", "error", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}; refusing before inspecting the remaining documents`);
  }

  // ---- Charged pass over assertions[]: same discipline. ----
  const provisionalAssertions = [];
  const malformedAssertions = [];
  for (let i = 0; i < rawSet.assertions.length; i++) {
    try {
      budget.countObject(`assertion[${i}]`);
    } catch (e) {
      if (e instanceof BudgetError) {
        budgetExceeded = true;
        break;
      }
      throw e;
    }
    const raw = rawSet.assertions[i];
    let a;
    try {
      a = validateAssertion(raw, `document set.assertions[${i}]`);
    } catch (e) {
      if (e instanceof SchemaError) {
        const fallbackId = raw && typeof raw === "object" && typeof raw.assertion_id === "string" ? raw.assertion_id : `malformed-index-${i}`;
        malformedAssertions.push({ assertion_id: fallbackId, reason: "MALFORMED_RECORD" });
        continue;
      }
      throw e;
    }
    provisionalAssertions.push(a);
  }
  if (budgetExceeded) {
    return refused(task, "BUDGET_EXCEEDED", "error", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}; refusing before inspecting the remaining assertions`);
  }

  // ---- Resolve + hash each admitted document's content (one charged
  // object per DISTINCT content SourceRef — identical refs are resolved
  // and charged once, cached by FULL exact identity via fullSourceRefKey
  // (repo+path+commit+blob+algorithm+revision), never a partial prefix.
  // A partial key (repo|path|commit alone) let a later document supply a
  // forged blob/revision at the same repo/path/commit and silently reuse
  // an earlier, unrelated, already-resolved result without its own ref
  // ever being validated — that was DOC-001. ----
  const contentCache = new Map(); // fullSourceRefKey(content_ref) -> {bytes, text}
  const quarantinedDocIds = new Set();
  const docsForIntegrity = [];
  const inventory = [];
  const quarantined_sources = [];
  const usedContentRefs = [];

  for (const doc of provisional) {
    const key = fullSourceRefKey(doc.content_ref);
    let resolved = contentCache.get(key);
    if (!resolved) {
      if (!hasReadGrant(doc.content_ref, ctx.readGrants)) {
        return refused(task, "READ_DENIED", "error", `read grant missing for document ${doc.doc_id} content ${doc.content_ref.repo}/${doc.content_ref.path}`);
      }
      try {
        resolved = resolveSourceRef(doc.content_ref, ctx.sources, budget, `content for ${doc.doc_id}`);
      } catch (e) {
        if (e instanceof ResolutionError) return refused(task, e.code, "error", `document ${doc.doc_id} content: ${e.message}`);
        if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
        throw e;
      }
      contentCache.set(key, resolved);
    }

    const injection = scanAnyDocText([resolved.text, doc.metadata.author, doc.metadata.id, doc.metadata.status]);
    const isQuarantined = injection.injected;
    if (isQuarantined) {
      quarantinedDocIds.add(doc.doc_id);
      quarantined_sources.push({ doc_id: doc.doc_id, reason: "INSTRUCTION_INJECTION_SEEDED_FAMILY" });
    }

    const contentSha256 = sha256HexBytes(resolved.bytes);

    // Verified sections: span-bounds-checked against the ACTUAL resolved
    // content length. A section only "exists" for checklist/reference
    // purposes once its span is verified — metadata/declared claims alone
    // cannot certify a section's existence. Skipped entirely (treated as
    // not-present) for quarantined content, so a hostile document cannot
    // manufacture checklist-satisfying sections.
    const verifiedSections = [];
    if (!isQuarantined) {
      for (const s of doc.sections) {
        try {
          verifySpanBounds(resolved.bytes, s, budget, `section ${doc.doc_id}/${s.section_id}`);
          verifiedSections.push(s);
        } catch (e) {
          if (e instanceof ResolutionError) continue; // out-of-bounds section: not counted present
          if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
          throw e;
        }
      }
    }

    // Metadata-vs-content marker verification.
    let metadata_verification;
    if (isQuarantined) {
      metadata_verification = ["author", "date", "id", "status"].map((key) => ({ key, declared: doc.metadata[key], marker_value: null, evidence_state: "unverifiable" }));
    } else {
      const markerTexts = new Map();
      for (const m of doc.markers) {
        try {
          const span = verifySpanBounds(resolved.bytes, m, budget, `marker ${doc.doc_id}/${m.key}`);
          markerTexts.set(m.key, span.quoted_text);
        } catch (e) {
          if (e instanceof ResolutionError) continue; // out-of-bounds marker: treated as absent (unverifiable)
          if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
          throw e;
        }
      }
      metadata_verification = computeMetadataVerification(doc, markerTexts);
    }

    if (!isQuarantined) usedContentRefs.push(doc.content_ref);

    inventory.push({
      doc_id: doc.doc_id,
      logical_id: doc.logical_id,
      revision: doc.revision,
      declared_date: doc.declared_date,
      metadata: doc.metadata,
      metadata_verification,
      content_sha256: contentSha256,
      quarantined: isQuarantined,
    });

    docsForIntegrity.push({
      doc_id: doc.doc_id,
      logical_id: doc.logical_id,
      revision: doc.revision,
      declared_date: doc.declared_date,
      contentSha256,
      sections: verifiedSections,
      references: doc.references,
      quarantined: isQuarantined,
    });
  }

  // ---- Cross-document conflicts over admitted, non-quarantined
  // assertions whose owning document is itself admitted and clean. ----
  const byDocId = new Map(docsForIntegrity.map((d) => [d.doc_id, d]));
  const contentByDocId = new Map();
  for (const doc of provisional) {
    const key = fullSourceRefKey(doc.content_ref);
    contentByDocId.set(doc.doc_id, contentCache.get(key));
  }
  const contentRefByDocId = new Map(provisional.map((d) => [d.doc_id, d.content_ref]));
  const excluded_assertions = [...malformedAssertions];
  const citedAssertions = [];
  for (const a of provisionalAssertions) {
    const owner = byDocId.get(a.doc_id);
    if (!owner) {
      excluded_assertions.push({ assertion_id: a.assertion_id, reason: "OWNER_DOCUMENT_NOT_ADMITTED" });
      continue;
    }
    if (owner.quarantined) {
      excluded_assertions.push({ assertion_id: a.assertion_id, reason: "OWNER_DOCUMENT_QUARANTINED" });
      continue;
    }
    const ownerBytes = contentByDocId.get(a.doc_id).bytes;
    let span;
    try {
      span = verifySpanBounds(ownerBytes, a.span, budget, `assertion ${a.assertion_id}`);
    } catch (e) {
      if (e instanceof ResolutionError) {
        excluded_assertions.push({ assertion_id: a.assertion_id, reason: "SPAN_MISMATCH" });
        continue;
      }
      if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
      throw e;
    }
    const ref = contentRefByDocId.get(a.doc_id);
    citedAssertions.push({
      assertion_id: a.assertion_id,
      doc_id: a.doc_id,
      subject: a.subject,
      property: a.property,
      scope: a.scope,
      value_type: a.value_type,
      value: a.value,
      citation: {
        repo: ref.repo,
        path: ref.path,
        commit: ref.commit,
        blob: ref.blob,
        algorithm: "git-sha1",
        revision: ref.revision,
        quoted_span: span.quoted_text,
        span,
        verification: "VERIFIED",
      },
    });
  }

  const duplicate_groups = computeDuplicateGroups(docsForIntegrity);
  const version_conflicts = computeVersionConflicts(docsForIntegrity);
  const checklist_results = computeChecklistResults(ctx.criteria, docsForIntegrity);
  const reference_edges = computeReferenceEdges(docsForIntegrity);
  const prereqCycles = detectCycles(docsForIntegrity, "PREREQUISITE").map((path) => ({ kind: "PREREQUISITE", doc_ids: path, status: "MISMATCH", evidence_state: "mismatch" }));
  const citationCycles = detectCycles(docsForIntegrity, "CITATION").map((path) => ({ kind: "CITATION", doc_ids: path, status: "CYCLE_DETECTED", evidence_state: "verified" }));
  const cycles = [...prereqCycles, ...citationCycles];
  const cross_document_conflicts = computeCrossDocumentConflicts(citedAssertions);

  const excluded_ids = [...malformed];
  const admittedCount = provisional.length;
  const excludedCount = excluded_ids.length;
  const totalPopulation = rawSet.documents.length;
  const hasMalformed = malformed.length > 0;

  const populationMatches = validatedTask.population.declared_total === totalPopulation;
  const populationVerified = validatedTask.population.complete === true && populationMatches && !hasMalformed;
  const population = {
    declared_total: validatedTask.population.declared_total,
    complete: validatedTask.population.complete,
    actual_total: totalPopulation,
    evidence_state: !validatedTask.population.complete ? "unverifiable" : hasMalformed ? "mismatch" : populationMatches ? "verified" : "mismatch",
  };

  let coverageState;
  if (admittedCount === 0) coverageState = populationVerified ? "COMPLETE_EMPTY" : "UNKNOWN_EMPTY";
  else coverageState = populationVerified ? "COMPLETE" : "PARTIAL";
  const status = admittedCount === 0 ? "EMPTY" : populationVerified ? "REPORT_READY" : "PARTIAL";

  const report = {
    population,
    inventory,
    duplicate_groups,
    version_conflicts,
    checklist_results,
    reference_edges,
    cycles,
    cross_document_conflicts,
    excluded_ids,
    excluded_assertions,
    coverage: { state: coverageState, admitted_count: admittedCount, excluded_count: excludedCount },
  };

  const source_refs = [];
  const seenRefs = new Set();
  for (const r of [ctx.criteria.checklist_ref, validatedTask.document_set_ref, ...usedContentRefs]) {
    const k = refKey(r);
    if (seenRefs.has(k)) continue;
    seenRefs.add(k);
    source_refs.push({ repo: r.repo, path: r.path, commit: r.commit, blob: r.blob, algorithm: r.algorithm, revision: r.revision });
  }

  const result = envelope(task, {
    status,
    complete: true,
    source_refs,
    diagnostics: [],
    quarantined_sources,
    routing_flags: [],
    report,
  });

  if (outputRecordsOf(result) > BUDGET_LIMITS.maxOutputRecords || canonicalByteLength(result) > BUDGET_LIMITS.maxOutputBytes) {
    return refused(task, "OUTPUT_LIMIT", "error", `final output envelope exceeds the ${BUDGET_LIMITS.maxOutputRecords}-record / ${BUDGET_LIMITS.maxOutputBytes}-byte output bounds`);
  }
  return result;
}

function outputRecordsOf(result) {
  const r = result.report;
  return (
    r.inventory.length +
    r.duplicate_groups.length +
    r.version_conflicts.length +
    r.checklist_results.required_sections.length +
    r.checklist_results.required_companions.length +
    r.reference_edges.length +
    r.cycles.length +
    r.cross_document_conflicts.length +
    r.excluded_ids.length +
    r.excluded_assertions.length +
    result.diagnostics.length +
    result.quarantined_sources.length +
    result.routing_flags.length +
    result.source_refs.length
  );
}

export { validateTask, validateContext, BUDGET_LIMITS, canonicalJson, sha256HexUtf8, makeBudget };
