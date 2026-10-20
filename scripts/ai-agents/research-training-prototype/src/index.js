/**
 * index.js — public entry for the Research Training Agent prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. DRAFT lesson outlines, extractive
 * summaries and passage-derived short-answer quizzes over invented
 * source bundles. Every taught statement, question and keyed answer
 * carries an exact byte-span passage citation; anything unsupported
 * is a gap or an explicitly rejected key, never taught. Research v2
 * taxonomy (contradicted > supported > attributed-only > unsupported)
 * decides what may be taught. All output is labeled
 * "DRAFT — NOT PUBLISHED". No multiple-choice distractors, no
 * freeform synthesis, no inference across passages, no model, no
 * web/LMS/publishing/enrollment.
 *
 * Budget discipline: every candidate object — the task, EVERY element
 * of the injected trusted context (sources, grants, principal, aliases,
 * criteria/templates, provenance declarations) — is charged as the
 * FIRST statement before any of its own fields are read. Attempt 65
 * refuses before that candidate (or any later one) is inspected at
 * all. After the grant gate, only exactly-granted source bytes are
 * admitted; a denied source's bytes are never touched.
 */

import { canonicalJson, canonicalByteLength } from "./canonical.js";
import {
  validateTask, validateGrantGateContext, validateSelectedSourceEntry,
  assertNoNativeProxies, admitGraph, SchemaError,
} from "./schemas.js";
import { resolveSourceRef, hasReadGrant, makeBudget, verifySpan, BudgetError, ResolutionError, BUDGET_LIMITS } from "./resolver.js";
import { scanTexts } from "./injection.js";
import {
  assertionKey, keyLabel, evidenceRoot, deriveKeyStatuses,
  buildQuestion, buildCompositeQuestion, buildStatement,
} from "./verify.js";
import { types } from "node:util";

export const AGENT_ID = "research-training-agent";
export const SCHEMA_VERSION = "1";
export const DRAFT_LABEL = "DRAFT — NOT PUBLISHED";

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
    draft_label: DRAFT_LABEL,
    coverage: [],
    lessons: [],
    quizzes: [],
    composites: [],
    gaps: [],
    rejected_keys: [],
    contradiction_notes: [],
    provenance: { groups: [], independence_notes: [] },
  };
}

function diagnostic(code, severity, reason, record_id = null, source_ref = null) {
  return { code, severity, source_ref, record_id, reason };
}

/**
 * One bounded final-envelope record walk implementing the brief's
 * public-record taxonomy. Counts every returned record once per
 * emitted occurrence:
 *
 *   report record ................... the report object itself
 *   coverage records ................ each coverage[] element
 *   lesson records .................. each lessons[] element
 *   statement records ............... each lesson.statements[] element
 *   quiz records .................... each quizzes[] element
 *   composite records ............... each composites[] element
 *   composite-key-part records ...... key.first / key.second of each
 *   citation records ................ every emitted citation
 *   span records .................... every span nested in a citation
 *   source-ref records .............. every emitted source_ref
 *   gap records ..................... each gaps[] element
 *   rejected-key records ............ each rejected_keys[] element
 *   contradiction-note records ...... each contradiction_notes[] element
 *   diagnostic records .............. each diagnostics[] entry
 *   exclusion records ............... each quarantined_sources[] entry
 *
 * Per-occurrence counting: the walk runs over the SERIALIZED envelope.
 * Unserializable input fails closed to +Infinity.
 */
const OUTPUT_WALK_NODE_CAP = 200000;
let outputPrefill = 0;

export function setOutputPrefill(n) {
  outputPrefill = n;
}

