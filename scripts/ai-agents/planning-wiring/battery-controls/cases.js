/**
 * Project-controls battery cases (81). Each case runs the full inert
 * runner three times against ONE shared publisher with a fixed clock
 * and fixed source; the published item must be byte-identical across
 * runs and must match the oracle's expectation for the case.
 *
 * Cases are data + small builders, not candidate logic: the oracle
 * (oracle.js) asserts outcomes, codes, counts, hand-derived
 * resolutions and finding kinds. It imports NOTHING from the
 * evaluator, the snapshot builder, the mapping layer or any
 * prototype math — only canonical JSON primitives.
 *
 * Groups: A domain/boundary (20), B coverage/version/calendar/
 * mapping (20), C authority/prohibited-data/operation/injection
 * (21), D budget/durability/replay/timeout (20).
 *
 * A case's `build` returns { host, request, spec, faults?, clock }.
 * `post` names an optional harness step run after the three runner
 * runs (decision/trust/deadline proofs that are not runner runs
 * themselves); the runner invariant still holds for the case.
 *
 * NOTE (learned from P2b-1 C15): evidence spans record DROPPED
 * FIELD NAMES by design, so financial/tenant canary cases assert
 * canary VALUES absent, never field names — a field name in a span
 * is metadata, not fetched data.
 */
import {
  CANONICAL_CONTROLS_AS_OF, CANONICAL_CONTROLS, CANONICAL_CONTROLS_HOST,
  canonicalControlsRequest, canonicalControlsSpec,
} from "../src/fixtures.js";

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function specWith(datasets, faults = {}, authorized = []) {
  return { kind: "synthetic", datasets, faults, authorized_global_calendar_refs: authorized };
}

function hostWith(overrides = {}) {
  return { ...clone(CANONICAL_CONTROLS_HOST), ...overrides };
}

function requestWith(overrides = {}) {
  return { ...clone(canonicalControlsRequest()), ...overrides };
}

function datasetsWith(mutator) {
  const d = clone(CANONICAL_CONTROLS);
  mutator(d);
  return d;
}

function pkg(id, overrides = {}) {
  return {
    package_ref: id, project_ref: "WM-1", owner_ref: "owner-1", status: "in_progress",
    planned_start: "2026-10-01", planned_finish: "2026-11-30", actual_start: "2026-10-01", actual_finish: null,
    percent_complete: 0, scope_baseline_ref: null, ...overrides,
  };
}

function baseline(id, packageRef, version, overrides = {}) {
  return {
    baseline_ref: id, package_ref: packageRef, owner_ref: "owner-1", version_number: version,
    baseline_start: "2026-10-01", baseline_finish: "2026-11-30",
    frozen_at: "2026-09-28T12:00:00.000Z", ...overrides,
  };
}

function snap(id, packageRef, statusDate, version, overrides = {}) {
  return {
    snapshot_ref: id, package_ref: packageRef, owner_ref: "owner-1", status_date: statusDate,
    baseline_version: version, planned_pct: 0, actual_pct: 0, earned_pct: 0, ...overrides,
  };
}

