/**
 * P2b-2 Project Controls evidence-review evaluator (pure,
 * deterministic). NONFINANCIAL controls evidence quality — not a
 * production port of the financial prototype (scripts/ai-agents/
 * project-controls-prototype): every PV/EV/AC, CPI/SPI, monetary
 * variance, EAC/ETC and contingency field returns NOT_MODELED, and
 * no cost/hour field is ever admitted into a snapshot (see
 * fieldMappings.js — the allowlist excludes them, so a query spy
 * asserting the allowlist proves zero cost-field fetches).
 *
 * Input: an admitted planning snapshot (never a live DB handle,
 * never a URL, never credentials) containing ONLY the controls
 * datasets (forge_work_packages, forge_work_package_baselines,
 * forge_work_progress_snapshots). Output: a DRAFT evidence review
 * whose every row names its evidence (snapshot spans) or an
 * explicit unavailable state. The report is review-only: no
 * baseline is frozen, no snapshot is created or approved, no
 * forecast is issued, no budget or contingency decision is made.
 *
 * Per package, the evaluator:
 * - resolves each eligible progress snapshot against its NAMED
 *   baseline_version — never falling back to the current baseline
 *   when the named version is missing (that is an integrity
 *   finding, not a silent substitution);
 * - takes the latest eligible snapshot as the greatest status_date
 *   <= review_date; future-dated records are flagged and excluded
 *   from current claims; tied snapshots without a source-defined
 *   order preserve the conflict and mark the current assessment
 *   UNVERIFIABLE;
 * - names baseline sequence/version integrity, missing baselines,
 *   invalid/inverted dates, snapshot date/applicability gaps and
 *   out-of-range progress claims as findings;
 * - treats null progress as unknown, never zero; treats a sourced
 *   100% as a reported claim, never independently observed
 *   physical completion;
 * - compares the snapshot's named baseline dates to that same
 *   named baseline and shows the distinct current baseline when it
 *   changed — historical status is never silently rewritten
 *   against today's baseline.
 *
 * Scope baselines and scheduling baselines are distinct concepts:
 * this lane reads no scheduling dataset, so it never joins their
 * versions or hashes. A package's scope_baseline_ref resolves
 * against the package baselines only, and is shown separately from
 * the current (max-version) baseline.
 *
 * Conclusions: READY (exact) / QUALIFIED (findings named, assessment
 * still publishable) / UNVERIFIABLE (tied latest snapshots — no
 * current assessment can be chosen). A PARTIAL snapshot degrades
 * READY to QUALIFIED: incomplete coverage never publishes as an
 * all-clear. Financial measures are NOT_MODELED, never a package
 * conclusion.
 *
 * Status: always DRAFT (brief §10: render DRAFT / ADVISORY /
 * READ-ONLY). execution_authorized is always false.
 *
 * Row identity: injective by construction. A row id is
 * "ctl-" + SHA-256 hex of the canonical tuple [agent, scope type,
 * scope id, section, kind, dataset, record, discriminator] — a
 * digest over the complete tuple, never a raw concatenation of
 * caller strings (the P670-005A lesson). At most one finding of
 * each kind is emitted per record (multi-field defects merge into
 * one finding naming every field), so (kind, dataset, record) is
 * unique for integrity rows; checklist/question rows disambiguate
 * with the finding kind in the discriminator.
 */

import { canonicalJson, sha256Hex } from "../rental-ops/canonical.js";
import { JobRefusal } from "./jobContracts.js";
import { isCivilDate, utcCivilDate } from "./fieldMappings.js";

export const CONTROLS_EVALUATOR_VERSION = "planning-controls-evaluator@1";
export const CONTROLS_WINDOW = "planning-latest-through-asof";

/** Source status vocabulary (rung 1 check constraint). */
export const PACKAGE_STATUSES = Object.freeze([
  "draft", "planned", "readiness_review", "ready", "in_progress", "blocked",
  "complete", "verified_closed", "cancelled",
]);

export const FINANCIAL_FIELDS = Object.freeze({
  scope: "FINANCIAL_SCOPE_EXCLUDED",
  planned_value: "NOT_MODELED",
  earned_value: "NOT_MODELED",
  actual_cost: "NOT_MODELED",
  cpi: "NOT_MODELED",
  spi: "NOT_MODELED",
  monetary_variance: "NOT_MODELED",
  eac: "NOT_MODELED",
  etc: "NOT_MODELED",
  contingency: "NOT_MODELED",
});

