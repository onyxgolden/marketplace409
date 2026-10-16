/**
 * schemas.js — runtime validation for the Executive Manager Agent
 * prototype. Strict: rejects unknown properties in control-bearing
 * objects, absent required fields, wrong types, invalid enum values,
 * duplicate IDs, nonfinite numbers, invalid dates. Pure Node 24 ESM,
 * zero dependencies.
 *
 * Design note (support_strength): the brief distinguishes a *structural*
 * rejection (malformed record -> excluded) from a *semantic* finding
 * ("unknown support labels... => invalid item, not a favorable
 * interpretation"). So support_strength is schema-typed as string|null
 * only (not enum-restricted) here; membership in the three allowed
 * values is checked in rollup.js, where an unrecognized value produces
 * an explicit INVALID derived_statement rather than a thrown-out record.
 * flags IS enum-restricted here, since an unrecognized flag token is
 * exactly the kind of structural anomaly the rest of this program
 * treats as a malformed record (excluded, not silently reinterpreted).
 */

import { HEX40 } from "./canonical.js";

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

const REPO_RE = /^[a-z][a-z0-9-]{0,63}$/;
const PATH_RE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\.(md|txt|json)$/;
const SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PERIOD_RE = /^\d{4}-q[1-4]$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export const REQUESTED_OPERATION_ALLOWED = "analyze";
export const FLAG_VALUES = ["mismatch", "contradicted"];
export const SUPPORT_VALUES = ["verified", "attributed_only", "unverifiable"];
export const PRINCIPAL_ROLES = ["JASON", "MUSE_RELAY"];

export const MAX_REPORTS_SCHEMA = 64; // outer array-shape bound only; the 64-object budget gates real processing
export const MAX_STATEMENTS_PER_REPORT = 32;
export const MAX_METRICS_PER_REPORT = 32;
export const MAX_HEADER_CLAIMS_PER_REPORT = 16;
export const MAX_FLAGS_PER_STATEMENT = FLAG_VALUES.length;
export const MAX_POPULATION_GROUPS = 16;
export const MAX_GROUP_MEMBERS = 16;

function fail(where, msg) {
  throw new SchemaError(`${where}: ${msg}`);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function exactKeys(obj, allowed, where) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(where, `unknown property '${k}'`);
  }
}

function reqStr(obj, key, where, { allowEmpty = false, maxBytes = null } = {}) {
  const v = obj[key];
  if (typeof v !== "string" || (!allowEmpty && v.length === 0)) fail(where, `'${key}' must be a non-empty string`);
  if (maxBytes !== null && Buffer.byteLength(v, "utf8") > maxBytes) fail(where, `'${key}' exceeds ${maxBytes} bytes`);
  return v;
}

function validateRecordId(value, where) {
  const v = reqStr({ v: value }, "v", where);
  if (!RECORD_ID_RE.test(v)) fail(where, `invalid record id '${v}'`);
  return v;
}

function validateSlug(value, where) {
  const v = reqStr({ v: value }, "v", where);
  if (!SLUG_RE.test(v)) fail(where, `invalid slug '${v}'`);
  return v;
}

function validatePeriod(value, where) {
  const v = reqStr({ v: value }, "v", where);
  if (!PERIOD_RE.test(v)) fail(where, `period must be YYYY-qN (e.g. '2026-q3')`);
  return v;
}

export function validateIsoDate(value, where) {
  if (typeof value !== "string") fail(where, "must be a string");
  if (!ISO_RE.test(value)) fail(where, "must be YYYY-MM-DDTHH:MM:SSZ");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail(where, "not a real calendar date");
  const d = new Date(ms);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const da = d.getUTCDate().toString().padStart(2, "0");
  if (`${y}-${mo}-${da}T` !== value.slice(0, 11)) fail(where, "not a real calendar date");
  return ms;
}

/** SourceRef = {repo, path, commit, blob, algorithm:"git-sha1", revision}. */
export function validateSourceRef(value, where) {
  if (!isPlainObject(value)) fail(where, "SourceRef must be an object");
  exactKeys(value, ["repo", "path", "commit", "blob", "algorithm", "revision"], where);
  const repo = reqStr(value, "repo", where);
  if (!REPO_RE.test(repo)) fail(where, `invalid repo '${repo}'`);
  const path = reqStr(value, "path", where);
  if (!PATH_RE.test(path)) fail(where, `invalid path '${path}'`);
  const commit = reqStr(value, "commit", where);
  if (!HEX40.test(commit)) fail(where, "commit must be a full 40-hex Git object ID");
  const blob = reqStr(value, "blob", where);
  if (!HEX40.test(blob)) fail(where, "blob must be a full 40-hex Git object ID");
  if (value.algorithm !== "git-sha1") fail(where, "algorithm must be 'git-sha1'");
  const revision = reqStr(value, "revision", where);
  return { repo, path, commit, blob, algorithm: "git-sha1", revision };
}

