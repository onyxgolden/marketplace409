/**
 * Independent oracle for the project-controls battery (P2b-2).
 *
 * The oracle asserts OUTCOMES, not implementations: it reads the
 * runner's result and the published item and checks them against the
 * case's literal expectation. It imports NOTHING from the evaluator,
 * the snapshot builder, the mapping layer, the serializer, or any
 * prototype math — only canonical JSON primitives (for digest
 * recomputation) and node builtins. A case passes only when every
 * asserted field matches; the oracle never consults candidate code
 * to derive an expected value.
 *
 * Expectation keys (all optional; absent keys are not asserted):
 * - outcome, code, kind, limit: runner outcome fields.
 * - code_not: the refusal code must NOT equal this.
 * - report_status, snapshot_consistency: report/snapshot fields.
 * - packages: [{ id, conclusion, latest_snapshot?, latest_status_date?,
 *   named_baseline_version?, current_baseline_version?, baseline_changed?,
 *   scope_baseline_version?, scope_baseline_resolved?, latest_pcts?,
 *   package_percent_complete? }] — matched by index with an id
 *   check; null asserts the field is null/absent.
 * - package_ids: exact ordered list of package ids.
 * - no_ready_packages: no package row may conclude READY
 *   (incomplete-coverage freeze: a missing category must qualify
 *   every conclusion drawn from it).
 * - integrity_kinds: exact set of integrity finding kinds.
 * - integrity_kinds_include: every listed kind must be present.
 * - checklist_kinds_include: every listed checklist kind must be present.
 * - questions_include: every listed substring must appear in some
 *   question row's question text.
 * - questions_records_include: every listed { field: value } must
 *   match some question row exactly (source-binding assertions).
 * - questions_text_absent: no question row's text may contain any
 *   listed substring (absence assertions).
 * - integrity_evidence_in_spans: every integrity row's every
 *   evidence citation must have a matching published evidence span
 *   (a citation without a span cites a row the source never
 *   admitted — a fictitious row).
 * - financial_all_not_modeled: every financial measure in the
 *   report's financial section is NOT_MODELED and the section scope
 *   is FINANCIAL_SCOPE_EXCLUDED.
 * - inventory: { field: value } exact inventory counts asserted.
 * - snapshot_consistency, coverage_gap_codes_include,
 *   collection_error_codes_include, conflicts_include,
 *   diagnostics_include: snapshot/report diagnostic assertions.
 * - report_equals_case: the published report bytes must equal the
 *   named earlier case's report bytes (pagination invariance).
 * - counters_zero: all counters are zero (DISABLED).
 * - domain_totals_null: refusal report carries no domain totals.
 * - forbidden_strings_absent: no listed string appears anywhere in
 *   the serialized published item.
 * - row_ids_digest_format: every row id matches ctl-<64 hex>.
 * - distinct_row_ids: all row ids in the item are unique.
 * - adapter_datasets_only: every adapter dataset called is one of
 *   the 3 admitted controls datasets.
 * - published_count: publisher size delta for this case (0 = the
 *   case published nothing).
 * - replay_idempotent: runs 2 and 3 wrote nothing new.
 * - post: { code | kind+limit | refused | exit } for post-steps.
 */
import { canonicalJson } from "../../../../src/application/ai-lab/rental-ops/canonical.js";

const ADMITTED_DATASETS = new Set([
  "forge_work_packages", "forge_work_package_baselines", "forge_work_progress_snapshots",
]);
const ROW_ID_RE = /^ctl-[0-9a-f]{64}$/;
const FINANCIAL_MEASURES = [
  "planned_value", "earned_value", "actual_cost", "cpi", "spi",
  "monetary_variance", "eac", "etc", "contingency",
];

function fail(caseId, msg) {
  throw new Error(`oracle failure ${caseId}: ${msg}`);
}