// --- Group A: domain / boundary ------------------------------------
const A = [
  {
    id: "A01", group: "A", title: "canonical happy path: both packages READY, snapshots resolve against named baselines",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec() }),
    expect: { outcome: "COMPLETED", report_status: "DRAFT",
      packages: [
        { id: "PKG-A", conclusion: "READY", latest_snapshot: "S-A2", latest_status_date: "2026-10-26",
          named_baseline_version: 2, current_baseline_version: 2, baseline_changed: false,
          scope_baseline_version: null, scope_baseline_resolved: false, scope_baseline_state: "RELATIONSHIP_NOT_MODELED", package_percent_complete: 55,
          latest_pcts: { planned_pct: 60, actual_pct: 55, earned_pct: 58 } },
        { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1", latest_status_date: "2026-10-12",
          named_baseline_version: 1, current_baseline_version: 1, baseline_changed: false,
          scope_baseline_version: null, scope_baseline_resolved: false, package_percent_complete: 20,
          latest_pcts: { planned_pct: 20, actual_pct: 20, earned_pct: 20 } },
      ],
      financial_all_not_modeled: true,
      inventory: { packages_total: 2, baselines_total: 3, snapshots_total: 3 } },
  },
  {
    id: "A02", group: "A", title: "complete empty report: a project with no packages is COMPLETE-empty, not an error",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith({ forge_work_packages: [], forge_work_package_baselines: [], forge_work_progress_snapshots: [] }) }),
    expect: { outcome: "COMPLETED", report_status: "DRAFT", packages: [],
      inventory: { packages_total: 0, baselines_total: 0, snapshots_total: 0 },
      financial_all_not_modeled: true },
  },
  {
    id: "A03", group: "A", title: "package with baselines but no snapshots: NO_SNAPSHOTS finding, QUALIFIED, never an all-clear",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => { d.forge_work_progress_snapshots = d.forge_work_progress_snapshots.filter((s) => s.package_ref === "PKG-B"); })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", latest_snapshot: null },
        { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["NO_SNAPSHOTS"] },
  },
  {
    id: "A04", group: "A", title: "package with snapshots but no baselines: BASELINE_MISSING + SNAPSHOT_BASELINE_MISSING, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => { d.forge_work_package_baselines = d.forge_work_package_baselines.filter((b) => b.package_ref === "PKG-B"); })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", latest_snapshot: "S-A2", named_baseline_version: null, current_baseline_version: null },
        { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["BASELINE_MISSING", "SNAPSHOT_BASELINE_MISSING"] },
  },
  {
    id: "A05", group: "A", title: "named baseline missing: snapshot version 9 matches no baseline — no fallback to the current baseline",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").baseline_version = 9;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", latest_snapshot: "S-A2", named_baseline_version: null, current_baseline_version: 2 }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["SNAPSHOT_BASELINE_MISSING"] },
  },
  {
    id: "A06", group: "A", title: "no silent rebase: latest snapshot anchored to v1 while current is v2 — BASELINE_CHANGED shows both, history not rewritten",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots = d.forge_work_progress_snapshots.filter((s) => s.snapshot_ref !== "S-A2");
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", latest_snapshot: "S-A1", latest_status_date: "2026-10-19",
        named_baseline_version: 1, current_baseline_version: 2, baseline_changed: true }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["BASELINE_CHANGED"] },
  },
  {
    id: "A07", group: "A", title: "future snapshot excluded from current claims: latest stays the in-period snapshot, FUTURE_SNAPSHOT named",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.push(snap("S-AF", "PKG-A", "2026-11-02", 2, { planned_pct: 90, actual_pct: 80, earned_pct: 85 }));
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", latest_snapshot: "S-A2" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["FUTURE_SNAPSHOT"] },
  },
  {
    id: "A08", group: "A", title: "all snapshots future: no latest, QUALIFIED, never a future claim as current",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots = d.forge_work_progress_snapshots.map((s) =>
          s.package_ref === "PKG-A" ? { ...s, status_date: "2026-11-02" } : s);
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", latest_snapshot: null }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["FUTURE_SNAPSHOT"] },
  },
  {
    id: "A09", group: "A", title: "tied snapshots with incompatible claims: SNAPSHOT_TIE_CONFLICT, current assessment UNVERIFIABLE",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.push(snap("S-A2B", "PKG-A", "2026-10-26", 2, { planned_pct: 61, actual_pct: 56, earned_pct: 59 }));
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "UNVERIFIABLE", latest_snapshot: null }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["SNAPSHOT_TIE_CONFLICT"] },
  },
  {
    id: "A10", group: "A", title: "tied snapshots with identical claims collapse to one claim: READY, no false conflict",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.push(snap("S-A2B", "PKG-A", "2026-10-26", 2, { planned_pct: 60, actual_pct: 55, earned_pct: 58 }));
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY", latest_snapshot: "S-A2" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }] },
  },
  {
    id: "A11", group: "A", title: "null progress is unknown, never zero: null pcts and null package percent conclude READY with unknown claims",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").planned_pct = null;
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").actual_pct = null;
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").earned_pct = null;
        d.forge_work_packages.find((p) => p.package_ref === "PKG-A").percent_complete = null;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY", latest_snapshot: "S-A2",
        latest_pcts: { planned_pct: null, actual_pct: null, earned_pct: null }, package_percent_complete: null }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }] },
  },
  {
    id: "A12", group: "A", title: "sourced 100% is a reported claim, never observed completion: READY plus an open completion question",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.find((p) => p.package_ref === "PKG-A").percent_complete = 100;
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").planned_pct = 100;
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").actual_pct = 100;
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").earned_pct = 100;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY", package_percent_complete: 100 }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      questions_include: ["observed physical completion"] },
  },
  {
    id: "A13", group: "A", title: "out-of-range progress claim: actual_pct 140 is PROGRESS_OUT_OF_RANGE, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").actual_pct = 140;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["PROGRESS_OUT_OF_RANGE"] },
  },
  {
    id: "A14", group: "A", title: "negative progress claim: planned_pct -5 is PROGRESS_OUT_OF_RANGE, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").planned_pct = -5;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["PROGRESS_OUT_OF_RANGE"] },
  },
  {
    id: "A15", group: "A", title: "package percent out of range: 150 is PROGRESS_OUT_OF_RANGE, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.find((p) => p.package_ref === "PKG-A").percent_complete = 150;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["PROGRESS_OUT_OF_RANGE"] },
  },
  {
    id: "A16", group: "A", title: "inverted package dates: planned_finish before planned_start is PACKAGE_DATES_INVERTED, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        const p = d.forge_work_packages.find((x) => x.package_ref === "PKG-A");
        p.planned_start = "2026-12-05"; p.planned_finish = "2026-10-05";
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["PACKAGE_DATES_INVERTED"] },
  },
  {
    id: "A17", group: "A", title: "inverted baseline dates: baseline_finish before baseline_start is BASELINE_DATES_INVERTED, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        const b = d.forge_work_package_baselines.find((x) => x.baseline_ref === "BL-A2");
        b.baseline_start = "2026-12-05"; b.baseline_finish = "2026-10-05";
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["BASELINE_DATES_INVERTED"] },
  },
  {
    id: "A18", group: "A", title: "duplicate baseline version (non-current): BASELINE_VERSION_DUPLICATE, current v2 still resolves, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_package_baselines.push(baseline("BL-A1B", "PKG-A", 1, { baseline_start: "2026-10-02", baseline_finish: "2026-11-29" }));
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", current_baseline_version: 2 }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["BASELINE_VERSION_DUPLICATE"] },
  },
  {
    id: "A19", group: "A", title: "duplicate current baseline version: current is AMBIGUOUS, snapshots naming v2 are SNAPSHOT_BASELINE_AMBIGUOUS",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_package_baselines.push(baseline("BL-A2B", "PKG-A", 2, { baseline_start: "2026-10-06", baseline_finish: "2026-12-06" }));
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", current_baseline_version: null }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["BASELINE_VERSION_DUPLICATE", "SNAPSHOT_BASELINE_AMBIGUOUS"] },
  },
  {
    id: "A20", group: "A", title: "unknown package status: a status outside the source vocabulary is UNKNOWN_STATUS, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.find((p) => p.package_ref === "PKG-A").status = "flying";
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["UNKNOWN_STATUS"] },
  },
  {
    id: "A21", group: "A", title: "P677-007 snapshot-only 100%: latest actual 100 with package 55 carries a snapshot completion question, never package status",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").actual_pct = 100;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY", package_percent_complete: 55 }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      questions_include: ["observed physical completion"],
      questions_records_include: [{ dataset: "forge_work_progress_snapshots", record_ref: "S-A2" }],
      checklist_evidence_include: [{ kind: "CONFIRM_COMPLETION_CLAIM", dataset: "forge_work_progress_snapshots", record_ref: "S-A2" }],
      questions_evidence_include: [{ kind: "OPEN_QUESTION", dataset: "forge_work_progress_snapshots", record_ref: "S-A2" }] },
  },
  {
    id: "A22", group: "A", title: "P677-007 package-only 100%: package 100 with snapshots below 100 carries the package completion question only",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.find((p) => p.package_ref === "PKG-A").percent_complete = 100;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY", package_percent_complete: 100 }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      questions_include: ["observed physical completion"],
      questions_records_include: [{ dataset: "forge_work_packages", record_ref: "PKG-A" }] },
  },
  {
    id: "A23", group: "A", title: "P677-007 null actual claim carries no completion question",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").actual_pct = null;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      questions_text_absent: ["observed physical completion"] },
  },
  {
    id: "A24", group: "A", title: "P677-007 zero actual claim carries no completion question",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").actual_pct = 0;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      questions_text_absent: ["observed physical completion"] },
  },
  {
    id: "A25", group: "A", title: "P677-007 future-excluded 100% carries no completion question: only the latest eligible claim counts",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.push({ ...d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2"), snapshot_ref: "S-A3", status_date: "2026-10-27", actual_pct: 100 });
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", latest_snapshot: "S-A2" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["FUTURE_SNAPSHOT"],
      questions_text_absent: ["observed physical completion"] },
  },
  {
    id: "A26", group: "A", title: "P677-007 planned-only 100% carries no completion question: planned semantics stay distinct from physical claims",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").planned_pct = 100;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      questions_text_absent: ["observed physical completion"] },
  },
  {
    id: "A27", group: "A", title: "P677-006 fractional versions 2.5 are invalid: corrupt version never becomes current by matching another corrupt value",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_package_baselines.find((b) => b.baseline_ref === "BL-A2").version_number = 2.5;
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").baseline_version = 2.5;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", named_baseline_version: null, current_baseline_version: 1 }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["BASELINE_VERSION_INVALID", "SNAPSHOT_BASELINE_VERSION_INVALID"] },
  },
  {
    id: "A28", group: "A", title: "P677-006 zero versions are invalid: version 0 names no baseline and never becomes current",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_package_baselines.find((b) => b.baseline_ref === "BL-A2").version_number = 0;
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").baseline_version = 0;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", named_baseline_version: null, current_baseline_version: 1 }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["BASELINE_VERSION_INVALID", "SNAPSHOT_BASELINE_VERSION_INVALID"] },
  },
  {
    id: "A29", group: "A", title: "P677-006 negative versions are invalid: version -1 names no baseline and never becomes current",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_package_baselines.find((b) => b.baseline_ref === "BL-A2").version_number = -1;
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").baseline_version = -1;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", named_baseline_version: null, current_baseline_version: 1 }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["BASELINE_VERSION_INVALID", "SNAPSHOT_BASELINE_VERSION_INVALID"] },
  },
  {
    id: "A30", group: "A", title: "P677-006 string versions are invalid: version '2' is malformed, never authoritative; typed admission nulls the snapshot claim (MISSING) and marks the snapshot PARTIAL, qualifying every package",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_package_baselines.find((b) => b.baseline_ref === "BL-A2").version_number = "2";
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").baseline_version = "2";
      })) }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", named_baseline_version: null, current_baseline_version: 1 }, { id: "PKG-B", conclusion: "QUALIFIED", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["BASELINE_VERSION_INVALID", "SNAPSHOT_BASELINE_MISSING"] },
  },
  {
    id: "A31", group: "A", title: "P677-006 null baseline version is malformed, snapshot naming valid 2 is missing: malformed and missing stay distinct",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_package_baselines.find((b) => b.baseline_ref === "BL-A2").version_number = null;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", named_baseline_version: null, current_baseline_version: 1 }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["BASELINE_VERSION_INVALID", "SNAPSHOT_BASELINE_MISSING"] },
  },
];

