/**
 * schemas.js — strict runtime schemas. Unknown properties in
 * control-bearing objects are rejected; required fields, types, enums,
 * pins, IDs and timestamps are validated. A malformed request yields a
 * structured denial, never an exception or a default success.
 */

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HEX40_RE = /^[0-9a-f]{40}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export const EVENT_KINDS = new Set(["IMPRESSION", "CLICK", "CONVERSION", "SPEND", "REVENUE"]);
export const MONEY_KINDS = new Set(["SPEND", "REVENUE"]);
export const CONVERSION_KINDS = new Set(["CONVERSION", "REVENUE"]);
export const FIXTURE_KINDS = new Set([
  "campaigns",
  "events",
  "aggregate_counts",
  "bindings",
  "header_claims",
  "content_brief",
  "completeness",
  "taxonomy",
  "benefit_registry",
]);
export const METRIC_NAMES = new Set([
  "CTR",
  "CONVERSION_RATE",
  "ROAS",
  "SPEND_MINOR",
  "REVENUE_MINOR",
  "IMPRESSIONS",
  "CLICKS",
  "CONVERSIONS",
]);
export const OPERATIONS = new Set(["analyze"]);
/** Operations that are explicitly prohibited (capability absence). */
export const PROHIBITED_OPERATIONS = new Set([
  "publish",
  "send",
  "send_email",
  "spend",
  "activate",
  "approve",
  "deploy",
  "execute",
  "target",
]);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function checkProps(obj, allowed, required, label, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) errors.push(`${label}: unknown property ${JSON.stringify(k)}`);
  }
  for (const k of required) {
    if (!(k in obj)) errors.push(`${label}: missing required property ${JSON.stringify(k)}`);
  }
}

function checkId(v, label, errors) {
  if (typeof v !== "string" || !ID_RE.test(v)) {
    errors.push(`${label}: must match ${ID_RE} (got ${JSON.stringify(v)?.slice(0, 80)})`);
    return false;
  }
  return true;
}

function checkText(v, label, errors, maxLen) {
  if (typeof v !== "string" || v.length === 0 || v.length > maxLen) {
    errors.push(`${label}: must be a non-empty string of at most ${maxLen} chars`);
    return false;
  }
  return true;
}

/** Finite UTC instant with Z. Returns epoch ms or null. */
export function parseTimestamp(s) {
  if (typeof s !== "string" || !TS_RE.test(s)) return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString();
  const canon = s.includes(".") ? iso : iso.slice(0, 19) + "Z";
  if (canon !== s) return null;
  return ms;
}

function checkAmountMinor(v, label, errors) {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) {
    errors.push(`${label}: amount_minor must be an integer 0..2^53-1`);
    return false;
  }
  return true;
}