function allRows(item) {
  const rows = [];
  const sections = item.report.sections ?? {};
  for (const section of Object.values(sections)) {
    if (!section || !Array.isArray(section.rows)) continue;
    for (const row of section.rows) rows.push(row);
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
    if (expect.packages !== undefined) {
      const rows = report.sections.packages.rows;
      if (rows.length !== expect.packages.length) {
        fail(caseId, `package count ${rows.length} !== expected ${expect.packages.length}`);
      }
      for (let i = 0; i < expect.packages.length; i++) {
        const want = expect.packages[i];
        const got = rows[i];
        if (got.package_ref !== want.id) fail(caseId, `package ${i} id ${got.package_ref} !== expected ${want.id}`);
        if (want.conclusion !== undefined && got.conclusion !== want.conclusion) {
          fail(caseId, `package ${want.id} conclusion ${got.conclusion} !== expected ${want.conclusion}`);
        }
        if (want.latest_snapshot !== undefined) {
          const v = got.latest_snapshot_ref ?? null;
          if (v !== want.latest_snapshot) fail(caseId, `package ${want.id} latest_snapshot ${v} !== expected ${want.latest_snapshot}`);
        }
        if (want.latest_status_date !== undefined && (got.latest_status_date ?? null) !== want.latest_status_date) {
          fail(caseId, `package ${want.id} latest_status_date ${got.latest_status_date} !== expected ${want.latest_status_date}`);
        }
        if (want.named_baseline_version !== undefined) {
          const v = got.named_baseline?.version_number ?? null;
          if (v !== want.named_baseline_version) fail(caseId, `package ${want.id} named_baseline_version ${v} !== expected ${want.named_baseline_version}`);
        }
        if (want.current_baseline_version !== undefined) {
          const v = got.current_baseline?.version_number ?? null;
          if (v !== want.current_baseline_version) fail(caseId, `package ${want.id} current_baseline_version ${v} !== expected ${want.current_baseline_version}`);
        }
        if (want.baseline_changed !== undefined && got.baseline_changed !== want.baseline_changed) {
          fail(caseId, `package ${want.id} baseline_changed ${got.baseline_changed} !== expected ${want.baseline_changed}`);
        }
        if (want.scope_baseline_version !== undefined) {
          const v = got.scope_baseline_version ?? null;
          if (v !== want.scope_baseline_version) fail(caseId, `package ${want.id} scope_baseline_version ${v} !== expected ${want.scope_baseline_version}`);
        }
        if (want.scope_baseline_resolved !== undefined && got.scope_baseline_resolved !== want.scope_baseline_resolved) {
          fail(caseId, `package ${want.id} scope_baseline_resolved ${got.scope_baseline_resolved} !== expected ${want.scope_baseline_resolved}`);
        }
        if (want.scope_baseline_state !== undefined && got.scope_baseline_state !== want.scope_baseline_state) {
          fail(caseId, `package ${want.id} scope_baseline_state ${got.scope_baseline_state} !== expected ${want.scope_baseline_state}`);
        }
        if (want.latest_pcts !== undefined) {
          const snap = (got.snapshots ?? []).find((s) => s.snapshot_ref === got.latest_snapshot_ref);
          if (!snap) fail(caseId, `package ${want.id} has no latest snapshot row for pct assertion`);
          for (const [k, v] of Object.entries(want.latest_pcts)) {
            if (snap[k] !== v) fail(caseId, `package ${want.id} latest ${k} ${snap[k]} !== expected ${v}`);
          }
        }
        if (want.package_percent_complete !== undefined && (got.percent_complete_claim ?? null) !== want.package_percent_complete) {
          fail(caseId, `package ${want.id} percent_complete_claim ${got.percent_complete_claim} !== expected ${want.package_percent_complete}`);
        }
      }
    }
    if (expect.package_ids !== undefined) {
      const ids = report.sections.packages.rows.map((r) => r.package_ref);
      if (canonicalJson(ids) !== canonicalJson(expect.package_ids)) {
        fail(caseId, `package ids ${canonicalJson(ids)} !== expected ${canonicalJson(expect.package_ids)}`);
      }
    }
    if (expect.no_ready_packages) {
      for (const row of report.sections.packages.rows) {
        if (row.conclusion === "READY") fail(caseId, `package ${row.package_ref} must not conclude READY under incomplete coverage`);
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
    if (expect.checklist_kinds_include !== undefined) {
      const kinds = new Set(report.sections.checklist.rows.map((r) => r.kind));
      for (const k of expect.checklist_kinds_include) {
        if (!kinds.has(k)) fail(caseId, `checklist kinds missing ${k}`);
      }
    }
    if (expect.questions_include !== undefined) {
      const hay = (report.sections.questions.rows ?? []).map((r) => r.question ?? "").join("\n");
      for (const needle of expect.questions_include) {
        if (!hay.includes(needle)) fail(caseId, `questions do not mention ${needle}`);
      }
    }
    if (expect.questions_records_include !== undefined) {
      const rows = report.sections.questions.rows ?? [];
      for (const want of expect.questions_records_include) {
        const hit = rows.some((r) => Object.entries(want).every(([k, v]) => r[k] === v));
        if (!hit) fail(caseId, `no question row matches ${canonicalJson(want)}`);
      }
    }
    if (expect.questions_text_absent !== undefined) {
      const hay = (report.sections.questions.rows ?? []).map((r) => r.question ?? "").join("\n");
      for (const needle of expect.questions_text_absent) {
        if (hay.includes(needle)) fail(caseId, `questions must not mention ${needle}`);
      }
    }
    if (expect.integrity_evidence_in_spans) {
      const spanKeys = new Set((item.evidence_spans ?? []).map((s) => `${s.dataset}:${s.record_ref}`));
      for (const row of report.sections.integrity.rows ?? []) {
        for (const ev of row.evidence ?? []) {
          if (!spanKeys.has(`${ev.dataset}:${ev.record_ref}`)) {
            fail(caseId, `integrity ${row.kind} cites ${ev.dataset}:${ev.record_ref}, which has no evidence span (fictitious row)`);
          }
        }
      }
    }
    if (expect.financial_all_not_modeled) {
      const fin = report.sections.financial ?? {};
      if (fin.scope !== "FINANCIAL_SCOPE_EXCLUDED") fail(caseId, `financial scope ${fin.scope} !== FINANCIAL_SCOPE_EXCLUDED`);
      for (const m of FINANCIAL_MEASURES) {
        if (fin[m] !== "NOT_MODELED") fail(caseId, `financial ${m} ${fin[m]} !== NOT_MODELED`);
      }
    }
    if (expect.inventory !== undefined) {
      const inv = report.sections.inventory ?? {};
      for (const [k, v] of Object.entries(expect.inventory)) {
        if (inv[k] !== v) fail(caseId, `inventory ${k} ${inv[k]} !== expected ${v}`);
      }
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
        if (row.row_id === "report") continue;
        if (!ROW_ID_RE.test(row.row_id)) fail(caseId, `row id ${row.row_id} is not a ctl-<64 hex> digest`);
      }
    }
    if (expect.distinct_row_ids) {
      const ids = allRows(item).map((r) => r.row_id).filter((id) => id !== "report");
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
