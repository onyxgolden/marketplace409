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
 * PC650-008: enforce the trusted principal / registered relay / scoped read
 * permission contract BEFORE accessing source bytes.
 *
 * - request_authority must be a recognized trusted identity ('jason' or the
 *   registered 'muse-relay'). A caller identity string alone is not
 *   authorization.
 * - principal.id must EQUAL request_authority. A principal claiming to be
 *   'mallory' with authority 'jason' is impersonation and is refused.
 * - Each fixture access requires a scoped read grant in context.grants:
 *   {scope: 'read', fixture: <fixture_id|'*'>}. The grant check happens
 *   BEFORE resolver.resolve(), so denied fixtures have zero byte access.
 */
const TRUSTED_IDENTITIES = new Set(['jason', 'muse-relay']);

function checkAuthority(context) {
  // Descriptor-safe reads (no getter invocation).
  const authSlot = getOwnData(context, 'request_authority');
  const princSlot = getOwnData(context, 'principal');
  const authority = (!authSlot.isAccessor && typeof authSlot.value === 'string') ? authSlot.value : null;
  const principal = (!princSlot.isAccessor && princSlot.value !== null && typeof princSlot.value === 'object')
    ? princSlot.value : null;
  const principalIdSlot = principal ? getOwnData(principal, 'id') : { present: false, isAccessor: false };
  const principalId = (!principalIdSlot.isAccessor && typeof principalIdSlot.value === 'string')
    ? principalIdSlot.value : null;

  if (!authority || !TRUSTED_IDENTITIES.has(authority)) {
    return { ok: false, reason: `request_authority ${JSON.stringify(authority)} is not a trusted identity` };
  }
  if (principalId !== authority) {
    return { ok: false, reason: `principal.id ${JSON.stringify(principalId)} does not match trusted request_authority ${JSON.stringify(authority)}: impersonation refused` };
  }
  return { ok: true, authority, principalId };
}