export function validateTask(task) {
  const errors = [];
  if (!isPlainObject(task)) return { ok: false, errors: ["task: must be an object"] };
  checkProps(
    task,
    new Set(["schema_version", "task_id", "operation", "fixture_refs", "options"]),
    ["schema_version", "task_id", "operation", "fixture_refs", "options"],
    "task",
    errors
  );
  if (task.schema_version !== "1") errors.push('task: schema_version must be "1"');
  checkId(task.task_id, "task.task_id", errors);
  if (typeof task.operation !== "string" || task.operation.length === 0) {
    errors.push("task: operation must be a non-empty string");
  }
  if (!Array.isArray(task.fixture_refs) || task.fixture_refs.length === 0 || task.fixture_refs.length > 16) {
    errors.push("task: fixture_refs must be a non-empty array of at most 16 refs");
  } else {
    const seen = new Set();
    task.fixture_refs.forEach((r, i) => {
      const label = `task.fixture_refs[${i}]`;
      if (!isPlainObject(r)) {
        errors.push(`${label}: must be an object`);
        return;
      }
      checkProps(r, new Set(["fixture_id", "kind"]), ["fixture_id", "kind"], label, errors);
      if (checkId(r.fixture_id, `${label}.fixture_id`, errors)) {
        if (seen.has(r.fixture_id)) errors.push(`${label}: duplicate fixture_id ${JSON.stringify(r.fixture_id)}`);
        seen.add(r.fixture_id);
      }
      if (typeof r.kind !== "string" || !FIXTURE_KINDS.has(r.kind)) {
        errors.push(`${label}.kind: must be one of ${[...FIXTURE_KINDS].join(",")}`);
      }
    });
  }
  if (!isPlainObject(task.options)) {
    errors.push("task: options must be an object");
  } else {
    const o = task.options;
    checkProps(
      o,
      new Set(["period", "mode", "include_drafts", "draft_max_codepoints", "pool_groups"]),
      ["period", "mode"],
      "task.options",
      errors
    );
    if (isPlainObject(o.period)) {
      checkProps(o.period, new Set(["start", "end"]), ["start", "end"], "task.options.period", errors);
      const s = parseTimestamp(o.period.start);
      const e = parseTimestamp(o.period.end);
      if (s === null) errors.push("task.options.period.start: must be a valid UTC ISO instant with Z");
      if (e === null) errors.push("task.options.period.end: must be a valid UTC ISO instant with Z");
      if (s !== null && e !== null && !(s < e)) errors.push("task.options.period: start must be before end");
    } else {
      errors.push("task.options.period: must be an object");
    }
    if (o.mode !== "event_rows" && o.mode !== "aggregate_counts") {
      errors.push('task.options.mode: must be "event_rows" or "aggregate_counts"');
    }
    if ("include_drafts" in o && typeof o.include_drafts !== "boolean") {
      errors.push("task.options.include_drafts: must be a boolean");
    }
    if ("draft_max_codepoints" in o) {
      if (!Number.isInteger(o.draft_max_codepoints) || o.draft_max_codepoints < 1 || o.draft_max_codepoints > 100000) {
        errors.push("task.options.draft_max_codepoints: must be an integer 1..100000");
      }
    }
    if ("pool_groups" in o) {
      if (!Array.isArray(o.pool_groups) || o.pool_groups.length > 16) {
        errors.push("task.options.pool_groups: must be an array of at most 16 groups");
      } else {
        const memberSeen = new Set();
        o.pool_groups.forEach((g, gi) => {
          if (!Array.isArray(g) || g.length < 2 || g.length > 32) {
            errors.push(`task.options.pool_groups[${gi}]: must be an array of 2..32 campaign ids`);
            return;
          }
          for (const m of g) {
            if (typeof m !== "string" || !ID_RE.test(m)) {
              errors.push(`task.options.pool_groups[${gi}]: invalid campaign id ${JSON.stringify(m)}`);
            } else if (memberSeen.has(m)) {
              errors.push(`task.options.pool_groups[${gi}]: campaign ${JSON.stringify(m)} in more than one group`);
            } else {
              memberSeen.add(m);
            }
          }
        });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateSourceRef(ref) {
  const errors = [];
  const label = "source_ref";
  if (!isPlainObject(ref)) return { ok: false, errors: [`${label}: must be an object`] };
  checkProps(
    ref,
    new Set(["repo", "path", "commit", "blob", "algorithm", "revision"]),
    ["repo", "path", "commit", "blob", "algorithm", "revision"],
    label,
    errors
  );
  if (typeof ref.repo !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(ref.repo)) {
    errors.push(`${label}.repo: invalid`);
  }
  if (typeof ref.path !== "string" || ref.path.length === 0 || ref.path.length > 256) {
    errors.push(`${label}.path: invalid`);
  } else if (
    ref.path.startsWith("/") ||
    ref.path.includes("\\") ||
    ref.path.startsWith("../") ||
    ref.path.includes("/../") ||
    ref.path.endsWith("/..") ||
    /(^|\/)\./.test(ref.path)
  ) {
    errors.push(`${label}.path: traversal/absolute/symlink-style paths rejected`);
  }
  if (typeof ref.commit !== "string" || !HEX40_RE.test(ref.commit)) {
    errors.push(`${label}.commit: must be 40-hex`);
  }
  if (typeof ref.blob !== "string" || !HEX40_RE.test(ref.blob)) {
    errors.push(`${label}.blob: must be 40-hex`);
  }
  if (ref.algorithm !== "git-sha1") errors.push(`${label}.algorithm: must be "git-sha1"`);
  if (typeof ref.revision !== "string" || ref.revision.length === 0 || ref.revision.length > 64) {
    errors.push(`${label}.revision: invalid`);
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Row validators. Each returns {ok, errors[], value} where value is the
// normalized row. recordId is used for diagnostics.
// ---------------------------------------------------------------------------

function rowBase(row, label, errors) {
  if (!isPlainObject(row)) {
    errors.push(`${label}: row must be an object`);
    return false;
  }
  return true;
}

export function validateCampaignRow(row, i) {
  const errors = [];
  const label = `campaigns.rows[${i}]`;
  if (!rowBase(row, label, errors)) return { ok: false, errors };
  checkProps(
    row,
    new Set(["campaign_id", "name", "objective", "currency", "notes"]),
    ["campaign_id", "name", "objective", "currency"],
    label,
    errors
  );
  checkId(row.campaign_id, `${label}.campaign_id`, errors);
  checkText(row.name, `${label}.name`, errors, 200);
  if (!isPlainObject(row.objective)) {
    errors.push(`${label}.objective: must be an object`);
  } else {
    checkProps(row.objective, new Set(["tag"]), ["tag"], `${label}.objective`, errors);
    checkText(row.objective.tag, `${label}.objective.tag`, errors, 64);
  }
  if (typeof row.currency !== "string" || !CURRENCY_RE.test(row.currency)) {
    errors.push(`${label}.currency: must be ISO-4217 3-letter code`);
  }
  if ("notes" in row) checkText(row.notes, `${label}.notes`, errors, 2000);
  return { ok: errors.length === 0, errors, value: row };
}

export function validateEventRow(row, i) {
  const errors = [];
  const label = `events.rows[${i}]`;
  if (!rowBase(row, label, errors)) return { ok: false, errors };
  checkProps(
    row,
    new Set(["event_id", "campaign_id", "timestamp", "kind", "amount_minor", "conversion_id", "attribution_campaign_id"]),
    ["event_id", "campaign_id", "timestamp", "kind"],
    label,
    errors
  );
  checkId(row.event_id, `${label}.event_id`, errors);
  checkId(row.campaign_id, `${label}.campaign_id`, errors);
  if (parseTimestamp(row.timestamp) === null) errors.push(`${label}.timestamp: must be a valid UTC ISO instant with Z`);
  if (typeof row.kind !== "string" || !EVENT_KINDS.has(row.kind)) {
    errors.push(`${label}.kind: must be one of ${[...EVENT_KINDS].join(",")}`);
  }
  if ("amount_minor" in row) {
    checkAmountMinor(row.amount_minor, `${label}.amount_minor`, errors);
  } else if (row.kind === "SPEND" || row.kind === "REVENUE") {
    errors.push(`${label}: amount_minor is required for kind ${row.kind}`);
  }
  if ("conversion_id" in row) checkId(row.conversion_id, `${label}.conversion_id`, errors);
  if ("attribution_campaign_id" in row) checkId(row.attribution_campaign_id, `${label}.attribution_campaign_id`, errors);
  return { ok: errors.length === 0, errors, value: row };
}

export function validateAggregateRow(row, i) {
  const errors = [];
  const label = `aggregate_counts.rows[${i}]`;
  if (!rowBase(row, label, errors)) return { ok: false, errors };
  checkProps(
    row,
    new Set(["campaign_id", "period_start", "period_end", "currency", "impressions", "clicks", "conversions", "spend_minor", "revenue_minor", "notes"]),
    ["campaign_id", "period_start", "period_end", "currency", "impressions", "clicks", "conversions", "spend_minor", "revenue_minor"],
    label,
    errors
  );
  checkId(row.campaign_id, `${label}.campaign_id`, errors);
  if (parseTimestamp(row.period_start) === null) errors.push(`${label}.period_start: invalid UTC instant`);
  if (parseTimestamp(row.period_end) === null) errors.push(`${label}.period_end: invalid UTC instant`);
  if (typeof row.currency !== "string" || !CURRENCY_RE.test(row.currency)) {
    errors.push(`${label}.currency: must be ISO-4217 3-letter code`);
  }
  for (const f of ["impressions", "clicks", "conversions"]) {
    if (!Number.isInteger(row[f]) || row[f] < 0 || row[f] > Number.MAX_SAFE_INTEGER) {
      errors.push(`${label}.${f}: must be an integer >= 0`);
    }
  }
  checkAmountMinor(row.spend_minor, `${label}.spend_minor`, errors);
  checkAmountMinor(row.revenue_minor, `${label}.revenue_minor`, errors);
  if ("notes" in row) checkText(row.notes, `${label}.notes`, errors, 2000);
  return { ok: errors.length === 0, errors, value: row };
}

export function validateBindingRow(row, i) {
  const errors = [];
  const label = `bindings.rows[${i}]`;
  if (!rowBase(row, label, errors)) return { ok: false, errors };
  checkProps(row, new Set(["event_id", "campaign_id"]), ["event_id", "campaign_id"], label, errors);
  checkId(row.event_id, `${label}.event_id`, errors);
  checkId(row.campaign_id, `${label}.campaign_id`, errors);
  return { ok: errors.length === 0, errors, value: row };
}

export function validateEvidenceSpan(sp, label, errors) {
  if (!isPlainObject(sp)) {
    errors.push(`${label}: evidence span must be an object`);
    return false;
  }
  checkProps(sp, new Set(["start_byte", "end_byte", "quoted_text"]), ["start_byte", "end_byte", "quoted_text"], label, errors);
  for (const f of ["start_byte", "end_byte"]) {
    if (!Number.isInteger(sp[f]) || sp[f] < 0 || sp[f] > 256 * 1024) {
      errors.push(`${label}.${f}: must be an integer 0..262144`);
    }
  }
  if (typeof sp.quoted_text !== "string" || sp.quoted_text.length > 4000) {
    errors.push(`${label}.quoted_text: must be a string of at most 4000 chars`);
  }
  if (Number.isInteger(sp.start_byte) && Number.isInteger(sp.end_byte) && sp.start_byte > sp.end_byte) {
    errors.push(`${label}: start_byte must not exceed end_byte`);
  }
  return errors.length === 0;
}

export function validateHeaderClaimRow(row, i) {
  const errors = [];
  const label = `header_claims.rows[${i}]`;
  if (!rowBase(row, label, errors)) return { ok: false, errors };
  checkProps(
    row,
    new Set(["claim_id", "campaign_id", "metric", "claimed_value", "rationale", "evidence_spans"]),
    ["claim_id", "campaign_id", "metric", "claimed_value"],
    label,
    errors
  );
  checkId(row.claim_id, `${label}.claim_id`, errors);
  checkId(row.campaign_id, `${label}.campaign_id`, errors);
  if (typeof row.metric !== "string" || !METRIC_NAMES.has(row.metric)) {
    errors.push(`${label}.metric: must be one of ${[...METRIC_NAMES].join(",")}`);
  }
  checkText(row.claimed_value, `${label}.claimed_value`, errors, 64);
  if ("rationale" in row) checkText(row.rationale, `${label}.rationale`, errors, 2000);
  if ("evidence_spans" in row) {
    if (!Array.isArray(row.evidence_spans) || row.evidence_spans.length > 1024) {
      errors.push(`${label}.evidence_spans: must be an array of at most 1024 spans`);
    } else {
      row.evidence_spans.forEach((sp, si) => validateEvidenceSpan(sp, `${label}.evidence_spans[${si}]`, errors));
    }
  }
  return { ok: errors.length === 0, errors, value: row };
}

export function validateBriefRow(row, i) {
  const errors = [];
  const label = `content_brief.rows[${i}]`;
  if (!rowBase(row, label, errors)) return { ok: false, errors };
  checkProps(
    row,
    new Set(["brief_id", "campaign_id", "product_label", "benefit_id", "cta_id", "template_ids"]),
    ["brief_id", "product_label", "benefit_id", "cta_id"],
    label,
    errors
  );
  checkId(row.brief_id, `${label}.brief_id`, errors);
  if ("campaign_id" in row) checkId(row.campaign_id, `${label}.campaign_id`, errors);
  checkText(row.product_label, `${label}.product_label`, errors, 200);
  checkId(row.benefit_id, `${label}.benefit_id`, errors);
  checkId(row.cta_id, `${label}.cta_id`, errors);
  if ("template_ids" in row) {
    if (!Array.isArray(row.template_ids) || row.template_ids.length === 0 || row.template_ids.length > 3) {
      errors.push(`${label}.template_ids: must be an array of 1..3 template ids`);
    } else {
      const seen = new Set();
      for (const t of row.template_ids) {
        if (!checkId(t, `${label}.template_ids[]`, errors)) break;
        if (seen.has(t)) errors.push(`${label}.template_ids: duplicate ${JSON.stringify(t)}`);
        seen.add(t);
      }
    }
  }
  return { ok: errors.length === 0, errors, value: row };
}

export function validateCompletenessRow(row, i) {
  const errors = [];
  const label = `completeness.rows[${i}]`;
  if (!rowBase(row, label, errors)) return { ok: false, errors };
  checkProps(row, new Set(["campaign_id", "complete", "notes"]), ["campaign_id", "complete"], label, errors);
  checkId(row.campaign_id, `${label}.campaign_id`, errors);
  if (typeof row.complete !== "boolean") errors.push(`${label}.complete: must be a boolean`);
  if ("notes" in row) checkText(row.notes, `${label}.notes`, errors, 2000);
  return { ok: errors.length === 0, errors, value: row };
}

export function validateTaxonomyRow(row, i) {
  const errors = [];
  const label = `taxonomy.rows[${i}]`;
  if (!rowBase(row, label, errors)) return { ok: false, errors };
  if (row.entry === "tag") {
    checkProps(row, new Set(["entry", "tag"]), ["entry", "tag"], label, errors);
    checkText(row.tag, `${label}.tag`, errors, 64);
  } else if (row.entry === "template") {
    checkProps(row, new Set(["entry", "template_id", "text"]), ["entry", "template_id", "text"], label, errors);
    checkId(row.template_id, `${label}.template_id`, errors);
    checkText(row.text, `${label}.text`, errors, 2000);
  } else if (row.entry === "cta") {
    checkProps(row, new Set(["entry", "cta_id", "text"]), ["entry", "cta_id", "text"], label, errors);
    checkId(row.cta_id, `${label}.cta_id`, errors);
    checkText(row.text, `${label}.text`, errors, 500);
  } else {
    errors.push(`${label}.entry: must be "tag", "template" or "cta"`);
  }
  return { ok: errors.length === 0, errors, value: row };
}

export function validateBenefitRow(row, i) {
  const errors = [];
  const label = `benefit_registry.rows[${i}]`;
  if (!rowBase(row, label, errors)) return { ok: false, errors };
  checkProps(row, new Set(["benefit_id", "benefit_text"]), ["benefit_id", "benefit_text"], label, errors);
  checkId(row.benefit_id, `${label}.benefit_id`, errors);
  checkText(row.benefit_text, `${label}.benefit_text`, errors, 500);
  return { ok: errors.length === 0, errors, value: row };
}

export const ROW_VALIDATORS = {
  campaigns: validateCampaignRow,
  events: validateEventRow,
  aggregate_counts: validateAggregateRow,
  bindings: validateBindingRow,
  header_claims: validateHeaderClaimRow,
  content_brief: validateBriefRow,
  completeness: validateCompletenessRow,
  taxonomy: validateTaxonomyRow,
  benefit_registry: validateBenefitRow,
};

/** Principal shape from the injected context. */
export function validatePrincipal(p) {
  const errors = [];
  if (!isPlainObject(p)) return { ok: false, errors: ["context.principal: must be an object"] };
  if (p.kind === "jason") {
    checkProps(p, new Set(["kind"]), ["kind"], "context.principal", errors);
  } else if (p.kind === "relay") {
    checkProps(p, new Set(["kind", "relay_id"]), ["kind", "relay_id"], "context.principal", errors);
    checkId(p.relay_id, "context.principal.relay_id", errors);
  } else {
    errors.push('context.principal.kind: must be "jason" or "relay"');
  }
  return { ok: errors.length === 0, errors };
}

export function validateClock(clock) {
  if (parseTimestamp(clock) === null) return { ok: false, errors: ["context.clock: must be a valid UTC ISO instant with Z"] };
  return { ok: true, errors: [] };
}
