/**
 * index.js — public entry for the marketing-agent Phase 2 slice 1 prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. The agent has no file-write API, no
 * network, no tool calls: it returns a detached advisory JSON snapshot.
 * Advisory output is never an execution token: authorization_granted is
 * always false.
 *
 * Pipeline: task schema -> operation gate -> authority check -> scoped
 * fixture resolution (budgeted, pinned, charge-before-inspect) ->
 * classification -> event/aggregate metrics -> pooling -> header
 * comparison -> inert drafts -> budgeted envelope.
 *
 * Any refusal (malformed input, budget exhaustion, prohibited action,
 * conflicting identities) yields a structured REFUSED envelope with
 * complete:false and empty domain collections — never a partial success
 * and never an exception for malformed requests.
 */

import { Budget, BudgetError, BUDGET_LIMITS, measureDepth } from "./budget.js";
import { canonicalJson, sha256HexUtf8, utf8ByteLength } from "./canonical.js";
import { resolveFixtures } from "./resolver.js";
import {
  validateTask,
  validatePrincipal,
  validateClock,
  PROHIBITED_OPERATIONS,
  parseTimestamp,
} from "./schemas.js";
import {
  classifyCampaigns,
  processEventRows,
  dedupeConversions,
  applyAttribution,
  computeEventMetrics,
  computeAggregateMetrics,
  poolMetrics,
  compareHeaderClaims,
} from "./metrics.js";
import { renderDrafts } from "./drafts.js";
import { scanRow } from "./injection.js";

export const AGENT_ID = "marketing";
export const SCHEMA_VERSION = "1";
export const TAXONOMY_VERSION = "1";
export { BUDGET_LIMITS };

class RefusalSignal extends Error {
  constructor(code, reason, opts = {}) {
    super(reason);
    this.name = "RefusalSignal";
    this.code = code;
    this.severity = opts.severity ?? "error";
    this.sourceRef = opts.sourceRef ?? null;
    this.recordId = opts.recordId ?? null;
  }
}

class InputSignal extends Error {
  constructor(reason, sourceRef = null, recordId = null) {
    super(reason);
    this.name = "InputSignal";
    this.code = "INVALID_INPUT";
    this.severity = "error";
    this.sourceRef = sourceRef;
    this.recordId = recordId;
  }
}

function emptyReport() {
  return {
    taxonomy_version: TAXONOMY_VERSION,
    campaigns: [],
    metrics: [],
    pooled: [],
    header_comparisons: [],
    duplicate_groups: [],
    exclusions: [],
    coverage: { campaigns: 0, events_seen: 0, events_used: 0, events_excluded: 0, aggregate_rows: 0 },
    unattached_drafts: [],
  };
}

function diagKey(d) {
  return `${d.code}\0${d.record_id ?? ""}\0${d.reason}`;
}

function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort((a, b) => {
    const ka = diagKey(a);
    const kb = diagKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** task_id is derived once, identically for success and refusal paths. */
function deriveTaskId(task) {
  if (task !== null && typeof task === "object" && !Array.isArray(task)) {
    try {
      return `mkt-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`;
    } catch {
      // fall through to the invalid-task id
    }
  }
  return "mkt-invalid-task";
}

function denialEnvelope(taskId, code, severity, reason, sourceRef, recordId) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskId,
    status: "REFUSED",
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete: false,
    source_refs: [],
    diagnostics: sortDiagnostics([{ code, severity, source_ref: sourceRef ?? null, record_id: recordId ?? null, reason }]),
    quarantined_sources: [],
    routing_flags: [],
    report: emptyReport(),
  };
}

/** Small complete:false refusal for output-cap exhaustion: fixed short fields only. */
function outputLimitRefusal(taskId, reason) {
  return denialEnvelope(taskId, "OUTPUT_LIMIT", "error", reason, null, null);
}

