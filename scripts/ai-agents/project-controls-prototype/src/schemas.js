// schemas.js — runtime validation. Rejects unknown control fields, missing
// required fields, wrong types, nonfinite values, duplicate IDs, malformed pins.
// A malformed request returns a structured denial, never an exception.

const EAC_VARIANTS = new Set([
  'BAC_OVER_CPI',
  'AC_PLUS_REMAINING_BUDGET',
  'AC_PLUS_REMAINING_OVER_CPI_SPI',
  'BOTTOM_UP_ETC',
]);

const HEX40 = /^[0-9a-f]{40}$/;
const CURRENCY = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function isHex40(s) { return typeof s === 'string' && HEX40.test(s); }

function isRecord(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function isSafeInt(v) { return typeof v === 'number' && Number.isSafeInteger(v); }

function checkDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function checkInstant(s) {
  if (!INSTANT_RE.test(s)) return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
}

/** Validate a rational percent {num, den} with 0 <= num/den <= 1. */
function checkPercent(p, field, errors, budget) {
  if (budget) budget.chargeObject(p);
  if (!isRecord(p)) { errors.push(`${field}: must be an object {num, den}`); return false; }
  const keys = Object.keys(p);
  for (const k of keys) if (k !== 'num' && k !== 'den') { errors.push(`${field}: unknown property ${k}`); return false; }
  if (!isSafeInt(p.num) || !isSafeInt(p.den)) { errors.push(`${field}: num/den must be safe integers`); return false; }
  if (p.den <= 0) { errors.push(`${field}: den must be > 0`); return false; }
  if (p.num < 0 || p.num > p.den) { errors.push(`${field}: percent out of [0,1]`); return false; }
  return true;
}

/** Validate a SourceRef pin. */
export function checkSourceRef(ref, errors, prefix, budget) {
  if (budget) budget.chargeObject(ref);
  if (!isRecord(ref)) { errors.push(`${prefix}: source_ref must be an object`); return false; }
  const allowed = new Set(['repo', 'path', 'commit', 'blob', 'algorithm', 'revision']);
  for (const k of Object.keys(ref)) {
    if (!allowed.has(k)) { errors.push(`${prefix}: unknown source_ref property ${k}`); return false; }
  }
  let ok = true;
  if (typeof ref.repo !== 'string' || ref.repo.length === 0) { errors.push(`${prefix}: repo required`); ok = false; }
  if (typeof ref.path !== 'string' || ref.path.length === 0 || ref.path.startsWith('/') || ref.path.includes('..')) {
    errors.push(`${prefix}: path must be canonical repo-relative`); ok = false;
  }
  if (!isHex40(ref.commit)) { errors.push(`${prefix}: commit must be 40-hex`); ok = false; }
  if (!isHex40(ref.blob)) { errors.push(`${prefix}: blob must be 40-hex`); ok = false; }
  if (ref.algorithm !== 'git-sha1') { errors.push(`${prefix}: algorithm must be git-sha1`); ok = false; }
  if (typeof ref.revision !== 'string' || ref.revision.length === 0) { errors.push(`${prefix}: revision required`); ok = false; }
  return ok;
}

/** Validate a citation label. The runtime derives the VERIFIED citation from
 * source byte spans; the input label is descriptive only. */
function checkCitation(c, prefix, errors) {
  if (typeof c !== 'string' || c.length === 0) { errors.push(`${prefix}: citation must be a non-empty string label`); return false; }
  return true;
}

// Closed kind for negative actual-cost adjustments. Negative amounts are
// only permitted on actual-cost lines with this kind and a verified citation.
export const ADJUSTMENT_KIND = 'ADJUSTMENT';

// PC650-006: Closed kind vocabularies per accounting population.
// Every money line's kind must be in the allowed set for its population.
// This enforces population separation: a kind valid in one population is
// not automatically valid in another.
export const KIND_VOCABULARIES = {
  actual_cost: new Set([
    'labor', 'materials', 'mobilization', 'equipment', 'subcontract', 'overhead',
    ADJUSTMENT_KIND,
  ]),
  etc: new Set([
    'etc-labor', 'etc-materials', 'etc-equipment', 'etc-subcontract', 'etc-overhead',
  ]),
  contingency_addition: new Set([
    'approved-addition', 'reserve-allocation',
  ]),
  contingency_draw: new Set([
    'draw', 'approved-draw', 'emergency-draw',
  ]),
};

/** Validate one work-package record. Returns {ok, errors}.
 * budget: Resolver for per-candidate charging (PC650-001). lineRegistry: a
 * package-wide Set for line-identity separation (PC650-006). */
export function checkPackage(pkg, errors, seenIds, budget, lineRegistry) {
  if (budget) budget.chargeObject(pkg);
  const p = `package ${pkg && pkg.package_id ? JSON.stringify(pkg.package_id) : '?'}`;
  if (!isRecord(pkg)) { errors.push(`${p}: must be an object`); return false; }
  const allowed = new Set([
    'kind', 'package_id', 'currency', 'bac_minor', 'planned_percent', 'claimed_actual_percent',
    'evidenced_ev_minor', 'actual_cost_lines', 'etc_lines', 'contingency',
    'header_claims', 'source_ref', 'label',
  ]);
  let ok = true;
  for (const k of Object.keys(pkg)) {
    if (!allowed.has(k)) { errors.push(`${p}: unknown property ${k}`); ok = false; }
  }
  if (typeof pkg.package_id !== 'string' || pkg.package_id.length === 0) {
    errors.push(`${p}: package_id required string`); ok = false;
  } else if (seenIds.has(pkg.package_id)) {
    errors.push(`${p}: duplicate package_id`); ok = false;
  } else {
    seenIds.add(pkg.package_id);
  }
  if (typeof pkg.currency !== 'string' || !CURRENCY.test(pkg.currency)) {
    errors.push(`${p}: currency must be 3-letter code`); ok = false;
  }
  if (!isSafeInt(pkg.bac_minor) || pkg.bac_minor < 0) {
    errors.push(`${p}: bac_minor must be a non-negative safe integer`); ok = false;
  }
  if (pkg.planned_percent !== undefined && pkg.planned_percent !== null) {
    if (!checkPercent(pkg.planned_percent, `${p}.planned_percent`, errors, budget)) ok = false;
  }
  if (!checkPercent(pkg.claimed_actual_percent, `${p}.claimed_actual_percent`, errors, budget)) ok = false;
  if (pkg.evidenced_ev_minor !== undefined && pkg.evidenced_ev_minor !== null) {
    // evidenced_ev_minor is a primitive value, not an object candidate; no charge needed
    if (!isSafeInt(pkg.evidenced_ev_minor) || pkg.evidenced_ev_minor < 0) {
      errors.push(`${p}: evidenced_ev_minor must be non-negative safe integer`); ok = false;
    }
  }
  const lr = lineRegistry || new Set();
  ok = checkMoneyLines(pkg.actual_cost_lines, `${p}.actual_cost_lines`, errors, { budget, registry: lr, population: 'actual_cost', allowNegative: ADJUSTMENT_KIND }) && ok;
  ok = checkMoneyLines(pkg.etc_lines, `${p}.etc_lines`, errors, { budget, registry: lr, population: 'etc', allowNegative: null }) && ok;
  if (pkg.contingency !== undefined && pkg.contingency !== null) {
    ok = checkContingency(pkg.contingency, `${p}.contingency`, errors, budget, lr) && ok;
  }
  if (pkg.header_claims !== undefined && pkg.header_claims !== null) {
    if (budget) budget.chargeObject();
    ok = checkHeaderClaims(pkg.header_claims, `${p}.header_claims`, errors, budget) && ok;
  }
  if (!checkSourceRef(pkg.source_ref, errors, p, budget)) ok = false;
  if (pkg.label !== undefined && typeof pkg.label !== 'string') {
    errors.push(`${p}: label must be string`); ok = false;
  }
  return ok;
}

function checkMoneyLines(lines, prefix, errors, opts) {
  const { budget, registry, population, allowNegative } = opts || {};
  if (budget) budget.chargeObject(lines);
  if (!Array.isArray(lines)) { errors.push(`${prefix}: must be an array`); return false; }
  let ok = true;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const lp = `${prefix}[${i}]`;
    if (budget) budget.chargeObject(ln);
    if (!isRecord(ln)) { errors.push(`${lp}: must be an object`); ok = false; continue; }
    const allowed = new Set(['line_id', 'amount_minor', 'kind', 'citation']);
    for (const k of Object.keys(ln)) {
      if (!allowed.has(k)) { errors.push(`${lp}: unknown property ${k}`); ok = false; }
    }
    if (typeof ln.line_id !== 'string' || ln.line_id.length === 0) { errors.push(`${lp}: line_id required`); ok = false; }
    else if (registry && registry.has(`${population}:${ln.line_id}`)) {
      // same id reused inside one population — duplicate
      errors.push(`${lp}: duplicate line_id within ${population}`); ok = false;
    } else if (registry && [...registry].some((k) => {
      // Finding 3 (local review): compare the bare id segment exactly.
      // Registry keys are `${population}:${line_id}`; population names contain
      // no colon, so the bare id is everything after the FIRST colon.
      const bare = k.slice(k.indexOf(':') + 1);
      return bare === ln.line_id && k !== `${population}:${ln.line_id}`;
    })) {
      // same bare id in a DIFFERENT population — ambiguous overlap (PC650-006)
      errors.push(`${lp}: line_id ${JSON.stringify(ln.line_id)} overlaps another accounting population; ambiguous`); ok = false;
    } else if (registry) {
      registry.add(`${population}:${ln.line_id}`);
    }
    if (!isSafeInt(ln.amount_minor)) { errors.push(`${lp}: amount_minor must be a safe integer`); ok = false; }
    else if (ln.amount_minor < 0) {
      // Negative amounts: only actual-cost adjustments with the closed kind.
      if (population === 'actual_cost' && ln.kind === allowNegative) {
        // permitted: cited adjustment; citation verified at runtime
      } else {
        errors.push(`${lp}: negative amount_minor only permitted for actual-cost kind ${JSON.stringify(ADJUSTMENT_KIND)}`); ok = false;
      }
    }
    if (typeof ln.kind !== 'string' || ln.kind.length === 0) {
      errors.push(`${lp}: kind required`); ok = false;
    } else {
      // PC650-006: enforce closed kind vocabulary per population
      const vocab = KIND_VOCABULARIES[population];
      if (vocab && !vocab.has(ln.kind)) {
        errors.push(`${lp}: kind ${JSON.stringify(ln.kind)} not in closed vocabulary for ${population}; allowed: ${[...vocab].join(', ')}`);
        ok = false;
      }
    }
    if (!checkCitation(ln.citation, `${lp}.citation`, errors)) ok = false;
  }
  return ok;
}

