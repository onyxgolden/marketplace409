// Deterministic, read-only baseline drift detection for the scheduling Brain.
//
// This is slice 2 of the scheduling Brain: where slice 1's "Ask the Schedule"
// answers ad-hoc questions (including a baseline-variance question), this module
// produces a standing drift report -- every activity whose current dates moved
// beyond a configurable threshold since the latest baseline, with severity bands
// and direction. No LLM, no writes, no auto-rebaseline, no notifications.
//
// Same conventions as the rest of src/domains/scheduling: pure, no I/O, no
// mutation, Object.freeze everywhere. Date math reuses daysBetweenISO and the
// Chicago-date helper from slice 1 (chicagoTodayISO), never UTC date math.
//
// Sign convention (shared with schedulingBaselines.computeBlockVariance):
// positive variance = later than baseline = slip.

import { daysBetweenISO } from "./schedulingRelationalMapping";
import { chicagoTodayISO } from "./schedulingAskSchedule";

// Default flag threshold: |variance| > 2 days. Severity is derived from the
// threshold so it scales when callers configure one: minor when the largest
// absolute variance is within (threshold, 2 * threshold], major above that.
// With the default, minor = 3-4 days, major = 5+ days.
export const DEFAULT_DRIFT_THRESHOLD_DAYS = 2;

function formatVarianceDays(days) {
  if (days == null) return "n/a";
  if (days === 0) return "on schedule";
  return `${days > 0 ? "+" : ""}${days}d`;
}

function isUsableDate(value) {
  return value != null && String(value).trim() !== "" && String(value).trim() !== "0";
}

function effectiveStart(block) {
  // Same "independent sides" convention as computeBlockVariance: a block with
  // actual_start set but no actual_finish still reports its projected finish.
  return isUsableDate(block.actual_start) ? block.actual_start
    : isUsableDate(block.early_start) ? block.early_start : null;
}

function effectiveFinish(block) {
  return isUsableDate(block.actual_finish) ? block.actual_finish
    : isUsableDate(block.early_finish) ? block.early_finish : null;
}

