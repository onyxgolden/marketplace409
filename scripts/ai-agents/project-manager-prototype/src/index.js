// index.js — run(task, context) entry. Builds the public envelope.
// Authority (PM651-001): principal/grant/relay validated before any
// fixture bytes are touched. Citations (PM651-002): host-registered
// SourceRef tuples with real Git blob SHA-1 and exact verified UTF-8
// byte spans. All envelopes (including refusals) are byte-bounded
// (PM651-003). Non-FS/calendar/float requests get named UNSUPPORTED_TASK.

import { canonicalStringify, utf8Length } from './canonical.js';
import { checkTask, checkContext, checkPlanPackage, safeGet } from './schemas.js';
import { Resolver, BudgetExceeded, InputLimit, AuthError, LIMITS, admitGraph } from './resolver.js';
import { scanPackageText } from './injection.js';
import { analyzePlan } from './manager.js';

export const AGENT = 'project-manager';
export const SCHEMA_VERSION = '1';

// Marker for inadmissible IDs in refusals (PM651-003): bounded, documented.
export const INADMISSIBLE_ID_MARKER = '[inadmissible-id]';

function safeTaskId(task) {
  try {
    const v = task && typeof task === 'object' ? safeGet(task, 'task_id', 'task').value : undefined;
    if (typeof v === 'string' && v.length > 0 && v.length <= 1024) return v;
  } catch { /* fall through */ }
  return INADMISSIBLE_ID_MARKER;
}

/**
 * PM651-003: descriptor-safe shallow copy of context EXCLUDING fixtureStore.
 * The fixtureStore subtree is host-trusted and was skipped by admitGraph;
 * serializing it would invoke getters on denied/unselected payloads.
 * After admitGraph, the non-store portion is accessor-free, so this
 * descriptor-safe copy cannot invoke getters.
 */
function contextWithoutStore(context) {
  const out = {};
  for (const k of Object.keys(context)) {
    if (k === 'fixtureStore') continue;
    const desc = Object.getOwnPropertyDescriptor(context, k);
    if (desc && 'value' in desc) {
      out[k] = desc.value;
    }
    // Accessor descriptors are skipped (admitGraph already rejected them,
    // so this is defense-in-depth; they contribute zero bytes).
  }
  return out;
}

export function run(task, context) {
  const started = Date.now();
  try {
    return runInner(task, context, started);
  } catch (e) {
    return refusalEnvelope(task, e, started);
  }
}