function makeSession(task, context, budget) {
  const diagnostics = [];
  const quarantined = [];
  const quarantinedFixtureIds = new Set();
  const exclusionMap = new Map(); // key -> {reason, count, kinds, campaign_id}
  const sx = {
    budget,
    options: {
      include_drafts: task.options.include_drafts ?? true,
      draft_max_codepoints: task.options.draft_max_codepoints ?? 280,
      pool_groups: task.options.pool_groups ?? [],
      mode: task.options.mode,
    },
    periodIsoStart: task.options.period.start,
    periodIsoEnd: task.options.period.end,
    periodStart: parseTimestamp(task.options.period.start),
    periodEnd: parseTimestamp(task.options.period.end),
    campaigns: new Map(),
    metrics: new Map(),
    bindings: new Map(),
    completeness: new Map(),
    benefits: new Map(),
    tags: new Set(),
    templates: new Map(),
    ctas: new Map(),
    duplicateGroups: [],
    headerComparisons: [],
    pooled: [],
    fixtureBytes: new Map(),
    fixtureSourceRefs: new Map(),
    eventsSeen: 0,
    aggregateRows: 0,
    diag(code, severity, sourceRef, recordId, reason) {
      diagnostics.push({ code, severity, source_ref: sourceRef ?? null, record_id: recordId ?? null, reason });
    },
    quarantine(fixtureId, recordId, family, reason, sourceRef) {
      quarantinedFixtureIds.add(fixtureId);
      quarantined.push({ fixture_id: fixtureId, record_id: recordId ?? null, family, reason, source_ref: sourceRef ?? null });
    },
    exclude(reason, count, kinds, campaignId) {
      const key = `${reason}\0${campaignId ?? ""}`;
      let e = exclusionMap.get(key);
      if (!e) {
        e = { reason, count: 0, kinds: {}, campaign_id: campaignId ?? null };
        exclusionMap.set(key, e);
      }
      e.count += count;
      for (const [k, v] of Object.entries(kinds ?? {})) e.kinds[k] = (e.kinds[k] ?? 0) + v;
    },
    invalid(reason, sourceRef = null, recordId = null) {
      throw new InputSignal(reason, sourceRef, recordId);
    },
    refused(code, reason, opts = {}) {
      throw new RefusalSignal(code, reason, opts);
    },
    _diagnostics: diagnostics,
    _quarantined: quarantined,
    _quarantinedFixtureIds: quarantinedFixtureIds,
    _exclusionMap: exclusionMap,
  };
  return sx;
}

function checkAuthority(task, context, sx) {
  const principal = context.principal;
  if (principal.kind === "jason") return;
  if (principal.kind === "relay") {
    const clockMs = parseTimestamp(context.clock);
    const reg = (context.relays ?? []).find((r) => r.relay_id === principal.relay_id);
    if (
      reg &&
      reg.registered_by === "Jason" &&
      reg.revoked === false &&
      parseTimestamp(reg.valid_from) !== null &&
      parseTimestamp(reg.expires_at) !== null &&
      parseTimestamp(reg.valid_from) <= clockMs &&
      clockMs < parseTimestamp(reg.expires_at)
    ) {
      return;
    }
  }
  throw new RefusalSignal("AUTH_UNVERIFIED", "request authority not established: only Jason or a registered, unrevoked, currently-valid Muse relay is accepted", { severity: "error" });
}

function singleFixture(fixtures, task, kind, sx) {
  const ids = [...fixtures.entries()].filter(([, f]) => f.kind === kind).map(([id]) => id);
  if (ids.length > 1) sx.invalid(`more than one ${kind} fixture referenced: ${ids.join(",")}`);
  return ids.length === 1 ? fixtures.get(ids[0]) : null;
}