// detectBaselineDrift(currentSchedule, baseline, options)
//
// currentSchedule: { blocks: [...] } -- runCpmEngine output rows (task_code,
//   label, block_type, early_start/early_finish, actual_start/actual_finish,
//   percent_complete).
// baseline: null | { name, baselineBlocks: [...] } -- schedule_baseline_blocks
//   rows (block_task_code, label, block_type, baseline_start, baseline_finish).
//   A null baseline yields a well-formed empty report (hasBaseline: false);
//   callers surface the "capture a baseline first" message.
// options: { thresholdDays = 2, todayISO } -- todayISO is injectable for tests
//   and defaults to the Chicago-date helper (never UTC `new Date()` math).
//
// Exclusions (never drifted):
//   - completed activities/milestones (percent_complete >= 100): done is done,
//     never late -- the slice-1 late_milestones convention.
//   - no usable baseline dates: a missing baseline row, or both baseline_start
//     and baseline_finish empty, means "no baseline", NOT zero drift. A block
//     with baseline dates but no current dates is likewise uncomparable.
export function detectBaselineDrift(currentSchedule, baseline, options = {}) {
  const thresholdDays = options.thresholdDays ?? DEFAULT_DRIFT_THRESHOLD_DAYS;
  const asOf = options.todayISO ?? chicagoTodayISO();
  const currentBlocks = currentSchedule?.blocks ?? [];

  const emptySummary = (overrides = {}) => Object.freeze({
    driftedCount: 0, minorCount: 0, majorCount: 0,
    earlyCount: 0, lateCount: 0, mixedCount: 0,
    comparedCount: 0, completedExcludedCount: 0, noBaselineCount: 0,
    addedSinceBaselineCount: 0, removedSinceBaselineCount: 0,
    projectFinishVarianceDays: null,
    ...overrides,
  });

  if (!baseline) {
    return Object.freeze({
      hasBaseline: false,
      baselineName: null,
      asOf,
      thresholdDays,
      drifted: Object.freeze([]),
      summary: emptySummary(),
    });
  }

  const baselineByTaskCode = new Map(
    (baseline.baselineBlocks ?? []).map((block) => [block.block_task_code, block]),
  );
  const currentTaskCodes = new Set(currentBlocks.map((block) => block.task_code));

  let completedExcludedCount = 0;
  let noBaselineCount = 0;
  let comparedCount = 0;
  const drifted = [];

  for (const block of currentBlocks) {
    if ((block.percent_complete ?? 0) >= 100) {
      completedExcludedCount += 1;
      continue;
    }
    const baselineBlock = baselineByTaskCode.get(block.task_code);
    const baselineStart = baselineBlock && isUsableDate(baselineBlock.baseline_start)
      ? baselineBlock.baseline_start : null;
    const baselineFinish = baselineBlock && isUsableDate(baselineBlock.baseline_finish)
      ? baselineBlock.baseline_finish : null;
    if (baselineStart == null && baselineFinish == null) {
      noBaselineCount += 1;
      continue;
    }
    const currentStart = effectiveStart(block);
    const currentFinish = effectiveFinish(block);
    const startVarianceDays = (baselineStart != null && currentStart != null)
      ? daysBetweenISO(baselineStart, currentStart) : null;
    const finishVarianceDays = (baselineFinish != null && currentFinish != null)
      ? daysBetweenISO(baselineFinish, currentFinish) : null;
    if (startVarianceDays == null && finishVarianceDays == null) {
      noBaselineCount += 1;
      continue;
    }
    comparedCount += 1;

    const variances = [startVarianceDays, finishVarianceDays].filter((days) => days != null);
    const significant = variances.filter((days) => Math.abs(days) > thresholdDays);
    if (significant.length === 0) continue;

    const maxVarianceDays = Math.max(...variances.map((days) => Math.abs(days)));
    const severity = maxVarianceDays > thresholdDays * 2 ? "major" : "minor";
    const direction = significant.every((days) => days > 0) ? "late"
      : significant.every((days) => days < 0) ? "early" : "mixed";

    drifted.push(Object.freeze({
      taskCode: block.task_code,
      label: block.label ?? "",
      blockType: block.block_type ?? "task",
      baselineStart,
      baselineFinish,
      currentStart,
      currentFinish,
      startVarianceDays,
      finishVarianceDays,
      maxVarianceDays,
      direction,
      severity,
      detail: `Start ${formatVarianceDays(startVarianceDays)} · Finish ${formatVarianceDays(finishVarianceDays)}`,
    }));
  }

  // Scope-change context: task codes present on only one side. Kept as counts --
  // the itemized added/removed lists already live in slice 1's baseline_variance
  // answer; this report is about drift, not scope.
  let addedSinceBaselineCount = 0;
  for (const taskCode of currentTaskCodes) {
    if (!baselineByTaskCode.has(taskCode)) addedSinceBaselineCount += 1;
  }
  let removedSinceBaselineCount = 0;
  for (const taskCode of baselineByTaskCode.keys()) {
    if (!currentTaskCodes.has(taskCode)) removedSinceBaselineCount += 1;
  }

  const baselineFinishes = (baseline.baselineBlocks ?? [])
    .map((block) => block.baseline_finish).filter(isUsableDate);
  const currentFinishes = currentBlocks
    .map((block) => effectiveFinish(block)).filter(isUsableDate);
  const baselineProjectFinish = baselineFinishes.length > 0
    ? baselineFinishes.reduce((max, date) => (date > max ? date : max)) : null;
  const currentProjectFinish = currentFinishes.length > 0
    ? currentFinishes.reduce((max, date) => (date > max ? date : max)) : null;
  const projectFinishVarianceDays = (baselineProjectFinish != null && currentProjectFinish != null)
    ? daysBetweenISO(baselineProjectFinish, currentProjectFinish) : null;

  // Major first, then largest slip, then task code -- the worst drift reads first.
  drifted.sort((a, b) =>
    (b.severity === "major" ? 1 : 0) - (a.severity === "major" ? 1 : 0)
    || b.maxVarianceDays - a.maxVarianceDays
    || String(a.taskCode).localeCompare(String(b.taskCode)),
  );

  return Object.freeze({
    hasBaseline: true,
    baselineName: baseline.name ?? null,
    asOf,
    thresholdDays,
    drifted: Object.freeze(drifted),
    summary: emptySummary({
      driftedCount: drifted.length,
      minorCount: drifted.filter((item) => item.severity === "minor").length,
      majorCount: drifted.filter((item) => item.severity === "major").length,
      earlyCount: drifted.filter((item) => item.direction === "early").length,
      lateCount: drifted.filter((item) => item.direction === "late").length,
      mixedCount: drifted.filter((item) => item.direction === "mixed").length,
      comparedCount,
      completedExcludedCount,
      noBaselineCount,
      addedSinceBaselineCount,
      removedSinceBaselineCount,
      projectFinishVarianceDays,
    }),
  });
}