function runInner(task, context, started) {
  // 0. Budget FIRST — before any validation inspects candidates.
  // PM651-003: bounded own-data-descriptor admission of the task and
  // context graphs BEFORE serialization or any field read. Getters are
  // rejected here with zero invocations; every admitted object is charged.
  // The host-trusted fixtureStore subtree is not deep-charged (it is large
  // and not task-controlled); its top-level descriptor is still checked.
  const resolver = new Resolver(null);
  try {
    if (task !== undefined && task !== null) admitGraph(task, resolver, 'task');
    if (context !== undefined && context !== null) {
      admitGraph(context, resolver, 'context', (path) => path === 'fixtureStore');
      // Shallow accessor check on fixtureStore itself (not deep-charged).
      const fsDesc = Object.getOwnPropertyDescriptor(context, 'fixtureStore');
      if (fsDesc && (typeof fsDesc.get === 'function' || typeof fsDesc.set === 'function')) {
        const e = new Error('ACCESSOR_REJECTED: context.fixtureStore is a getter/setter');
        e.code = 'ACCESSOR_REJECTED';
        throw e;
      }
    }
  } catch (e) {
    // Admission failures (accessor, budget, depth) fail closed.
    throw e;
  }
  const store = (context && typeof context === 'object' && !Array.isArray(context))
    ? safeGet(context, 'fixtureStore', 'context').value || {}
    : {};
  resolver.store = store;

  // Pre-flight: bound fixture_refs length via descriptor-safe length read
  // (does not trigger element getters) before serialization.
  try {
    const preRefs = task && typeof task === 'object' ? safeGet(task, 'fixture_refs', 'task').value : undefined;
    if (Array.isArray(preRefs)) {
      const lenDesc = Object.getOwnPropertyDescriptor(preRefs, 'length');
      const len = lenDesc && typeof lenDesc.value === 'number' ? lenDesc.value : 0;
      if (len > 64) {
        const e = new Error('BUDGET_EXCEEDED: fixture_refs length exceeds 64');
        e.code = 'BUDGET_EXCEEDED';
        throw e;
      }
    }
  } catch (e) {
    if (e.code === 'BUDGET_EXCEEDED') throw e;
    // Fall through to normal validation on accessor issues.
  }

  // Serialized task/context bytes are charged as input (PM651-003).
  // Both graphs are already admitted (accessors rejected, objects charged)
  // so serialization cannot invoke getters. The fixtureStore is NEVER
  // serialized: it was skipped by admitGraph, and canonicalizing it would
  // evaluate getters on denied/unselected payloads before authorization.
  // Context metadata (excluding the store) counts against the same 256KiB
  // input budget as the task.
  const taskBytes = canonicalStringify(task === undefined ? null : task);
  resolver.chargeInputBytes(utf8Length(taskBytes));
  const contextForBytes = (context !== undefined && context !== null && typeof context === 'object' && !Array.isArray(context))
    ? contextWithoutStore(context)
    : context;
  const contextBytes = canonicalStringify(contextForBytes === undefined ? null : contextForBytes);
  resolver.chargeInputBytes(utf8Length(contextBytes));

  // 1. Validate task + context envelopes (charged, descriptor-safe).
  let tc;
  try {
    tc = checkTask(task, resolver);
  } catch (e) {
    if (e.code === 'BUDGET_EXCEEDED' || e.code === 'INPUT_LIMIT' || e.code === 'ACCESSOR_REJECTED') throw e;
    return invalidInput(task, ['task validation failed'], started, resolver);
  }
  if (!tc.ok) {
    if (tc.oversizedId) return oversizedIdRefusal(task, started, resolver);
    return invalidInput(task, tc.errors, started, resolver);
  }
  let cc;
  try {
    cc = checkContext(context, resolver);
  } catch (e) {
    if (e.code === 'BUDGET_EXCEEDED' || e.code === 'INPUT_LIMIT' || e.code === 'ACCESSOR_REJECTED') throw e;
    return invalidInput(task, ['context validation failed'], started, resolver);
  }
  if (!cc.ok) return invalidInput(task, cc.errors, started, resolver);

  // 1b. Unsupported operations -> named refusal (PM651-007).
  const op = safeGet(task, 'operation', 'task').value;
  if (op !== 'analyze') {
    return namedRefusal(task, 'UNSUPPORTED_TASK', `operation "${op}" not supported; only "analyze"`, started, resolver);
  }

  const diagnostics = [];
  const quarantined = [];
  const sourceRefs = [];
  const packages = [];
  let partial = false;

  // 2. Resolve each fixture ref (authority checked before bytes; PM651-001).
  const refs = safeGet(task, 'fixture_refs', 'task').value;
  for (let ri = 0; ri < refs.length; ri++) {
    const ref = safeGet(refs, String(ri), 'task.fixture_refs').value;
    resolver.chargeObject(); // each ref candidate charged before use
    let resolved;
    try {
      resolved = resolver.resolve(ref, context);
    } catch (e) {
      if (e.code === 'READ_DENIED') {
        diagnostics.push(mkdiag('READ_DENIED', 'high', null, `fixture ${ref}: not registered`, null));
        partial = true;
        continue;
      }
      if (e.code === 'AUTH_UNVERIFIED' || e.code === 'AUTHZ_DENIED') {
        // Fail closed on authority; no bytes touched (PM651-001).
        return denied(task, e.code, e.message, started, resolver);
      }
      throw e; // BUDGET_EXCEEDED / INPUT_LIMIT / HASH_MISMATCH / BLOB_MISMATCH -> refusal
    }
    const pkg = resolved.record;
    let pc;
    try {
      pc = checkPlanPackage(pkg, resolver);
    } catch (e) {
      if (e.code === 'BUDGET_EXCEEDED' || e.code === 'INPUT_LIMIT' || e.code === 'ACCESSOR_REJECTED') throw e;
      return invalidInput(task, ['package validation failed'], started, resolver);
    }
    if (!pc.ok) {
      // Structural corruption -> named refusal, no partial domain payload (PM651-007).
      return namedRefusal(task, 'INVALID_INPUT', `package ${ref}: ${pc.errors[0]}`, started, resolver);
    }
    // Injection scan on free-text notes -> quarantine record text.
    // Quarantined text is EXCLUDED from citations (PM651-002).
    const hits = scanPackageText(pkg);
    const quarantinedIds = new Set();
    for (const h of hits) {
      quarantinedIds.add(h.record_id);
      quarantined.push({ fixture_id: ref, record_id: h.record_id, families: h.families });
      diagnostics.push(mkdiag('INSTRUCTION_INJECTION', 'high', h.record_id,
        `quarantined note text (${h.families.join(',')})`, null));
    }
    // Exact citation: whole-fixture span, verified under the span budget.
    // Quarantined records are cited with explicit exclusion.
    // PM651-002: quoted_span equals span.quoted_text exactly (no truncation);
    // verification lives at the Citation level per the brief contract.
    const span = resolver.verifySpan(resolved.bytes, 0, Buffer.byteLength(resolved.bytes, 'utf8'));
    const sourceRef = {
      ...resolved.source_ref,
      quoted_span: span.quoted_text,
      span,
      verification: 'VERIFIED',
    };
    sourceRefs.push(stripSpanForList(sourceRef));
    packages.push({ ref, pkg, citation: sourceRef, bytes: resolved.bytes, quarantinedIds });
    resolver.chargeOutputRecord();
  }

  // 3. Analyze each admitted package.
  const reports = [];
  // PM651-006: host-established population (if declared in context).
  const population = (() => {
    try {
      const p = safeGet(context, 'population', 'context').value;
      return (p && typeof p === 'object') ? p : null;
    } catch { return null; }
  })();
  for (const p of packages) {
    const analysis = analyzePlan(p.pkg, resolver, p.bytes, p.citation, population);
    // Attach exact per-finding citations (PM651-002); quarantined records
    // get explicit exclusion instead of support.
    // PM651-002: quoted_span equals span.quoted_text exactly (no truncation);
    // verification at the Citation level. Aggregate findings (no record_id)
    // get the whole-fixture verified span as their basis, not a bare
    // 'verified' claim.
    const baseCite = stripSpanForList(p.citation);
    for (const f of analysis.findings) {
      if (f.record_id && p.quarantinedIds.has(f.record_id)) {
        f.source_ref = { ...baseCite, excluded: 'quarantined' };
        f.evidence_state = 'unavailable-quarantined';
      } else if (f.record_id) {
        const recSpan = resolver.findRecordSpan(p.bytes, f.record_key || 'task_id', f.record_id);
        if (recSpan) {
          const vs = resolver.verifySpan(p.bytes, recSpan[0], recSpan[1]);
          f.source_ref = {
            ...baseCite,
            quoted_span: vs.quoted_text,
            span: vs,
            verification: 'VERIFIED',
          };
          f.evidence_state = 'verified';
        } else {
          f.source_ref = { ...baseCite, evidence_state: 'unavailable-record-span' };
          f.evidence_state = 'unavailable-record-span';
        }
      } else {
        // Aggregate finding: whole-fixture span is the verified basis.
        f.source_ref = {
          ...baseCite,
          quoted_span: p.citation.quoted_span,
          span: p.citation.span,
          verification: 'VERIFIED',
        };
        f.evidence_state = 'verified-aggregate';
      }
      if (!f.evidence_state) f.evidence_state = 'verified';
    }
    reports.push({ plan_id: p.pkg.plan_id, citation: p.citation, ...analysis });
    if (analysis.status === 'PARTIAL') partial = true;
    resolver.chargeOutputRecord();
    // PM651-003 (fix round 5): charge every nested public output record.
    // The 256-record budget applies to all returned records, not just
    // the top-level report wrappers.
    const nestedArrays = [
      analysis.findings,
      analysis.orphans,
      analysis.milestones,
      analysis.resourceAssessments,
      analysis.resourceConflicts,
      analysis.citations,
      analysis.diagnostics,
    ];
    for (const arr of nestedArrays) {
      if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) {
          resolver.chargeOutputRecord();
        }
      }
    }
  }

  // 4. Draft summary (inert, no approval/tasking language).
  let draft = null;
  const includeDraft = safeGet(safeGet(task, 'options', 'task').value || {}, 'include_draft_summary', 'opts').value;
  if (includeDraft === true && reports.length) {
    draft = reports.map((r) =>
      `DRAFT plan-health summary for ${r.plan_id}: status ${r.status}, ` +
      `${r.findings.length} finding(s), ${r.orphans.length} orphan task(s), ` +
      `completion ${r.completion ? `${r.completion.complete}/${r.completion.total}` : 'n/a'}. ` +
      `Advisory only — no tasking, commitment, or authorization language.`
    ).join('\n');
  }

  const envelope = {
    schema_version: SCHEMA_VERSION,
    agent: AGENT,
    task_id: safeTaskId(task),
    status: partial ? 'PARTIAL' : 'REPORT_READY',
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete: false, // computed below from verified coverage (PM651-006)
    source_refs: sourceRefs,
    diagnostics,
    quarantined_sources: quarantined,
    routing_flags: [],
    report: { plans: reports, draft_summary: draft },
  };
  // Completeness reflects verified coverage (PM651-006): true only if every
  // plan is REPORT_READY with no UNVERIFIABLE findings and no quarantine.
  const allReady = reports.length > 0 && reports.every((r) =>
    r.status === 'REPORT_READY' &&
    !(r.findings || []).some((f) => f.severity === 'UNVERIFIABLE') &&
    !(r.completion && r.completion.verified === false));
  const noQuarantine = quarantined.length === 0;
  envelope.complete = !partial && allReady && noQuarantine;

  // Output bound on the EXACT final envelope (PM651-003).
  const outBytes = utf8Length(canonicalStringify(envelope));
  if (outBytes > LIMITS.maxOutputBytes) throw outputLimitErr();
  return envelope;
}

