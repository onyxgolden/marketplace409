/**
 * schemas.js — runtime validation for the Finance Agent prototype.
 * Strict: rejects unknown properties in control-bearing objects, absent
 * required fields, wrong types, invalid enum values, duplicate IDs,
 * nonfinite numbers, invalid dates. Pure Node 24 ESM, zero dependencies.
 *
 * CRITICAL (CS-001 / DOC-002 / FM-005 bug class): validateContext()
 * treats the injected trusted context as a CANDIDATE POPULATION, not a
 * free pre-pass. Every registered source, every revision within it,
 * every read grant, the principal record, the criteria record, and —
 * FIN-001 — EVERY chart entry inside the criteria are each object-charged
 * via budget.countObject() as the FIRST statement before any of that
 * candidate's own fields are read. A revision's text bytes are
 * payload-charged before acceptance whether or not that revision is ever
 * resolved/used — an unused oversized revision must still count against
 * the input budget, never traversed for free.
 * `budget` is REQUIRED.
 *
 * FIN-002: splitTopLevelArray() establishes the transaction bundle's
 * bounded container and yields raw per-element source spans WITHOUT
 * decoding any candidate's fields; the caller charges each candidate
 * before JSON.parse on its span. */

import { HEX40, parseMinorUnits, parseDecimalToRational } from "./canonical.js";

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

const REPO_RE = /^[a-z][a-z0-9-]{0,63}$/;
const PATH_RE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\.(md|txt|json)$/;
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ACCOUNT_CODE_RE = /^[A-Z0-9]{1,12}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

export const REQUESTED_OPERATION_ALLOWED = "analyze";
export const DIRECTIONS = ["IN", "OUT", "TRANSFER"];
export const ACCOUNT_CLASSES = ["INCOME", "EXPENSE", "ASSET", "LIABILITY", "EQUITY", "TRANSFER", "UNKNOWN"];
export const PRINCIPAL_ROLES = ["JASON", "MUSE_RELAY"];
export const MAX_TXNS_PER_BUNDLE_SCHEMA = 4096; // outer array-shape bound only; the 64-object budget gates real processing

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

/** Real calendar date (YYYY-MM-DD) or full UTC instant. Returns the string. */
export function validateDate(value, where) {
  if (typeof value !== "string") fail(where, "must be a string");
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      fail(where, "not a real calendar date");
    }
    return value;
  }
  if (ISO_RE.test(value)) {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) fail(where, "not a real calendar instant");
    return value;
  }
  fail(where, "must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ");
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
  const pid = reqStr(value, "principal_id", where);
  if (!RECORD_ID_RE.test(pid)) fail(where, `invalid principal_id '${pid}'`);
  if (!PRINCIPAL_ROLES.includes(value.role)) fail(where, `role must be one of ${PRINCIPAL_ROLES.join(", ")}`);
  const registered_by = reqStr(value, "registered_by", where);
  if (registered_by !== "jason") fail(where, "registered_by must be 'jason'");
  validateDate(value.valid_from, `${where}.valid_from`);
  validateDate(value.expires_at, `${where}.expires_at`);
  if (typeof value.revoked !== "boolean") fail(where, "revoked must be a boolean");
  return { principal_id: pid, role: value.role, registered_by, valid_from: value.valid_from, expires_at: value.expires_at, revoked: value.revoked };
}

/** Trusted criteria: versioned chart of accounts (exact code -> class),
 *  currency scale metadata, and the pinned chart document SourceRef.
 *  Host-injected only — never supplied or overridable by task content.
 *
 *  FIN-001: every chart entry is its own candidate. The live monotonic
 *  budget is REQUIRED; each entry is object-charged BEFORE its code/class
 *  is read. A poisoned 200-entry chart can no longer be enumerated for
 *  free under the single criteria charge. */