export function validatePrincipal(value, where) {
  if (!isPlainObject(value)) fail(where, "principal must be an object");
  exactKeys(value, ["principal_id", "role", "registered_by", "valid_from", "expires_at", "revoked"], where);
  const principal_id = validateRecordId(value.principal_id, where);
  if (!PRINCIPAL_ROLES.includes(value.role)) fail(where, `role must be one of ${PRINCIPAL_ROLES.join(", ")}`);
  const registered_by = reqStr(value, "registered_by", where);
  if (registered_by !== "jason") fail(where, "registered_by must be 'jason'");
  validateIsoDate(value.valid_from, `${where}.valid_from`);
  validateIsoDate(value.expires_at, `${where}.expires_at`);
  if (typeof value.revoked !== "boolean") fail(where, "revoked must be a boolean");
  return { principal_id, role: value.role, registered_by, valid_from: value.valid_from, expires_at: value.expires_at, revoked: value.revoked };
}

/** One named population group: a declared union of population_ids a
 *  header claim may target as a single combined figure. disjoint:true is
 *  the host's attestation that the member populations do not overlap —
 *  the ONLY thing that licenses summing distinct populations together.
 *  Host-injected only — never supplied or overridable by task content. */
export function validatePopulationGroup(value, where, seenGroupIds) {
  if (!isPlainObject(value)) fail(where, "population group must be an object");
  exactKeys(value, ["group_id", "member_population_ids", "disjoint"], where);
  const group_id = validateSlug(value.group_id, `${where}.group_id`);
  if (seenGroupIds.has(group_id)) fail(where, `duplicate group_id '${group_id}'`);
  seenGroupIds.add(group_id);
  if (!Array.isArray(value.member_population_ids) || value.member_population_ids.length < 2 || value.member_population_ids.length > MAX_GROUP_MEMBERS) {
    fail(where, `member_population_ids must be an array of 2..${MAX_GROUP_MEMBERS} entries`);
  }
  const members = value.member_population_ids.map((m, i) => validateSlug(m, `${where}.member_population_ids[${i}]`));
  if (new Set(members).size !== members.length) fail(where, "member_population_ids contains duplicates");
  if (typeof value.disjoint !== "boolean") fail(where, "disjoint must be a boolean");
  return { group_id, member_population_ids: members, disjoint: value.disjoint };
}

export function validateReadGrant(value, where) {
  if (!isPlainObject(value)) fail(where, "read grant must be an object");
  exactKeys(value, ["repo", "path"], where);
  const repo = reqStr(value, "repo", where);
  if (!REPO_RE.test(repo)) fail(where, `invalid repo '${repo}'`);
  const path = reqStr(value, "path", where);
  if (!PATH_RE.test(path)) fail(where, `invalid path '${path}'`);
  return { repo, path };
}

/**
 * validateContextShape — OUTER SHAPE PREFLIGHT ONLY. Checks container
 * types and bounded lengths (a "bounded preflight may inspect
 * containers/lengths" per the common contract) but NEVER descends into
 * reading any individual source/revision/grant/criteria-entry field —
 * that is exactly the unbudgeted walk that let an unused, oversized
 * registry entry bypass the 256 KiB / 64-object budget entirely in this
 * program's earlier Customer Success (CS-001) and Document Agent
 * (DOC-002) findings. The real per-item validation (validateRevisionEntry,
 * validateReadGrant, validatePrincipal, validatePopulationGroup) is
 * called one object at a time by the CHARGED walk in index.js, via
 * budget.countObject() BEFORE each item's fields are read — the same
 * incremental charge-before-read discipline applied to this agent's own
 * domain candidates (reports/statements/metrics/header_claims).
 */
export function validateContextShape(context) {
  if (!isPlainObject(context)) fail("context", "must be an object");
  exactKeys(context, ["clock", "sources", "readGrants", "principal", "criteria"], "context");
  const clock = context.clock;
  if (!Number.isFinite(clock)) fail("context", "clock must be a finite number");

  if (!isPlainObject(context.sources)) fail("context", "sources must be an object");
  const sourceKeys = Object.keys(context.sources);
  // Container-length sanity cap only — NOT the per-task consultation
  // budget (strictly enforced at 64 objects by resolver.js's
  // BUDGET_LIMITS via the charged walk, regardless of catalog size).
  if (sourceKeys.length === 0 || sourceKeys.length > 4096) fail("context", "sources must have 1..4096 entries");

  if (!Array.isArray(context.readGrants) || context.readGrants.length > 4096) fail("context", "readGrants must be an array of at most 4096 entries");
  if (!isPlainObject(context.principal)) fail("context", "principal must be an object");
  if (!isPlainObject(context.criteria)) fail("context", "criteria must be an object");

  return { clock, sources: context.sources, sourceKeys, readGrantsRaw: context.readGrants, principalRaw: context.principal, criteriaRaw: context.criteria };
}

