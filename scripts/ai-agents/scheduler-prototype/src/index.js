/**
 * index.js — public entry for the Scheduler Agent prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. Deterministic synthetic CPM network
 * recomputation (early/late start/finish, total float), driving/critical
 * edges, calendar tick mapping, and source-claim discrepancy detection.
 * Invented scheduling arithmetic only — never a project date commitment.
 * The agent returns a detached advisory JSON snapshot; it cannot approve,
 * merge, deploy, activate, or reinterpret authorization.
 *
 * Budget discipline: every candidate object — the network bundle source,
 * EACH network record inside it, and EVERY element of the injected
 * trusted context — is charged with budget.countObject() as the FIRST
 * statement before any of its own fields are read. Attempt 65 refuses
 * before that candidate (or any later one) is inspected at all.
 * validateContext() requires the caller's live monotonic budget.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength } from "./canonical.js";
import { validateTask, validateContext, validateNetworkRecord, splitTopLevelArray, admitGraph, assertDeepNoAccessors, SchemaError } from "./schemas.js";
import { resolveSourceRef, hasReadGrant, makeBudget, BudgetError, ResolutionError, BUDGET_LIMITS } from "./resolver.js";
import { scanTexts } from "./injection.js";
import { analyzeComponent } from "./scheduler.js";

export const AGENT_ID = "scheduler-agent";
export const SCHEMA_VERSION = "1";

/**
 * S648-004: pre-validation task_id fallback. Preserves the caller's raw
 * task_id when it is a string; otherwise the documented "unavailable"
 * marker. Never hash-derived, never replaces a valid caller ID.
 *
 * S648A-001: single own-data-descriptor read. The prior two-step
 * (typeof check, then read) invoked an enumerable getter twice on the
 * refusal path; a nonenumerable getter bypassed detection entirely.
 * getOwnPropertyDescriptor never invokes accessors.
 *
 * S648-006: the echoed ID is byte-bounded. A 300KB task_id must not
 * become a 300KB refusal envelope; oversized IDs get a documented
 * bounded marker instead of the raw value.
 */
function requestTaskId(task) {
  if (task !== null && typeof task === "object") {
    const desc = Object.getOwnPropertyDescriptor(task, "task_id");
    if (desc && typeof desc.get !== "function" && typeof desc.set !== "function" && typeof desc.value === "string") {
      if (Buffer.byteLength(desc.value, "utf8") > 256) {
        return "[task-id-exceeds-256-bytes]";
      }
      return desc.value;
    }
  }
  return "unavailable";
}

/**
 * Explicit unavailable citation for values that carry no bundle source
 * span (task-input claims, constraint diagnostics). The brief permits an
 * explicit unavailable state where no verified span exists.
 */
function unavailableCitation(reason) {
  return {
    quoted_span: null,
    span: null,
    verification: "unavailable",
    reason,
  };
}

/**
 * S648-002: positional span verification under the live span budget.
 * Charges one span, then proves bytes[startByte:endByte] decode to exactly
 * the expected span text. Throws ResolutionError (SPAN_MISMATCH) on any
 * divergence, BudgetError when the span budget is exhausted.
 */
export function verifyRecordSpan(bytes, startByte, endByte, expectedText, budget, what) {
  budget.countSpan(what);
  if (!Number.isInteger(startByte) || !Number.isInteger(endByte) || startByte < 0 || endByte < startByte || endByte > bytes.length) {
    throw new ResolutionError("SPAN_MISMATCH", `span byte range [${startByte}, ${endByte}) is outside the source bytes`);
  }
  const slice = bytes.subarray(startByte, endByte).toString("utf8");
  if (slice !== expectedText) {
    throw new ResolutionError("SPAN_MISMATCH", "span bytes do not decode to the expected span text");
  }
  return { start_byte: startByte, end_byte: endByte, quoted_text: expectedText };
}

function envelope(taskId, { status, complete, source_refs = [], diagnostics = [], quarantined_sources = [], routing_flags = [], report = null }) {
  return {
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
    quarantined_sources,
    routing_flags,
    report: report ?? emptyReport(),
  };
}

function refused(taskId, code, severity, reason, extra = {}) {
  return envelope(taskId, {
    status: "REFUSED",
    complete: false,
    diagnostics: [{ code, severity, source_ref: null, record_id: null, reason }],
    ...extra,
  });
}