function stripSpanForList(ref) {
  const { quoted_span, span, ...rest } = ref;
  return rest;
}

function mkdiag(code, severity, record_id, reason, source_ref) {
  return { code, severity, record_id, source_ref: source_ref || null, reason };
}

function baseEnvelope(task, started) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT,
    task_id: safeTaskId(task),
    advisory: true, fixture_only: true, authorization_granted: false,
    complete: false, source_refs: [], diagnostics: [],
    quarantined_sources: [], routing_flags: [],
  };
}

/** Bound an envelope's serialized size; replace with minimal refusal if over. */
function boundEnvelope(env, resolver) {
  try {
    const n = utf8Length(canonicalStringify(env));
    if (n <= LIMITS.maxOutputBytes) return env;
  } catch { /* fall through to minimal */ }
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT,
    task_id: INADMISSIBLE_ID_MARKER,
    status: 'REFUSED',
    advisory: true, fixture_only: true, authorization_granted: false,
    complete: false, source_refs: [], diagnostics: [],
    quarantined_sources: [], routing_flags: [],
    report: null,
    note: 'OUTPUT_LIMIT',
  };
}

function invalidInput(task, errors, started, resolver) {
  const e = baseEnvelope(task, started);
  e.status = 'REFUSED';
  for (const err of errors) e.diagnostics.push(mkdiag('INVALID_INPUT', 'high', null, err, null));
  e.report = null;
  return boundEnvelope(e, resolver);
}

