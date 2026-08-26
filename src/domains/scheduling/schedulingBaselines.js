// Pure, framework-agnostic baseline capture and schedule-variance computation for the relational
// scheduling schema (supabase/migrations/20260828000000_add_schedule_baselines_and_progress_tracking.sql).
// Not wired into any route or UI yet -- this module designs the algorithm; every judgment call is
// explained inline rather than silently decided. Same conventions as schedulingCpmEngine.js: pure,
// no I/O, no mutation, Object.freeze everywhere.

import { daysBetweenISO } from "./schedulingRelationalMapping";

// blocks are runCpmEngine's OUTPUT rows (post-CPM, so early_start/early_finish/duration_days/
// percent_complete/task_code are all present). baseline_start/finish snapshot early_start/
// early_finish -- the CPM-computed dates -- not any raw constraint start_date, since that's what
// "the schedule says right now" means.
export function captureBaseline({ project, blocks = [], name, ownerId, baselineId, createdAt }) {
  const baseline = Object.freeze({
    owner_id: ownerId,
    id: baselineId,
    schedule_project_id: project.id,
    name,
    created_at: createdAt,
  });

  const baselineBlocks = blocks.map((block) => Object.freeze({
    owner_id: ownerId,
    id: `${baselineId}_${block.task_code}`,
    baseline_id: baselineId,
    block_task_code: block.task_code,
    label: block.label,
    block_type: block.block_type,
    baseline_start: block.early_start ?? null,
    baseline_finish: block.early_finish ?? null,
    baseline_duration_days: block.duration_days ?? 0,
    percent_complete: block.percent_complete ?? 0,
    total_float_days: block.total_float_days ?? null,
    is_critical: block.is_critical ?? false,
    created_at: createdAt,
  }));

  return Object.freeze({ baseline, baselineBlocks: Object.freeze(baselineBlocks) });
}

// currentBlock is a live/current schedule_blocks row (post-CPM, so it also has actual_start/
// actual_finish). The two sides are independent, not all-or-nothing: a block with actual_start set
// but not actual_finish still uses early_finish for the finish side (the honest "still projected to
// finish on X" case). Positive variance = later than baseline = slip.
export function computeBlockVariance(baselineBlock, currentBlock) {
  const effectiveCurrentStart = currentBlock.actual_start ?? currentBlock.early_start ?? null;
  const effectiveCurrentFinish = currentBlock.actual_finish ?? currentBlock.early_finish ?? null;

  const startVarianceDays = (baselineBlock.baseline_start != null && effectiveCurrentStart != null)
    ? daysBetweenISO(baselineBlock.baseline_start, effectiveCurrentStart)
    : null;
  const finishVarianceDays = (baselineBlock.baseline_finish != null && effectiveCurrentFinish != null)
    ? daysBetweenISO(baselineBlock.baseline_finish, effectiveCurrentFinish)
    : null;

  const baselineSpanDays = (baselineBlock.baseline_start != null && baselineBlock.baseline_finish != null)
    ? daysBetweenISO(baselineBlock.baseline_start, baselineBlock.baseline_finish)
    : null;
  const currentSpanDays = (effectiveCurrentStart != null && effectiveCurrentFinish != null)
    ? daysBetweenISO(effectiveCurrentStart, effectiveCurrentFinish)
    : null;
  const durationVarianceDays = (baselineSpanDays != null && currentSpanDays != null)
    ? currentSpanDays - baselineSpanDays
    : null;

  return Object.freeze({
    taskCode: baselineBlock.block_task_code,
    startVarianceDays,
    finishVarianceDays,
    durationVarianceDays,
    usedActualStart: currentBlock.actual_start != null,
    usedActualFinish: currentBlock.actual_finish != null,
  });
}

// Joins by task_code (block_task_code <-> task_code) -- the only durable identifier available,
// since schedule_baseline_blocks has no FK/id to join on. Three separate result arrays because
// removed/added entries structurally can't carry a variance result (nothing to diff against).
export function computeScheduleVariance({ baselineBlocks = [], currentBlocks = [] }) {
  const baselineByTaskCode = new Map(baselineBlocks.map((block) => [block.block_task_code, block]));
  const currentByTaskCode = new Map(currentBlocks.map((block) => [block.task_code, block]));
  const allTaskCodes = new Set([...baselineByTaskCode.keys(), ...currentByTaskCode.keys()]);

  const compared = [];
  const removedSinceBaseline = [];
  const addedSinceBaseline = [];

  for (const taskCode of allTaskCodes) {
    const baselineBlock = baselineByTaskCode.get(taskCode);
    const currentBlock = currentByTaskCode.get(taskCode);
    if (baselineBlock && currentBlock) {
      compared.push(computeBlockVariance(baselineBlock, currentBlock));
    } else if (baselineBlock) {
      removedSinceBaseline.push(Object.freeze({ taskCode, label: baselineBlock.label }));
    } else {
      addedSinceBaseline.push(Object.freeze({ taskCode, label: currentBlock.label }));
    }
  }

  return Object.freeze({
    compared: Object.freeze(compared),
    removedSinceBaseline: Object.freeze(removedSinceBaseline),
    addedSinceBaseline: Object.freeze(addedSinceBaseline),
  });
}

// baselineProjectFinish = max(baseline_finish) across ALL baseline blocks, not leaves-only --
// schedule_baseline_blocks doesn't snapshot dependencies, so "which blocks had no successors" is
// structurally unknowable from the baseline alone. In the normal non-negative-lag case this is
// numerically identical to leaves-only (a non-leaf's early_finish is dominated by a successor's);
// it can diverge under negative lag (lead time) -- an accepted, named limitation.
// currentProjectFinish deliberately includes added-since-baseline blocks: scope growth pushing the
// finish date later is real, reportable variance; excluding them would understate it.
export function rollupProjectVariance({ baselineBlocks = [], currentBlocks = [] }) {
  const baselineFinishes = baselineBlocks.map((block) => block.baseline_finish).filter((date) => date != null);
  const currentFinishes = currentBlocks.map((block) => block.actual_finish ?? block.early_finish).filter((date) => date != null);

  const baselineProjectFinish = baselineFinishes.length > 0 ? baselineFinishes.reduce((max, date) => (date > max ? date : max)) : null;
  const currentProjectFinish = currentFinishes.length > 0 ? currentFinishes.reduce((max, date) => (date > max ? date : max)) : null;

  const projectFinishVarianceDays = (baselineProjectFinish != null && currentProjectFinish != null)
    ? daysBetweenISO(baselineProjectFinish, currentProjectFinish)
    : null;

  return Object.freeze({ baselineProjectFinish, currentProjectFinish, projectFinishVarianceDays });
}
