// index.js — run(task, context) entry. Builds the public envelope.
// Advisory JSON only; no filesystem/shell/network/send capability.

import { canonicalStringify, utf8Length } from './canonical.js';
import { checkTask, checkContext, checkPackage, checkSourceRef } from './schemas.js';
import { Resolver, BudgetExceeded, InputLimit, LIMITS, verifySourceRef } from './resolver.js';
import { recognizeInjections } from './injection.js';
import { analyzePackage, poolByCurrency } from './controls.js';

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
  // 1. Validate task + context envelopes.
  const tc = checkTask(task);
  if (!tc.ok) return invalidInput(task, tc.errors);
  const cc = checkContext(context);
  if (!cc.ok) return invalidInput(task, cc.errors);

  // Authority: only jason or his registered muse relay.
  if (!['jason', 'muse-relay'].includes(context.request_authority)) {
    return denied(task, 'AUTH_UNVERIFIED', 'request authority not recognized');
  }

  const options = task.options;
  const resolver = new Resolver(context.fixtureStore || {});
  const diagnostics = [];
  const quarantined = [];
  const sourceRefs = [];
  const packages = [];
  let partial = false;

  // 2. Resolve + validate each fixture ref (charged before inspection).
  const seenPkgIds = new Set();
  for (const ref of task.fixture_refs) {
    let resolved;
    try {
      resolved = resolver.resolve(ref);
    } catch (e) {
      if (e.code === 'READ_DENIED') {
        diagnostics.push(mkdiag('READ_DENIED', 'high', null, `fixture ${ref}: not registered`));
        partial = true;
        continue;
      }
      throw e; // BUDGET_EXCEEDED / INPUT_LIMIT / HASH_MISMATCH -> refusal
    }
    const rec = resolved.record;
    if (!rec || rec.kind !== 'work-package') {
      diagnostics.push(mkdiag('INVALID_INPUT', 'high', ref, 'fixture is not a work-package record'));
      partial = true;
      continue;
    }

    // 3. Injection scan over textual fields (one span per package sweep).
    const texts = collectTexts(rec);
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
      partial = true;
      continue;
    }

    // 4. Schema validation of the package record.
    const errs = [];
    if (!checkPackage(rec, errs, seenPkgIds)) {
      const dup = errs.some((e) => e.includes('duplicate'));
      diagnostics.push(mkdiag(dup ? 'INVALID_INPUT' : 'INVALID_INPUT', 'high', rec.package_id || ref, errs.join('; ')));
      partial = true;
      continue;
    }

    // 5. Provenance: verify the source_ref pin against the store.
    const v = verifySourceRef(rec.source_ref, resolver);
    if (!v.ok) {
      diagnostics.push(mkdiag('SOURCE_UNVERIFIED', 'high', rec.package_id, `source_ref pin failed: ${v.reason}`));
      partial = true;
      continue;
    }
    sourceRefs.push({ ...rec.source_ref, verification: 'VERIFIED' });

    // 6. Domain analysis.
    const ctx = {
      evMode: options.ev_mode,
      eacFormulas: options.eac_formulas,
      includeContingency: options.include_contingency,
      compareHeaders: options.compare_headers,
      chargeSpan: () => resolver.chargeSpan(),
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

  // 8. Output budget: records + bytes on the exact final envelope.
  for (const p of packages) resolver.chargeOutputRecord();
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

function collectTexts(rec) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(rec);
  return out;
}

function mkdiag(code, severity, record_id, reason) {
  return { code, severity, record_id, source_ref: null, reason };
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