function oversizedIdRefusal(task, started, resolver) {
  const e = baseEnvelope(task, started);
  e.status = 'REFUSED';
  e.diagnostics.push(mkdiag('INPUT_LIMIT', 'high', null, 'task_id exceeds 1024 chars; use bounded marker', null));
  e.report = null;
  return boundEnvelope(e, resolver);
}

function namedRefusal(task, code, reason, started, resolver) {
  const e = baseEnvelope(task, started);
  e.status = 'REFUSED';
  e.diagnostics.push(mkdiag(code, 'high', null, reason, null));
  e.report = null;
  return boundEnvelope(e, resolver);
}

function denied(task, code, reason, started, resolver) {
  const e = baseEnvelope(task, started);
  e.status = 'REFUSED';
  e.diagnostics.push(mkdiag(code, 'high', null, reason, null));
  e.report = null;
  return boundEnvelope(e, resolver);
}

function refusalEnvelope(task, e, started) {
  const env = baseEnvelope(task, started);
  env.status = 'REFUSED';
  const code = e && e.code ? e.code : 'INTERNAL_ERROR';
  env.diagnostics.push(mkdiag(code, 'high', null, String((e && e.message) || e).slice(0, 200), null));
  env.report = null;
  return boundEnvelope(env, null);
}

function outputLimitErr() { const e = new Error('OUTPUT_LIMIT'); e.code = 'OUTPUT_LIMIT'; return e; }