function checkContingency(c, prefix, errors, budget, lineRegistry) {
  if (budget) budget.chargeObject(c);
  if (!isRecord(c)) { errors.push(`${prefix}: must be an object`); return false; }
  const allowed = new Set(['original_minor', 'additions', 'draws', 'citation']);
  let ok = true;
  for (const k of Object.keys(c)) {
    if (!allowed.has(k)) { errors.push(`${prefix}: unknown property ${k}`); ok = false; }
  }
  if (!isSafeInt(c.original_minor) || c.original_minor < 0) { errors.push(`${prefix}: original_minor must be non-negative safe integer`); ok = false; }
  if (!Array.isArray(c.additions) || !Array.isArray(c.draws)) { errors.push(`${prefix}: additions/draws must be arrays`); ok = false; }
  else {
    ok = checkMoneyLines(c.additions, `${prefix}.additions`, errors, { budget, registry: lineRegistry, population: 'contingency_addition', allowNegative: null }) && ok;
    ok = checkMoneyLines(c.draws, `${prefix}.draws`, errors, { budget, registry: lineRegistry, population: 'contingency_draw', allowNegative: null }) && ok;
  }
  if (!checkCitation(c.citation, `${prefix}.citation`, errors)) ok = false;
  return ok;
}

function checkHeaderClaims(h, prefix, errors, budget) {
  if (budget) budget.chargeObject(h);
  if (!isRecord(h)) { errors.push(`${prefix}: must be an object`); return false; }
  const allowed = new Set(['cpi', 'spi', 'cv_minor', 'sv_minor', 'eac_minor', 'source']);
  let ok = true;
  for (const k of Object.keys(h)) {
    if (!allowed.has(k)) { errors.push(`${prefix}: unknown property ${k}`); ok = false; }
  }
  for (const f of ['cpi', 'spi']) {
    if (h[f] !== undefined && h[f] !== null) {
      if (budget) budget.chargeObject(h[f]);
      if (!isRecord(h[f]) || !isSafeInt(h[f].num) || !isSafeInt(h[f].den) || h[f].den <= 0) {
        errors.push(`${prefix}.${f}: must be rational {num, den}, den > 0`); ok = false;
      }
    }
  }
  for (const f of ['cv_minor', 'sv_minor', 'eac_minor']) {
    if (h[f] !== undefined && h[f] !== null) {
      // Primitives, not object candidates; no charge needed
      if (!isSafeInt(h[f])) {
        errors.push(`${prefix}.${f}: must be safe integer minor units`); ok = false;
      }
    }
  }
  if (h.source !== undefined && typeof h.source !== 'string') { errors.push(`${prefix}.source must be string`); ok = false; }
  return ok;
}

