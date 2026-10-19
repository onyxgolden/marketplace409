/**
 * index.js — public entry for the Sales Agent prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. Deterministic lead classification over
 * preloaded registered synthetic lead bundles: fit precedence
 * (explicit false -> FIT_LOW; missing facts -> FIT_UNKNOWN; both true +
 * timing<=90 -> FIT_HIGH; else FIT_MEDIUM), do_not_contact suppression
 * checked BEFORE draft construction (zero variants when suppressed), two
 * inert outreach drafts per eligible FIT_HIGH lead, and exact
 * BigInt/integer-rational pipeline-health arithmetic. No CRM, no network,
 * no dispatch, no real prospect information. The agent returns a detached
 * advisory JSON snapshot; it cannot approve, merge, deploy, activate,
 * send, or reinterpret authorization.
 *
 * Admission order (S653-006): trap-free Proxy rejection first, then the
 * task, then the context CONTROL plane (clock, grants, principal,
 * criteria, product registry — the sources container is charged but never
 * walked). Principal authority AND validity window are enforced next.
 * Only then, per fixture_ref: read-grant check FIRST, then admission of
 * that one source entry, then blob verification. Denied/unselected source
 * metadata is never touched.
 *
 * Budget discipline: every candidate object — the task, EVERY element of
 * the injected trusted context, each fixture record — is charged with
 * budget.countObject()/chargeObjectOnce() as the FIRST statement before
 * any of its own fields are read, and every reachable string's UTF-8
 * bytes are charged against the single 256-KiB aggregate input budget.
 * Attempt 65 refuses before that candidate (or any later one) is
 * inspected at all; record slots are charged BEFORE JSON.parse decodes
 * them. validateContextControl() requires the caller's live monotonic
 * budget.
 *
 * Population completeness (S653-001): a definitive summary requires
 * TRUSTED, applicable coverage — the host's registered expected_records
 * matching admitted spans for every bundle, the caller's identity claims
 * matching, AND the declared dataset_id/dataset_version binding to every
 * resolved bundle's host-registered identity. A matching caller claim
 * alone never establishes it. Missing/contradictory/unknown coverage
 * suppresses the summary and complete:true; recomputed metrics stay
 * available as partial results.
 */

import { types } from "node:util";
import { canonicalJson, sha256HexUtf8, canonicalByteLength } from "./canonical.js";
import {
  validateTask, validateContextControl, validateSourceEntry, validateLeadRecord,
  splitTopLevelArray, admitGraph, assertDenseArray, assertNotProxy,
  principalWindowLive, SchemaError,
} from "./schemas.js";
import { resolveSourceRef, hasReadGrant, makeBudget, BudgetError, ResolutionError, BUDGET_LIMITS } from "./resolver.js";
import { scanTexts } from "./injection.js";
import { classifyFit, checkSuppression, buildDrafts, computePipelineMetrics, compareHeaderClaims } from "./sales.js";

export const AGENT_ID = "sales-agent";
export const SCHEMA_VERSION = "1";

/**
 * Pre-validation task_id fallback. Preserves the caller's raw task_id
 * when it is a string; otherwise the documented "unavailable" marker.
 * Only safe to call AFTER the trap-free Proxy gate: descriptor reflection
 * on a Proxy would fire user traps (S653-006).
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
 * Admit the context control plane: trap-free Proxy gate, object charging,
 * and UTF-8 byte charging for every reachable string — but the sources
 * container is charged and descriptor-checked WITHOUT recursing into it.
 * Source entries are admitted individually, per granted ref, after the
 * grant check (S653-006).
 */
function admitContextControlGraph(context, budget) {
  assertNotProxy(context, "context");
  budget.chargeObjectOnce(context, "context");
  for (const k of Object.getOwnPropertyNames(context)) {
    budget.countPayload(k, "context property name");
    const desc = Object.getOwnPropertyDescriptor(context, k);
    if (!desc) continue;
    if (typeof desc.get === "function" || typeof desc.set === "function") {
      throw new SchemaError(`context: accessor property '${k}' is not plain data; refusing`);
    }
    if (typeof desc.value === "function") {
      throw new SchemaError(`context: function property '${k}' is not plain data; refusing`);
    }
    if (typeof desc.value === "symbol") {
      throw new SchemaError(`context: symbol property '${k}' is not plain data; refusing`);
    }
    if (k === "sources") {
      // Charged, proxy-checked, descriptor-checked — never walked.
      assertNotProxy(desc.value, "context.sources");
      budget.chargeObjectOnce(desc.value, "context.sources");
      if (desc.value !== null && typeof desc.value === "object") {
        for (const kk of Object.getOwnPropertyNames(desc.value)) {
          const dd = Object.getOwnPropertyDescriptor(desc.value, kk);
          if (dd && (typeof dd.get === "function" || typeof dd.set === "function")) {
            throw new SchemaError(`context.sources: accessor property '${kk}' is not plain data; refusing`);
          }
        }
      }
      continue;
    }
    admitGraph(desc.value, `context.${String(k)}`, budget);
  }
  for (const s of Object.getOwnPropertySymbols(context)) {
    throw new SchemaError(`context: symbol-keyed property '${String(s)}' is not plain data; refusing`);
  }
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
    report: report === undefined ? null : report,
  };
}