export function controlsRowId(tuple) {
  return `ctl-${sha256Hex(canonicalJson(tuple))}`;
}

function rowIdFor({ agent, scope, section, kind, dataset, record, discriminator = "" }) {
  return controlsRowId([agent, scope.type, scope.id, section, kind, dataset, record, discriminator]);
}

/** Open-question text per finding kind (deterministic, no guessing). */
const QUESTION_TEXT = Object.freeze({
  BASELINE_MISSING: "Which baseline version anchors this package's progress claims? No baseline row exists for this package.",
  BASELINE_VERSION_DUPLICATE: "Which baseline row is authoritative for the duplicated version number?",
  BASELINE_DATES_INVERTED: "What are the correct baseline dates? The recorded finish precedes the recorded start.",
  BASELINE_DATES_INVALID: "What are the correct baseline dates? The recorded dates are missing or not civil dates.",
  BASELINE_CHANGED: "The current baseline differs from the snapshot's named baseline — confirm the historical status stays anchored to the named baseline and is not rewritten against today's baseline.",
  SCOPE_BASELINE_UNRESOLVED: "Which baseline does the package's scope baseline reference name? The referenced row does not exist for this package.",
  NO_SNAPSHOTS: "Where is the progress evidence for this package? No progress snapshot exists.",
  FUTURE_SNAPSHOT: "Does this future-dated snapshot belong to the current reporting period? It is excluded from current claims.",
  SNAPSHOT_BASELINE_MISSING: "Which baseline does this snapshot's baseline_version name? No baseline row carries that version for this package.",
  SNAPSHOT_BASELINE_AMBIGUOUS: "Which baseline row is authoritative for this snapshot's version? The version is duplicated.",
  SNAPSHOT_TIE_CONFLICT: "Which tied snapshot is the authoritative current record? Multiple incompatible snapshots share the latest status date.",
  SNAPSHOT_DATE_INVALID: "What is the correct status date for this snapshot? The recorded date is missing or not a civil date.",
  PROGRESS_OUT_OF_RANGE: "What is the correct progress value within 0–100? The recorded claim falls outside the range.",
  PACKAGE_DATES_INVERTED: "What are the correct planned/actual dates? A recorded finish precedes its recorded start.",
  UNKNOWN_STATUS: "What is the package's status in the source vocabulary? The recorded status is not a known value.",
  COMPLETION_CLAIM: "Is the 100% progress claim supported by observed physical completion evidence? A sourced 100% is a reported claim, never independently observed completion.",
});

function pctState(v) {
  if (v === null || v === undefined) return "UNKNOWN";
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100) return "CLAIM";
  return "INVALID";
}

function claimTuple(s) {
  return canonicalJson([s.baseline_version ?? null, s.planned_pct ?? null, s.actual_pct ?? null, s.earned_pct ?? null]);
}