/** Validate the task envelope. Returns {ok, errors}.
 * budget: charged for the task root, each fixture ref and the options
 * candidate before inspection (PC650-001). */
export function checkTask(task, budget) {
  const errors = [];
  if (budget) budget.chargeObject(task);
  if (!isRecord(task)) return { ok: false, errors: ['task: must be an object'] };
  const allowed = new Set(['schema_version', 'task_id', 'operation', 'fixture_refs', 'options']);
  for (const k of Object.keys(task)) {
    if (!allowed.has(k)) errors.push(`task: unknown property ${k}`);
  }
  if (task.schema_version !== '1') errors.push('task: schema_version must be "1"');
  if (typeof task.task_id !== 'string' || task.task_id.length === 0) errors.push('task: task_id required');
  if (task.operation !== 'analyze') errors.push('task: operation must be "analyze" (unsupported operations are refused)');
  if (!Array.isArray(task.fixture_refs) || task.fixture_refs.length === 0) {
    errors.push('task: fixture_refs must be a non-empty array');
  } else {
    if (budget) budget.chargeObject(task.fixture_refs);
    for (const r of task.fixture_refs) {
      // PC650-001: each fixture_ref is a candidate representing resolution work.
      // Charge it during admission, even though the string itself is a primitive.
      // This ensures 65 refs exceed the 64-object budget before resolution begins.
      if (budget) budget.chargeObject();
      if (typeof r !== 'string' || r.length === 0) errors.push('task: fixture_refs entries must be non-empty strings');
    }
  }
  if (!isRecord(task.options)) {
    errors.push('task: options must be an object');
  } else {
    if (budget) budget.chargeObject(task.options);
    const oallowed = new Set(['ev_mode', 'eac_formulas', 'include_contingency', 'compare_headers']);
    for (const k of Object.keys(task.options)) {
      if (!oallowed.has(k)) errors.push(`task.options: unknown property ${k}`);
    }
    if (task.options.ev_mode !== 'claimed' && task.options.ev_mode !== 'evidenced') {
      errors.push('task.options: ev_mode must be "claimed" or "evidenced"');
    }
    if (!Array.isArray(task.options.eac_formulas)) {
      errors.push('task.options: eac_formulas must be an array');
    } else {
      if (budget) budget.chargeObject(task.options.eac_formulas);
      for (const f of task.options.eac_formulas) {
        // Strings are primitives; no per-formula charge
        if (!EAC_VARIANTS.has(f)) errors.push(`task.options: unknown eac_formula ${JSON.stringify(f)}`);
      }
    }
    if (typeof task.options.include_contingency !== 'boolean') errors.push('task.options: include_contingency must be boolean');
    if (typeof task.options.compare_headers !== 'boolean') errors.push('task.options: compare_headers must be boolean');
  }
  return { ok: errors.length === 0, errors };
}

