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
 * Budget discipline: every candidate object — the task, EVERY element of
 * the injected trusted context (sources, revisions, grants, principal,
 * criteria, product registry), each fixture record — is charged with
 * budget.countObject()/chargeObjectOnce() as the FIRST statement before
 * any of its own fields are read. Attempt 65 refuses before that
 * candidate (or any later one) is inspected at all. validateContext()
 * requires the caller's live monotonic budget.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength } from "./canonical.js";
import {
  validateTask, validateContext, validateLeadRecord, splitTopLevelArray,
  admitGraph, assertDenseArray, SchemaError,
} from "./schemas.js";
import { resolveSourceRef, hasReadGrant, makeBudget, BudgetError, ResolutionError, BUDGET_LIMITS } from "./resolver.js";
import { scanTexts } from "./injection.js";
import { classifyFit, checkSuppression, buildDrafts, computePipelineMetrics, compareHeaderClaims } from "./sales.js";

export const AGENT_ID = "sales-agent";
export const SCHEMA_VERSION = "1";

/**
 * Pre-validation task_id fallback. Preserves the caller's raw task_id
 * when it is a string; otherwise the documented "unavailable" marker.
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

function outputRecordCounter(testHooks) {
  let count = testHooks && typeof testHooks.prefill_output_records === "number" ? testHooks.prefill_output_records : 0;
  return {
    charge(what) {
      count += 1;
      if (count > BUDGET_LIMITS.maxOutputRecords) {
        throw new BudgetError("OUTPUT_LIMIT", `public output records exceed ${BUDGET_LIMITS.maxOutputRecords}${what ? ` (at ${what})` : ""}`);
      }
    },
    get() { return count; },
  };
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
 * run(task, context) — the single public entrypoint.
 */