function refused(taskId, code, severity, reason, extra = {}) {
  return envelope(taskId, {
    status: "REFUSED",
    complete: false,
    diagnostics: [{ code, severity, source_ref: null, record_id: null, reason }],
    report: null,
    ...extra,
  });
}

/** Byte-bounded refusal: every exit path respects the output byte cap. */
function boundedRefused(taskId, code, severity, reason, extra = {}) {
  const env = refused(taskId, code, severity, reason, extra);
  if (canonicalByteLength(env) <= BUDGET_LIMITS.maxOutputBytes) return env;
  const minimal = refused(
    "[refusal-exceeds-output-cap]",
    code,
    severity,
    String(reason).slice(0, 500)
  );
  if (canonicalByteLength(minimal) > BUDGET_LIMITS.maxOutputBytes) {
    minimal.diagnostics[0].reason = String(reason).slice(0, 100);
  }
  return minimal;
}

/**
 * Verify a raw record span byte-exactly: the slice must decode to the
 * quoted text AND re-encode to the identical bytes (UTF-8 boundary and
 * round-trip check, S653-002). Returns the span record for the citation.
 */
function verifyRecordSpan(bytes, start_byte, end_byte, quoted_text, budget, what) {
  budget.countSpan(what);
  const slice = bytes.subarray(start_byte, end_byte);
  const decoded = slice.toString("utf8");
  const round_trip_ok = decoded === quoted_text && Buffer.from(quoted_text, "utf8").equals(slice);
  if (!round_trip_ok) {
    throw new ResolutionError("SPAN_MISMATCH", `record span at [${start_byte},${end_byte}) does not round-trip byte-exactly`);
  }
  return { start_byte, end_byte, quoted_text, byte_length: end_byte - start_byte, round_trip_ok: true };
}

/**
 * S653-007: one bounded final-envelope record walk with a published
 * taxonomy (see README). Every emitted occurrence counts once:
 * source_refs / diagnostics / quarantined_sources entries; each
 * classification and draft; each citation and span nested inside them;
 * each metrics-group occurrence (including the aliased copy inside
 * summary); each nested stage_age; the header_comparison, population,
 * and summary records. Scalars and plain collection arrays are not
 * records; discarded intermediate work is never counted.
 */
export function countOutputRecords(env) {
  let n = 0;
  const rec = (v) => { if (v !== null && typeof v === "object") n += 1; };
  const countCitation = (holder) => {
    if (holder && typeof holder === "object" && holder.citation && typeof holder.citation === "object") {
      rec(holder.citation);
      if (holder.citation.span && typeof holder.citation.span === "object") rec(holder.citation.span);
    }
  };
  const countMetrics = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const m of arr) {
      rec(m);
      if (m && typeof m === "object" && Array.isArray(m.stage_ages)) {
        for (const s of m.stage_ages) rec(s);
      }
    }
  };
  for (const k of ["source_refs", "diagnostics", "quarantined_sources"]) {
    const a = env[k];
    if (Array.isArray(a)) for (const e of a) rec(e);
  }
  const rep = env.report;
  if (rep && typeof rep === "object") {
    if (Array.isArray(rep.classifications)) {
      for (const c of rep.classifications) { rec(c); countCitation(c); }
    }
    if (Array.isArray(rep.drafts)) {
      for (const d of rep.drafts) { rec(d); countCitation(d); }
    }
    countMetrics(rep.metrics);
    if (rep.header_comparison && typeof rep.header_comparison === "object") rec(rep.header_comparison);
    if (rep.population && typeof rep.population === "object") rec(rep.population);
    if (rep.summary && typeof rep.summary === "object") {
      rec(rep.summary);
      countMetrics(rep.summary.metrics);
      if (rep.summary.header_comparison && typeof rep.summary.header_comparison === "object") {
        rec(rep.summary.header_comparison);
      }
    }
  }
  return n;
}

/**
 * run(task, context) — the single public entrypoint.
 */