/** Validate the host-injected context envelope. Returns {ok, errors}.
 * budget: charged per candidate before inspection (PC650-001). */
export function checkContext(ctx, budget) {
  const errors = [];
  if (budget) budget.chargeObject(ctx);
  if (!isRecord(ctx)) return { ok: false, errors: ['context: must be an object'] };
  const allowed = new Set(['clock', 'criteria_version', 'principal', 'grants', 'request_authority', 'fixtureStore']);
  for (const k of Object.keys(ctx)) {
    if (!allowed.has(k)) errors.push(`context: unknown property ${k}`);
  }
  if (budget) budget.chargeObject(ctx.clock);
  if (!isRecord(ctx.clock) || typeof ctx.clock.now !== 'string' || !checkInstant(ctx.clock.now)) {
    errors.push('context: clock.now must be a UTC instant with Z');
  }
  if (ctx.criteria_version !== 'controls-v1') errors.push('context: criteria_version must be "controls-v1"');
  if (budget) budget.chargeObject(ctx.principal);
  if (!isRecord(ctx.principal) || typeof ctx.principal.id !== 'string') errors.push('context: principal.id required');
  if (!Array.isArray(ctx.grants)) errors.push('context: grants must be an array');
  else {
    if (budget) budget.chargeObject(ctx.grants);
    for (const g of ctx.grants) {
      // Grant entries may be primitives or objects; charge objects only
      if (budget && g !== null && typeof g === 'object') budget.chargeObject(g);
      void g;
    }
  }
  if (typeof ctx.request_authority !== 'string' || ctx.request_authority.length === 0) {
    errors.push('context: request_authority must be a non-empty string');
  }
  return { ok: errors.length === 0, errors };
}

export { EAC_VARIANTS };