export { A };

// --- Group B: coverage / version / calendar / mapping -------------
const B = [
  {
    id: "B01", group: "B", title: "scope baseline pointer is carried, never resolved against scheduling rows: BL-MISSING names no finding, READY",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.find((p) => p.package_ref === "PKG-A").scope_baseline_ref = "BL-MISSING";
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY", scope_baseline_version: null, scope_baseline_resolved: false, scope_baseline_state: "RELATIONSHIP_NOT_MODELED" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds: [] },
  },
  {
    id: "B02", group: "B", title: "scope baseline pointer is carried, never resolved: canonical BL-A2 is NOT_MODELED, still READY",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec() }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY", scope_baseline_version: null, scope_baseline_resolved: false, scope_baseline_state: "RELATIONSHIP_NOT_MODELED" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }] },
  },
  {
    id: "B03", group: "B", title: "scope baseline pointer is carried, never resolved: scope v1 vs current v2 still READY, scope NOT_MODELED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.find((p) => p.package_ref === "PKG-A").scope_baseline_ref = "BL-A1";
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY", scope_baseline_version: null, scope_baseline_resolved: false, scope_baseline_state: "RELATIONSHIP_NOT_MODELED",
        current_baseline_version: 2 }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }] },
  },
  {
    id: "B04", group: "B", title: "invalid snapshot date: 'not-a-date' status_date is FIELD_INVALID, snapshot PARTIAL, no READY package",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").status_date = "not-a-date";
      })) }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL",
      collection_error_codes_include: ["FIELD_INVALID"], no_ready_packages: true },
  },
  {
    id: "B05", group: "B", title: "null named baseline version: a snapshot with no baseline_version is SNAPSHOT_BASELINE_MISSING",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").baseline_version = null;
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", named_baseline_version: null }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["SNAPSHOT_BASELINE_MISSING"] },
  },
  {
    id: "B06", group: "B", title: "pagination is order-invariant: pageSize 1 yields the identical report to unpaged",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(clone(CANONICAL_CONTROLS), { pageSize: 1 }) }),
    expect: { outcome: "COMPLETED", report_equals_case: "A01" },
  },
  {
    id: "B07", group: "B", title: "mixed revisions across pages mark the snapshot PARTIAL with REVISION_UNATTESTED, never a silent coherent snapshot",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(clone(CANONICAL_CONTROLS), { mixedRevisions: true, pageSize: 1 }) }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL",
      coverage_gap_codes_include: ["REVISION_UNATTESTED"], no_ready_packages: true },
  },
  {
    id: "B08", group: "B", title: "unattested expected counts mark the snapshot PARTIAL with COVERAGE_UNATTESTED, never an all-clear",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(clone(CANONICAL_CONTROLS), { hideExpected: true }) }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL",
      coverage_gap_codes_include: ["COVERAGE_UNATTESTED"], no_ready_packages: true },
  },
  {
    id: "B09", group: "B", title: "missing snapshot category (dataset read fails) yields PARTIAL with a coverage gap, never an all-clear",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(clone(CANONICAL_CONTROLS), { failDataset: "forge_work_progress_snapshots" }) }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL",
      integrity_kinds_include: ["NO_SNAPSHOTS"], no_ready_packages: true },
  },
  {
    id: "B10", group: "B", title: "missing package category: baselines/snapshots fail closed as unverifiable, report stays empty and PARTIAL",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(clone(CANONICAL_CONTROLS), { failDataset: "forge_work_packages" }) }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL", packages: [],
      coverage_gap_codes_include: ["BASELINE_PACKAGE_UNVERIFIED"] },
  },
  {
    id: "B11", group: "B", title: "baseline for an unadmitted package under a leaky adapter refuses SCOPE_VIOLATION in the builder's defense-in-depth",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_package_baselines.push(baseline("BL-ZZ", "PKG-ZZ", 1));
      }), { leakyScope: true }) }),
    expect: { outcome: "REFUSED", code: "SCOPE_VIOLATION", published_count: 0 },
  },
  {
    id: "B12", group: "B", title: "cross-owner baseline under a leaky adapter refuses SCOPE_VIOLATION",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_package_baselines.push({ ...baseline("BL-X", "PKG-A", 3), owner_ref: "owner-2" });
      }), { leakyOwners: true }) }),
    expect: { outcome: "REFUSED", code: "SCOPE_VIOLATION", published_count: 0 },
  },
  {
    id: "B13", group: "B", title: "controls job with a scheduling-project scope refuses SCOPE_TYPE_MISMATCH (identity types are distinct)",
    build: () => ({
      host: hostWith({ registered_project_scope: { type: "scheduling-project", id: "WM-1" } }),
      request: requestWith({ project_scope_ref: { type: "scheduling-project", id: "WM-1" } }),
      spec: canonicalControlsSpec(),
    }),
    expect: { outcome: "REFUSED", code: "SCOPE_TYPE_MISMATCH", published_count: 0 },
  },
  {
    id: "B14", group: "B", title: "wrong window for the controls job refuses BAD_REQUEST (window vocabulary is bound to the job)",
    build: () => ({ host: hostWith(), request: requestWith({ window: { name: "planning-lookahead-14-civil-days" } }), spec: canonicalControlsSpec() }),
    expect: { outcome: "REFUSED", code: "BAD_REQUEST", published_count: 0 },
  },
  {
    id: "B15", group: "B", title: "package scope for the controls job refuses SCOPE_UNREGISTERED (the job serves the WM-project population)",
    build: () => ({ host: hostWith(), request: requestWith({ project_scope_ref: { type: "package", id: "WM-1" } }), spec: canonicalControlsSpec() }),
    expect: { outcome: "REFUSED", code: "SCOPE_UNREGISTERED", published_count: 0 },
  },
  {
    id: "B16", group: "B", title: "all nine source status values are known: no UNKNOWN_STATUS across the full vocabulary",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        const statuses = ["draft", "planned", "readiness_review", "ready", "in_progress", "blocked", "complete", "verified_closed", "cancelled"];
        d.forge_work_packages = statuses.map((st, i) => pkg(`PKG-${i}`, { status: st }));
        d.forge_work_package_baselines = statuses.map((st, i) => baseline(`BL-${i}`, `PKG-${i}`, 1));
        d.forge_work_progress_snapshots = statuses.map((st, i) => snap(`S-${i}`, `PKG-${i}`, "2026-10-12", 1, { planned_pct: 10, actual_pct: 10, earned_pct: 10 }));
      })) }),
    expect: { outcome: "COMPLETED",
      package_ids: ["PKG-0", "PKG-1", "PKG-2", "PKG-3", "PKG-4", "PKG-5", "PKG-6", "PKG-7", "PKG-8"],
      integrity_kinds: [] },
  },
  {
    id: "B17", group: "B", title: "leap day status_date resolves: 2028-02-29 snapshot is the latest at a 2028-03-01 review",
    build: () => ({ host: hostWith(), request: requestWith({ as_of: "2028-03-01T12:00:00.000Z" }),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").status_date = "2028-02-29";
      })), clock: { nowIso: () => "2028-03-01T12:00:00.000Z" } }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY", latest_snapshot: "S-A2", latest_status_date: "2028-02-29" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }] },
  },
  {
    id: "B18", group: "B", title: "collection finished after as_of refuses SNAPSHOT_FROM_FUTURE outright",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: canonicalControlsSpec(), clock: { nowIso: () => "2026-10-27T12:00:00.000Z" } }),
    expect: { outcome: "REFUSED", code: "SNAPSHOT_FROM_FUTURE", published_count: 0 },
  },
  {
    id: "B19", group: "B", title: "stale collection (>15 min before as_of) marks the snapshot PARTIAL, never fresh",
    build: () => ({ host: hostWith(), request: requestWith({ as_of: "2026-10-26T12:30:00.000Z" }), spec: canonicalControlsSpec() }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL", no_ready_packages: true },
  },
  {
    id: "B20", group: "B", title: "duplicate identical baseline row is deduped, not a conflict: READY",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_package_baselines.push({ ...d.forge_work_package_baselines.find((b) => b.baseline_ref === "BL-A2") });
      }), { pageSize: 1 }) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY", current_baseline_version: 2 }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }] },
  },
  {
    id: "B21", group: "B", title: "P677-005 scope ref from another namespace (SCOPE-A) is carried, never resolved, never a finding",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.find((p) => p.package_ref === "PKG-A").scope_baseline_ref = "SCOPE-A";
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "READY", scope_baseline_version: null, scope_baseline_resolved: false, scope_baseline_state: "RELATIONSHIP_NOT_MODELED" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds: [] },
  },
  {
    id: "B22", group: "B", title: "P677-004 missing-baseline evidence cites real rows: package row, never an invented baseline row",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_package_baselines = d.forge_work_package_baselines.filter((b) => b.package_ref !== "PKG-A");
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED" }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["BASELINE_MISSING"],
      integrity_evidence_in_spans: true },
  },
  {
    id: "B23", group: "B", title: "P677-004 no-snapshots evidence cites the real package row, never an invented snapshot row",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots = d.forge_work_progress_snapshots.filter((s) => s.package_ref !== "PKG-A");
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", latest_snapshot: null }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["NO_SNAPSHOTS"],
      integrity_evidence_in_spans: true },
  },
  {
    id: "B24", group: "B", title: "P677-004 baseline-changed evidence cites the named and current baseline rows plus the anchoring snapshot",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots = d.forge_work_progress_snapshots.filter((s) => s.snapshot_ref !== "S-A2");
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "QUALIFIED", latest_snapshot: "S-A1", named_baseline_version: 1, current_baseline_version: 2, baseline_changed: true }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["BASELINE_CHANGED"],
      integrity_evidence_in_spans: true },
  },
  {
    id: "B25", group: "B", title: "P677-004 tie-conflict evidence cites every conflicting snapshot, never the package id as a snapshot row",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_progress_snapshots.push({ ...d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2"), snapshot_ref: "TIED", actual_pct: 99 });
      })) }),
    expect: { outcome: "COMPLETED",
      packages: [{ id: "PKG-A", conclusion: "UNVERIFIABLE", latest_snapshot: null }, { id: "PKG-B", conclusion: "READY", latest_snapshot: "S-B1" }],
      integrity_kinds_include: ["SNAPSHOT_TIE_CONFLICT"],
      integrity_evidence_in_spans: true },
  },
];

