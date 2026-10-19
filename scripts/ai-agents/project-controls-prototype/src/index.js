// index.js — run(task, context) entry. Builds the public envelope.
// Advisory JSON only; no filesystem/shell/network/send capability.

import { canonicalStringify, utf8Length } from './canonical.js';
import { checkTask, checkContext, checkPackage, checkSourceRef } from './schemas.js';
import { Resolver, BudgetExceeded, InputLimit, LIMITS, verifySourceRef } from './resolver.js';
import { recognizeInjections } from './injection.js';
import { analyzePackage, poolByCurrency } from './controls.js';
import { measureInputBytes, getOwnData } from './admission.js';

export const AGENT = 'project-controls';
export const SCHEMA_VERSION = '1';

/**
 * run(task, context) -> result envelope.
 * context carries the injected host adapter: { clock, criteria_version,
 * principal, grants, request_authority, fixtureStore }.
 * fixtureStore is host-injected and trusted; task content cannot replace it.
 */
export function run(task, context) {
  const started = Date.now();
  try {
    return runInner(task, context, started);
  } catch (e) {
    return refusalEnvelope(task, e, started);
  }
}

function runInner(task, context, started) {
  // 0. Invocation-wide budget BEFORE any traversal (PC650-001). Every
  // candidate is charged before inspection under one monotonic counter.
  // measureInputBytes performs descriptor-safe charged admission: it walks
  // the task/context with the budget, charging each object BEFORE reading
  // its fields. If the 65th distinct object is reached, BudgetExceeded is
  // thrown BEFORE that object is read. Getters are rejected, not executed.
  const resolver = new Resolver(context.fixtureStore || {});
  measureInputBytes(task, resolver);
  // context metadata bytes (fixtureStore bytes are charged per resolve)
  // Use descriptor-safe read to separate fixtureStore from metadata.
  const ctxMeta = {};
  if (context && typeof context === 'object') {
    for (const k of Object.keys(context)) {
      if (k === 'fixtureStore') continue;
      const slot = getOwnData(context, k);
      if (slot.present && !slot.isAccessor) {
        ctxMeta[k] = slot.value;
      }
    }
  }
  measureInputBytes(ctxMeta, resolver);

  // 1. Validate task + context envelopes (charged per candidate).
  const tc = checkTask(task, resolver);
  if (!tc.ok) return invalidInput(task, tc.errors);
  const cc = checkContext(context, resolver);
  if (!cc.ok) return invalidInput(task, cc.errors);

  // Authority: only jason or his registered muse relay.
  if (!['jason', 'muse-relay'].includes(context.request_authority)) {
    return denied(task, 'AUTH_UNVERIFIED', 'request authority not recognized');
  }

  const options = task.options;
  const diagnostics = [];
  const quarantined = [];
  const sourceRefs = [];
  const packages = [];
  let partial = false;

  // 2. Resolve + validate each fixture ref (charged before inspection).
  const seenPkgIds = new Set();
  // PC650-006: invocation-wide line-identity registry. The same bare line_id
  // cannot appear in two packages, even in different populations. This
  // enforces cross-package identity separation.
  const lineRegistry = new Set();
  for (const ref of task.fixture_refs) {
    let resolved;
    try {
      resolved = resolver.resolve(ref);
    } catch (e) {
      if (e.code === 'READ_DENIED' || e.code === 'HASH_MISMATCH' || e.code === 'INVALID_INPUT') {
        // PC650-003: denial/corruption refuses the whole invocation.
        throw e;
      }
      throw e; // BUDGET_EXCEEDED / INPUT_LIMIT -> refusal
    }
    const rec = resolved.record;
    if (!rec || rec.kind !== 'work-package') {
      const e = new Error(`INVALID_INPUT: fixture ${ref} is not a work-package record`);
      e.code = 'INVALID_INPUT';
      throw e;
    }

    // 3. Injection scan over textual fields (charged traversal).
    // PC650-001: collectTexts now charges each object before reading it,
    // using the same budget. The scan happens after resolve() but the
    // objects are charged during the walk.
    const texts = collectTexts(rec, resolver);
    resolver.chargeSpan();
    let qHits = [];
    for (const t of texts) {
      qHits = qHits.concat(recognizeInjections(t).map((h) => ({ ...h, field_text: t.slice(0, 80) })));
    }
    if (qHits.length > 0) {
      quarantined.push({ fixture_id: ref, families: [...new Set(qHits.map((h) => h.family_id))], hits: qHits.length });
      diagnostics.push(mkdiag('INSTRUCTION_INJECTION', 'high', rec.package_id || ref,
        `quarantined ${qHits.length} seeded injection hit(s): ${[...new Set(qHits.map((h) => h.family_id))].join(',')}`));
      // Quarantined sources cannot support claims: skip package analysis, keep accounting.
      // PARTIAL is reserved for valid records with quarantine/insufficient evidence.
      partial = true;
      continue;
    }

    // 4. Schema validation of the package record (charged per candidate).
    // PC650-003: structural corruption refuses; never a partial domain payload.
    // PC650-006: invocation-wide line-identity registry across populations
    // (defined outside the loop) prevents cross-package line_id reuse.
    const errs = [];
    if (!checkPackage(rec, errs, seenPkgIds, resolver, lineRegistry)) {
      const e = new Error(`INVALID_INPUT: package ${rec.package_id || ref}: ${errs.join('; ')}`);
      e.code = 'INVALID_INPUT';
      throw e;
    }

    // 5. Provenance: verify the source_ref pin against the store.
    const v = verifySourceRef(rec.source_ref, resolver);
    if (!v.ok) {
      const e = new Error(`SOURCE_UNVERIFIED: package ${rec.package_id}: ${v.reason}`);
      e.code = 'SOURCE_UNVERIFIED';
      throw e;
    }
    sourceRefs.push({ ...rec.source_ref, verification: 'VERIFIED' });

    // 6. Domain analysis (citations verified against source bytes).
    const ctx = {
      evMode: options.ev_mode,
      eacFormulas: options.eac_formulas,
      includeContingency: options.include_contingency,
      compareHeaders: options.compare_headers,
      chargeSpan: () => resolver.chargeSpan(),
      sourceBytes: resolved.bytes,
      sourceSpans: resolved.spans,
      sourceRef: rec.source_ref,
    };
    try {
      const { result, diagnostics: d2 } = analyzePackage(rec, ctx);
      packages.push(result);
      for (const d of d2) diagnostics.push(d);
      if (d2.some((d) => ['CONTINGENCY_EXCEEDED', 'HEADER_MISMATCH', 'PV_UNVERIFIABLE', 'EV_UNVERIFIABLE', 'CPI_INVALID'].includes(d.code))) partial = true;
    } catch (e) {
      throw e; // budget errors propagate to refusal
    }
  }

  // 7. Pooled aggregates per currency.
  let pools = [];
  if (packages.length > 0) {
    const pr = poolByCurrency(packages, { chargeSpan: () => resolver.chargeSpan() });
    pools = pr.pools;
    for (const d of pr.diagnostics) diagnostics.push(d);
  }

  // 8. Output budget: EVERY public output record counts (PC650-001).
  // packages, EAC entries, header comparisons, contingency, pools,
  // diagnostics, quarantined sources, source refs.
  for (const p of packages) {
    resolver.chargeOutputRecord(); // the package record
    for (const k of Object.keys(p.eac || {})) { resolver.chargeOutputRecord(); void k; }
    for (const hc of p.header_comparison || []) { resolver.chargeOutputRecord(); void hc; }
    if (p.contingency) resolver.chargeOutputRecord();
  }
  for (const pl of pools) { resolver.chargeOutputRecord(); void pl; }
  for (const d of diagnostics) { resolver.chargeOutputRecord(); void d; }
  for (const q of quarantined) { resolver.chargeOutputRecord(); void q; }
  for (const s of sourceRefs) { resolver.chargeOutputRecord(); void s; }

  const report = {
    formula_note: 'All forecast values are SYNTHETIC ARITHMETIC EXERCISE — not a project forecast.',
    packages,
    pooled: pools,
    coverage: {
      packages_analyzed: packages.length,
      packages_quarantined: quarantined.length,
      currencies: [...new Set(packages.map((p) => p.currency))],
    },
  };
  const envelope = {
    schema_version: SCHEMA_VERSION,
    agent: AGENT,
    task_id: task.task_id,
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete: !partial,
    status: packages.length === 0 ? (quarantined.length > 0 ? 'PARTIAL' : 'EMPTY') : (partial ? 'PARTIAL' : 'REPORT_READY'),
    source_refs: sourceRefs,
    diagnostics: stableDiagnostics(diagnostics),
    quarantined_sources: quarantined,
    routing_flags: [],
    report,
  };
  const outBytes = utf8Length(canonicalStringify(envelope));
  if (outBytes > LIMITS.maxOutputBytes) {
    throw new InputLimit(`output ${outBytes} bytes exceeds ${LIMITS.maxOutputBytes}`);
  }
  void started;
  return envelope;
}

