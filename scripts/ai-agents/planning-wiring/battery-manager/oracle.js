/**
 * Independent oracle for the Project Manager battery (P2b-3).
 *
 * The oracle asserts OUTCOMES, not implementations: it reads the
 * runner's result and the published item and checks them against
 * the case's literal expectation. It imports NOTHING from the
 * evaluator, the snapshot builder, the mapping layer, the
 * serializer, or any prototype math — only canonical JSON
 * primitives (for digest recomputation) and node builtins. A case
 * passes only when every asserted field matches; the oracle never
 * consults candidate code to derive an expected value.
 *
 * Expectation keys (all optional; absent keys are not asserted):
 * - outcome, code, kind, limit: runner outcome fields.
 * - report_status, conclusion, snapshot_consistency: report fields.
 * - findings_scheduler_kinds_include / findings_controls_kinds_include:
 *   every listed kind must appear in that findings section.
 * - findings_records_include: every listed { section, field: value }
 *   must match some row of that findings section exactly.
 * - milestones_include: every listed { block_ref, bucket } must
 *   match some milestone row.
 * - milestones_empty: the milestones section has no rows.
 * - agenda_kinds_include: every listed kind must appear in agenda.
 * - agenda_kinds_absent: no listed kind may appear in agenda.
 * - agenda_records_include: every listed { field: value } must
 *   match some agenda row exactly.
 * - agenda_roles_all_project_reviewer: every agenda row's
 *   responsible_role is exactly "project reviewer".
 * - agenda_no_executable_keys: no agenda row carries patch, task,
 *   approval, execute, apply, send or activate keys.
 * - agenda_no_person_assignment: no agenda row names a person
 *   (no assigned_to / assignee / person keys, and no
 *   responsible_role other than "project reviewer").
 * - completion: { state?, admitted_packages?, terminal_count?,
 *   cancelled_count?, counts_by_status?, unknown_statuses_include? }.
 * - relationships_state: the relationships section state.
 * - predecessor_statuses: { scheduler?, controls? } BOUND/WITHHELD.
 * - predecessor_gaps_include: every listed gap code must appear in
 *   some predecessor row's gaps or in diagnostics.
 * - financial_all_not_modeled, resources_not_modeled.
 * - inventory: { field: value } exact inventory counts asserted.
 * - coverage_gap_codes_include, collection_error_codes_include,
 *   diagnostics_include: snapshot/report diagnostic assertions.
 * - report_equals_case: the published report bytes must equal the
 *   named earlier case's report bytes.
 * - forbidden_strings_absent: no listed string appears anywhere in
 *   the serialized published item.
 * - row_ids_digest_format: every row id matches pm-<64 hex>.
 * - distinct_row_ids: all row ids in the item are unique.
 * - carried_evidence_record_ref_only: every carried row's every
 *   evidence entry has a string record_ref and no `record` key
 *   (P677-007A class: a bare `record` key must fail).
 * - carried_evidence_in_spans: every carried row's every evidence
 *   citation has a matching published evidence span.
 * - report_digest_recomputes: canonicalDigest(report) equals the
 *   item's report_digest.
 * - adapter_datasets_only: every adapter dataset called is one of
 *   the 10 admitted manager datasets.
 * - published_count, replay_idempotent, counters_zero,
 *   domain_totals_null, post: as in the sibling oracles.
 */
import { canonicalDigest, canonicalJson } from "../../../../src/application/ai-lab/rental-ops/canonical.js";

const ADMITTED_DATASETS = new Set([
  "schedule_projects", "schedule_calendars", "schedule_lanes", "schedule_blocks",
  "schedule_dependencies", "schedule_calendar_holidays", "schedule_blackout_windows",
  "forge_work_packages", "forge_work_package_baselines", "forge_work_progress_snapshots",
]);
const ROW_ID_RE = /^pm-[0-9a-f]{64}$/;
const FINANCIAL_MEASURES = [
  "planned_value", "earned_value", "actual_cost", "cpi", "spi",
  "monetary_variance", "eac", "etc", "contingency",
];
const EXECUTABLE_KEYS = ["patch", "task", "approval", "execute", "apply", "send", "activate", "assigned_to", "assignee", "person"];

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