/** Per-source-entry container check (bounded preflight only — does not
 *  read any individual revision's fields). Called once per source key,
 *  AFTER that source key has been charged. */
export function validateSourceEntryShape(entry, where) {
  if (!isPlainObject(entry)) fail(where, "must be an object");
  if (!isPlainObject(entry.revisions)) fail(where, "revisions must be an object");
  const commits = Object.keys(entry.revisions);
  if (commits.length > 256) fail(where, "revisions must have at most 256 entries");
  return commits;
}

/** One registered revision's fields. Called once per revision, AFTER
 *  that revision has been charged. */
export function validateRevisionEntry(rev, where) {
  if (!isPlainObject(rev)) fail(where, "must be an object");
  if (typeof rev.text !== "string") fail(where, "text must be a string");
  if (typeof rev.blob !== "string" || !HEX40.test(rev.blob)) fail(where, "blob must be a 40-hex Git object ID");
  return { text: rev.text, blob: rev.blob };
}

/** criteria container shape only — population_groups entries are
 *  validated one at a time (validatePopulationGroup) by the charged
 *  walk, not here. */
export function validateCriteriaShape(value, where) {
  if (!isPlainObject(value)) fail(where, "criteria must be an object");
  exactKeys(value, ["criteria_version", "population_groups"], where);
  const criteria_version = validateSlug(value.criteria_version, `${where}.criteria_version`);
  if (!Array.isArray(value.population_groups) || value.population_groups.length > MAX_POPULATION_GROUPS) {
    fail(where, `population_groups must be an array of at most ${MAX_POPULATION_GROUPS} entries`);
  }
  return { criteria_version, population_groups_raw: value.population_groups };
}

/** Task input schema. kind: "analyze" | "prohibited". */
export function validateTask(task) {
  if (!isPlainObject(task)) fail("task", "must be an object");
  exactKeys(task, ["schema_version", "task_id", "operation", "fixture_refs", "options"], "task");
  if (task.schema_version !== "1") fail("task", "schema_version must be '1'");
  const task_id = reqStr(task, "task_id", "task", { maxBytes: 2048 });
  const operation = reqStr(task, "operation", "task", { maxBytes: 256 });

  if (!isPlainObject(task.fixture_refs)) fail("task", "fixture_refs must be an object");
  exactKeys(task.fixture_refs, ["report_set"], "task.fixture_refs");
  const report_set_ref = validateSourceRef(task.fixture_refs.report_set, "task.fixture_refs.report_set");

  if (!isPlainObject(task.options)) fail("task", "options must be an object");
  exactKeys(task.options, ["population"], "task.options");
  const pop = task.options.population;
  if (!isPlainObject(pop)) fail("task.options.population", "must be an object");
  exactKeys(pop, ["declared_total", "complete"], "task.options.population");
  if (!Number.isInteger(pop.declared_total) || pop.declared_total < 0) fail("task.options.population", "declared_total must be a nonnegative integer");
  if (typeof pop.complete !== "boolean") fail("task.options.population", "complete must be a boolean");

  return {
    task_id,
    operation,
    report_set_ref,
    population: { declared_total: pop.declared_total, complete: pop.complete },
    kind: operation === REQUESTED_OPERATION_ALLOWED ? "analyze" : "prohibited",
  };
}

function validateSpan(value, where) {
  if (!isPlainObject(value)) fail(where, "span must be an object");
  exactKeys(value, ["start_byte", "end_byte"], where);
  if (!Number.isInteger(value.start_byte) || value.start_byte < 0) fail(where, "start_byte must be a nonnegative integer");
  if (!Number.isInteger(value.end_byte) || value.end_byte <= value.start_byte) fail(where, "end_byte must be an integer greater than start_byte");
  return { start_byte: value.start_byte, end_byte: value.end_byte };
}

/** One statement record. support_strength is string|null, NOT enum-
 *  restricted here (see module header). flags IS enum-restricted: an
 *  unrecognized flag token makes the whole record malformed. */