function collectTexts(rec, budget) {
  // PC650-001: charged traversal for injection scanning. Each object/array
  // is charged BEFORE its contents are read. Uses descriptor-safe reads to
  // avoid invoking getters.
  const out = [];
  const walk = (v, depth) => {
    if (depth > 32) {
      const e = new Error('INVALID_INPUT: nesting depth exceeds 32 in collectTexts');
      e.code = 'INVALID_INPUT';
      throw e;
    }
    if (typeof v === 'string') {
      out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      if (budget) budget.chargeObject(v);
      for (let i = 0; i < v.length; i++) {
        const slot = getOwnData(v, i);
        if (!slot.present || slot.isAccessor) continue; // sparse/accessor: skip, validation will reject
        walk(slot.value, depth + 1);
      }
      return;
    }
    if (v !== null && typeof v === 'object') {
      if (budget) budget.chargeObject(v);
      for (const k of Object.keys(v)) {
        const slot = getOwnData(v, k);
        if (!slot.present || slot.isAccessor) continue;
        walk(slot.value, depth + 1);
      }
    }
  };
  walk(rec, 0);
  return out;
}

function mkdiag(code, severity, record_id, reason, citation) {
  // PC650-004: diagnostics carry an explicit citation state, never a bare null.
  return {
    code,
    severity,
    record_id,
    source_ref: null, // legacy field; use citation instead
    citation: citation || { status: 'UNAVAILABLE', reason: 'no citation bound to this diagnostic' },
    reason,
  };
}

function stableDiagnostics(ds) {
  return [...ds].sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : String(a.record_id) < String(b.record_id) ? -1 : 1);
}

function invalidInput(task, errors) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT,
    task_id: task && task.task_id ? task.task_id : 'unknown',
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete: false,
    status: 'REFUSED',
    source_refs: [],
    diagnostics: errors.map((e) => mkdiag('INVALID_INPUT', 'high', null, e)),
    quarantined_sources: [],
    routing_flags: [],
    report: { packages: [], pooled: [], coverage: { packages_analyzed: 0, packages_quarantined: 0, currencies: [] } },
  };
}

function denied(task, code, reason) {
  const e = invalidInput(task, [reason]);
  e.diagnostics = [mkdiag(code, 'high', null, reason)];
  return e;
}

function refusalEnvelope(task, e, started) {
  void started;
  const code = e && typeof e.code === 'string' ? e.code : 'INVALID_INPUT';
  const env = invalidInput(task, [e && e.message ? e.message : String(e)]);
  env.diagnostics = [mkdiag(code, 'high', null, e && e.message ? e.message : String(e))];
  env.report = { packages: [], pooled: [], coverage: { packages_analyzed: 0, packages_quarantined: 0, currencies: [] } };
  return env;
}