function carriedRows(item) {
  const s = item.report.sections ?? {};
  return [
    ...(s.findings_scheduler?.rows ?? []),
    ...(s.findings_controls?.rows ?? []),
    ...(s.milestones?.rows ?? []),
  ];
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
  if (first.outcome === "COMPLETED") {
    const item = items[0];
    if (!item) fail(caseId, "COMPLETED but no published item");
    const report = item.report;
    const s = report.sections ?? {};
    if (expect.report_status !== undefined && report.status !== expect.report_status) {
      fail(caseId, `report status ${report.status} !== expected ${expect.report_status}`);
    }
    if (expect.conclusion !== undefined && report.conclusion !== expect.conclusion) {
      fail(caseId, `conclusion ${report.conclusion} !== expected ${expect.conclusion}`);
    }
    if (expect.snapshot_consistency !== undefined && report.snapshot_consistency !== expect.snapshot_consistency) {
      fail(caseId, `snapshot consistency ${report.snapshot_consistency} !== expected ${expect.snapshot_consistency}`);
    }
    for (const [key, section] of [["findings_scheduler_kinds_include", "findings_scheduler"], ["findings_controls_kinds_include", "findings_controls"]]) {
      if (expect[key] !== undefined) {
        const kinds = new Set((s[section]?.rows ?? []).map((r) => r.kind));
        for (const k of expect[key]) {
          if (!kinds.has(k)) fail(caseId, `${section} kinds missing ${k}`);
        }
      }
    }
    if (expect.findings_records_include !== undefined) {
      for (const want of expect.findings_records_include) {
        const rows = s[want.section]?.rows ?? [];
        const hit = rows.some((r) => Object.entries(want).every(([k, v]) => k === "section" || r[k] === v));
        if (!hit) fail(caseId, `no ${want.section} row matches ${canonicalJson(want)}`);
      }
    }
    if (expect.milestones_include !== undefined) {
      const rows = s.milestones?.rows ?? [];
      for (const want of expect.milestones_include) {
        const hit = rows.some((r) => Object.entries(want).every(([k, v]) => r[k] === v));
        if (!hit) fail(caseId, `no milestone row matches ${canonicalJson(want)}`);
      }
    }
    if (expect.milestones_empty && (s.milestones?.rows ?? []).length !== 0) {
      fail(caseId, "milestones must be empty");
    }
    if (expect.agenda_kinds_include !== undefined) {
      const kinds = new Set((s.agenda?.rows ?? []).map((r) => r.kind));
      for (const k of expect.agenda_kinds_include) {
        if (!kinds.has(k)) fail(caseId, `agenda kinds missing ${k}`);
      }
    }
    if (expect.agenda_kinds_absent !== undefined) {
      const kinds = new Set((s.agenda?.rows ?? []).map((r) => r.kind));
      for (const k of expect.agenda_kinds_absent) {
        if (kinds.has(k)) fail(caseId, `agenda must not contain kind ${k}`);
      }
    }
    if (expect.agenda_records_include !== undefined) {
      const rows = s.agenda?.rows ?? [];
      for (const want of expect.agenda_records_include) {
        const hit = rows.some((r) => Object.entries(want).every(([k, v]) => r[k] === v));
        if (!hit) fail(caseId, `no agenda row matches ${canonicalJson(want)}`);
      }
    }
    if (expect.agenda_roles_all_project_reviewer) {
      for (const row of s.agenda?.rows ?? []) {
        if (row.responsible_role !== "project reviewer") {
          fail(caseId, `agenda row ${row.row_id} responsible_role '${row.responsible_role}' !== 'project reviewer'`);
        }
      }
    }
    if (expect.agenda_no_executable_keys) {
      for (const row of s.agenda?.rows ?? []) {
        for (const k of EXECUTABLE_KEYS) {
          if (k in row) fail(caseId, `agenda row ${row.row_id} carries executable/assignment key '${k}'`);
        }
      }
    }
    if (expect.agenda_no_person_assignment) {
      for (const row of s.agenda?.rows ?? []) {
        for (const k of ["assigned_to", "assignee", "person"]) {
          if (k in row) fail(caseId, `agenda row ${row.row_id} assigns a person via '${k}'`);
        }
        if (row.responsible_role !== "project reviewer") {
          fail(caseId, `agenda row ${row.row_id} responsible_role '${row.responsible_role}' is not the role label`);
        }
      }
    }
    if (expect.completion !== undefined) {
      const c = s.completion ?? {};
      const want = expect.completion;
      if (want.state !== undefined && c.state !== want.state) fail(caseId, `completion state ${c.state} !== expected ${want.state}`);
      if (want.admitted_packages !== undefined && c.admitted_packages !== want.admitted_packages) {
        fail(caseId, `completion admitted_packages ${c.admitted_packages} !== expected ${want.admitted_packages}`);
      }
      if (want.terminal_count !== undefined && c.terminal_count !== want.terminal_count) {
        fail(caseId, `completion terminal_count ${c.terminal_count} !== expected ${want.terminal_count}`);
      }
      if (want.cancelled_count !== undefined && c.cancelled_count !== want.cancelled_count) {
        fail(caseId, `completion cancelled_count ${c.cancelled_count} !== expected ${want.cancelled_count}`);
      }
      if (want.counts_by_status !== undefined && canonicalJson(c.counts_by_status ?? {}) !== canonicalJson(want.counts_by_status)) {
        fail(caseId, `completion counts_by_status ${canonicalJson(c.counts_by_status)} !== expected ${canonicalJson(want.counts_by_status)}`);
      }
      if (want.unknown_statuses_include !== undefined) {
        for (const u of want.unknown_statuses_include) {
          if (!(c.unknown_statuses ?? []).includes(u)) fail(caseId, `completion unknown_statuses missing ${u}`);
        }
      }
    }
    if (expect.relationships_state !== undefined && s.relationships?.state !== expect.relationships_state) {
      fail(caseId, `relationships state ${s.relationships?.state} !== expected ${expect.relationships_state}`);
    }
    if (expect.predecessor_statuses !== undefined) {
      for (const [leg, status] of Object.entries(expect.predecessor_statuses)) {
        const row = (s.predecessor_evidence?.rows ?? []).find((r) => r.agent === leg);
        if (!row) fail(caseId, `no predecessor row for ${leg}`);
        if (row.status !== status) fail(caseId, `predecessor ${leg} status ${row.status} !== expected ${status}`);
      }
    }
    if (expect.predecessor_gaps_include !== undefined) {
      const codes = new Set();
      for (const row of s.predecessor_evidence?.rows ?? []) {
        for (const g of row.gaps ?? []) codes.add(g);
      }
      for (const d of report.diagnostics ?? []) if (d.code) codes.add(d.code);
      for (const c of expect.predecessor_gaps_include) {
        if (!codes.has(c)) fail(caseId, `predecessor gaps/diagnostics missing ${c}`);
      }
    }
    if (expect.financial_all_not_modeled) {
      const fin = s.financial ?? {};
      if (fin.scope !== "FINANCIAL_SCOPE_EXCLUDED") fail(caseId, `financial scope ${fin.scope} !== FINANCIAL_SCOPE_EXCLUDED`);
      for (const m of FINANCIAL_MEASURES) {
        if (fin[m] !== "NOT_MODELED") fail(caseId, `financial ${m} ${fin[m]} !== NOT_MODELED`);
      }
    }
    if (expect.resources_not_modeled) {
      const res = s.resources ?? {};
      if (res.scope !== "NOT_MODELED" || res.overallocation !== "NOT_MODELED" || res.leveling !== "NOT_MODELED") {
        fail(caseId, `resources must be NOT_MODELED, got ${canonicalJson(res)}`);
      }
    }
    if (expect.inventory !== undefined) {
      const inv = s.inventory ?? {};
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
        if (!ROW_ID_RE.test(row.row_id)) fail(caseId, `row id ${row.row_id} is not a pm-<64 hex> digest`);
      }
    }
    if (expect.distinct_row_ids) {
      const ids = allRows(item).map((r) => r.row_id).filter((id) => id !== "report");
      if (new Set(ids).size !== ids.length) fail(caseId, "duplicate row ids in the published item");
    }
    if (expect.carried_evidence_record_ref_only) {
      for (const row of carriedRows(item)) {
        for (const ev of row.evidence ?? []) {
          if (typeof ev.record_ref !== "string") fail(caseId, `carried row ${row.row_id} evidence lacks a string record_ref`);
          if ("record" in ev) fail(caseId, `carried row ${row.row_id} evidence uses a bare 'record' key (P677-007A class)`);
        }
      }
    }
    if (expect.carried_evidence_in_spans) {
      const spanKeys = new Set((item.evidence_spans ?? []).map((sp) => `${sp.dataset}:${sp.record_ref}`));
      for (const row of carriedRows(item)) {
        for (const ev of row.evidence ?? []) {
          if (!spanKeys.has(`${ev.dataset}:${ev.record_ref}`)) {
            fail(caseId, `carried row ${row.row_id} cites ${ev.dataset}:${ev.record_ref}, which has no evidence span (fictitious row)`);
          }
        }
      }
    }
    if (expect.report_digest_recomputes) {
      if (canonicalDigest(report) !== item.report_digest) {
        fail(caseId, "report digest does not recompute over the published report");
      }
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