export { B };

// --- Group C: authority / prohibited data / operation / injection --
const C = [
  {
    id: "C01", group: "C", title: "DISABLED returns before any adapter, credential, store or source access (counters zero)",
    build: () => ({ host: hostWith({ mode: "DISABLED" }), request: requestWith(), spec: canonicalControlsSpec() }),
    expect: { outcome: "DISABLED", counters_zero: true },
  },
  {
    id: "C02", group: "C", title: "live-shaped request (mode live) returns ACTIVATION_REQUIRED, never a read",
    build: () => ({ host: hostWith({ mode: "LIVE" }), request: requestWith(), spec: canonicalControlsSpec() }),
    expect: { outcome: "ACTIVATION_REQUIRED" },
  },
  {
    id: "C03", group: "C", title: "production-shaped request (mode production) returns ACTIVATION_REQUIRED",
    build: () => ({ host: hostWith({ mode: "PRODUCTION" }), request: requestWith(), spec: canonicalControlsSpec() }),
    expect: { outcome: "ACTIVATION_REQUIRED" },
  },
  {
    id: "C04", group: "C", title: "wrong principal refuses PRINCIPAL_MISMATCH before any read",
    build: () => ({ host: hostWith(), request: requestWith({ principal_ref: "principal-impostor" }), spec: canonicalControlsSpec() }),
    expect: { outcome: "REFUSED", code: "PRINCIPAL_MISMATCH" },
  },
  {
    id: "C05", group: "C", title: "wrong owner refuses SCOPE_VIOLATION before any read",
    build: () => ({ host: hostWith(), request: requestWith({ owner_ref: "owner-2" }), spec: canonicalControlsSpec() }),
    expect: { outcome: "REFUSED", code: "SCOPE_VIOLATION" },
  },
  {
    id: "C06", group: "C", title: "wrong scope TYPE with a coincidentally equal id refuses: a package id is not a WM-project id",
    build: () => ({ host: hostWith(), request: requestWith({ project_scope_ref: { type: "package", id: "WM-1" } }), spec: canonicalControlsSpec() }),
    expect: { outcome: "REFUSED", code: "SCOPE_UNREGISTERED" },
  },
  {
    id: "C07", group: "C", title: "unregistered project id refuses SCOPE_UNREGISTERED, never an empty population",
    build: () => ({ host: hostWith(), request: requestWith({ project_scope_ref: { type: "work-management-project", id: "WM-2" } }), spec: canonicalControlsSpec() }),
    expect: { outcome: "REFUSED", code: "SCOPE_UNREGISTERED" },
  },
  {
    id: "C08", group: "C", title: "caller-supplied adapter refuses CALLER_ADAPTER_REFUSED (no URL/path/query from callers)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec(), callerAdapter: { kind: "synthetic" } }),
    expect: { outcome: "REFUSED", code: "CALLER_ADAPTER_REFUSED" },
  },
  {
    id: "C09", group: "C", title: "mode smuggled inside the request refuses BAD_REQUEST (mode is host-owned only)",
    build: () => ({ host: hostWith(), request: requestWith({ mode: "live" }), spec: canonicalControlsSpec() }),
    expect: { outcome: "REFUSED", code: "BAD_REQUEST" },
  },
  {
    id: "C10", group: "C", title: "unknown job kind refuses UNKNOWN_AGENT",
    build: () => ({ host: hostWith(), request: requestWith({ job_kind: "tax-planning-review" }), spec: canonicalControlsSpec() }),
    expect: { outcome: "REFUSED", code: "UNKNOWN_AGENT" },
  },
  {
    id: "C11", group: "C", title: "Project Manager kind still refuses JOB_NOT_BUILT_IN_SLICE (its slice has not landed)",
    build: () => ({ host: hostWith(), request: requestWith({ job_kind: "project-manager-plan-health-review", window: { name: "planning-review-snapshot" } }), spec: canonicalControlsSpec() }),
    expect: { outcome: "REFUSED", code: "JOB_NOT_BUILT_IN_SLICE" },
  },
  {
    id: "C12", group: "C", title: "scheduler job with a WM-project scope refuses SCOPE_TYPE_MISMATCH (the scheduler serves scheduling projects only)",
    build: () => ({ host: hostWith(), request: requestWith({ job_kind: "scheduler-planning-review", window: { name: "planning-lookahead-14-civil-days" } }), spec: canonicalControlsSpec() }),
    expect: { outcome: "REFUSED", code: "SCOPE_TYPE_MISMATCH" },
  },
  {
    id: "C13", group: "C", title: "cross-owner rows (leaky adapter) refuse SCOPE_VIOLATION in the builder's defense-in-depth",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.push(pkg("PKG-X", { owner_ref: "owner-2" }));
      }), { leakyOwners: true }) }),
    expect: { outcome: "REFUSED", code: "SCOPE_VIOLATION" },
  },
  {
    id: "C14", group: "C", title: "cross-scope rows (leaky adapter) refuse SCOPE_VIOLATION in the builder's defense-in-depth",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.push(pkg("PKG-X", { project_ref: "WM-9" }));
      }), { leakyScope: true }) }),
    expect: { outcome: "REFUSED", code: "SCOPE_VIOLATION" },
  },
  {
    id: "C15", group: "C", title: "financial canary: cost/hour values on rows are dropped by the projection — canary VALUES never reach the item",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.find((p) => p.package_ref === "PKG-A").planned_cost = 99991;
        d.forge_work_package_baselines.find((b) => b.baseline_ref === "BL-A2").baseline_cost = 99992;
        d.forge_work_package_baselines.find((b) => b.baseline_ref === "BL-A2").baseline_hours = 99993;
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").earned_cost = 99994;
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").actual_cost = 99995;
        d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").eac_cost = 99996;
      })) }),
    expect: { outcome: "COMPLETED",
      forbidden_strings_absent: ["99991", "99992", "99993", "99994", "99995", "99996"],
      financial_all_not_modeled: true },
  },
  {
    id: "C16", group: "C", title: "tenant/enrollment/contact canary: non-controls fields are dropped by the projection",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        const p = d.forge_work_packages.find((x) => x.package_ref === "PKG-A");
        p.title = "CANARY-TITLE"; p.description = "CANARY-DESC"; p.responsible_party = "canary@example.invalid"; p.phone = "555-0100";
      })) }),
    expect: { outcome: "COMPLETED", forbidden_strings_absent: ["CANARY-TITLE", "CANARY-DESC", "canary@example.invalid", "555-0100"] },
  },
  {
    id: "C17", group: "C", title: "XSS string in source data is carried as inert data: row ids are digests, the item carries no markup",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.find((p) => p.package_ref === "PKG-A").status = "<script>alert(1)</script>";
      })) }),
    expect: { outcome: "COMPLETED", row_ids_digest_format: true, integrity_kinds_include: ["UNKNOWN_STATUS"] },
  },
  {
    id: "C18", group: "C", title: "P670-005A counterexample: refs a:b, c, a, b:c collide under colon-join but get distinct digest row ids",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages = ["a:b", "c", "a", "b:c"].map((id) => pkg(id));
        d.forge_work_package_baselines = ["a:b", "c", "a", "b:c"].map((id, i) => baseline(`BL-${i}`, id, 1));
        d.forge_work_progress_snapshots = ["a:b", "c", "a", "b:c"].map((id, i) => snap(`S-${i}`, id, "2026-10-12", 1, { planned_pct: 10, actual_pct: 10, earned_pct: 10 }));
      })) }),
    expect: { outcome: "COMPLETED", distinct_row_ids: true },
  },
  {
    id: "C19", group: "C", title: "no side-effecting GET: adapter calls name only the 3 admitted controls datasets, never a project GET or mutation",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec() }),
    expect: { outcome: "COMPLETED", adapter_datasets_only: true },
  },
  {
    id: "C20", group: "C", title: "permission revoked mid-read refuses PERMISSION_REVOKED and publishes nothing",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { revoked: true }) }),
    expect: { outcome: "REFUSED", code: "PERMISSION_REVOKED", published_count: 0 },
  },
  {
    id: "C21", group: "C", title: "P676-003 analog: a package row with a missing/null project_ref under a leaky adapter refuses SCOPE_VIOLATION, never acquires scope by omission",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.push(pkg("PKG-X", { project_ref: null }));
      }), { leakyScope: true }) }),
    expect: { outcome: "REFUSED", code: "SCOPE_VIOLATION", published_count: 0 },
  },
];