/**
 * S648-006: byte-bounded refusal. Every exit path — including early
 * structural refusals — must respect the exact output byte cap. If the
 * refusal envelope itself would exceed maxOutputBytes (e.g. an
 * oversized task_id echoed raw), fall back to a minimal bounded
 * envelope with a truncated reason. Ordinary refusals pass through
 * unchanged.
 */
function boundedRefused(taskId, code, severity, reason, extra = {}) {
  const env = refused(taskId, code, severity, reason, extra);
  if (canonicalByteLength(env) <= BUDGET_LIMITS.maxOutputBytes) return env;
  // Oversized: rebuild with a bounded marker ID and truncated reason.
  const minimal = refused(
    "[refusal-exceeds-output-cap]",
    code,
    severity,
    String(reason).slice(0, 500)
  );
  // If even the minimal envelope exceeds (pathological), truncate further.
  if (canonicalByteLength(minimal) > BUDGET_LIMITS.maxOutputBytes) {
    minimal.diagnostics[0].reason = String(reason).slice(0, 100);
  }
  return minimal;
}

function emptyReport() {
  return {
    components: [],
    claimed_comparisons: [],
    anomalies: [],
    coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0 },
    summary: null,
  };
}

export function run(task, context) {
  // S648-001: the monotonic object budget exists BEFORE any admission or
  // validation. S648-006: descriptor-safe admission is integrated with
  // this budget — admitGraph charges each distinct object BEFORE its
  // descriptor fields are examined, so candidate #65 refuses with
  // BUDGET_EXCEEDED without touching that candidate at all. The old
  // pre-budget full-graph sweep is gone; it defeated the cap by visiting
  // every candidate for free.
  const budget = makeBudget();
  try {
    admitGraph(task, "task", budget);
    admitGraph(context, "context", budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(requestTaskId(task), e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(requestTaskId(task), "INVALID_INPUT", "error", e.message);
    throw e;
  }

  // S648A-001: clock must be an own data property; validateContext
  // enforces this, but the early gate must not read through a prototype
  // either. A missing/inherited clock refuses here.
  const clockDesc = context !== null && typeof context === "object"
    ? Object.getOwnPropertyDescriptor(context, "clock")
    : undefined;
  const clockRaw = clockDesc && typeof clockDesc.get !== "function" && typeof clockDesc.set !== "function"
    ? clockDesc.value
    : undefined;
  if (!Number.isFinite(clockRaw)) return boundedRefused(requestTaskId(task), "INVALID_INPUT", "error", "context.clock must be a finite number");

  // S648-001: validateTask charges each task/control candidate before
  // reading its fields, under the same counter as context and network
  // records (idempotent via chargeObjectOnce — admission already charged
  // these objects, so validation charges are free).
  let validatedTask;
  try {
    validatedTask = validateTask(task, budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(requestTaskId(task), e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(requestTaskId(task), "INVALID_INPUT", "error", e.message);
    throw e;
  }
  const taskId = validatedTask.task_id;

  try {
    budget.countPayload(canonicalJson(task), "task payload");
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    throw e;
  }

  if (validatedTask.kind === "prohibited") {
    return boundedRefused(
      taskId,
      "ACTION_DENIED",
      "critical",
      `prohibited operation '${validatedTask.operation}': this agent only supports 'analyze' (read a fixture-only network and return an advisory recomputation); it cannot approve schedules, commit dates, publish, or mutate any record`
    );
  }

  // ALAP and any non-implemented constraint kinds are explicitly
  // unsupported in slice 1 — refuse before any math, no silent defaults.
  for (const c of validatedTask.constraints) {
    if (c.kind === "ALAP") {
      return boundedRefused(taskId, "UNSUPPORTED_CONSTRAINT", "error", `constraint kind 'ALAP' on activity '${c.activity_id}' is explicitly unsupported in slice 1; no undocumented default applied`);
    }
  }

  let ctx;
  try {
    ctx = validateContext(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", `context: ${e.message}`);
    throw e;
  }

  // Authenticated request authority: Jason or his registered Muse relay.
  if (ctx.principal.revoked) {
    return boundedRefused(taskId, "ACTION_DENIED", "critical", `principal '${ctx.principal.principal_id}' is revoked; no request authority`);
  }
  const validFrom = Date.parse(ctx.principal.valid_from);
  const expiresAt = Date.parse(ctx.principal.expires_at);
  if (!(validFrom <= ctx.clock && ctx.clock <= expiresAt)) {
    return boundedRefused(taskId, "ACTION_DENIED", "critical", `principal '${ctx.principal.principal_id}' is not valid at the current clock; no request authority`);
  }

  // Horizon policy: host criteria caps the requested horizon.
  if (validatedTask.horizon_days > ctx.criteria.max_horizon_days) {
    return boundedRefused(taskId, "INVALID_INPUT", "error", `horizon_days ${validatedTask.horizon_days} exceeds host policy max ${ctx.criteria.max_horizon_days}`);
  }

  // Resolve the network bundle.
  if (!hasReadGrant(validatedTask.network_bundle_ref, ctx.readGrants)) {
    return boundedRefused(taskId, "READ_DENIED", "error", `read grant missing for network bundle ${validatedTask.network_bundle_ref.repo}/${validatedTask.network_bundle_ref.path}`);
  }
  let bundleResolved;
  try {
    bundleResolved = resolveSourceRef(validatedTask.network_bundle_ref, ctx.sources, budget, "network bundle source");
  } catch (e) {
    if (e instanceof ResolutionError) return boundedRefused(taskId, e.code, "error", `network bundle: ${e.message}`);
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    throw e;
  }

  // Bounded-container preflight FIRST — raw spans, no field decoding.
  let spans;
  try {
    spans = splitTopLevelArray(bundleResolved.text, "network bundle");
  } catch (e) {
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  // ---- Charged pass: one countObject() per record, strictly before
  // that candidate's span is decoded or any of its fields read. ----
  // S648-002: each admitted record's original UTF-8 byte range is
  // preserved and verified under the live span budget before decoding.
  const bundleBytes = bundleResolved.bytes;
  const provisional = [];
  let budgetExceeded = false;
  for (let i = 0; i < spans.length; i++) {
    try {
      budget.countObject(`network[${i}]`);
    } catch (e) {
      if (e instanceof BudgetError) {
        budgetExceeded = true;
        break;
      }
      throw e;
    }
    const spanText = spans[i].text;
    try {
      verifyRecordSpan(bundleBytes, spans[i].startByte, spans[i].endByte, spanText, budget, `network[${i}] span`);
    } catch (e) {
      if (e instanceof ResolutionError) {
        return boundedRefused(taskId, "SPAN_MISMATCH", "error", `network bundle entry ${i} span verification failed: ${e.message}`);
      }
      if (e instanceof BudgetError) {
        budgetExceeded = true;
        break;
      }
      throw e;
    }
    let raw;
    try {
      raw = JSON.parse(spanText);
    } catch {
      return boundedRefused(taskId, "INVALID_INPUT", "error", `network bundle entry ${i} is not valid JSON`);
    }
    let rec;
    try {
      rec = validateNetworkRecord(raw, `network bundle[${i}]`);
    } catch (e) {
      if (e instanceof SchemaError) {
        return boundedRefused(taskId, "INVALID_INPUT", "error", `malformed network record at index ${i}: ${e.message}`);
      }
      throw e;
    }
    rec._citation = {
      quoted_span: spanText,
      span: { start_byte: spans[i].startByte, end_byte: spans[i].endByte, quoted_text: spanText },
      verification: "verified",
    };
    provisional.push(rec);
  }

  if (budgetExceeded) {
    return boundedRefused(taskId, "BUDGET_EXCEEDED", "error", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}; refusing before inspecting the remaining records`);
  }

  // Duplicate IDs are rejected outright — no first-wins, no dedup.
  // (Calendar records carry no id field; two calendars for one component
  // is a domain-level UNSUPPORTED_CALENDAR, not a schema duplicate.)
  const seenIds = new Map();
  for (const r of provisional) {
    if (r.record === "calendar") continue;
    const id = r.id;
    if (seenIds.has(id)) {
      return boundedRefused(taskId, "INVALID_INPUT", "error", `duplicate ${r.record} id '${id}'; duplicates are rejected outright`);
    }
    seenIds.set(id, r.record);
  }

  // Injection quarantine: records whose free-text note carries a seeded
  // directive family are quarantined and excluded from the network.
  // Quarantine is explicit; clean records still support unaffected math.
  const quarantined_sources = [];
  const quarantinedIds = new Set();
  const admitted = [];
  const diagnostics = [];
  for (const r of provisional) {
    const scan = scanTexts([r.note]);
    if (scan.injected) {
      const qid = r.record === "calendar" ? `calendar:${r.component}` : r.id;
      quarantinedIds.add(qid);
      quarantined_sources.push({ record_id: qid, reason: "INSTRUCTION_INJECTION_SEEDED_FAMILY" });
      diagnostics.push({
        code: "INSTRUCTION_INJECTION",
        severity: "critical",
        source_ref: null,
        record_id: qid,
        reason: `record '${qid}' note carries a seeded directive family; quarantined and excluded from the network`,
        // S648-005: material findings carry evidence states.
        evidence_state: "verified",
        evidence: { record_id: qid, citation: r._citation ?? null },
      });
    } else {
      admitted.push(r);
    }
  }

  const totalRecords = spans.length;
  // S648A-003: population completeness is host-established, never
  // task-asserted. The host declares expected_records on the registered
  // revision; it is bound to the resolved source identity here. The
  // task's own declared_total/complete must ALSO agree, but a request
  // header alone can never verify its own completeness. Absent host
  // declaration, or any mismatch, means unknown/incomplete coverage.
  const hostExpectedRecords = bundleResolved.expected_records;
  const populationVerified =
    Number.isInteger(hostExpectedRecords) &&
    hostExpectedRecords === totalRecords &&
    validatedTask.population.complete === true &&
    validatedTask.population.declared_total === totalRecords;
  const admittedCount = admitted.length;
  const excludedCount = totalRecords - admittedCount;

  if (admitted.length === 0) {
    const report = emptyReport();
    report.coverage = {
      state: populationVerified ? "COMPLETE_EMPTY" : "UNKNOWN_EMPTY",
      admitted_count: 0,
      excluded_count: excludedCount,
    };
    // S648A-003: an unknown or quarantined-away population may not become
    // a verified zero. complete is true only for a host-verified empty.
    return envelope(taskId, {
      status: "EMPTY",
      complete: populationVerified && quarantinedIds.size === 0,
      source_refs: [sourceRefOut(validatedTask.network_bundle_ref)],
      diagnostics,
      quarantined_sources,
      report,
    });
  }

  // Group admitted records by component.
  const byComponent = new Map();
  for (const r of admitted) {
    if (!byComponent.has(r.component)) byComponent.set(r.component, { activities: [], ties: [], calendars: [] });
    const g = byComponent.get(r.component);
    if (r.record === "activity") g.activities.push(r);
    else if (r.record === "tie") g.ties.push(r);
    else g.calendars.push(r);
  }

  // S648A-004: connected components are derived from the tie graph, not
  // from record.component labels. A label group whose activities form
  // multiple disconnected islands splits into independent components, each
  // with its own deadline (never a shared D creating false float). An
  // explicit deadline on a split label is ambiguous and refuses.
  //
  // Dangling/cross-label endpoints are validated HERE, before the island
  // partitioner can drop them. A tie with an unresolved endpoint is a
  // structural failure: the component is marked with the dangling evidence
  // and its math is suppressed (analyzeComponent returns DANGLING_TIE).
  // The evidence never disappears in partitioning.
  const componentGroups = [];
  const admittedActivityIds = new Set(admitted.filter((r) => r.record === "activity").map((r) => r.id));
  const activityComponentOf = new Map(admitted.filter((r) => r.record === "activity").map((r) => [r.id, r.component]));
  for (const [componentId, g] of [...byComponent.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    // S648A-004: endpoint validation before island splitting.
    let danglingTie = null;
    for (const t of g.ties) {
      for (const [role, ref] of [["predecessor", t.predecessor], ["successor", t.successor]]) {
        if (!admittedActivityIds.has(ref)) {
          danglingTie = { tie: t, role, missing_id: ref, quarantined: quarantinedIds.has(ref) };
          break;
        }
        if (activityComponentOf.get(ref) !== componentId) {
          danglingTie = { tie: t, role, missing_id: ref, cross_label: activityComponentOf.get(ref) };
          break;
        }
      }
      if (danglingTie) break;
    }
    if (danglingTie) {
      // Preserve the dangling evidence; math suppressed for this component.
      componentGroups.push({ componentId, ...g, danglingTie });
      continue;
    }
    if (g.activities.length <= 1) {
      componentGroups.push({ componentId, ...g });
      continue;
    }
    const adj = new Map(g.activities.map((a) => [a.id, []]));
    for (const t of g.ties) {
      if (adj.has(t.predecessor) && adj.has(t.successor)) {
        adj.get(t.predecessor).push(t.successor);
        adj.get(t.successor).push(t.predecessor);
      }
    }
    const islands = [];
    const visited = new Set();
    for (const a of g.activities) {
      if (visited.has(a.id)) continue;
      const island = [];
      const stack = [a.id];
      visited.add(a.id);
      while (stack.length > 0) {
        const id = stack.pop();
        island.push(id);
        for (const n of adj.get(id)) {
          if (!visited.has(n)) {
            visited.add(n);
            stack.push(n);
          }
        }
      }
      islands.push(island);
    }
    if (islands.length === 1) {
      componentGroups.push({ componentId, ...g });
    } else {
      const explicitDeadline = validatedTask.deadlines[componentId] ?? null;
      if (explicitDeadline !== null) {
        return boundedRefused(
          taskId,
          "DISCONNECTED_COMPONENT",
          "error",
          `component '${componentId}' has an explicit deadline but its ${g.activities.length} activities form ${islands.length} disconnected islands; deadline mapping is ambiguous`
        );
      }
      islands.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      islands.forEach((islandIds, idx) => {
        const islandSet = new Set(islandIds);
        componentGroups.push({
          componentId: `${componentId}~${idx}`,
          baseComponentId: componentId,
          activities: g.activities.filter((a) => islandSet.has(a.id)),
          ties: g.ties.filter((t) => islandSet.has(t.predecessor) && islandSet.has(t.successor)),
          calendars: g.calendars,
        });
      });
    }
  }

  // S648A-003: structural unknown references refuse outright — a
  // constraint on a missing activity is never silently discarded.
  const knownActivityIds = new Set(admitted.filter((r) => r.record === "activity").map((r) => r.id));
  for (const c of validatedTask.constraints) {
    if (!knownActivityIds.has(c.activity_id)) {
      return boundedRefused(
        taskId,
        "UNKNOWN_CONSTRAINT_REFERENCE",
        "error",
        `constraint '${c.kind}' references unknown activity '${c.activity_id}'; structural references must resolve, never silently ignored`
      );
    }
  }
  const anomalies = [];
  const usableConstraints = [...validatedTask.constraints];

  const components = [];
  let anyReady = false;
  let anyFailed = false;
  for (const grp of componentGroups) {
    const baseId = grp.baseComponentId ?? grp.componentId;
    // S648A-004: dangling evidence preserved from partitioning; math
    // suppressed, component fails with DANGLING_TIE (never silently pruned).
    if (grp.danglingTie) {
      const dt = grp.danglingTie;
      const failed = {
        status: "DANGLING_TIE",
        reason: `tie '${dt.tie.id}' references unknown ${dt.role} activity '${dt.missing_id}'` +
          (dt.quarantined ? " (quarantined and excluded from the network)" : "") +
          (dt.cross_label ? ` (in component '${dt.cross_label}')` : "") +
          "; structural dependency endpoints must resolve",
        detail: { tie_id: dt.tie.id, role: dt.role, missing_id: dt.missing_id },
        component_id: grp.componentId,
        anchor_date: validatedTask.anchors[baseId] ?? null,
        horizon_days: validatedTask.horizon_days,
        working_days: [],
        tick_count: 0,
        deadline_tick: validatedTask.deadlines[baseId] ?? null,
        activities: [],
        edges: [],
        critical_subgraph: {
          activities: [],
          edges: [],
          citation: {
            quoted_span: null,
            span: null,
            verification: "unavailable",
            reason: "no critical subgraph computed; dangling dependency suppressed math",
          },
        },
      };
      components.push(failed);
      anyFailed = true;
      diagnostics.push({
        code: "DANGLING_TIE",
        severity: "error",
        source_ref: null,
        record_id: grp.componentId,
        reason: failed.reason,
        // S648-005: material findings carry evidence states.
        evidence_state: "verified",
        evidence: { tie_id: dt.tie.id, citation: dt.tie._citation ?? null },
      });
      continue;
    }
    const result = analyzeComponent({
      componentId: grp.componentId,
      activities: grp.activities,
      ties: grp.ties,
      calendars: grp.calendars,
      anchorDate: validatedTask.anchors[baseId] ?? null,
      horizonDays: validatedTask.horizon_days,
      deadlineTick: validatedTask.deadlines[baseId] ?? null,
      constraints: usableConstraints,
    });
    components.push(result);
    if (result.status === "READY") anyReady = true;
    else {
      anyFailed = true;
      diagnostics.push({
        code: result.status,
        severity: "error",
        source_ref: null,
        record_id: grp.componentId,
        reason: result.reason,
        // S648-005: material findings carry evidence states.
        evidence_state: result.detail ? "verified" : "unavailable",
        evidence: result.detail ?? null,
      });
    }
  }

  // ---- Claimed comparisons against computed results. ----
  const claimed_comparisons = [];
  const computedById = new Map();
  const computedByComponent = new Map();
  for (const comp of components) {
    computedByComponent.set(comp.component_id, comp);
    if (comp.status !== "READY" && comp.status !== "CONSTRAINT_UNSATISFIABLE") continue;
    for (const a of comp.activities) computedById.set(a.id, { comp: comp.component_id, row: a });
  }

  for (const [id, claimed] of Object.entries(validatedTask.claimed.activities)) {
    const found = computedById.get(id);
    if (!found || found.row.civil_start === null) {
      claimed_comparisons.push({
        kind: "activity",
        activity_id: id,
        evidence_state: "unverifiable",
        reason: `no computed dates for activity '${id}'; claim cannot be checked`,
        claimed,
        claimed_citation: unavailableCitation("claimed values from task input; no bundle source span"),
        computed: null,
        computed_citation: null,
      });
      continue;
    }
    const c = found.row;
    const fields = ["es", "ef", "ls", "lf", "total_float"];
    const mismatches = fields.filter((f) => claimed[f] !== c[f]);
    claimed_comparisons.push({
      kind: "activity",
      activity_id: id,
      component_id: found.comp,
      evidence_state: mismatches.length === 0 ? "verified" : "mismatch",
      mismatched_fields: mismatches,
      claimed,
      claimed_citation: unavailableCitation("claimed values from task input; no bundle source span"),
      computed: { es: c.es, ef: c.ef, ls: c.ls, lf: c.lf, total_float: c.total_float },
      computed_citation: c.citation ?? null,
    });
    if (mismatches.length > 0) {
      diagnostics.push({
        code: "CLAIMED_VALUE_MISMATCH",
        severity: "error",
        source_ref: null,
        record_id: id,
        reason: `claimed ${mismatches.map((f) => `${f}=${claimed[f]}`).join(", ")} vs computed ${mismatches.map((f) => `${f}=${c[f]}`).join(", ")} for activity '${id}'; both preserved, claim not verified`,
        // S648-005: material findings carry evidence states.
        evidence_state: "mismatch",
        evidence: {
          claimed_citation: unavailableCitation("claimed values from task input; no bundle source span"),
          computed_citation: c.citation ?? null,
        },
      });
    }
  }

  for (const [compId, path] of Object.entries(validatedTask.claimed.critical_paths)) {
    const comp = computedByComponent.get(compId);
    if (!comp || comp.status !== "READY") {
      claimed_comparisons.push({
        kind: "critical_path",
        component_id: compId,
        evidence_state: "unverifiable",
        reason: `component '${compId}' has no feasible computed schedule; claimed path cannot be checked`,
        claimed_path: path,
        claimed_citation: unavailableCitation("claimed path from task input; no bundle source span"),
        computed_critical_subgraph: null,
        computed_citation: null,
      });
      continue;
    }
    const critEdgeSet = new Set(comp.critical_subgraph.edges.map((eid) => {
      const e = comp.edges.find((x) => x.id === eid);
      return `${e.predecessor}|${e.successor}`;
    }));
    let ok = true;
    let badStep = null;
    for (let i = 0; i < path.length - 1; i++) {
      if (!critEdgeSet.has(`${path[i]}|${path[i + 1]}`)) {
        ok = false;
        badStep = [path[i], path[i + 1]];
        break;
      }
    }
    // Every node on the path must itself be critical.
    if (ok) {
      const critActs = new Set(comp.critical_subgraph.activities);
      for (const id of path) {
        if (!critActs.has(id)) {
          ok = false;
          badStep = [id];
          break;
        }
      }
    }
    claimed_comparisons.push({
      kind: "critical_path",
      component_id: compId,
      evidence_state: ok ? "verified" : "mismatch",
      reason: ok ? `claimed path matches directed tight critical edges` : `claimed path breaks at ${JSON.stringify(badStep)}: not a directed chain of tight critical edges`,
      claimed_path: path,
      claimed_citation: unavailableCitation("claimed path from task input; no bundle source span"),
      computed_critical_subgraph: comp.critical_subgraph,
      computed_citation: comp.critical_subgraph.citation ?? null,
    });
    if (!ok) {
      diagnostics.push({
        code: "CLAIMED_PATH_MISMATCH",
        severity: "error",
        source_ref: null,
        record_id: null,
        reason: `claimed critical path for '${compId}' is not a directed chain of tight critical edges (breaks at ${JSON.stringify(badStep)}); computed subgraph preserved`,
        // S648-005: material findings carry evidence states.
        evidence_state: "mismatch",
        evidence: {
          claimed_citation: unavailableCitation("claimed path from task input; no bundle source span"),
          computed_citation: comp.critical_subgraph.citation ?? null,
        },
      });
    }
  }

  const claimMismatches = claimed_comparisons.filter((c) => c.evidence_state === "mismatch").length;
  const failedComponents = components.filter((c) => c.status !== "READY").length;
  const hasQuarantine = quarantinedIds.size > 0;

  let status;
  if (!anyReady) status = "PARTIAL";
  else if (anyFailed || claimMismatches > 0 || hasQuarantine) status = "PARTIAL";
  else status = "REPORT_READY";

  let coverageState;
  if (populationVerified) coverageState = failedComponents === 0 && claimMismatches === 0 && !hasQuarantine ? "COMPLETE" : "PARTIAL";
  else coverageState = "UNKNOWN";

  let summary = null;
  // S648A-003: no verified-complete summary when support was quarantined
  // away; a zero-activity summary over quarantined work is not complete.
  if (status === "REPORT_READY" && populationVerified && !hasQuarantine) {
    const critCount = components.reduce((n, c) => n + c.critical_subgraph.activities.length, 0);
    summary = {
      component_count: components.length,
      activity_count: components.reduce((n, c) => n + c.activities.length, 0),
      tie_count: components.reduce((n, c) => n + c.edges.length, 0),
      critical_activity_count: critCount,
      claimed_checks: claimed_comparisons.length,
      derivation_note: "synthetic recomputation only; never a project date commitment",
    };
  }

  const report = {
    components,
    claimed_comparisons,
    anomalies,
    coverage: { state: coverageState, admitted_count: admittedCount, excluded_count: excludedCount },
    summary,
  };

  const result = envelope(taskId, {
    status,
    // S648A-003: complete:true only for a verified-complete report.
    // Quarantined-away, unknown, or partial populations are never complete.
    complete: status === "REPORT_READY" && populationVerified && !hasQuarantine,
    source_refs: [sourceRefOut(validatedTask.network_bundle_ref)],
    diagnostics,
    quarantined_sources,
    routing_flags: [],
    report,
  });

  const outputRecords =
    result.report.components.length +
    result.report.claimed_comparisons.length +
    result.report.anomalies.length +
    result.diagnostics.length +
    result.quarantined_sources.length +
    result.source_refs.length +
    result.report.components.reduce((n, c) => n + c.activities.length + c.edges.length, 0);
  if (outputRecords > BUDGET_LIMITS.maxOutputRecords || canonicalByteLength(result) > BUDGET_LIMITS.maxOutputBytes) {
    return boundedRefused(taskId, "OUTPUT_LIMIT", "error", `final output envelope exceeds the ${BUDGET_LIMITS.maxOutputRecords}-record / ${BUDGET_LIMITS.maxOutputBytes}-byte output bounds`);
  }
  return result;
}

function sourceRefOut(r) {
  return { repo: r.repo, path: r.path, commit: r.commit, blob: r.blob, algorithm: r.algorithm, revision: r.revision };
}

export { validateTask, validateContext, BUDGET_LIMITS, canonicalJson, sha256HexUtf8, makeBudget };