function checkReadGrant(context, fixtureId) {
  // Descriptor-safe grant scan. Returns true iff a {scope:'read'} grant
  // covers this fixture id (exact match or '*' wildcard).
  if (context === null || typeof context !== 'object') return false;
  const grantsSlot = getOwnData(context, 'grants');
  if (grantsSlot.isAccessor || !Array.isArray(grantsSlot.value)) return false;
  for (const g of grantsSlot.value) {
    if (g === null || typeof g !== 'object' || Array.isArray(g)) continue;
    const scopeSlot = getOwnData(g, 'scope');
    const fixtureSlot = getOwnData(g, 'fixture');
    if (scopeSlot.isAccessor || fixtureSlot.isAccessor) continue;
    if (scopeSlot.value === 'read' && (fixtureSlot.value === '*' || fixtureSlot.value === fixtureId)) {
      return true;
    }
  }
  return false;
}

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
  //
  // PC650-001: the fixtureStore is extracted with a descriptor-safe read.
  // `context.fixtureStore || {}` would INVOKE a getter; getOwnData rejects
  // accessors without executing them.
  const storeSlot = (context !== null && typeof context === 'object')
    ? getOwnData(context, 'fixtureStore')
    : { present: false, isAccessor: false, value: undefined };
  if (storeSlot.isAccessor) {
    const e = new Error('INVALID_INPUT: context.fixtureStore accessor rejected');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  const fixtureStore = storeSlot.present ? storeSlot.value : {};
  const resolver = new Resolver(fixtureStore);
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

  // PC650-008: enforce trusted principal / registered relay / scoped grants.
  // The principal must BE the trusted authority (no impersonation), and each
  // fixture access requires a scoped read grant. Checked BEFORE any source
  // byte access.
  const auth = checkAuthority(context);
  if (!auth.ok) {
    return denied(task, 'AUTH_UNVERIFIED', auth.reason);
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
    // PC650-008: scoped read permission checked BEFORE resolver.resolve().
    // No grant => READ_DENIED with zero denied-byte access.
    if (!checkReadGrant(context, ref)) {
      const e = new Error(`READ_DENIED: no scoped read grant for fixture ${ref}`);
      e.code = 'READ_DENIED';
      throw e;
    }
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

    // 5. Provenance: verify the source_ref pin against the cited bytes.
    // PC650-004: the pin's blob authenticates the cited document (canonical
    // bytes WITHOUT source_ref) — the exact bytes that citation spans refer
    // to. resolved.citedBytes comes from the charged canonicalization in
    // resolve(); verifySourceRef checks the git blob SHA-1 matches the pin.
    const v = verifySourceRef(resolved.sourceRef, resolved.citedBytes);
    if (!v.ok) {
      const e = new Error(`SOURCE_UNVERIFIED: package ${rec.package_id}: ${v.reason}`);
      e.code = 'SOURCE_UNVERIFIED';
      throw e;
    }
    sourceRefs.push({ ...resolved.sourceRef, verification: 'VERIFIED' });

    // 6. Domain analysis (citations verified against cited source bytes).
    // PC650-004: ctx.sourceBytes/sourceSpans are the cited document (without
    // source_ref), so byte slices match the blob-authenticated bytes.
    const ctx = {
      evMode: options.ev_mode,
      eacFormulas: options.eac_formulas,
      includeContingency: options.include_contingency,
      compareHeaders: options.compare_headers,
      chargeSpan: () => resolver.chargeSpan(),
      sourceBytes: resolved.citedBytes,
      sourceSpans: resolved.citedSpans,
      sourceRef: resolved.sourceRef,
    };
    try {
      const { result, diagnostics: d2 } = analyzePackage(rec, ctx);
      packages.push(result);
      for (const d of d2) diagnostics.push(d);
      if (d2.some((d) => ['CONTINGENCY_EXCEEDED', 'HEADER_MISMATCH', 'PV_UNVERIFIABLE', 'EV_UNVERIFIABLE', 'CPI_INVALID', 'AC_UNVERIFIABLE', 'CITATION_UNVERIFIED'].includes(d.code))) partial = true;
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

/**
 * PC650-001: descriptor-safe, bounded task_id extraction for refusal envelopes.
 * Never invokes getters (uses getOwnData). Returns '[inadmissible-id]' when
 * the task is not an object, task_id is missing/an accessor, or the ID is
 * oversized — so a 300KB task_id cannot blow the 256KiB output cap via the
 * refusal envelope echoing it.
 */
function safeTaskId(task) {
  if (task === null || typeof task !== 'object') return '[inadmissible-id]';
  const slot = getOwnData(task, 'task_id');
  if (!slot.present || slot.isAccessor) return '[inadmissible-id]';
  const id = slot.value;
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) return '[inadmissible-id]';
  return id;
}

/**
 * PC650-001: bound a refusal reason string so the envelope cannot exceed
 * the output cap via an oversized reason.
 */
function boundReason(reason) {
  const s = String(reason ?? '');
  return s.length > 1000 ? s.slice(0, 1000) + '…[truncated]' : s;
}

function invalidInput(task, errors) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT,
    task_id: safeTaskId(task),
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete: false,
    status: 'REFUSED',
    source_refs: [],
    diagnostics: errors.map((e) => mkdiag('INVALID_INPUT', 'high', null, boundReason(e))),
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
  const env = invalidInput(task, [boundReason(e && e.message ? e.message : String(e))]);
  env.diagnostics = [mkdiag(code, 'high', null, boundReason(e && e.message ? e.message : String(e)))];
  env.report = { packages: [], pooled: [], coverage: { packages_analyzed: 0, packages_quarantined: 0, currencies: [] } };
  // PC650-001: the refusal envelope itself is bounded. task_id is already
  // sanitized by safeTaskId; reasons are truncated by boundReason. Verify the
  // final serialized size cannot exceed the output cap by construction.
  const outBytes = utf8Length(canonicalStringify(env));
  if (outBytes > LIMITS.maxOutputBytes) {
    // Defense in depth: if somehow still over (should be impossible with
    // bounded fields), replace diagnostics with a single truncation marker.
    env.diagnostics = [mkdiag(code, 'high', null, '[refusal envelope truncated: output cap]')];
  }
  return env;
}