export { C };

// --- Group D: budget / durability / replay / timeout ----------------
const D = [
  {
    id: "D01", group: "D", title: "candidate 65 refuses BUDGET_EXCEEDED with no domain totals",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages = Array.from({ length: 62 }, (_, i) => pkg(`PKG-${i}`));
        d.forge_work_package_baselines = [];
        d.forge_work_progress_snapshots = [];
      })) }),
    expect: { outcome: "BUDGET_EXCEEDED", kind: "candidates", limit: 64, domain_totals_null: true },
  },
  {
    id: "D02", group: "D", title: "evidence-span cap 512 is enforced at unit level (unreachable in a full run: the 64-candidate cap fires first)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec() }),
    post: "span-cap-unit",
    expect: { outcome: "COMPLETED", post: { kind: "evidenceSpans", limit: 512 } },
  },
  {
    id: "D03", group: "D", title: "output-record cap 256 is enforced at unit level (unreachable in a full run: the 64-candidate cap fires first)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec() }),
    post: "output-cap-unit",
    expect: { outcome: "COMPLETED", post: { kind: "outputRecords", limit: 256 } },
  },
  {
    id: "D04", group: "D", title: "input bytes over 256 KiB refuse BUDGET_EXCEEDED during control admission",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.find((p) => p.package_ref === "PKG-A").status = "X".repeat(300 * 1024);
      })) }),
    expect: { outcome: "BUDGET_EXCEEDED", kind: "inputBytes", limit: 262144 },
  },
  {
    id: "D05", group: "D", title: "control depth 33 refuses BUDGET_EXCEEDED (depth cap is 32)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: (() => {
        const deep = {}; let cur = deep;
        for (let i = 0; i < 33; i++) { cur.next = {}; cur = cur.next; }
        const s = canonicalControlsSpec(); s.deep = deep;
        return s;
      })() }),
    expect: { outcome: "BUDGET_EXCEEDED", kind: "depth", limit: 32 },
  },
  {
    id: "D06", group: "D", title: "control depth exactly 32 is admitted: the run completes, proving the cap is 32 not lower",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: (() => {
        const deep = {}; let cur = deep;
        for (let i = 0; i < 30; i++) { cur.next = {}; cur = cur.next; }
        const s = canonicalControlsSpec(); s.deep = deep;
        return s;
      })() }),
    expect: { outcome: "COMPLETED" },
  },
  {
    id: "D07", group: "D", title: "hung collection refuses EXECUTION_TIMEOUT preemptively (promise-only timeouts do not count)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { hangCollect: true }) }),
    expect: { outcome: "REFUSED", code: "EXECUTION_TIMEOUT" },
  },
  {
    id: "D08", group: "D", title: "synchronous runaway in the adapter refuses EXECUTION_TIMEOUT via worker termination",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { syncSpinMs: 30000 }) }),
    expect: { outcome: "REFUSED", code: "EXECUTION_TIMEOUT" },
  },
  {
    id: "D09", group: "D", title: "slow-but-bounded reads complete: the deadline is 5 s, not zero",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { slowReadMs: 100 }) }),
    expect: { outcome: "COMPLETED" },
  },
  {
    id: "D10", group: "D", title: "replay of identical content is idempotent: first run writes, second and third write nothing",
    build: () => {
      const datasets = clone(CANONICAL_CONTROLS);
      for (const p of datasets.forge_work_packages) p.project_ref = "WM-10";
      return {
        host: hostWith({ registered_project_scope: { type: "work-management-project", id: "WM-10" } }),
        request: requestWith({ project_scope_ref: { type: "work-management-project", id: "WM-10" }, snapshot_request_id: "snap-controls-d10-1" }),
        spec: specWith(datasets),
      };
    },
    expect: { outcome: "COMPLETED", replay_idempotent: true },
  },
  {
    id: "D11", group: "D", title: "replay with changed content under the same identity refuses REPUBLISH_CONFLICT (changed content gets its own version)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec() }),
    post: "republish-conflict",
    expect: { outcome: "COMPLETED", post: { code: "REPUBLISH_CONFLICT" } },
  },
  {
    id: "D12", group: "D", title: "hanging publisher refuses PUBLICATION_TIMEOUT; the report was computed but not durably published",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec(), hangingPublisher: true }),
    expect: { outcome: "REFUSED", code: "PUBLICATION_TIMEOUT" },
  },
  {
    id: "D13", group: "D", title: "looping cursor refuses cleanly: CURSOR_FAULT marks the dataset partial, no infinite loop",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { cursorLoopDataset: "forge_work_packages" }) }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL", collection_error_codes_include: ["CURSOR_FAULT"] },
  },
  {
    id: "D14", group: "D", title: "stale decision digest refuses STALE_DIGEST: a refreshed report never inherits an old decision",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec() }),
    post: "decide-stale",
    expect: { outcome: "COMPLETED", post: { code: "STALE_DIGEST" } },
  },
  {
    id: "D15", group: "D", title: "decision on an unknown row refuses UNKNOWN_ROW",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec() }),
    post: "decide-unknown-row",
    expect: { outcome: "COMPLETED", post: { code: "UNKNOWN_ROW" } },
  },
  {
    id: "D16", group: "D", title: "decision outside the closed enum refuses BAD_DECISION (no Approve/Apply/Execute/Send/Auto-fix/Activate)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec() }),
    post: "decide-bad-enum",
    expect: { outcome: "COMPLETED", post: { code: "BAD_DECISION" } },
  },
  {
    id: "D17", group: "D", title: "trust root mismatch refuses before any candidate byte runs",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec() }),
    post: "trust-wrong-root",
    expect: { outcome: "COMPLETED", post: { refused: true } },
  },
  {
    id: "D18", group: "D", title: "unlisted entry refuses (exit 3): a test file on disk but absent from the manifest never runs",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec() }),
    post: "trust-unlisted-entry",
    expect: { outcome: "COMPLETED", post: { exit: 3 } },
  },
  {
    id: "D19", group: "D", title: "deadline already spent refuses EXECUTION_TIMEOUT before the worker spawns",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalControlsSpec() }),
    post: "deadline-spent",
    expect: { outcome: "COMPLETED", post: { code: "EXECUTION_TIMEOUT" } },
  },
  {
    id: "D20", group: "D", title: "duplicate conflicting rows mark the snapshot PARTIAL with DUPLICATE_CONFLICT, never an all-clear",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_package_baselines = [
          baseline("BL-A2", "PKG-A", 2),
          baseline("BL-A2", "PKG-A", 2, { baseline_finish: "2026-12-06" }),
        ];
      }), { pageSize: 1 }) }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL", conflicts_include: ["DUPLICATE_CONFLICT"] },
  },
];

export { D };

export const CASES = [...A, ...B, ...C, ...D];