function runInner(task, context, taskId) {
  // 1. task envelope: depth-bounded, schema-valid, then budgeted.
  if (task === null || typeof task !== "object" || Array.isArray(task)) {
    throw new InputSignal("task: must be an object");
  }
  const depth = measureDepth(task);
  if (!depth.ok) throw new RefusalSignal("INPUT_TOO_DEEP", `task envelope refused before traversal: ${depth.reason}`);
  const tv = validateTask(task);
  if (!tv.ok) throw new InputSignal(`task invalid: ${tv.errors.join("; ")}`);

  const budget = new Budget();
  budget.chargeObject(1); // the task envelope, before inspection
  budget.chargeInputBytes(utf8ByteLength(canonicalJson(task)));

  // 2. operation gate: only the scoped advisory action is allowed.
  if (task.operation !== "analyze") {
    if (PROHIBITED_OPERATIONS.has(task.operation)) {
      throw new RefusalSignal("ACTION_DENIED", `operation ${JSON.stringify(task.operation)} is prohibited for this agent; no domain output`, { severity: "critical" });
    }
    throw new RefusalSignal("UNSUPPORTED_TASK", `operation ${JSON.stringify(task.operation)} is not supported; only "analyze"`);
  }

  // 3. context: separately trusted host injection (fixed clock, fixture
  //    store, grants, authority table). Task content cannot replace it.
  if (context === null || typeof context !== "object" || Array.isArray(context)) {
    throw new InputSignal("context: must be an object");
  }
  const cv = validateClock(context.clock);
  if (!cv.ok) throw new InputSignal(`context invalid: ${cv.errors.join("; ")}`);
  const pv = validatePrincipal(context.principal);
  if (!pv.ok) throw new InputSignal(`context invalid: ${pv.errors.join("; ")}`);
  if (typeof context.fixtures !== "object" || context.fixtures === null || Array.isArray(context.fixtures)) {
    throw new InputSignal("context.fixtures: must be an object map");
  }
  if (!Array.isArray(context.grants) || context.grants.some((g) => typeof g !== "string")) {
    throw new InputSignal("context.grants: must be an array of fixture id strings");
  }
  if (context.relays !== undefined && !Array.isArray(context.relays)) {
    throw new InputSignal("context.relays: must be an array");
  }

  const sx = makeSession(task, context, budget);
  checkAuthority(task, context, sx);

  // 4. scoped fixture resolution: budgeted, pinned, charge-before-inspect.
  const fixtures = resolveFixtures(task, context, sx);

  // 5. taxonomy (host-pinned v1): tags, templates, CTA registry.
  const taxFx = singleFixture(fixtures, task, "taxonomy", sx);
  if (!taxFx) sx.invalid("taxonomy fixture is required (host-pinned taxonomy v1)");
  for (const w of taxFx.rows) {
    const r = w.row;
    if (r.entry === "tag") {
      if (sx.tags.has(r.tag)) sx.invalid(`duplicate taxonomy tag ${JSON.stringify(r.tag)}`, w.source_ref, null);
      sx.tags.add(r.tag);
    } else if (r.entry === "template") {
      if (sx.templates.has(r.template_id)) sx.invalid(`duplicate template_id ${JSON.stringify(r.template_id)}`, w.source_ref, null);
      sx.templates.set(r.template_id, r.text);
    } else {
      if (sx.ctas.has(r.cta_id)) sx.invalid(`duplicate cta_id ${JSON.stringify(r.cta_id)}`, w.source_ref, null);
      sx.ctas.set(r.cta_id, r.text);
    }
  }
  if (sx.templates.size !== 3) {
    sx.invalid(`taxonomy must pin exactly 3 templates (host-pinned); found ${sx.templates.size}`, taxFx.source_ref, null);
  }

  // 6. campaigns + classification.
  const campFx = singleFixture(fixtures, task, "campaigns", sx);
  if (!campFx) sx.invalid("campaigns fixture is required");
  classifyCampaigns(campFx.rows, sx.tags, sx);

  // 7. completeness declarations (optional).
  const compFx = singleFixture(fixtures, task, "completeness", sx);
  if (compFx) {
    for (const w of compFx.rows) {
      const r = w.row;
      const hits = scanRow("completeness", r);
      if (hits.length > 0) {
        const h = hits[0];
        sx.quarantine(w.fixture_id, r.campaign_id, h.family, `completeness.notes matched injection family ${h.family}; notes dropped, typed declaration still analyzed`, w.source_ref);
        sx.diag("INSTRUCTION_INJECTION", "warning", w.source_ref, r.campaign_id, `quarantined completeness.notes (${h.family})`);
      }
      if (sx.completeness.has(r.campaign_id)) sx.invalid(`duplicate completeness row for ${JSON.stringify(r.campaign_id)}`, w.source_ref, r.campaign_id);
      sx.completeness.set(r.campaign_id, r.complete);
    }
  }

  // 8. bindings (optional): exact registered campaign bindings.
  const bindFx = singleFixture(fixtures, task, "bindings", sx);
  if (bindFx) {
    for (const w of bindFx.rows) {
      sx.budget.chargeSpan(2); // identity + binding evidence
      const r = w.row;
      if (!sx.bindings.has(r.event_id)) sx.bindings.set(r.event_id, []);
      sx.bindings.get(r.event_id).push(r.campaign_id);
    }
  }

  // 9. mode-specific metrics.
  const mode = task.options.mode;
  const hasEventsRef = [...fixtures.values()].some((f) => f.kind === "events");
  const hasAggRef = [...fixtures.values()].some((f) => f.kind === "aggregate_counts");
  if (hasEventsRef && hasAggRef) {
    throw new RefusalSignal("MIXED_EVIDENCE_MODE", "event rows and aggregate-count rows must never be mixed for the same population");
  }
  let eventsUsed = 0;
  if (mode === "event_rows") {
    const evFx = singleFixture(fixtures, task, "events", sx);
    if (!evFx) sx.invalid("events fixture is required in event_rows mode");
    sx.eventsSeen = evFx.rows.length;
    const valid = processEventRows(evFx.rows, sx);
    const deduped = dedupeConversions(valid, sx);
    const dedupExcluded = valid.length - deduped.length;
    const unattributed = applyAttribution(deduped, sx);
    let unattributedCount = 0;
    for (const ids of unattributed.values()) unattributedCount += ids.length;
    eventsUsed = deduped.length - unattributedCount;
    computeEventMetrics(deduped, unattributed, sx);
  } else {
    const aggFx = singleFixture(fixtures, task, "aggregate_counts", sx);
    if (!aggFx) sx.invalid("aggregate_counts fixture is required in aggregate_counts mode");
    sx.aggregateRows = aggFx.rows.length;
    computeAggregateMetrics(aggFx.rows, sx);
  }

  // 10. pooled rates for host-declared disjoint populations.
  const pooled = poolMetrics(sx.options.pool_groups, sx);

  // 11. header-claim comparison at the same grain.
  const hcFx = singleFixture(fixtures, task, "header_claims", sx);
  const headerComparisons = hcFx ? compareHeaderClaims(hcFx.rows, sx) : [];

  // 12. inert drafts.
  let draftsByCampaign = new Map();
  let unattachedDrafts = [];
  const briefFx = singleFixture(fixtures, task, "content_brief", sx);
  if (sx.options.include_drafts) {
    if (briefFx) {
      const benFx = singleFixture(fixtures, task, "benefit_registry", sx);
      if (!benFx) sx.invalid("benefit_registry fixture is required to render drafts");
      for (const w of benFx.rows) {
        if (sx.benefits.has(w.row.benefit_id)) sx.invalid(`duplicate benefit_id ${JSON.stringify(w.row.benefit_id)}`, w.source_ref, null);
        sx.benefits.set(w.row.benefit_id, w.row.benefit_text);
      }
      ({ draftsByCampaign, unattached: unattachedDrafts } = renderDrafts(briefFx.rows, sx));
    }
  } else if (briefFx) {
    sx.diag("CONTENT_BRIEF_IGNORED", "info", null, null, "content_brief referenced but include_drafts is false; no drafts rendered");
  }

  // 13. assemble the report.
  const campaignsOut = [...sx.campaigns.values()]
    .map((c) => ({
      campaign_id: c.row.campaign_id,
      classification: c.classification,
      taxonomy_version: TAXONOMY_VERSION,
      currency: c.currency,
      drafts: draftsByCampaign.get(c.row.campaign_id) ?? [],
    }))
    .sort((a, b) => (a.campaign_id < b.campaign_id ? -1 : 1));
  const metricsOut = [...sx.metrics.values()].sort((a, b) => (a.campaign_id < b.campaign_id ? -1 : 1));
  const exclusions = [...sx._exclusionMap.values()].sort((a, b) =>
    a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : (a.campaign_id ?? "") < (b.campaign_id ?? "") ? -1 : 1
  );
  const quarantined = [...sx._quarantined].sort((a, b) =>
    a.family < b.family ? -1 : a.family > b.family ? 1 : (a.record_id ?? "") < (b.record_id ?? "") ? -1 : 1
  );
  const report = {
    taxonomy_version: TAXONOMY_VERSION,
    campaigns: campaignsOut,
    metrics: metricsOut,
    pooled,
    header_comparisons: headerComparisons,
    duplicate_groups: sx.duplicateGroups,
    exclusions,
    coverage: {
      campaigns: sx.campaigns.size,
      events_seen: sx.eventsSeen,
      events_used: eventsUsed,
      events_excluded: sx.eventsSeen - eventsUsed,
      aggregate_rows: sx.aggregateRows,
    },
    unattached_drafts: unattachedDrafts,
  };

  // 14. status + completeness.
  let status;
  let complete;
  if (sx.campaigns.size === 0) {
    status = "EMPTY";
    complete = true;
    sx.diag("EMPTY_POPULATION", "info", null, null, "no campaigns registered; nothing to analyze");
  } else {
    const allComplete = [...sx.campaigns.keys()].every((id) => sx.completeness.get(id) === true);
    complete = allComplete && metricsOut.every((m) => m.status === "READY") && quarantined.length === 0;
    status = complete ? "REPORT_READY" : "PARTIAL";
  }

  const diagnostics = sortDiagnostics(sx._diagnostics);
  const source_refs = [];
  for (const [fid, ref] of sx.fixtureSourceRefs) {
    if (!sx._quarantinedFixtureIds.has(fid)) source_refs.push({ ...ref });
  }
  const routing_flags = [];

  // 15. output budget gate on the EXACT final envelope.
  const draftCount = campaignsOut.reduce((n, c) => n + c.drafts.length, 0) + unattachedDrafts.length;
  const outRecords =
    report.campaigns.length +
    report.metrics.length +
    report.pooled.length +
    report.header_comparisons.length +
    report.duplicate_groups.length +
    report.exclusions.length +
    draftCount +
    diagnostics.length +
    quarantined.length +
    source_refs.length +
    routing_flags.length;
  try {
    budget.chargeOutputRecord(outRecords);
  } catch (e) {
    if (e instanceof BudgetError) return outputLimitRefusal(taskId, e.message);
    throw e;
  }
  const result = {
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
    quarantined_sources: quarantined,
    routing_flags,
    report,
  };
  if (utf8ByteLength(canonicalJson(result)) > BUDGET_LIMITS.maxOutputBytes) {
    return outputLimitRefusal(taskId, `final output envelope exceeds ${BUDGET_LIMITS.maxOutputBytes} bytes`);
  }
  return result;
}

/**
 * run(task, context) -> result. Malformed requests, budget exhaustion,
 * prohibited actions and unsupported tasks yield structured REFUSED
 * denials — never an exception and never a default success.
 */
export function run(task, context) {
  const taskId = deriveTaskId(task);
  try {
    return runInner(task, context, taskId);
  } catch (e) {
    if (e instanceof RefusalSignal || e instanceof InputSignal || e instanceof BudgetError) {
      return denialEnvelope(taskId, e.code, e.severity ?? "error", e.message, e.sourceRef ?? null, e.recordId ?? null);
    }
    throw e;
  }
}
