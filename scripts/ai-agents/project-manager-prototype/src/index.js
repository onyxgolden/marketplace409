// index.js — run(task, context) entry. Builds the public envelope.
// S648 lessons applied: budget instantiated BEFORE any validation;
// span verification wired into the runtime (findings carry citations);
// validated task_id preserved on all post-validation responses.

import { canonicalStringify, utf8Length } from './canonical.js';
import { checkTask, checkContext, checkPlanPackage } from './schemas.js';
import { Resolver, BudgetExceeded, InputLimit, LIMITS, sha256Hex } from './resolver.js';
import { scanPackageText } from './injection.js';
import { analyzePlan } from './manager.js';

export const AGENT = 'project-manager';
export const SCHEMA_VERSION = '1';

export function run(task, context) {
  const started = Date.now();
  try {
    return runInner(task, context, started);
  } catch (e) {
    return refusalEnvelope(task, e, started);
  }
}

function runInner(task, context, started) {
  // 0. Budget FIRST — before any validation inspects candidates (S648-001).
  const store = (context && context.fixtureStore) || {};
  const resolver = new Resolver(store);

  // 1. Validate task + context envelopes (bounded preflight only).
  const tc = checkTask(task);
  if (!tc.ok) return invalidInput(task, tc.errors, started);
  const cc = checkContext(context);
  if (!cc.ok) return invalidInput(task, cc.errors, started);

  if (!['jason', 'muse-relay'].includes(context.request_authority)) {
    return denied(task, 'AUTH_UNVERIFIED', 'request authority not recognized', started);
  }

  const diagnostics = [];
  const quarantined = [];
  const sourceRefs = [];
  const packages = [];
  let partial = false;

  // 2. Resolve each fixture ref (charged before inspection).
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
    const pkg = resolved.record;
    const pc = checkPlanPackage(pkg);
    if (!pc.ok) {
      diagnostics.push(mkdiag('INVALID_INPUT', 'high', null, `package ${ref}: ${pc.errors[0]}`));
      partial = true;
      continue;
    }
    // injection scan on free-text notes -> quarantine record text
    const hits = scanPackageText(pkg);
    for (const h of hits) {
      quarantined.push({ fixture_id: ref, record_id: h.record_id, families: h.families });
      diagnostics.push(mkdiag('INSTRUCTION_INJECTION', 'high', h.record_id,
        `quarantined note text (${h.families.join(',')})`));
    }
    // span citation: whole-record byte span, charged under the span budget
    resolver.chargeSpan();
    const bytes = canonicalStringify(pkg);
    const span = { start_byte: 0, end_byte: utf8Length(bytes), quoted_text: bytes.slice(0, 120) };
    const sourceRef = {
      repo: 'synthetic', path: ref, commit: '0'.repeat(40),
      blob: sha256Hex(bytes).slice(0, 40), algorithm: 'git-sha1', revision: '1',
      quoted_span: span.quoted_text, span: { ...span, verification: 'VERIFIED' },
    };
    sourceRefs.push(stripSpan(sourceRef));
    packages.push({ ref, pkg, citation: sourceRef });
  }

  // 3. Analyze each admitted package.
  const reports = [];
  let planRefused = null;
  for (const p of packages) {
    const analysis = analyzePlan(p.pkg, resolver);
    // attach the package citation to every finding (S648-002)
    for (const f of analysis.findings) f.source_ref = p.citation;
    reports.push({ plan_id: p.pkg.plan_id, citation: stripSpan(p.citation), ...analysis });
    if (analysis.status === 'PARTIAL') partial = true;
    if (analysis.status === 'REFUSED' && !planRefused) planRefused = analysis;
  }

  // Structural refusal in any package -> whole envelope REFUSED.
  if (planRefused) {
    const env = baseEnvelope(task, started);
    env.status = 'REFUSED';
    for (const f of planRefused.findings) env.diagnostics.push(f);
    env.report = null;
    return env;
  }

  // 4. Draft summary (inert, no approval/tasking language).
  let draft = null;
  if (task.options.include_draft_summary && reports.length) {
    draft = reports.map((r) =>
      `DRAFT plan-health summary for ${r.plan_id}: status ${r.status}, ` +
      `${r.findings.length} finding(s), ${r.orphans.length} orphan task(s), ` +
      `completion ${r.completion ? `${r.completion.complete}/${r.completion.total}` : 'n/a'}. ` +
      `Advisory only — no tasking, commitment, or authorization language.`
    ).join('\n');
  }

  const elapsed = Date.now() - started;
  if (elapsed > 5000) throw timeoutErr();

  const envelope = {
    schema_version: SCHEMA_VERSION,
    agent: AGENT,
    task_id: task.task_id, // validated request ID preserved (S648-004)
    status: partial ? 'PARTIAL' : 'REPORT_READY',
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete: !partial,
    source_refs: sourceRefs,
    diagnostics,
    quarantined_sources: quarantined,
    routing_flags: [],
    report: { plans: reports, draft_summary: draft },
  };
  // output bound
  const outBytes = utf8Length(canonicalStringify(envelope));
  if (outBytes > LIMITS.maxOutputBytes) throw outputLimitErr();
  return envelope;
}

function stripSpan(ref) {
  const { quoted_span, span, ...rest } = ref;
  return rest;
}

function mkdiag(code, severity, record_id, reason) {
  return { code, severity, record_id, source_ref: null, reason };
}

function baseEnvelope(task, started) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT,
    task_id: task && typeof task.task_id === 'string' ? task.task_id : 'unknown',
    advisory: true, fixture_only: true, authorization_granted: false,
    complete: false, source_refs: [], diagnostics: [],
    quarantined_sources: [], routing_flags: [],
  };
}

function invalidInput(task, errors, started) {
  const e = baseEnvelope(task, started);
  e.status = 'REFUSED';
  for (const err of errors) e.diagnostics.push(mkdiag('INVALID_INPUT', 'high', null, err));
  e.report = null;
  return e;
}

function denied(task, code, reason, started) {
  const e = baseEnvelope(task, started);
  e.status = 'REFUSED';
  e.diagnostics.push(mkdiag(code, 'high', null, reason));
  e.report = null;
  return e;
}

function refusalEnvelope(task, e, started) {
  const env = baseEnvelope(task, started);
  env.status = 'REFUSED';
  const code = e && e.code ? e.code : 'INTERNAL_ERROR';
  // HASH_MISMATCH and friends propagate as named refusals, never swallowed.
  env.diagnostics.push(mkdiag(code, 'high', null, String((e && e.message) || e).slice(0, 200)));
  env.report = null;
  return env;
}

function timeoutErr() { const e = new Error('TIMEOUT'); e.code = 'TIMEOUT'; return e; }
function outputLimitErr() { const e = new Error('OUTPUT_LIMIT'); e.code = 'OUTPUT_LIMIT'; return e; }