export function validateCriteria(value, where, budget) {
  if (!budget || typeof budget.countObject !== "function") fail(where, "internal: validateCriteria requires a live budget");
  if (!isPlainObject(value)) fail(where, "criteria must be an object");
  exactKeys(value, ["chart_version", "chart", "currency", "currency_scale", "chart_ref"], where);
  const chart_version = reqStr(value, "chart_version", where);
  if (!SLUG_RE.test(chart_version)) fail(where, `invalid chart_version '${chart_version}'`);
  if (!isPlainObject(value.chart)) fail(where, "chart must be an object");
  const chartEntries = Object.entries(value.chart);
  if (chartEntries.length === 0 || chartEntries.length > 256) fail(where, "chart must have 1..256 entries");
  const chart = {};
  for (const [code, cls] of chartEntries) {
    // Charge FIRST: the entry key is container-level (already enumerated),
    // the code/class pair is the candidate's own fields — unread until charged.
    budget.countObject(`${where}.chart[${code}]`);
    if (!ACCOUNT_CODE_RE.test(code)) fail(where, `invalid account code '${code}'`);
    if (!ACCOUNT_CLASSES.includes(cls)) fail(where, `account '${code}' class must be one of ${ACCOUNT_CLASSES.join(", ")}`);
    chart[code] = cls;
  }
  const currency = reqStr(value, "currency", where);
  if (!CURRENCY_RE.test(currency)) fail(where, `invalid currency '${currency}'`);
  const currency_scale = value.currency_scale;
  if (!Number.isInteger(currency_scale) || currency_scale < 0 || currency_scale > 6) {
    fail(where, "currency_scale must be an integer 0..6");
  }
  const chart_ref = validateSourceRef(value.chart_ref, `${where}.chart_ref`);
  return { chart_version, chart, currency, currency_scale, chart_ref };
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
 * validateContext(context, budget) — the injected trusted context is a
 * candidate population. Every source, every revision, every read grant,
 * the principal and the criteria are object-charged BEFORE any of their
 * fields are read. Revision text bytes are payload-charged before
 * acceptance. `budget` is REQUIRED.
 */
export function validateContext(context, budget) {
  if (!budget || typeof budget.countObject !== "function") fail("context", "internal: validateContext requires a live budget");
  if (!isPlainObject(context)) fail("context", "must be an object");
  exactKeys(context, ["clock", "sources", "readGrants", "principal", "criteria"], "context");
  const clock = context.clock;
  if (!Number.isFinite(clock)) fail("context", "clock must be a finite number");

  if (!isPlainObject(context.sources)) fail("context", "sources must be an object");
  const sourceKeys = Object.keys(context.sources);
  if (sourceKeys.length === 0 || sourceKeys.length > 64) fail("context", "sources must have 1..64 entries");
  for (const sk of sourceKeys) {
    budget.countObject(`context.sources[${sk}]`);
    const entry = context.sources[sk];
    if (!isPlainObject(entry)) fail("context", `source '${sk}' must be an object`);
    const revs = entry.revisions;
    if (!isPlainObject(revs)) fail("context", `source '${sk}' revisions must be an object`);
    for (const commit of Object.keys(revs)) {
      budget.countObject(`context.sources[${sk}]@${commit}`);
      const rev = revs[commit];
      if (!isPlainObject(rev)) fail("context", `source '${sk}' revision '${commit}' must be an object`);
      if (typeof rev.text !== "string") fail("context", `source '${sk}' revision '${commit}' text must be a string`);
      budget.countPayload(rev.text, `context source ${sk}@${commit}`);
      if (typeof rev.blob !== "string" || !HEX40.test(rev.blob)) fail("context", `source '${sk}' revision '${commit}' blob must be a 40-hex Git object ID`);
    }
  }

  if (!Array.isArray(context.readGrants)) fail("context", "readGrants must be an array");
  const readGrants = context.readGrants.map((g, i) => {
    budget.countObject(`context.readGrants[${i}]`);
    return validateReadGrant(g, `context.readGrants[${i}]`);
  });

  budget.countObject("context.principal");
  const principal = validatePrincipal(context.principal, "context.principal");
  budget.countObject("context.criteria");
  // FIN-001: the criteria charge covers the record itself; validateCriteria
  // charges each chart entry as its own candidate on the same budget.
  const criteria = validateCriteria(context.criteria, "context.criteria", budget);

  return { clock, sources: context.sources, readGrants, principal, criteria };
}

/** Task input schema. kind: "analyze" | "prohibited". */
export function validateTask(task) {
  if (!isPlainObject(task)) fail("task", "must be an object");
  exactKeys(task, ["schema_version", "task_id", "operation", "fixture_refs", "options"], "task");
  if (task.schema_version !== "1") fail("task", "schema_version must be '1'");
  const task_id = reqStr(task, "task_id", "task", { maxBytes: 2048 });
  const operation = reqStr(task, "operation", "task", { maxBytes: 256 });

  if (!isPlainObject(task.fixture_refs)) fail("task", "fixture_refs must be an object");
  exactKeys(task.fixture_refs, ["transaction_bundle"], "task.fixture_refs");
  const transaction_bundle_ref = validateSourceRef(task.fixture_refs.transaction_bundle, "task.fixture_refs.transaction_bundle");

  if (!isPlainObject(task.options)) fail("task", "options must be an object");
  exactKeys(task.options, ["population", "period", "header_claims"], "task.options");

  const pop = task.options.population;
  if (!isPlainObject(pop)) fail("task.options.population", "must be an object");
  exactKeys(pop, ["declared_total", "complete"], "task.options.population");
  if (!Number.isInteger(pop.declared_total) || pop.declared_total < 0) fail("task.options.population", "declared_total must be a nonnegative integer");
  if (typeof pop.complete !== "boolean") fail("task.options.population", "complete must be a boolean");

  const period = task.options.period;
  if (!isPlainObject(period)) fail("task.options.period", "must be an object");
  exactKeys(period, ["start_date", "end_date", "opening_balance_minor", "currency"], "task.options.period");
  const start_date = validateDate(period.start_date, "task.options.period.start_date");
  const end_date = validateDate(period.end_date, "task.options.period.end_date");
  if (start_date > end_date) fail("task.options.period", "start_date must not be after end_date");
  // opening_balance_minor is a CLAIMED input (declared opening), never
  // independently verified — the report labels derived balances accordingly.
  let opening_balance_minor;
  try {
    opening_balance_minor = parseMinorUnits(period.opening_balance_minor, "task.options.period.opening_balance_minor");
  } catch (e) {
    fail("task.options.period", e.message);
  }
  const currency = reqStr(period, "currency", "task.options.period");
  if (!CURRENCY_RE.test(currency)) fail("task.options.period", `invalid currency '${currency}'`);

  const hc = task.options.header_claims;
  if (!isPlainObject(hc)) fail("task.options.header_claims", "must be an object");
  const HC_KEYS = ["subtotal_minor", "tax_total_minor", "grand_total_minor", "income_total_minor", "expense_total_minor", "net_income_minor", "closing_balance_minor"];
  exactKeys(hc, HC_KEYS, "task.options.header_claims");
  const header_claims = {};
  for (const k of HC_KEYS) {
    const v = hc[k] === undefined ? null : hc[k];
    if (v !== null) {
      try {
        header_claims[k] = parseMinorUnits(v, `task.options.header_claims.${k}`);
      } catch (e) {
        fail("task.options.header_claims", e.message);
      }
    } else {
      header_claims[k] = null;
    }
  }

  return {
    task_id,
    operation,
    transaction_bundle_ref,
    population: { declared_total: pop.declared_total, complete: pop.complete },
    period: { start_date, end_date, opening_balance_minor, currency },
    header_claims,
    kind: operation === REQUESTED_OPERATION_ALLOWED ? "analyze" : "prohibited",
  };
}

/**
 * One transaction record. amount_minor is a signed integer string;
 * direction IN/OUT/TRANSFER. Invoice fields (quantity, unit_price_minor,
 * tax_rate) are optional — transactions without them need no invented
 * tax calculation. description is UNTRUSTED free text.
 *
 * TRANSFER rows require transfer_pair_id (paired internal IDs). Signed
 * contra entries are allowed; amounts are never silently absolute-valued.
 */
export function validateTransaction(value, where) {
  if (!isPlainObject(value)) fail(where, "transaction must be an object");
  exactKeys(
    value,
    ["transaction_id", "date", "account_code", "direction", "amount_minor", "currency", "quantity", "unit_price_minor", "tax_rate", "transfer_pair_id", "description"],
    where
  );
  const tid = reqStr(value, "transaction_id", where);
  if (!RECORD_ID_RE.test(tid)) fail(where, `invalid transaction_id '${tid}'`);
  const date = validateDate(value.date, `${where}.date`);
  const account_code = reqStr(value, "account_code", where);
  if (!ACCOUNT_CODE_RE.test(account_code)) fail(where, `invalid account_code '${account_code}'`);
  if (!DIRECTIONS.includes(value.direction)) fail(where, `direction must be one of ${DIRECTIONS.join(", ")}`);
  let amount_minor;
  try {
    amount_minor = parseMinorUnits(value.amount_minor, `${where}.amount_minor`);
  } catch (e) {
    fail(where, e.message);
  }
  const currency = reqStr(value, "currency", where);
  if (!CURRENCY_RE.test(currency)) fail(where, `invalid currency '${currency}'`);

  let quantity = null;
  let unit_price_minor = null;
  let tax_rate = null;
  const hasInvoice = value.quantity !== undefined || value.unit_price_minor !== undefined || value.tax_rate !== undefined;
  if (hasInvoice) {
    if (value.quantity === undefined || value.unit_price_minor === undefined || value.tax_rate === undefined) {
      fail(where, "invoice fields quantity/unit_price_minor/tax_rate must appear together or not at all");
    }
    try {
      quantity = parseDecimalToRational(value.quantity, `${where}.quantity`);
    } catch (e) {
      fail(where, e.message);
    }
    try {
      unit_price_minor = parseMinorUnits(value.unit_price_minor, `${where}.unit_price_minor`);
    } catch (e) {
      fail(where, e.message);
    }
    try {
      tax_rate = parseDecimalToRational(value.tax_rate, `${where}.tax_rate`);
    } catch (e) {
      fail(where, e.message);
    }
    if (tax_rate.num < 0n) fail(where, "tax_rate must not be negative");
  }

  let transfer_pair_id = null;
  if (value.direction === "TRANSFER") {
    if (value.transfer_pair_id === undefined || value.transfer_pair_id === null) {
      fail(where, "TRANSFER direction requires transfer_pair_id");
    }
    transfer_pair_id = reqStr(value, "transfer_pair_id", where);
    if (!RECORD_ID_RE.test(transfer_pair_id)) fail(where, `invalid transfer_pair_id '${transfer_pair_id}'`);
  } else if (value.transfer_pair_id !== undefined && value.transfer_pair_id !== null) {
    fail(where, "transfer_pair_id is only allowed with TRANSFER direction");
  }

  const description = value.description === undefined ? "" : reqStr(value, "description", where, { allowEmpty: true, maxBytes: 4096 });

  return {
    transaction_id: tid,
    date,
    account_code,
    direction: value.direction,
    amount_minor,
    currency,
    quantity,
    unit_price_minor,
    tax_rate,
    transfer_pair_id,
    description,
    _hasInvoice: hasInvoice,
  };
}

/** FIN-002 — bounded-container preflight.
 *
 *  splitTopLevelArray(text, where) verifies the bundle text is a JSON
 *  array and returns the RAW SOURCE SPAN of each top-level element —
 *  WITHOUT decoding any element's fields. It is a structural scanner,
 *  not a parser: it tracks nesting depth and string boundaries (with
 *  escape awareness) and never unescapes, interprets, or validates a
 *  candidate's own content. The caller must budget.countObject() each
 *  candidate FIRST, then JSON.parse only that candidate's span.
 *
 *  Malformed structure -> SchemaError (INVALID_INPUT). A structurally
 *  valid but schema-invalid element survives this scan untouched; only
 *  the charged per-candidate decode can reject it — which is exactly
 *  what the FIN-002 sentinel test proves never happens past the budget.
 */
const WS_CHARS = new Set([" ", "\t", "\n", "\r"]);

function scanScalar(text, i, where) {
  const n = text.length;
  for (const lit of ["true", "false", "null"]) {
    if (text.startsWith(lit, i)) {
      const after = i + lit.length;
      if (after < n && /[A-Za-z0-9_$]/.test(text[after])) fail(where, "transaction bundle is not a valid JSON array");
      return after;
    }
  }
  // Number: consume the numeric charset leniently; JSON.parse validates
  // the exact grammar per span later.
  let j = i;
  while (j < n && /[-+0-9.eE]/.test(text[j])) j++;
  if (j === i) fail(where, "transaction bundle is not a valid JSON array");
  return j;
}

/** Scan one complete composite value (string/object/array) starting at i;
 *  return the index just past it. Structural only — strings are skipped
 *  by boundary, never unescaped. */
function scanComposite(text, i, where) {
  const n = text.length;
  if (text[i] === '"') {
    // Bare string element: scan to its closing quote, never unescaping.
    i++;
    while (i < n) {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i] === '"') return i + 1;
      if (text[i] < " ") fail(where, "transaction bundle is not a valid JSON array");
      i++;
    }
    fail(where, "transaction bundle is not a valid JSON array");
  }
  const stack = [];
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      i++;
      while (i < n) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === '"') break;
        if (text[i] < " ") fail(where, "transaction bundle is not a valid JSON array");
        i++;
      }
      if (i >= n) fail(where, "transaction bundle is not a valid JSON array");
      i++; // past the closing quote
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      const open = stack.pop();
      if ((ch === "}" && open !== "{") || (ch === "]" && open !== "[")) {
        fail(where, "transaction bundle is not a valid JSON array");
      }
      if (stack.length === 0) return i + 1;
    }
    i++;
  }
  fail(where, "transaction bundle is not a valid JSON array");
}