export function run(task, context) {
  const budget = makeBudget();
  const taskId = requestTaskId(task);
  try {
    admitGraph(task, "task", budget);
    admitGraph(context, "context", budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  let t, ctx;
  try {
    t = validateTask(task, budget);
    ctx = validateContext(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  // Principal authority: only JASON / MUSE_RELAY through the adapter.
  if (ctx.principal.role !== "JASON" && ctx.principal.role !== "MUSE_RELAY") {
    return boundedRefused(taskId, "ACTION_DENIED", "error", "principal role not authorized for this prototype");
  }

  const outRecords = outputRecordCounter(ctx.test_hooks);
  const source_refs = [];
  const diagnostics = [];
  const quarantined_sources = [];

  try {
    // 1. Resolve every fixture_ref through grants + blob verification.
    const bundles = [];
    for (let i = 0; i < t.fixture_refs.length; i++) {
      const ref = t.fixture_refs[i];
      if (!hasReadGrant(ref, ctx.readGrants)) {
        return boundedRefused(taskId, "ACTION_DENIED", "error", `no read grant for ${ref.repo}/${ref.path}`);
      }
      const resolved = resolveSourceRef(ref, ctx.sources, budget, `task.fixture_refs[${i}]`);
      source_refs.push({ repo: ref.repo, path: ref.path, commit: ref.commit, blob: ref.blob, algorithm: ref.algorithm, revision: ref.revision });
      bundles.push({ ref, text: resolved.text, expected_records: resolved.expected_records });
    }

    // 2. Structural split + per-record admission and validation.
    const leads = []; // {record, sourceIndex, quarantined, quarantineFamilies}
    const seenLeadIds = new Set();
    const seenOppIds = new Set();
    for (let bi = 0; bi < bundles.length; bi++) {
      const b = bundles[bi];
      budget.countPayload(b.text, `bundle ${b.ref.repo}/${b.ref.path} payload`);
      const { spans, bytes } = splitTopLevelArray(b.text, `bundle[${bi}]`);
      // Over-long reference lists cannot hide behind the array: bound first.
      if (spans.length > 4096) {
        return boundedRefused(taskId, "INPUT_LIMIT", "error", `bundle[${bi}] declares ${spans.length} records; outer bound is 4096`);
      }
      for (let si = 0; si < spans.length; si++) {
        const { start_byte, end_byte } = spans[si];
        // Charge the candidate BEFORE decoding or inspecting its fields.
        const rawText = bytes.subarray(start_byte, end_byte).toString("utf8");
        budget.countPayload(rawText, `bundle[${bi}] record ${si}`);
        let parsed;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          return boundedRefused(taskId, "INVALID_INPUT", "error", `bundle[${bi}] record ${si} is not valid JSON`);
        }
        // Charge the parsed object before validation reads its fields.
        budget.chargeObjectOnce(parsed, `bundle[${bi}] record ${si}`);
        let record;
        try {
          record = validateLeadRecord(parsed, `bundle[${bi}].records[${si}]`, budget);
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
        leads.push({ record, sourceIndex: bi, quarantined, quarantineFamilies: scan.families });
      }
      // Host-declared population completeness for this bundle.
      if (b.expected_records !== undefined && b.expected_records !== spans.length) {
        diagnostics.push({
          code: "POPULATION_MISMATCH", severity: "warning", record_id: null,
          source_ref: { repo: b.ref.repo, path: b.ref.path, commit: b.ref.commit, blob: b.ref.blob },
          reason: `bundle declared ${b.expected_records} records, found ${spans.length}`,
        });
      }
    }

    // Task-declared population completeness.
    let populationComplete = false;
    if (t.population && t.population.declared_complete) {
      const expectedIds = t.population.expected_lead_ids;
      const expectedCount = t.population.expected_count;
      const actualIds = new Set(leads.map((l) => l.record.lead_id));
      let ok = true;
      if (expectedIds !== undefined) {
        if (expectedIds.length !== actualIds.size) ok = false;
        else for (const id of expectedIds) if (!actualIds.has(id)) { ok = false; break; }
      }
      if (expectedCount !== undefined && expectedCount !== leads.length) ok = false;
      populationComplete = ok;
      if (!ok) {
        diagnostics.push({
          code: "POPULATION_INCOMPLETE", severity: "warning", record_id: null, source_ref: null,
          reason: "declared-complete population does not match admitted records; whole-pipeline totals unverified",
        });
      }
    }

    // 3. Classify, suppress, draft.
    const classified = [];
    const draftRecords = [];
    for (const l of leads) {
      const { fit, gaps } = classifyFit(l.record, ctx.criteria.fit_high_timing_days);
      const { suppressed } = checkSuppression(l.record);
      let drafts = [];
      let draftReason = null;
      if (suppressed) {
        draftReason = "SUPPRESSED: do_not_contact=true checked before draft construction; zero variants";
      } else if (l.quarantined) {
        draftReason = "QUARANTINED: untrusted field matched an injection family; no draft";
      } else if (fit === "FIT_HIGH" && t.options.include_drafts) {
        const product = ctx.product_registry[l.record.fixture_product_id];
        if (!product) {
          draftReason = "NO_PRODUCT: fixture_product_id not in the host product registry";
        } else if (!product.verified) {
          draftReason = "UNVERIFIED_PRODUCT: product entry not verified; no draft";
        } else {
          // Charge the product entry consultation before reading its tokens.
          budget.chargeObjectOnce(product, `product_registry[${l.record.fixture_product_id}]`);
          drafts = buildDrafts(l.record, product, ctx.criteria);
          for (const d of drafts) outRecords.charge(`draft ${l.record.lead_id}/${d.variant}`);
        }
      } else if (fit !== "FIT_HIGH") {
        draftReason = `NO_DRAFT: fit is ${fit}, not FIT_HIGH`;
      } else {
        draftReason = "NO_DRAFT: include_drafts=false";
      }
      outRecords.charge(`classification ${l.record.lead_id}`);
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
        criteria_version: ctx.criteria.criteria_version,
      });
      for (const d of drafts) {
        draftRecords.push({
          lead_id: l.record.lead_id,
          variant: d.variant,
          text: d.text,
          marker: d.marker,
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
      classified.map((c, i) => ({ record: leads[i].record, fit: c.fit, gaps: c.gaps, suppressed: c.suppressed })),
      t.options
    );
    for (const m of metrics) outRecords.charge(`metrics ${m.currency}`);
    for (const d of draftRecords) outRecords.charge(`draft-record ${d.lead_id}/${d.variant}`);

    // 5. Header-claim comparison; mismatch suppresses the summary.
    const headerCheck = compareHeaderClaims(t.header_claims, metrics);
    let summary = null;
    if (headerCheck.checked) {
      outRecords.charge("header-comparison");
      if (!headerCheck.match) {
        diagnostics.push({
          code: "HEADER_MISMATCH", severity: "error", record_id: null, source_ref: null,
          reason: `header claims open_gross_minor=${headerCheck.claimed} ${headerCheck.currency} but recomputation gives ${headerCheck.computed}; definitive summary suppressed`,
        });
      }
    }
    const headerOk = !headerCheck.checked || headerCheck.match;
    const pipelineVerifiable = populationComplete || !t.population || !t.population.declared_complete
      ? metrics.every((m) => !m.unverifiable)
      : false;
    if (headerOk && pipelineVerifiable) {
      summary = { metrics, header_comparison: headerCheck.checked ? headerCheck : null };
      outRecords.charge("summary");
    }

    const complete = headerOk && pipelineVerifiable && quarantined_sources.length === 0;
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

    // Final-envelope output accounting: the exact returned bytes.
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
