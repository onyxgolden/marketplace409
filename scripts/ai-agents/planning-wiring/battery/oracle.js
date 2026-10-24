/**
 * Independent oracle for the planning battery.
 *
 * The oracle asserts OUTCOMES, not implementations: it reads the
 * runner's result and the published item and checks them against the
 * case's literal expectation. It imports NOTHING from the evaluator,
 * the snapshot builder, the mapping layer, the serializer, or the
 * prototype math — only canonical JSON primitives (for digest
 * recomputation) and node builtins. A case passes only when every
 * asserted field matches; the oracle never consults candidate code
 * to derive an expected value.
 *
 * Expectation keys (all optional; absent keys are not asserted):
 * - outcome, code, kind, limit: runner outcome fields.
 * - code_not: the refusal code must NOT equal this.
 * - report_status, snapshot_consistency: report/snapshot fields.
 * - components: [{ id, conclusion, prototype_status?,
 *   activities_null?, withheld_all?, activities: { id: { es, ef,
 *   ls, lf, total_float, critical, civil_start,
 *   civil_finish_boundary } }, edges: { tie_ref: { weight, tight,
 *   critical, withheld? } } }] — activity fields present in the
 *   expectation are asserted; absent fields are not. Edge fields
 *   are asserted exactly, except withheld, which is a substring
 *   match (null asserts the edge carries no withheld reason).
 * - no_ready_components: no component row may conclude READY
 *   (incomplete-coverage freeze: a missing category must qualify
 *   every conclusion drawn from it).
 * - no_ready_lookahead: no lookahead row may carry a READY
 *   computed conclusion.
 * - component_ids: exact ordered list of component ids.
 * - lookahead: [{ block_ref, bucket, disagreement? }] — matched by
 *   block_ref; disagreement asserts the row HAS (true) or LACKS
 *   (false) a disagreement string.
 * - lookahead_blocks: exact ordered list of lookahead block refs.
 * - integrity_kinds: exact set of integrity finding kinds.
 * - integrity_kinds_include: every listed kind must be present.
 * - review_kinds: every listed review kind must be present.
 * - inventory_wbs_only, inventory_hammocks: inventory counts.
 * - snapshot_consistency, coverage_gap_codes_include,
 *   collection_error_codes_include, conflicts_include,
 *   diagnostics_include: snapshot/report diagnostic assertions.
 * - report_equals_case: the published report bytes must equal the
 *   named earlier case's report bytes (pagination invariance).
 * - counters_zero: all counters are zero (DISABLED).
 * - domain_totals_null: refusal report carries no domain totals.
 * - forbidden_strings_absent: no listed string appears anywhere in
 *   the serialized published item.
 * - row_ids_digest_format: every row id matches sch-<64 hex>.
 * - distinct_row_ids: all row ids in the item are unique.
 * - adapter_datasets_only: every adapter dataset called is one of
 *   the 8 admitted planning datasets.
 * - published_count: publisher size delta for this case (0 = the
 *   case published nothing).
 * - replay_idempotent: runs 2 and 3 wrote nothing new.
 * - post: { code | kind+limit | refused | exit } for post-steps.
 */
import { canonicalJson } from "../../../../src/application/ai-lab/rental-ops/canonical.js";

const ADMITTED_DATASETS = new Set([
  "schedule_projects", "schedule_calendars", "schedule_calendar_holidays",
  "schedule_blackout_windows", "schedule_lanes", "schedule_blocks",
  "schedule_dependencies",
]);
const ROW_ID_RE = /^sch-[0-9a-f]{64}$/;

// Case language -> report activity-row field names. The report
// names ticks explicitly (es_tick) and computed values explicitly
// (computed_start); cases use the prototype's short names.
const ACTIVITY_FIELD_MAP = {
  es: "es_tick", ef: "ef_tick", ls: "ls_tick", lf: "lf_tick",
  total_float: "total_float", critical: "critical",
  civil_start: "computed_start", civil_finish_boundary: "computed_finish_boundary",
};

function fail(caseId, msg) {
  throw new Error(`oracle failure ${caseId}: ${msg}`);
}