export function splitTopLevelArray(text, where) {
  if (typeof text !== "string") fail(where, "transaction bundle must be a JSON array");
  const n = text.length;
  let i = 0;
  while (i < n && WS_CHARS.has(text[i])) i++;
  if (i >= n || text[i] !== "[") fail(where, "transaction bundle must be a JSON array");
  i++; // past '['
  const spans = [];
  let afterComma = false; // ']' is legal only for the empty bundle — never after a comma or an element
  for (;;) {
    while (i < n && WS_CHARS.has(text[i])) i++;
    if (i >= n) fail(where, "transaction bundle is not a valid JSON array");
    if (text[i] === "]") {
      if (afterComma || spans.length > 0) fail(where, "transaction bundle is not a valid JSON array");
      i++;
      while (i < n && WS_CHARS.has(text[i])) i++;
      if (i !== n) fail(where, "transaction bundle has trailing content");
      return spans;
    }
    const start = i;
    const c = text[i];
    if (c === '"' || c === "{" || c === "[") i = scanComposite(text, i, where);
    else if (c === "t" || c === "f" || c === "n" || c === "-" || (c >= "0" && c <= "9") || c === "+") {
      i = scanScalar(text, i, where);
    } else {
      fail(where, "transaction bundle is not a valid JSON array");
    }
    spans.push(text.slice(start, i));
    if (spans.length > MAX_TXNS_PER_BUNDLE_SCHEMA) fail(where, `transaction bundle exceeds ${MAX_TXNS_PER_BUNDLE_SCHEMA} entries`);
    afterComma = false;
    while (i < n && WS_CHARS.has(text[i])) i++;
    if (i >= n) fail(where, "transaction bundle is not a valid JSON array");
    const sep = text[i];
    if (sep === ",") { i++; afterComma = true; continue; }
    if (sep === "]") {
      i++;
      while (i < n && WS_CHARS.has(text[i])) i++;
      if (i !== n) fail(where, "transaction bundle has trailing content");
      return spans;
    }
    fail(where, "transaction bundle is not a valid JSON array");
  }
}

export { REPO_RE, PATH_RE, RECORD_ID_RE, SLUG_RE, ACCOUNT_CODE_RE, CURRENCY_RE };