export function evaluateControlsSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.records) {
    throw new JobRefusal("BAD_SNAPSHOT", "controls evaluation requires an admitted snapshot with records");
  }
  const scope = snapshot.project_scope_ref ?? { type: "work-management-project", id: "unknown" };
  const agent = "project-controls";
  const reviewDate = utcCivilDate(snapshot.as_of);

  const packages = [...(snapshot.records.forge_work_packages ?? [])].sort((a, b) => (a.package_ref < b.package_ref ? -1 : 1));
  const baselinesByPackage = new Map();
  for (const b of snapshot.records.forge_work_package_baselines ?? []) {
    const list = baselinesByPackage.get(b.package_ref) ?? [];
    list.push(b);
    baselinesByPackage.set(b.package_ref, list);
  }
  const snapshotsByPackage = new Map();
  for (const s of snapshot.records.forge_work_progress_snapshots ?? []) {
    const list = snapshotsByPackage.get(s.package_ref) ?? [];
    list.push(s);
    snapshotsByPackage.set(s.package_ref, list);
  }
  for (const list of baselinesByPackage.values()) {
    list.sort((a, b) => (a.version_number - b.version_number) || (a.baseline_ref < b.baseline_ref ? -1 : 1));
  }
  for (const list of snapshotsByPackage.values()) {
    list.sort((a, b) => {
      const da = typeof a.status_date === "string" ? a.status_date : "";
      const db = typeof b.status_date === "string" ? b.status_date : "";
      return da < db ? -1 : da > db ? 1 : (a.snapshot_ref < b.snapshot_ref ? -1 : 1);
    });
  }

  const packageRows = [];
  const integrityRows = [];
  const checklistRows = [];
  const questionRows = [];
  let futureSnapshots = 0;
  let tieConflicts = 0;
  let outOfRangeClaims = 0;
  let unresolvedBaselineRefs = 0;

  for (const p of packages) {
    const findings = [];
    const pushFinding = (kind, dataset, recordRef, detail) => {
      findings.push({ kind, dataset, record_ref: recordRef, detail });
    };
    const pkgBaselines = baselinesByPackage.get(p.package_ref) ?? [];
    const pkgSnapshots = snapshotsByPackage.get(p.package_ref) ?? [];

    // --- baselines: version groups, current, scope ---
    const versionGroups = new Map();
    for (const b of pkgBaselines) {
      const g = versionGroups.get(b.version_number) ?? [];
      g.push(b);
      versionGroups.set(b.version_number, g);
    }
    for (const [version, rows] of [...versionGroups.entries()].sort((a, b) => a[0] - b[0])) {
      if (rows.length > 1) {
        pushFinding("BASELINE_VERSION_DUPLICATE", "forge_work_package_baselines", rows[0].baseline_ref,
          `version ${version} is carried by ${rows.length} baseline rows (${rows.map((r) => r.baseline_ref).join(", ")}); no single row is authoritative for that version`);
      }
    }
    if (pkgBaselines.length === 0) {
      pushFinding("BASELINE_MISSING", "forge_work_package_baselines", p.package_ref,
        "no baseline row exists for this package; no snapshot can resolve against a named baseline");
    }
    for (const b of pkgBaselines) {
      if (b.baseline_start === undefined || b.baseline_start === null || b.baseline_finish === undefined || b.baseline_finish === null
        || !isCivilDate(b.baseline_start) || !isCivilDate(b.baseline_finish)) {
        pushFinding("BASELINE_DATES_INVALID", "forge_work_package_baselines", b.baseline_ref,
          "baseline start or finish is missing or not a civil date");
      } else if (b.baseline_finish < b.baseline_start) {
        pushFinding("BASELINE_DATES_INVERTED", "forge_work_package_baselines", b.baseline_ref,
          `baseline finish ${b.baseline_finish} precedes baseline start ${b.baseline_start}`);
      }
    }
    let currentBaseline = null;
    let currentState = "ABSENT";
    if (pkgBaselines.length > 0) {
      const maxVersion = Math.max(...pkgBaselines.map((b) => b.version_number));
      const group = versionGroups.get(maxVersion) ?? [];
      if (group.length > 1) {
        currentState = "AMBIGUOUS";
      } else {
        currentState = "RESOLVED";
        const row = group[0];
        currentBaseline = { baseline_ref: row.baseline_ref, version_number: row.version_number, baseline_start: row.baseline_start ?? null, baseline_finish: row.baseline_finish ?? null };
      }
    }
    let scopeBaselineVersion = null;
    let scopeBaselineResolved = false;
    if (p.scope_baseline_ref !== undefined && p.scope_baseline_ref !== null) {
      const row = pkgBaselines.find((b) => b.baseline_ref === p.scope_baseline_ref);
      if (row) {
        scopeBaselineVersion = row.version_number;
        scopeBaselineResolved = true;
      } else {
        unresolvedBaselineRefs += 1;
        pushFinding("SCOPE_BASELINE_UNRESOLVED", "forge_work_packages", p.package_ref,
          `scope baseline reference '${p.scope_baseline_ref}' names no baseline row for this package`);
      }
    }

    // --- package-level fields ---
    if (p.status === undefined || p.status === null || !PACKAGE_STATUSES.includes(p.status)) {
      pushFinding("UNKNOWN_STATUS", "forge_work_packages", p.package_ref,
        `status '${String(p.status)}' is not in the source vocabulary (${PACKAGE_STATUSES.join(", ")})`);
    }
    const invertedPairs = [];
    if (isCivilDate(p.planned_start) && isCivilDate(p.planned_finish) && p.planned_finish < p.planned_start) invertedPairs.push("planned");
    if (isCivilDate(p.actual_start) && isCivilDate(p.actual_finish) && p.actual_finish < p.actual_start) invertedPairs.push("actual");
    if (invertedPairs.length > 0) {
      pushFinding("PACKAGE_DATES_INVERTED", "forge_work_packages", p.package_ref,
        `finish precedes start for: ${invertedPairs.join(", ")}`);
    }
    const percentState = pctState(p.percent_complete);
    if (percentState === "INVALID") {
      outOfRangeClaims += 1;
      pushFinding("PROGRESS_OUT_OF_RANGE", "forge_work_packages", p.package_ref,
        `package percent_complete ${p.percent_complete} falls outside 0–100`);
    }

    // --- snapshots: per-row resolution, then latest ---
    const snapshotRows = [];
    for (const s of pkgSnapshots) {
      const row = {
        snapshot_ref: s.snapshot_ref,
        status_date: s.status_date ?? null,
        baseline_version: s.baseline_version ?? null,
        baseline_resolved: false,
        baseline_ref: null,
        planned_pct: s.planned_pct ?? null,
        actual_pct: s.actual_pct ?? null,
        earned_pct: s.earned_pct ?? null,
        pct_states: {
          planned: pctState(s.planned_pct),
          actual: pctState(s.actual_pct),
          earned: pctState(s.earned_pct),
        },
        state: null,
      };
      if (s.status_date === undefined || s.status_date === null || !isCivilDate(s.status_date)) {
        pushFinding("SNAPSHOT_DATE_INVALID", "forge_work_progress_snapshots", s.snapshot_ref,
          "status_date is missing or not a civil date; the snapshot cannot be ordered and is excluded from current claims");
        row.state = "DATE_INVALID";
        snapshotRows.push(row);
        continue;
      }
      if (s.status_date > reviewDate) {
        futureSnapshots += 1;
        pushFinding("FUTURE_SNAPSHOT", "forge_work_progress_snapshots", s.snapshot_ref,
          `status_date ${s.status_date} is after the review date ${reviewDate}; excluded from current claims`);
        row.state = "FUTURE_EXCLUDED";
        snapshotRows.push(row);
        continue;
      }
      const badFields = ["planned_pct", "actual_pct", "earned_pct"].filter((f) => row.pct_states[f === "planned_pct" ? "planned" : f === "actual_pct" ? "actual" : "earned"] === "INVALID");
      if (badFields.length > 0) {
        outOfRangeClaims += 1;
        pushFinding("PROGRESS_OUT_OF_RANGE", "forge_work_progress_snapshots", s.snapshot_ref,
          `progress claim outside 0–100 for: ${badFields.join(", ")}`);
      }
      if (s.baseline_version === undefined || s.baseline_version === null) {
        unresolvedBaselineRefs += 1;
        pushFinding("SNAPSHOT_BASELINE_MISSING", "forge_work_progress_snapshots", s.snapshot_ref,
          "baseline_version is missing; the snapshot names no baseline and cannot resolve");
      } else {
        const group = versionGroups.get(s.baseline_version) ?? [];
        if (group.length === 0) {
          unresolvedBaselineRefs += 1;
          pushFinding("SNAPSHOT_BASELINE_MISSING", "forge_work_progress_snapshots", s.snapshot_ref,
            `baseline_version ${s.baseline_version} matches no baseline row for this package; no fallback to the current baseline is applied`);
        } else if (group.length > 1) {
          unresolvedBaselineRefs += 1;
          pushFinding("SNAPSHOT_BASELINE_AMBIGUOUS", "forge_work_progress_snapshots", s.snapshot_ref,
            `baseline_version ${s.baseline_version} is carried by ${group.length} baseline rows; no single row is authoritative`);
        } else {
          row.baseline_resolved = true;
          row.baseline_ref = group[0].baseline_ref;
        }
      }
      row.state = "ELIGIBLE";
      snapshotRows.push(row);
    }
    const eligible = snapshotRows.filter((r) => r.state === "ELIGIBLE");
    let latestSnapshotRef = null;
    let latestStatusDate = null;
    let latestState = "NONE";
    let latestRow = null;
    if (pkgSnapshots.length === 0) {
      pushFinding("NO_SNAPSHOTS", "forge_work_progress_snapshots", p.package_ref,
        "no progress snapshot exists for this package");
    } else if (eligible.length > 0) {
      const maxDate = eligible.map((r) => r.status_date).sort().at(-1);
      const group = eligible.filter((r) => r.status_date === maxDate);
      const distinct = new Set(group.map((r) => claimTuple({
        baseline_version: r.baseline_version, planned_pct: r.planned_pct, actual_pct: r.actual_pct, earned_pct: r.earned_pct,
      })));
      if (distinct.size > 1) {
        tieConflicts += 1;
        pushFinding("SNAPSHOT_TIE_CONFLICT", "forge_work_progress_snapshots", p.package_ref,
          `${group.length} incompatible snapshots share the latest status_date ${maxDate} with no source-defined order; no latest snapshot is chosen`);
        latestState = "TIE_CONFLICT";
      } else {
        latestRow = group[0];
        latestSnapshotRef = latestRow.snapshot_ref;
        latestStatusDate = latestRow.status_date;
        latestState = "RESOLVED";
      }
    }
    let namedBaseline = null;
    if (latestRow && latestRow.baseline_resolved) {
      const b = pkgBaselines.find((x) => x.baseline_ref === latestRow.baseline_ref);
      if (b) {
        namedBaseline = { baseline_ref: b.baseline_ref, version_number: b.version_number, baseline_start: b.baseline_start ?? null, baseline_finish: b.baseline_finish ?? null };
      }
    }
    const baselineChanged = namedBaseline !== null && currentBaseline !== null
      && namedBaseline.version_number !== currentBaseline.version_number;
    if (baselineChanged) {
      pushFinding("BASELINE_CHANGED", "forge_work_package_baselines", p.package_ref,
        `latest snapshot is anchored to baseline version ${namedBaseline.version_number} while the current baseline is version ${currentBaseline.version_number}; the historical status stays anchored to the named baseline`);
    }

    // --- conclusion (PARTIAL degrades READY, never UNVERIFIABLE) ---
    const tieConflict = findings.some((f) => f.kind === "SNAPSHOT_TIE_CONFLICT");
    const qualifications = [];
    let conclusion;
    if (tieConflict) {
      conclusion = "UNVERIFIABLE";
    } else if (findings.length > 0) {
      conclusion = "QUALIFIED";
    } else {
      conclusion = "READY";
    }
    if (snapshot.consistency === "PARTIAL" && conclusion === "READY") {
      conclusion = "QUALIFIED";
      qualifications.push("snapshot PARTIAL: conclusions drawn from incomplete coverage are qualified, never all-clear");
    }

    const evidence = [{ dataset: "forge_work_packages", record_ref: p.package_ref }];
    for (const b of pkgBaselines) evidence.push({ dataset: "forge_work_package_baselines", record_ref: b.baseline_ref });
    for (const s of pkgSnapshots) evidence.push({ dataset: "forge_work_progress_snapshots", record_ref: s.snapshot_ref });

    const packageRow = {
      row_id: rowIdFor({ agent, scope, section: "packages", kind: "package", dataset: "forge_work_packages", record: p.package_ref }),
      package_ref: p.package_ref,
      status: p.status ?? null,
      status_state: p.status !== undefined && p.status !== null && PACKAGE_STATUSES.includes(p.status) ? "KNOWN" : "UNKNOWN",
      planned_start: p.planned_start ?? null,
      planned_finish: p.planned_finish ?? null,
      actual_start: p.actual_start ?? null,
      actual_finish: p.actual_finish ?? null,
      percent_complete_claim: p.percent_complete ?? null,
      percent_complete_state: percentState,
      completion_note: p.percent_complete === 100
        ? "100% is a reported claim, never independently observed physical completion"
        : null,
      scope_baseline_ref: p.scope_baseline_ref ?? null,
      scope_baseline_version: scopeBaselineVersion,
      scope_baseline_resolved: scopeBaselineResolved,
      baselines: pkgBaselines.map((b) => ({
        baseline_ref: b.baseline_ref, version_number: b.version_number,
        baseline_start: b.baseline_start ?? null, baseline_finish: b.baseline_finish ?? null,
      })),
      current_baseline: currentBaseline,
      current_baseline_state: currentState,
      snapshots: snapshotRows,
      latest_snapshot_ref: latestSnapshotRef,
      latest_status_date: latestStatusDate,
      latest_state: latestState,
      named_baseline: namedBaseline,
      baseline_changed: baselineChanged,
      conclusion,
      qualifications,
      finding_kinds: findings.map((f) => f.kind),
      evidence,
    };
    packageRows.push(packageRow);

    for (const f of findings) {
      integrityRows.push({
        row_id: rowIdFor({ agent, scope, section: "integrity", kind: f.kind, dataset: f.dataset, record: f.record_ref }),
        kind: f.kind, dataset: f.dataset, record_ref: f.record_ref, detail: f.detail ?? "",
        evidence: [{ dataset: f.dataset, record_ref: f.record_ref }],
      });
    }
    if (namedBaseline) {
      checklistRows.push({
        row_id: rowIdFor({ agent, scope, section: "checklist", kind: "VERIFY_BASELINE", dataset: "forge_work_package_baselines", record: namedBaseline.baseline_ref }),
        kind: "VERIFY_BASELINE", record_ref: namedBaseline.baseline_ref, dataset: "forge_work_package_baselines",
        action: "verify-baseline",
        detail: `Verify the named baseline (version ${namedBaseline.version_number}, ${namedBaseline.baseline_start} → ${namedBaseline.baseline_finish}) against source records`,
        evidence: [{ dataset: "forge_work_package_baselines", record_ref: namedBaseline.baseline_ref }],
      });
    }
    if (latestRow) {
      checklistRows.push({
        row_id: rowIdFor({ agent, scope, section: "checklist", kind: "VERIFY_LATEST_SNAPSHOT", dataset: "forge_work_progress_snapshots", record: latestRow.snapshot_ref }),
        kind: "VERIFY_LATEST_SNAPSHOT", record_ref: latestRow.snapshot_ref, dataset: "forge_work_progress_snapshots",
        action: "verify-latest-snapshot",
        detail: `Verify the latest snapshot's progress claims (status_date ${latestRow.status_date}) against source records`,
        evidence: [{ dataset: "forge_work_progress_snapshots", record_ref: latestRow.snapshot_ref }],
      });
    }
    for (const f of findings) {
      checklistRows.push({
        row_id: rowIdFor({ agent, scope, section: "checklist", kind: "RESOLVE_FINDING", dataset: f.dataset, record: f.record_ref, discriminator: `${f.kind}:${f.record_ref}` }),
        kind: "RESOLVE_FINDING", record_ref: f.record_ref, dataset: f.dataset,
        action: "resolve-finding",
        detail: `Resolve ${f.kind}: ${f.detail}`,
        evidence: [{ dataset: f.dataset, record_ref: f.record_ref }],
      });
      questionRows.push({
        row_id: rowIdFor({ agent, scope, section: "questions", kind: "OPEN_QUESTION", dataset: f.dataset, record: f.record_ref, discriminator: f.kind }),
        kind: "OPEN_QUESTION", record_ref: f.record_ref, dataset: f.dataset,
        question: QUESTION_TEXT[f.kind] ?? `What resolves ${f.kind} for this record?`,
        detail: f.detail,
        evidence: [{ dataset: f.dataset, record_ref: f.record_ref }],
      });
    }
    if (p.percent_complete === 100) {
      checklistRows.push({
        row_id: rowIdFor({ agent, scope, section: "checklist", kind: "CONFIRM_COMPLETION_CLAIM", dataset: "forge_work_packages", record: p.package_ref }),
        kind: "CONFIRM_COMPLETION_CLAIM", record_ref: p.package_ref, dataset: "forge_work_packages",
        action: "confirm-completion-claim",
        detail: "Confirm the 100% progress claim with observed physical completion evidence; a sourced 100% alone is not completion",
        evidence: [{ dataset: "forge_work_packages", record_ref: p.package_ref }],
      });
      questionRows.push({
        row_id: rowIdFor({ agent, scope, section: "questions", kind: "OPEN_QUESTION", dataset: "forge_work_packages", record: p.package_ref, discriminator: "COMPLETION_CLAIM" }),
        kind: "OPEN_QUESTION", record_ref: p.package_ref, dataset: "forge_work_packages",
        question: QUESTION_TEXT.COMPLETION_CLAIM,
        detail: "package percent_complete is 100",
        evidence: [{ dataset: "forge_work_packages", record_ref: p.package_ref }],
      });
    }
  }

  integrityRows.sort((a, b) => (a.record_ref < b.record_ref ? -1 : a.record_ref > b.record_ref ? 1 : (a.kind < b.kind ? -1 : 1)));
  checklistRows.sort((a, b) => (a.record_ref < b.record_ref ? -1 : a.record_ref > b.record_ref ? 1 : (a.kind < b.kind ? -1 : 1)));
  questionRows.sort((a, b) => (a.record_ref < b.record_ref ? -1 : a.record_ref > b.record_ref ? 1 : (a.kind < b.kind ? -1 : 1)));

  const diagnostics = [];
  if (snapshot.consistency === "PARTIAL") {
    diagnostics.push({ code: "SNAPSHOT_PARTIAL", reason: "the snapshot is PARTIAL; conclusions drawn from incomplete coverage are qualified, never all-clear" });
  }
  for (const g of snapshot.coverage_gaps ?? []) {
    diagnostics.push({ code: g.code, dataset: g.dataset, reason: g.detail ?? "" });
  }
  for (const e of snapshot.collection_errors ?? []) {
    diagnostics.push({ code: e.code, dataset: e.dataset, reason: "collection error for this dataset" });
  }
  for (const cf of snapshot.conflicts ?? []) {
    diagnostics.push({ code: cf.code, dataset: cf.dataset, record_ref: cf.record_ref, reason: "conflicting rows share one record ref; the first admitted row wins and the snapshot is PARTIAL" });
  }

  const inventory = {
    packages_total: packages.length,
    baselines_total: (snapshot.records.forge_work_package_baselines ?? []).length,
    snapshots_total: (snapshot.records.forge_work_progress_snapshots ?? []).length,
    packages_with_baselines: packageRows.filter((r) => r.baselines.length > 0).length,
    packages_without_baselines: packageRows.filter((r) => r.baselines.length === 0).length,
    packages_with_snapshots: packageRows.filter((r) => r.snapshots.length > 0).length,
    packages_without_snapshots: packageRows.filter((r) => r.snapshots.length === 0).length,
    future_snapshots: futureSnapshots,
    tie_conflicts: tieConflicts,
    out_of_range_claims: outOfRangeClaims,
    unresolved_baseline_refs: unresolvedBaselineRefs,
  };

  const report = {
    schema_version: "planning-controls-report@1",
    agent,
    job_kind: "project-controls-evidence-review",
    job_version: 1,
    owner_ref: snapshot.owner_ref,
    project_scope_ref: scope,
    window: { name: CONTROLS_WINDOW },
    as_of: snapshot.as_of,
    as_of_date: reviewDate,
    as_of_timezone: "UTC",
    review_date: reviewDate,
    status: "DRAFT",
    snapshot_digest: snapshot.digest,
    snapshot_consistency: snapshot.consistency,
    sections: {
      inventory,
      packages: { rows: packageRows },
      integrity: { rows: integrityRows },
      checklist: { rows: checklistRows },
      questions: { rows: questionRows },
      financial: { ...FINANCIAL_FIELDS },
      not_modeled: {
        modules: [
          "financial measures (PV/EV/AC, CPI/SPI, monetary variances, EAC/ETC, contingency, costs, hours)",
          "cost/hour rollups and earned-value computation (the financial prototype's engine is not ported here)",
          "baseline freeze, snapshot creation, snapshot approval (no writes of any kind)",
          "forecasts, budget decisions, contingency decisions",
          "scheduling-lane baselines (distinct from package baselines; versions and hashes are never joined)",
          "resource capacity, labor availability, assignments and leveling",
          "live CPM engine outputs (recomputed by the scheduler lane, never read here)",
          "cross-project inference (no mapping registered)",
        ],
      },
    },
    diagnostics,
    execution_authorized: false,
  };
  return report;
}