export function countFinalEnvelopeRecords(env) {
  let tree;
  try {
    tree = JSON.parse(canonicalJson(env));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  let count = outputPrefill;
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
    obj(r.coverage, () => { for (const c of r.coverage ?? []) obj(c, () => rec()); });
    obj(r.lessons, () => {
      for (const l of r.lessons ?? []) obj(l, () => {
        rec(); // lesson record
        obj(l.statements, () => {
          for (const s of l.statements ?? []) obj(s, () => {
            rec(); // statement record
            walkCitation(s.citation);
          });
        });
      });
    });
    obj(r.quizzes, () => {
      for (const q of r.quizzes ?? []) obj(q, () => {
        rec(); // quiz record
        obj(q.citations, () => { for (const c of q.citations ?? []) walkCitation(c); });
      });
    });
    obj(r.composites, () => {
      for (const c of r.composites ?? []) obj(c, () => {
        rec(); // composite record
        obj(c.key, (k) => {
          obj(k.first, () => rec()); // key-part record
          obj(k.second, () => rec()); // key-part record
        });
        obj(c.citations, () => { for (const x of c.citations ?? []) walkCitation(x); });
      });
    });
    obj(r.gaps, () => { for (const g of r.gaps ?? []) obj(g, () => rec()); });
    obj(r.rejected_keys, () => { for (const k of r.rejected_keys ?? []) obj(k, () => rec()); });
    obj(r.contradiction_notes, () => { for (const n of r.contradiction_notes ?? []) obj(n, () => { rec(); obj(n.citations, () => { for (const c of n.citations ?? []) walkCitation(c); }); }); });
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

/**
 * Byte-exact span proof at the CLAIMED offsets. The quoted text must
 * equal the exact UTF-8 slice at [start_byte, end_byte), and the
 * re-encoded text must reproduce the original bytes (no split
 * multi-byte sequences). Charges the span before inspection.
 */
function verifyClaimedSpan(bytes, startByte, endByte, quotedText, budget, what) {
  budget.countSpan(what);
  if (startByte < 0 || endByte > bytes.length || endByte <= startByte) {
    throw new ResolutionError("SPAN_MISMATCH", `span [${startByte},${endByte}) out of bounds (${what})`);
  }
  const slice = bytes.subarray(startByte, endByte);
  const text = slice.toString("utf8");
  if (text !== quotedText) {
    throw new ResolutionError("SPAN_MISMATCH", `quoted text does not match bytes at claimed offsets (${what})`);
  }
  if (!Buffer.from(text, "utf8").equals(slice)) {
    throw new ResolutionError("SPAN_MISMATCH", `quoted text splits a UTF-8 sequence (${what})`);
  }
  return { start_byte: startByte, end_byte: endByte, quoted_text: quotedText };
}

export function run(task, context) {
  const budget = makeBudget();
  try {
    assertNoNativeProxies(task, "task");
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
  const request = validatedTask.request;

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
      `prohibited operation '${validatedTask.operation}': this agent only supports 'analyze' (draft passage-derived training material and return an advisory report); it cannot execute commands, browse, publish, or mutate any record`
    );
  }

  // No multiple-choice distractors in this slice: a requested MC task
  // is UNSUPPORTED_TASK, never invented alternatives.
  if (request.question_format === "multiple_choice") {
    return boundedRefused(
      taskId,
      "UNSUPPORTED_TASK",
      "error",
      "multiple-choice distractors are not supported in this slice; short-answer only"
    );
  }

  let gate;
  try {
    gate = validateGrantGateContext(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  setOutputPrefill(gate.test_hooks?.prefill_output_records ?? 0);
  if (gate.test_hooks?.prefill_spans) budget.applySpanPrefill(gate.test_hooks.prefill_spans);

  // Truly no request/source content => EMPTY.
  if (request.topics.length === 0 && request.assertions.length === 0 && validatedTask.source_refs.length === 0) {
    return envelope(taskId, { status: "EMPTY", complete: true, report: emptyReport() });
  }

  // Resolve granted sources (exact read grant first; denied sources
  // contribute nothing — their bytes are never touched).
  const resolved = new Map(); // key "repo|path" -> {ref, text, bytes, granted}
  const deniedSources = [];
  const emittedRefs = [];
  for (let i = 0; i < validatedTask.source_refs.length; i++) {
    const ref = validatedTask.source_refs[i];
    const key = `${ref.repo}|${ref.path}`;
    if (resolved.has(key)) {
      budget.countObject(`repeat consultation ${key}`);
      continue;
    }
    if (!hasReadGrant(ref, gate.readGrants)) {
      deniedSources.push(key);
      resolved.set(key, { ref, granted: false });
      continue;
    }
    // An unregistered source key is SOURCE_UNVERIFIED (the resolver
    // reports it); selected-entry validation only runs for registered
    // keys.
    if (Object.prototype.hasOwnProperty.call(context.sources, key)) {
      try {
        validateSelectedSourceEntry(context, budget, key);
      } catch (e) {
        if (e instanceof SchemaError) {
          return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
        }
        if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
        throw e;
      }
    }
    try {
      const r = resolveSourceRef(ref, context.sources, budget, `source_refs[${i}]`);
      resolved.set(key, { ref, text: r.text, bytes: r.bytes, granted: true });
      emittedRefs.push(sourceRefOut(ref));
    } catch (e) {
      if (e instanceof ResolutionError) {
        return boundedRefused(taskId, e.code === "HASH_MISMATCH" ? "HASH_MISMATCH" : "SOURCE_UNVERIFIED", "error", e.message);
      }
      if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
      throw e;
    }
  }

  // Quarantine: scan the FULL resolved source text for seeded
  // injection families. A hit excludes the source's text and support.
  const quarantined = new Set();
  const quarantineRecords = [];
  for (const [key, r] of resolved) {
    if (!r.granted) continue;
    const { hit, families } = scanTexts([r.text]);
    if (hit) {
      quarantined.add(key);
      quarantineRecords.push({ record_id: key, families, reason: "seeded injection family detected; text and support quarantined" });
    }
  }

  // Admit assertions: span proof + grammar-token match + grant +
  // non-quarantined passage. Span/content mismatches are structural
  // INVALID_INPUT (the assertion disagrees with its passage).
  const admitted = [];
  try {
    for (let i = 0; i < request.assertions.length; i++) {
      const a = request.assertions[i];
      if (a.source_index >= validatedTask.source_refs.length) {
        return boundedRefused(taskId, "INVALID_INPUT", "error", `assertions[${i}]: source_index out of range`);
      }
      const ref = validatedTask.source_refs[a.source_index];
      const key = `${ref.repo}|${ref.path}`;
      const entry = resolved.get(key);
      if (!entry || !entry.granted) {
        // Denied source: the assertion cannot be taught; recorded as a gap below.
        admitted.push({ ...a, _sourceKey: key, _denied: true });
        continue;
      }
      if (quarantined.has(key)) {
        admitted.push({ ...a, _sourceKey: key, _quarantined: true });
        continue;
      }
      verifyClaimedSpan(
        entry.bytes,
        a.span.start_byte, a.span.end_byte, a.span.quoted_text,
        budget, `assertions[${i}]`
      );
      // Controlled grammar: the quoted passage line must be exactly
      // "subject | predicate | value | scope".
      const parts = a.span.quoted_text.split(" | ");
      if (parts.length !== 4 ||
          parts[0] !== a.subject || parts[1] !== a.predicate ||
          parts[2] !== a.value || parts[3] !== a.scope) {
        return boundedRefused(taskId, "INVALID_INPUT", "error",
          `assertions[${i}]: span text does not parse as 'subject | predicate | value | scope' matching the assertion tokens`);
      }
      admitted.push({ ...a, _sourceKey: key });
    }
  } catch (e) {
    if (e instanceof ResolutionError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    throw e;
  }

  // Research v2 taxonomy over admitted, non-denied, non-quarantined assertions.
  const teachable = admitted.filter((a) => !a._denied && !a._quarantined);
  const statuses = deriveKeyStatuses(teachable, gate.provenance.sources);
  const statusOfAssertion = (a) => statuses.get(assertionKey(a))?.status ?? "unsupported";

  const lessons = [];
  const lessonQuizCounts = [];
  const quizzes = [];
  const composites = [];
  const gaps = [];
  const rejectedKeys = [];
  const contradictionNotes = [];
  const diagnostics = [];
  for (const key of deniedSources) {
    diagnostics.push(diagnostic("SOURCE_DENIED", "warning", `exact read grant missing for '${key}'; its assertions cannot be taught`, key));
  }

  // Per-topic teaching. Stable topic order; stable assertion order.
  const assertionById = new Map(admitted.map((a) => [a.assertion_id, a]));
  const keyNotes = new Map(); // key -> contradiction note (emitted once)
  const quizEmitted = new Set(); // assertion_id — quizzes are unique per assertion
  for (const topic of request.topics) {
    const predSet = new Set(topic.predicates);
    const atoms = teachable.filter((a) => predSet.has(a.predicate));
    const statements = [];
    const taughtByKey = new Set();
    let taughtAny = false;
    let quizzesThisTopic = 0;
    for (const a of atoms) {
      const st = statusOfAssertion(a);
      if (st === "contradicted") {
        if (!keyNotes.has(assertionKey(a))) {
          const note = statuses.get(assertionKey(a));
          const citations = note.assertions.map((x) => ({
            source_ref: sourceRefOut(validatedTask.source_refs[x.source_index]),
            span: { start_byte: x.span.start_byte, end_byte: x.span.end_byte, quoted_text: x.span.quoted_text },
            research_status: "contradicted",
          }));
          keyNotes.set(assertionKey(a), keyLabel(a));
          contradictionNotes.push({
            key: keyLabel(a),
            citations,
            reason: "passages disagree on value or polarity; both sides cited, no quiz or answer emitted",
            draft_label: DRAFT_LABEL,
          });
        }
        continue;
      }
      if (st === "unsupported") continue;
      // Dedup: one statement+quiz per unique (key) — repeated
      // identical attestations of the same key teach once.
      const k = assertionKey(a);
      if (taughtByKey.has(k)) continue;
      taughtByKey.add(k);
      taughtAny = true;
      const tmpl = gate.criteria.templates[a.predicate];
      const statement = {
        text: buildStatement(st, a),
        draft_label: DRAFT_LABEL,
        citation: {
          source_ref: sourceRefOut(validatedTask.source_refs[a.source_index]),
          span: { start_byte: a.span.start_byte, end_byte: a.span.end_byte, quoted_text: a.span.quoted_text },
          research_status: st,
        },
      };
      statements.push(statement);
      if (!quizEmitted.has(a.assertion_id)) {
        quizEmitted.add(a.assertion_id);
        quizzes.push({
          item_id: `q-${a.assertion_id}`,
          question: buildQuestion(tmpl, a),
          key: { value_token: a.value, polarity: a.polarity },
          citations: [statement.citation],
          research_status: st,
          draft_label: DRAFT_LABEL,
        });
        quizzesThisTopic += 1;
      }
    }
    // Headline lesson for the topic.
    const firstTmpl = atoms.length > 0 ? gate.criteria.templates[atoms[0].predicate] : undefined;
    lessons.push({
      topic_id: topic.topic_id,
      heading: firstTmpl ? firstTmpl.lesson_heading : topic.topic_id,
      statements,
      draft_label: DRAFT_LABEL,
    });
    lessonQuizCounts.push({ topic_id: topic.topic_id, quizzes: quizzesThisTopic });
    const covered = taughtAny;
    if (!covered) {
      gaps.push({
        topic_id: topic.topic_id,
        reason: atoms.length === 0 ? "no admitted assertions for the requested predicates"
          : "admitted assertions are contradicted, denied or quarantined",
        draft_label: DRAFT_LABEL,
      });
    }
  }

  // Quarantined assertions: rejected keys.
  for (const a of admitted.filter((a) => a._quarantined)) {
    rejectedKeys.push({
      item_id: a.assertion_id,
      code: "KEY_QUARANTINED",
      reason: `assertion's passage quarantined (injection family); key rejected, never taught`,
      draft_label: DRAFT_LABEL,
    });
  }
  for (const a of admitted.filter((a) => a._denied)) {
    rejectedKeys.push({
      item_id: a.assertion_id,
      code: "KEY_DENIED_SOURCE",
      reason: `assertion's source lacks an exact read grant; key rejected`,
      draft_label: DRAFT_LABEL,
    });
  }

  // Multi-passage composites: exactly two distinct admitted atoms,
  // each with its own verified citation; keyed as an ordered pair.
  for (const c of request.composite_requests) {
    const [idA, idB] = c.atom_refs;
    const a = assertionById.get(idA);
    const b = assertionById.get(idB);
    const fail = (code, reason) => rejectedKeys.push({ item_id: c.item_id, code, reason, draft_label: DRAFT_LABEL });
    if (!a || !b) { fail("KEY_UNKNOWN_ATOM", `composite references unknown atom id`); continue; }
    if (a._quarantined || b._quarantined) { fail("KEY_QUARANTINED", "composite atom's passage quarantined; no definitive composite question"); continue; }
    if (a._denied || b._denied) { fail("KEY_DENIED_SOURCE", "composite atom's source denied; no definitive composite question"); continue; }
    const sa = statusOfAssertion(a);
    const sb = statusOfAssertion(b);
    if (sa === "contradicted" || sb === "contradicted") {
      fail("KEY_CONTRADICTED", "composite atom contradicted; no definitive composite question"); continue;
    }
    if (sa === "unsupported" || sb === "unsupported") {
      fail("KEY_UNSUPPORTED", "composite atom unsupported; no definitive composite question"); continue;
    }
    composites.push({
      item_id: c.item_id,
      question: buildCompositeQuestion(a, b),
      key: {
        first: { value_token: a.value, polarity: a.polarity },
        second: { value_token: b.value, polarity: b.polarity },
      },
      citations: [
        {
          source_ref: sourceRefOut(validatedTask.source_refs[a.source_index]),
          span: { start_byte: a.span.start_byte, end_byte: a.span.end_byte, quoted_text: a.span.quoted_text },
          research_status: sa,
        },
        {
          source_ref: sourceRefOut(validatedTask.source_refs[b.source_index]),
          span: { start_byte: b.span.start_byte, end_byte: b.span.end_byte, quoted_text: b.span.quoted_text },
          research_status: sb,
        },
      ],
      constituent_statuses: [sa, sb],
      draft_label: DRAFT_LABEL,
    });
  }

  // Proposed answer-key claims: the derived key stands; a disagreeing
  // proposal is rejected KEY_UNSUPPORTED, never repaired.
  for (const p of request.proposed_keys) {
    const a = assertionById.get(p.assertion_id);
    if (!a || a._denied || a._quarantined) {
      rejectedKeys.push({ item_id: p.assertion_id, code: "KEY_REJECTED", reason: "proposed key references an untaught assertion; rejected", draft_label: DRAFT_LABEL });
      continue;
    }
    const st = statusOfAssertion(a);
    if (st !== "supported" && st !== "attributed-only") {
      rejectedKeys.push({ item_id: p.assertion_id, code: "KEY_REJECTED", reason: `proposed key references a ${st} assertion; rejected`, draft_label: DRAFT_LABEL });
      continue;
    }
    if (p.proposed_value !== a.value) {
      rejectedKeys.push({
        item_id: p.assertion_id,
        code: "KEY_UNSUPPORTED",
        reason: `proposed value '${p.proposed_value.slice(0, 120)}' disagrees with the passage-derived value token; rejected, no repair from memory`,
        draft_label: DRAFT_LABEL,
      });
    }
  }

  // Coverage: the requested-topic population is fixed — gaps stay listed.
  const coverage = request.topics.map((t) => {
    const lesson = lessons.find((l) => l.topic_id === t.topic_id);
    const g = gaps.find((g2) => g2.topic_id === t.topic_id);
    return {
      topic_id: t.topic_id,
      taught_statements: lesson ? lesson.statements.length : 0,
      taught_quizzes: lessonQuizCounts.find((c) => c.topic_id === t.topic_id)?.quizzes ?? 0,
      status: lesson && lesson.statements.length > 0 ? (g ? "partial" : "full") : "gap",
    };
  });

  const provenance = {
    groups: [...new Set(teachable.map((a) => gate.provenance.sources[a._sourceKey]?.group ?? "unknown"))].sort(),
    independence_notes: teachable.length > 0 ? [
      "support counted by evidence roots (transitive copied_from closure), not passages",
      "duplicate passages, known copies and citation cycles contribute no independent support",
    ] : [],
  };

  const report = {
    draft_label: DRAFT_LABEL,
    coverage,
    lessons,
    quizzes,
    composites,
    gaps,
    rejected_keys: rejectedKeys,
    contradiction_notes: contradictionNotes,
    provenance,
  };

  const taughtCount = lessons.reduce((n, l) => n + l.statements.length, 0);
  let status;
  if (teachable.length === 0) {
    status = "PARTIAL";
    diagnostics.push(diagnostic("INSUFFICIENT_EVIDENCE", "warning", "sources admitted but zero valid assertions; no material drafted"));
  } else if (taughtCount > 0) {
    status = gaps.length > 0 ? "PARTIAL" : "REPORT_READY";
  } else {
    status = "PARTIAL";
    diagnostics.push(diagnostic("INSUFFICIENT_EVIDENCE", "warning", "no teachable material; all assertions contradicted, denied or quarantined"));
  }

  const out = envelope(taskId, {
    status,
    complete: status === "REPORT_READY",
    source_refs: emittedRefs,
    diagnostics,
    quarantined_sources: quarantineRecords,
    report,
  });

  try {
    const recordCount = countFinalEnvelopeRecords(out);
    if (recordCount > BUDGET_LIMITS.maxOutputRecords) {
      return boundedRefused(taskId, "OUTPUT_LIMIT", "error",
        `public envelope holds ${recordCount} records (limit ${BUDGET_LIMITS.maxOutputRecords}); refusing with no partial domain artifact`);
    }
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    throw e;
  }
  if (canonicalByteLength(out) > BUDGET_LIMITS.maxOutputBytes) {
    return boundedRefused(taskId, "OUTPUT_LIMIT", "error",
      `public envelope exceeds ${BUDGET_LIMITS.maxOutputBytes} bytes; refusing with no partial domain artifact`);
  }
  return out;
}