export function validateStatement(value, where, seenItemIds) {
  if (!isPlainObject(value)) fail(where, "statement must be an object");
  exactKeys(value, ["item_id", "support_strength", "flags", "span"], where);
  const item_id = validateRecordId(value.item_id, where);
  if (seenItemIds.has(item_id)) fail(where, `duplicate item_id '${item_id}' within one report`);
  seenItemIds.add(item_id);
  let support_strength;
  if (value.support_strength === null) {
    support_strength = null;
  } else {
    support_strength = reqStr(value, "support_strength", where, { maxBytes: 64 });
  }
  if (!Array.isArray(value.flags) || value.flags.length > MAX_FLAGS_PER_STATEMENT) fail(where, `flags must be an array of at most ${MAX_FLAGS_PER_STATEMENT} entries`);
  const flags = value.flags.map((f, i) => {
    if (typeof f !== "string" || !FLAG_VALUES.includes(f)) fail(`${where}.flags[${i}]`, `must be one of ${FLAG_VALUES.join(", ")}`);
    return f;
  });
  if (new Set(flags).size !== flags.length) fail(where, "flags contains duplicates");
  const span = validateSpan(value.span, `${where}.span`);
  return { item_id, support_strength, flags, span };
}

/** Nonnegative integer, required. Used for percentage numerator/denominator —
 *  these must be exact counts, never floats, so pooled sums stay exact. */
function reqNonnegInt(value, where, label) {
  if (!Number.isInteger(value) || value < 0) fail(where, `'${label}' must be a nonnegative integer`);
  return value;
}

export function validateMetricLine(value, where, seenLineItemIds) {
  if (!isPlainObject(value)) fail(where, "metric line must be an object");
  exactKeys(value, ["line_item_id", "metric_key", "population_id", "unit", "period", "currency", "value", "numerator", "denominator", "span"], where);
  const line_item_id = validateRecordId(value.line_item_id, where);
  if (seenLineItemIds.has(line_item_id)) fail(where, `duplicate line_item_id '${line_item_id}' within one report`);
  seenLineItemIds.add(line_item_id);
  const metric_key = validateSlug(value.metric_key, `${where}.metric_key`);
  const population_id = validateSlug(value.population_id, `${where}.population_id`);
  const unit = validateSlug(value.unit, `${where}.unit`);
  const period = validatePeriod(value.period, `${where}.period`);
  let currency;
  if (unit === "currency") {
    currency = validateSlug(value.currency, `${where}.currency`);
  } else {
    if (value.currency !== null) fail(where, "currency must be null when unit is not 'currency'");
    currency = null;
  }

  // EM-002 fix: percentage metrics carry an exact numerator/denominator
  // pair instead of a single float `value` — the brief requires
  // percentages to aggregate by summing DEDUPLICATED numerators and
  // denominators over disjoint populations, never by summing/averaging
  // the percentage VALUE itself. A plain `value` number cannot be pooled
  // that way (it's lost the two counts that produced it). denominator
  // may be exactly 0 (a trivially empty line, e.g. "0 of 0") — the typed
  // undefined-zero-denominator case is handled at the aggregate level in
  // rollup.js, not rejected here.
  // numerator/denominator are new fields (added for this fix); existing
  // non-percentage fixtures predate them and never set them at all, so
  // ABSENT and explicit null are both accepted as "not applicable" here
  // — unlike `currency` above, which fixtures already set explicitly.
  let numerator = null;
  let denominator = null;
  let numericValue = null;
  if (unit === "percentage") {
    if (value.value !== undefined && value.value !== null) fail(where, "value must be absent or null when unit is 'percentage' (use numerator/denominator instead)");
    numerator = reqNonnegInt(value.numerator, where, "numerator");
    denominator = reqNonnegInt(value.denominator, where, "denominator");
    if (denominator > 0 && numerator > denominator) fail(where, "numerator cannot exceed denominator");
  } else {
    if ((value.numerator !== undefined && value.numerator !== null) || (value.denominator !== undefined && value.denominator !== null)) {
      fail(where, "numerator/denominator must be absent or null when unit is not 'percentage'");
    }
    if (typeof value.value !== "number" || !Number.isFinite(value.value)) fail(where, "value must be a finite number");
    if (unit === "currency" && !Number.isInteger(value.value)) fail(where, "currency value must be an integer (minor units) for exact arithmetic");
    numericValue = value.value;
  }

  const span = validateSpan(value.span, `${where}.span`);
  return { line_item_id, metric_key, population_id, unit, period, currency, value: numericValue, numerator, denominator, span };
}