export function run(task, context) {
  const budget = makeBudget();
  // S653-006: trap-free native Proxy rejection BEFORE any reflection,
  // including the task-id fallback. types.isProxy invokes no user trap.
  if (types.isProxy(task) || types.isProxy(context)) {
    return boundedRefused("unavailable", "INVALID_INPUT", "error", "proxy input refused before inspection; proxies are not plain data");
  }
  const taskId = requestTaskId(task);
  try {
    admitGraph(task, "task", budget);
    admitContextControlGraph(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  let t, c;
  try {
    t = validateTask(task, budget);
    c = validateContextControl(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  // Principal authority: only JASON / MUSE_RELAY through the adapter.
  if (c.principal.role !== "JASON" && c.principal.role !== "MUSE_RELAY") {
    return boundedRefused(taskId, "ACTION_DENIED", "error", "principal role not authorized for this prototype");
  }
  // S653-004: the authorization window must be live at the injected host
  // clock. Expired, future, or inverted windows are denied HERE — before
  // any source entry is admitted, so denied runs never inspect selected
  // payload metadata.
  if (!principalWindowLive(c.principal, c.clock)) {
    return boundedRefused(taskId, "ACTION_DENIED", "error", "principal authorization window is not live at the host clock (expired, future, or inverted); refusing");
  }

  const source_refs = [];
  const diagnostics = [];
  const quarantined_sources = [];

  try {
    // 1. Per fixture_ref: grant check FIRST, then admit + verify that one
    // source entry. Denied/unselected source metadata stays untouched.
    const bundles = [];
    for (let i = 0; i < t.fixture_refs.length; i++) {
      const ref = t.fixture_refs[i];
      if (!hasReadGrant(ref, c.readGrants)) {
        return boundedRefused(taskId, "ACTION_DENIED", "error", `no read grant for ${ref.repo}/${ref.path}`);
      }
      const key = `${ref.repo}|${ref.path}`;
      const rawEntry = c.sources[key];
      if (!rawEntry || typeof rawEntry !== "object") {
        return boundedRefused(taskId, "SOURCE_UNVERIFIED", "error", `source not registered: ${key}`);
      }
      let entry;
      try {
        entry = validateSourceEntry(rawEntry, key, `context.sources[${key}]`, budget);
      } catch (e) {
        if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
        if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
        throw e;
      }
      const resolved = resolveSourceRef(ref, { [key]: entry }, budget, `task.fixture_refs[${i}]`);
      source_refs.push({ repo: ref.repo, path: ref.path, commit: ref.commit, blob: ref.blob, algorithm: ref.algorithm, revision: ref.revision });
      bundles.push({
        ref, text: resolved.text, expected_records: resolved.expected_records,
        dataset_id: resolved.dataset_id, dataset_version: resolved.dataset_version,
      });
    }

    // 2. Structural split + per-record admission and validation.
    const leads = []; // {record, sourceIndex, quarantined, quarantineFamilies, citation}
    const seenLeadIds = new Set();
    const seenOppIds = new Set();
    for (let bi = 0; bi < bundles.length; bi++) {
      const b = bundles[bi];
      budget.countPayload(b.text, `bundle ${b.ref.repo}/${b.ref.path} payload`);
      const { spans, bytes } = splitTopLevelArray(b.text, `bundle[${bi}]`);
      b.spanCount = spans.length;
      // Over-long reference lists cannot hide behind the array: bound first.
      if (spans.length > 4096) {
        return boundedRefused(taskId, "INPUT_LIMIT", "error", `bundle[${bi}] declares ${spans.length} records; outer bound is 4096`);
      }
      for (let si = 0; si < spans.length; si++) {
        const { start_byte, end_byte } = spans[si];
        // S653-005: charge the candidate slot BEFORE decoding or inspecting
        // its fields. Candidate 65 refuses here, before JSON.parse runs.
        budget.countObject(`bundle[${bi}] record ${si} slot`);
        const rawText = bytes.subarray(start_byte, end_byte).toString("utf8");
        budget.countPayload(rawText, `bundle[${bi}] record ${si} bytes`);
        let parsed;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          return boundedRefused(taskId, "INVALID_INPUT", "error", `bundle[${bi}] record ${si} is not valid JSON`);
        }
        // The slot was pre-charged; skip validateLeadRecord's top-level
        // charge to avoid double-counting the same candidate.
        let record;
        try {
          record = validateLeadRecord(parsed, `bundle[${bi}].records[${si}]`, budget, true);
        } catch (e) {
          if (e instanceof SchemaError) {
            return boundedRefused(taskId, "INVALID_INPUT", "error", `bundle[${bi}] record ${si}: ${e.message}`);
          }
          throw e;
        }
        // Duplicate IDs refuse rather than double-count or first-wins.
        if (seenLeadIds.has(record.lead_id)) {
          return boundedRefused(taskId, "DUPLICATE_ID", "error", `duplicate lead_id '${record.lead_id}'`);
        }
        if (seenOppIds.has(record.opportunity_id)) {
          return boundedRefused(taskId, "DUPLICATE_ID", "error", `duplicate opportunity_id '${record.opportunity_id}'`);
        }
        seenLeadIds.add(record.lead_id);
        seenOppIds.add(record.opportunity_id);
        // S653-002: byte-exact citation for this record's claim inputs.
        const span = verifyRecordSpan(bytes, start_byte, end_byte, rawText, budget, `citation ${record.lead_id}`);
        const citation = {
          source_ref: { repo: b.ref.repo, path: b.ref.path, commit: b.ref.commit, blob: b.ref.blob, algorithm: "git-sha1", revision: b.ref.revision },
          span,
          verification: { algorithm: "git-sha1", blob: b.ref.blob, byte_length: end_byte - start_byte, round_trip_ok: true },
        };
        // Injection scan over untrusted free-text fields.
        const scan = scanTexts([record.display_name, record.notes]);
        const quarantined = scan.injected;
        if (quarantined) {
          quarantined_sources.push({
            record_id: record.lead_id,
            source_ref: { repo: b.ref.repo, path: b.ref.path, commit: b.ref.commit, blob: b.ref.blob },
            families: scan.families,
            reason: "untrusted field matched a seeded injection family; record quarantined",
          });
        }
        leads.push({ record, sourceIndex: bi, quarantined, quarantineFamilies: scan.families, citation });
      }
      // Host-declared population coverage for this bundle (trusted).
      if (b.expected_records !== undefined && b.expected_records !== spans.length) {
        diagnostics.push({
          code: "POPULATION_MISMATCH", severity: "warning", record_id: null,
          source_ref: { repo: b.ref.repo, path: b.ref.path, commit: b.ref.commit, blob: b.ref.blob },
          reason: `bundle declared ${b.expected_records} records, found ${spans.length}`,
        });
      }
    }

    // S653-001: trusted, applicable population completeness. Requires ALL
    // of: the caller declared complete; the host's registered
    // expected_records matches admitted spans on EVERY bundle; the
    // caller's identity claims match; and the declared dataset_id /
    // dataset_version binds to every resolved bundle's host-registered
    // identity. A matching caller claim alone never establishes it.
    let populationComplete = false;
    if (t.population && t.population.declared_complete) {
      const actualIds = new Set(leads.map((l) => l.record.lead_id));
      let claimOk = true;
      const expectedIds = t.population.expected_lead_ids;
      const expectedCount = t.population.expected_count;
      if (expectedIds !== undefined) {
        if (expectedIds.length !== actualIds.size) claimOk = false;
        else for (const id of expectedIds) if (!actualIds.has(id)) { claimOk = false; break; }
      }
      if (expectedCount !== undefined && expectedCount !== leads.length) claimOk = false;
      const hostCovered = bundles.length > 0 && bundles.every(
        (b) => b.expected_records !== undefined && b.expected_records === b.spanCount
      );
      const identityBound = bundles.length > 0 && bundles.every(
        (b) => b.dataset_id === t.population.dataset_id && b.dataset_version === t.population.dataset_version
      );
      populationComplete = claimOk && hostCovered && identityBound;
      if (!populationComplete) {
        diagnostics.push({
          code: "POPULATION_INCOMPLETE", severity: "warning", record_id: null, source_ref: null,
          reason: "declared-complete population not established against host-registered coverage and dataset identity; whole-pipeline totals unverified",
        });
      }
    }

    // 3. Classify, suppress, draft.
    const classified = [];
    const draftRecords = [];
    for (const l of leads) {
      const { fit, gaps } = classifyFit(l.record, c.criteria.fit_high_timing_days);
      const { suppressed } = checkSuppression(l.record);
      let drafts = [];
      let draftReason = null;
      if (suppressed) {
        draftReason = "SUPPRESSED: do_not_contact=true checked before draft construction; zero variants";
      } else if (l.quarantined) {
        draftReason = "QUARANTINED: untrusted field matched an injection family; no draft";
      } else if (fit === "FIT_HIGH" && t.options.include_drafts) {
        const product = c.product_registry[l.record.fixture_product_id];
        if (!product) {
          draftReason = "NO_PRODUCT: fixture_product_id not in the host product registry";
        } else if (!product.verified) {
          draftReason = "UNVERIFIED_PRODUCT: product entry not verified; no draft";
        } else {
          drafts = buildDrafts(l.record, product, c.criteria);
        }
      } else if (fit !== "FIT_HIGH") {
        draftReason = `NO_DRAFT: fit is ${fit}, not FIT_HIGH`;
      } else {
        draftReason = "NO_DRAFT: include_drafts=false";
      }
      classified.push({
        lead_id: l.record.lead_id,
        opportunity_id: l.record.opportunity_id,
        fit,
        gaps,
        suppressed,
        quarantined: l.quarantined,
        quarantine_families: l.quarantineFamilies,
        stage: l.record.stage,
        currency: l.record.currency,
        criteria_version: c.criteria.criteria_version,
        citation: l.citation,
      });
      for (const d of drafts) {
        draftRecords.push({
          lead_id: l.record.lead_id,
          variant: d.variant,
          text: d.text,
          marker: d.marker,
          // S653-002: the lead-record citation plus an explicit marker that
          // product/benefit tokens come from the separately trusted host
          // context, not from source bytes.
          citation: {
            ...l.citation,
            product_evidence: "host product_registry (separately trusted context; not source bytes)",
          },
        });
      }
      if (draftReason) {
        diagnostics.push({
          code: suppressed ? "SUPPRESSED" : l.quarantined ? "QUARANTINED" : "NO_DRAFT",
          severity: "info",
          record_id: l.record.lead_id,
          source_ref: null,
          reason: draftReason,
        });
      }
    }

    // 4. Pipeline metrics (exact rational arithmetic).
    const metrics = computePipelineMetrics(
      classified.map((cl, i) => ({ record: leads[i].record, fit: cl.fit, gaps: cl.gaps, suppressed: cl.suppressed })),
      t.options
    );

    // 5. Header-claim comparison; mismatch OR inapplicable interval
    // suppresses the definitive summary (comparison evidence retained).
    const headerCheck = compareHeaderClaims(t.header_claims, metrics, t.options);
    let headerOk = true;
    if (headerCheck.checked) {
      headerOk = headerCheck.match;
      if (!headerCheck.match) {
        diagnostics.push({
          code: "HEADER_MISMATCH", severity: "error", record_id: null, source_ref: null,
          reason: headerCheck.interval_match
            ? `header claims open_gross_minor=${headerCheck.claimed} ${headerCheck.currency} but recomputation gives ${headerCheck.computed}; definitive summary suppressed`
            : `header interval does not match the task report interval; claim not applicable to this recomputation; definitive summary suppressed`,
        });
      }
    }
    const metricsVerifiable = metrics.every((m) => !m.unverifiable);
    // S653-001: the definitive summary requires trusted, applicable
    // population completeness. Without it the recomputed metrics below
    // remain available as clearly partial results.
    let summary = null;
    if (headerOk && metricsVerifiable && populationComplete) {
      summary = { metrics, header_comparison: headerCheck.checked ? headerCheck : null };
    }

    const complete = summary !== null && quarantined_sources.length === 0;
    const status = complete ? "REPORT_READY" : "PARTIAL";

    const report = {
      classifications: classified,
      drafts: draftRecords,
      metrics,
      header_comparison: headerCheck.checked ? headerCheck : null,
      summary,
      population: t.population ? {
        declared_complete: t.population.declared_complete,
        dataset_id: t.population.dataset_id,
        dataset_version: t.population.dataset_version,
        complete: populationComplete,
      } : null,
    };

    const result = envelope(taskId, {
      status,
      complete,
      source_refs,
      diagnostics,
      quarantined_sources,
      routing_flags: [],
      report,
    });

    // S653-007: one bounded final-envelope accounting walk. Overrun returns
    // bounded REFUSED, complete:false, report:null — no partial artifact.
    const prefill = c.test_hooks && typeof c.test_hooks.prefill_output_records === "number"
      ? c.test_hooks.prefill_output_records : 0;
    const outCount = prefill + countOutputRecords(result);
    if (outCount > BUDGET_LIMITS.maxOutputRecords) {
      return boundedRefused(taskId, "OUTPUT_LIMIT", "error", `public output records ${outCount} exceed ${BUDGET_LIMITS.maxOutputRecords}`);
    }
    // Final-envelope output byte accounting: the exact returned bytes.
    const outBytes = canonicalByteLength(result);
    if (outBytes > BUDGET_LIMITS.maxOutputBytes) {
      return boundedRefused(taskId, "OUTPUT_LIMIT", "error", `final envelope is ${outBytes} bytes, cap is ${BUDGET_LIMITS.maxOutputBytes}`);
    }
    return result;
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof ResolutionError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
    throw e;
  }
}