function allRows(item) {
  const rows = [];
  const sections = item.report.sections ?? {};
  for (const section of Object.values(sections)) {
    if (!section || !Array.isArray(section.rows)) continue;
    for (const row of section.rows) {
      rows.push(row);
      for (const nested of [...(row.activities ?? []), ...(row.edges ?? [])]) rows.push(nested);
    }
  }
  return rows;
}

export function assertExpectation({ caseId, expect, runs, items, publisherBefore, publisherAfter, postResult, priorReports }) {
  const [first] = runs;
  if (!first) fail(caseId, "no runs recorded");
  if (expect.outcome !== undefined && first.outcome !== expect.outcome) {
    fail(caseId, `outcome ${first.outcome} !== expected ${expect.outcome} (code ${first.code ?? "-"})`);
  }
  if (expect.code !== undefined && first.code !== expect.code) {
    fail(caseId, `code ${first.code} !== expected ${expect.code}`);
  }
  if (expect.code_not !== undefined && first.code === expect.code_not) {
    fail(caseId, `code must not be ${expect.code_not}`);
  }
  if (expect.kind !== undefined && first.kind !== expect.kind) {
    fail(caseId, `kind ${first.kind} !== expected ${expect.kind}`);
  }
  if (expect.limit !== undefined && first.limit !== expect.limit) {
    fail(caseId, `limit ${first.limit} !== expected ${expect.limit}`);
  }
  if (expect.counters_zero) {
    for (const [k, v] of Object.entries(first.counters ?? {})) {
      if (v !== 0) fail(caseId, `counter ${k} = ${v}, expected 0`);
    }
  }
  if (expect.domain_totals_null && first.refusal_report?.domain_totals !== null) {
    fail(caseId, "refusal report must carry domain_totals: null");
  }
  if (expect.published_count !== undefined) {
    const delta = publisherAfter - publisherBefore;
    if (delta !== expect.published_count) fail(caseId, `publisher delta ${delta} !== expected ${expect.published_count}`);
  }
  if (expect.replay_idempotent) {
    for (let i = 1; i < runs.length; i++) {
      if (runs[i].receipt?.written) fail(caseId, `run ${i + 1} wrote a new item; replay must be idempotent`);
    }
  }
  // Published-item assertions need a COMPLETED run.
  if (first.outcome === "COMPLETED") {
    const item = items[0];
    if (!item) fail(caseId, "COMPLETED but no published item");
    const report = item.report;
    if (expect.report_status !== undefined && report.status !== expect.report_status) {
      fail(caseId, `report status ${report.status} !== expected ${expect.report_status}`);
    }
    if (expect.snapshot_consistency !== undefined && item.report.snapshot_consistency !== expect.snapshot_consistency) {
      fail(caseId, `snapshot consistency ${item.report.snapshot_consistency} !== expected ${expect.snapshot_consistency}`);
    }
    if (expect.components !== undefined) {
      const rows = report.sections.components.rows;
      if (rows.length !== expect.components.length) {
        fail(caseId, `component count ${rows.length} !== expected ${expect.components.length}`);
      }
      for (let i = 0; i < expect.components.length; i++) {
        const want = expect.components[i];
        const got = rows[i];
        if (got.component_id !== want.id) fail(caseId, `component ${i} id ${got.component_id} !== expected ${want.id}`);
        if (want.conclusion !== undefined && got.conclusion !== want.conclusion) {
          fail(caseId, `component ${want.id} conclusion ${got.conclusion} !== expected ${want.conclusion}`);
        }
        if (want.prototype_status !== undefined && got.prototype_status !== want.prototype_status) {
          fail(caseId, `component ${want.id} prototype_status ${got.prototype_status} !== expected ${want.prototype_status}`);
        }
        if (want.activities_null) {
          for (const a of got.activities) {
            if (a.es !== null || a.ef !== null || a.ls !== null || a.lf !== null) {
              fail(caseId, `component ${want.id} must expose no computed dates, but activity ${a.block_ref} has es=${a.es}`);
            }
          }
        }
        if (want.withheld_all !== undefined) {
          for (const id of want.withheld_all) {
            const reason = got.withheld?.[id];
            if (!reason || !reason.includes("all-computed-withheld")) {
              fail(caseId, `component ${want.id} must withhold-all ${id} (got ${reason ?? "none"})`);
            }
          }
        }
        if (want.activities !== undefined) {
          const byId = new Map(got.activities.map((a) => [a.block_ref, a]));
          for (const [id, fields] of Object.entries(want.activities)) {
            const a = byId.get(id);
            if (!a) fail(caseId, `component ${want.id} missing activity ${id}`);
            for (const [k, v] of Object.entries(fields)) {
              const reportField = ACTIVITY_FIELD_MAP[k] ?? k;
              if (a[reportField] !== v) fail(caseId, `component ${want.id} activity ${id} field ${k} = ${a[reportField]} !== expected ${v}`);
            }
          }
        }
        if (want.edges !== undefined) {
          const byTie = new Map((got.edges ?? []).map((e) => [e.tie_ref, e]));
          for (const [tieRef, fields] of Object.entries(want.edges)) {
            const e = byTie.get(tieRef);
            if (!e) fail(caseId, `component ${want.id} missing edge ${tieRef}`);
            for (const [k, v] of Object.entries(fields)) {
              if (k === "withheld") {
                if (v === null) {
                  if (e.withheld !== null) fail(caseId, `component ${want.id} edge ${tieRef} must carry no withheld reason (got ${e.withheld})`);
                } else if (!e.withheld || !e.withheld.includes(v)) {
                  fail(caseId, `component ${want.id} edge ${tieRef} withheld ${e.withheld ?? "none"} must include ${v}`);
                }
              } else if (e[k] !== v) {
                fail(caseId, `component ${want.id} edge ${tieRef} field ${k} = ${e[k]} !== expected ${v}`);
              }
            }
          }
        }
      }
    }
    if (expect.component_ids !== undefined) {
      const ids = report.sections.components.rows.map((r) => r.component_id);
      if (canonicalJson(ids) !== canonicalJson(expect.component_ids)) {
        fail(caseId, `component ids ${canonicalJson(ids)} !== expected ${canonicalJson(expect.component_ids)}`);
      }
    }
    if (expect.no_ready_components) {
      for (const row of report.sections.components.rows) {
        if (row.conclusion === "READY") fail(caseId, `component ${row.component_id} must not conclude READY under incomplete coverage`);
      }
    }
    if (expect.no_ready_lookahead) {
      for (const row of report.sections.lookahead.rows) {
        if (row.computed_conclusion === "READY") fail(caseId, `lookahead ${row.block_ref} must not carry a READY computed conclusion under incomplete coverage`);
      }
    }
    if (expect.lookahead !== undefined) {
      const rows = report.sections.lookahead.rows;
      for (const want of expect.lookahead) {
        const got = rows.find((r) => r.block_ref === want.block_ref);
        if (!got) fail(caseId, `lookahead missing block ${want.block_ref}`);
        if (want.bucket !== undefined && got.bucket !== want.bucket) {
          fail(caseId, `lookahead ${want.block_ref} bucket ${got.bucket} !== expected ${want.bucket}`);
        }
        if (want.disagreement === true && !got.disagreement) fail(caseId, `lookahead ${want.block_ref} must carry a disagreement`);
        if (want.disagreement === false && got.disagreement) fail(caseId, `lookahead ${want.block_ref} must not carry a disagreement`);
      }
    }
    if (expect.lookahead_blocks !== undefined) {
      const blocks = report.sections.lookahead.rows.map((r) => r.block_ref);
      if (canonicalJson(blocks) !== canonicalJson(expect.lookahead_blocks)) {
        fail(caseId, `lookahead blocks ${canonicalJson(blocks)} !== expected ${canonicalJson(expect.lookahead_blocks)}`);
      }
    }
    if (expect.integrity_kinds !== undefined) {
      const kinds = report.sections.integrity.rows.map((r) => r.kind).sort();
      if (canonicalJson(kinds) !== canonicalJson([...expect.integrity_kinds].sort())) {
        fail(caseId, `integrity kinds ${canonicalJson(kinds)} !== expected ${canonicalJson(expect.integrity_kinds)}`);
      }
    }
    if (expect.integrity_kinds_include !== undefined) {
      const kinds = new Set(report.sections.integrity.rows.map((r) => r.kind));
      for (const k of expect.integrity_kinds_include) {
        if (!kinds.has(k)) fail(caseId, `integrity kinds missing ${k}`);
      }
    }
    if (expect.review_kinds !== undefined) {
      const kinds = new Set(report.sections.review_list.rows.map((r) => r.kind));
      for (const k of expect.review_kinds) {
        if (!kinds.has(k)) fail(caseId, `review kinds missing ${k}`);
      }
    }
    if (expect.inventory_wbs_only !== undefined
      && report.sections.inventory.wbs_only !== expect.inventory_wbs_only) {
      fail(caseId, `inventory wbs_only ${report.sections.inventory.wbs_only} !== expected ${expect.inventory_wbs_only}`);
    }
    if (expect.inventory_hammocks !== undefined
      && report.sections.inventory.hammocks !== expect.inventory_hammocks) {
      fail(caseId, `inventory hammocks ${report.sections.inventory.hammocks} !== expected ${expect.inventory_hammocks}`);
    }
    const diagnostics = report.diagnostics ?? [];
    if (expect.coverage_gap_codes_include !== undefined) {
      const codes = new Set(diagnostics.filter((d) => d.code).map((d) => d.code));
      for (const c of expect.coverage_gap_codes_include) {
        if (!codes.has(c)) fail(caseId, `diagnostics missing coverage code ${c}`);
      }
    }
    if (expect.collection_error_codes_include !== undefined) {
      const codes = new Set(diagnostics.filter((d) => d.code).map((d) => d.code));
      for (const c of expect.collection_error_codes_include) {
        if (!codes.has(c)) fail(caseId, `diagnostics missing collection error code ${c}`);
      }
    }
    if (expect.conflicts_include !== undefined) {
      const codes = new Set(diagnostics.filter((d) => d.code).map((d) => d.code));
      for (const c of expect.conflicts_include) {
        if (!codes.has(c)) fail(caseId, `diagnostics missing conflict code ${c}`);
      }
    }
    if (expect.diagnostics_include !== undefined) {
      const hay = canonicalJson(diagnostics);
      for (const needle of expect.diagnostics_include) {
        if (!hay.includes(needle)) fail(caseId, `diagnostics do not mention ${needle}`);
      }
    }
    if (expect.report_equals_case !== undefined) {
      const prior = priorReports[expect.report_equals_case];
      if (!prior) fail(caseId, `no prior report recorded for case ${expect.report_equals_case}`);
      if (canonicalJson(report) !== prior) {
        fail(caseId, `report bytes differ from case ${expect.report_equals_case}`);
      }
    }
    if (expect.forbidden_strings_absent !== undefined) {
      const hay = canonicalJson(item);
      for (const needle of expect.forbidden_strings_absent) {
        if (hay.includes(needle)) fail(caseId, `forbidden string ${needle} leaked into the published item`);
      }
    }
    if (expect.row_ids_digest_format) {
      for (const row of allRows(item)) {
        if (!ROW_ID_RE.test(row.row_id)) fail(caseId, `row id ${row.row_id} is not a sch-<64 hex> digest`);
      }
    }
    if (expect.distinct_row_ids) {
      const ids = allRows(item).map((r) => r.row_id);
      if (new Set(ids).size !== ids.length) fail(caseId, "duplicate row ids in the published item");
    }
    if (expect.adapter_datasets_only) {
      for (const ds of first.adapter_datasets ?? []) {
        if (!ADMITTED_DATASETS.has(ds)) fail(caseId, `adapter called non-admitted dataset ${ds}`);
      }
    }
  }
  if (expect.post !== undefined) {
    if (!postResult) fail(caseId, "expected a post-step result but none ran");
    const want = expect.post;
    if (want.code !== undefined && postResult.code !== want.code) {
      fail(caseId, `post-step code ${postResult.code} !== expected ${want.code}`);
    }
    if (want.kind !== undefined && postResult.kind !== want.kind) {
      fail(caseId, `post-step kind ${postResult.kind} !== expected ${want.kind}`);
    }
    if (want.limit !== undefined && postResult.limit !== want.limit) {
      fail(caseId, `post-step limit ${postResult.limit} !== expected ${want.limit}`);
    }
    if (want.refused === true && !postResult.refused) fail(caseId, "post-step must refuse");
    if (want.exit !== undefined && postResult.exit !== want.exit) {
      fail(caseId, `post-step exit ${postResult.exit} !== expected ${want.exit}`);
    }
  }
}