export function validateHeaderClaim(value, where, seenClaimIds) {
  if (!isPlainObject(value)) fail(where, "header claim must be an object");
  exactKeys(value, ["claim_id", "metric_key", "population_id", "unit", "period", "currency", "claimed_value", "span"], where);
  const claim_id = validateRecordId(value.claim_id, where);
  if (seenClaimIds.has(claim_id)) fail(where, `duplicate claim_id '${claim_id}' within one report`);
  seenClaimIds.add(claim_id);
  const metric_key = validateSlug(value.metric_key, `${where}.metric_key`);
  const population_id = validateSlug(value.population_id, `${where}.population_id`);
  const unit = validateSlug(value.unit, `${where}.unit`);
  const period = validatePeriod(value.period, `${where}.period`);
  let currency;
  if (unit === "currency") {
    currency = validateSlug(value.currency, `${where}.currency`);
  } else {
    if (value.currency !== null) fail(where, "currency must be null when unit is not 'currency'");
    currency = null;
  }
  if (typeof value.claimed_value !== "number" || !Number.isFinite(value.claimed_value)) fail(where, "claimed_value must be a finite number");
  if (unit === "currency" && !Number.isInteger(value.claimed_value)) fail(where, "currency claimed_value must be an integer (minor units) for exact arithmetic");
  const span = validateSpan(value.span, `${where}.span`);
  return { claim_id, metric_key, population_id, unit, period, currency, claimed_value: value.claimed_value, span };
}

/** One report record, as read from the resolved report-set fixture.
 *
 * EM-001 fix: this is now a CONTAINER-LEVEL preflight only — it validates
 * the report's own scalar fields and checks that statements/metrics/
 * header_claims are arrays within the schema-level length bound (the same
 * "bounded preflight may inspect containers/lengths, never walk uncharged
 * candidates" rule already applied to validateReportSetShape below). It
 * returns the RAW, not-yet-validated nested arrays. The caller (src/
 * index.js) charges the monotonic budget for each individual statement,
 * metric line and header claim via budget.countObject() BEFORE calling
 * validateStatement/validateMetricLine/validateHeaderClaim on that one
 * raw candidate — never before. The previous version of this function
 * eagerly mapped and fully validated every nested candidate here, which
 * read every candidate's fields before any budget charge ever happened
 * (EM-001: ChatGPT's exact-head review, 2026-10-15). */
export function validateReport(value, where) {
  if (!isPlainObject(value)) fail(where, "report must be an object");
  exactKeys(value, ["report_id", "content_ref", "source_principal", "workstream", "scope", "period", "statements", "metrics", "header_claims"], where);
  const report_id = validateRecordId(value.report_id, where);
  const content_ref = validateSourceRef(value.content_ref, `${where}.content_ref`);
  const source_principal = reqStr(value, "source_principal", where, { maxBytes: 256 });
  const workstream = validateSlug(value.workstream, `${where}.workstream`);
  const scope = validateSlug(value.scope, `${where}.scope`);
  const period = validatePeriod(value.period, `${where}.period`);

  if (!Array.isArray(value.statements) || value.statements.length > MAX_STATEMENTS_PER_REPORT) fail(where, `statements must be an array of at most ${MAX_STATEMENTS_PER_REPORT} entries`);
  if (!Array.isArray(value.metrics) || value.metrics.length > MAX_METRICS_PER_REPORT) fail(where, `metrics must be an array of at most ${MAX_METRICS_PER_REPORT} entries`);
  if (!Array.isArray(value.header_claims) || value.header_claims.length > MAX_HEADER_CLAIMS_PER_REPORT) fail(where, `header_claims must be an array of at most ${MAX_HEADER_CLAIMS_PER_REPORT} entries`);

  return {
    report_id,
    content_ref,
    source_principal,
    workstream,
    scope,
    period,
    statements: value.statements, // raw, unvalidated — see doc comment above
    metrics: value.metrics, // raw, unvalidated
    header_claims: value.header_claims, // raw, unvalidated
  };
}

/** Outer report-set shape: {reports:[...]}. Only the array shape and
 *  outer bound are checked here — the "bounded preflight may inspect
 *  containers/lengths" step; it must never walk an UNCHARGED candidate's
 *  own fields (see src/index.js). */
export function validateReportSetShape(parsed, where) {
  if (!isPlainObject(parsed)) fail(where, "report set must be an object");
  exactKeys(parsed, ["reports"], where);
  if (!Array.isArray(parsed.reports) || parsed.reports.length > MAX_REPORTS_SCHEMA) fail(where, `reports must be an array of at most ${MAX_REPORTS_SCHEMA} entries`);
  return parsed;
}

export { REPO_RE, PATH_RE, RECORD_ID_RE, SLUG_RE, PERIOD_RE };
