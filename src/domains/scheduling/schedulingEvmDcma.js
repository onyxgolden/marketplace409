// Pure, framework-agnostic EVM (Earned Value Management) and DCMA 14-point schedule health checks
// for the relational scheduling schema. Fourth and final capability area of the P6-parity build-out
// (CPM engine: Phase 0/SCHED-01/SCHED-03; baselines+progress: SCHED-02/SCHED-04; resources+costs:
// SCHED-05/SCHED-06; this slice: EVM+DCMA). No new schema -- every input already exists on
// schedule_blocks/schedule_baseline_blocks/schedule_dependencies/schedule_resource_assignments.
// Not wired into any route or UI yet -- that's SCHED-08, same two-slice pattern as every prior area.
// Same conventions as schedulingBaselines.js/schedulingResources.js: pure, no I/O, no mutation,
// Object.freeze everywhere, calendar-day arithmetic via daysBetweenISO/addDaysISO (not working-day
// calendar walking -- see below for why).

import { daysBetweenISO } from "./schedulingRelationalMapping";
import { runCpmEngine } from "./schedulingCpmEngine";

// DCMA's own published thresholds (14-Point Schedule Assessment, DI-MGMT-81861). Not user-editable
// in v1 -- see the SCHED-07 scoping note; a future slice could expose these as project settings.
export const DCMA_THRESHOLDS = Object.freeze({
  highFloatDays: 44, highDurationDays: 44,
  maxMissingLogicPercent: 5, maxLagPercent: 5, minFsPercent: 90, maxHardConstraintPercent: 5, maxHighFloatPercent: 5, maxHighDurationPercent: 5,
});

// ---------------------------------------------------------------------------------------------
// EVM
// ---------------------------------------------------------------------------------------------

// blockInputs: [{ taskCode, budgetedCost, actualCost, percentComplete, baselineStart, baselineFinish }].
// budgetedCost/actualCost come from schedulingResources.js's rollupProjectCost.byBlock (joined by
// task_code); percentComplete/baselineStart/baselineFinish come from the current block and its
// matching schedule_baseline_blocks row respectively (a block absent from the chosen baseline --
// added since baseline -- contributes 0 planned value, matching schedulingBaselines.js's own
// "added since baseline" handling: it's real current scope, but there was no plan for it yet).
//
// PV time-phases each block's budgeted cost evenly across CALENDAR days from baselineStart to
// baselineFinish (inclusive) -- not working days. schedule_baseline_blocks stores no calendar_id
// (it's a frozen snapshot, see the SCHED-02 migration), and schedulingBaselines.js already
// established calendar-day-only arithmetic as this baseline-data module family's convention; using
// the CURRENT schedule's calendar to time-phase a PAST baseline's dates would be mixing snapshots.
// Flagged simplification, not a silent gap.
export function computeEvm({ asOfDate, blockInputs = [] }) {
  let bac = 0, ev = 0, ac = 0, pv = 0;
  for (const block of blockInputs) {
    const budgetedCost = block.budgetedCost ?? 0;
    bac += budgetedCost;
    ac += block.actualCost ?? 0;
    ev += budgetedCost * ((block.percentComplete ?? 0) / 100);
    pv += budgetedCost * plannedFraction(block.baselineStart, block.baselineFinish, asOfDate);
  }

  const cv = ev - ac;
  const sv = ev - pv;
  const cpi = ac > 0 ? ev / ac : null;
  const spi = pv > 0 ? ev / pv : null;
  // Three EAC methods, reported side by side (matching how a P6/DCMA-style report presents them,
  // not picking one as "the" answer): "atypical" assumes remaining work returns to the planned
  // rate; "typical" assumes current cost performance (CPI) continues; "cpiSpi" additionally weights
  // by schedule performance, the most conservative of the three when a project is both over cost
  // and behind schedule.
  const eacAtypical = ac + (bac - ev);
  const eacTypical = cpi != null && cpi > 0 ? bac / cpi : null;
  const eacCpiSpi = cpi != null && cpi > 0 && spi != null && spi > 0 ? ac + (bac - ev) / (cpi * spi) : null;

  return Object.freeze({
    asOfDate, bac, pv, ev, ac, cv, sv, cpi, spi,
    eac: Object.freeze({ atypical: eacAtypical, typical: eacTypical, cpiSpi: eacCpiSpi }),
    etc: eacTypical != null ? eacTypical - ac : null,
    vac: eacTypical != null ? bac - eacTypical : null,
  });
}

// +1 on both numerator and denominator: a zero-duration span (baselineStart === baselineFinish, a
// milestone) would otherwise divide by zero. With +1, a milestone is 0% planned until asOfDate
// reaches its date, then 100% -- exactly right for a single-day event, and the +1 cancels out for
// any multi-day span's fraction shape (still linear from 0 to 1 across the span).
function plannedFraction(baselineStart, baselineFinish, asOfDate) {
  if (baselineStart == null || baselineFinish == null) return 0;
  if (asOfDate < baselineStart) return 0;
  if (asOfDate >= baselineFinish) return 1;
  const spanDays = daysBetweenISO(baselineStart, baselineFinish) + 1;
  const elapsedDays = daysBetweenISO(baselineStart, asOfDate) + 1;
  return elapsedDays / spanDays;
}

// ---------------------------------------------------------------------------------------------
// DCMA 14-point assessment (points 1-11, 13, 14 -- point 12, the Critical Path Test, is
// runCriticalPathTest below since it needs a full CPM re-run, unlike everything else here).
// ---------------------------------------------------------------------------------------------

// Point 1 -- Logic: % of non-milestone activities missing a predecessor or a successor. Milestones
// are excluded from both sides -- a project's start/finish milestones legitimately have no
// predecessor/successor respectively, and this schema has no separate "is the project start/finish
// milestone" flag to single those two out more precisely.
export function dcmaLogicDensity(blocks, dependencies) {
  const nonMilestones = blocks.filter((block) => block.block_type !== "milestone" && block.block_type !== "hammock");
  const hasPredecessor = new Set(dependencies.map((dependency) => dependency.successor_id));
  const hasSuccessor = new Set(dependencies.map((dependency) => dependency.predecessor_id));
  const missingPredecessor = nonMilestones.filter((block) => !hasPredecessor.has(block.id)).length;
  const missingSuccessor = nonMilestones.filter((block) => !hasSuccessor.has(block.id)).length;
  const denominator = nonMilestones.length * 2;
  const percentMissing = denominator > 0 ? ((missingPredecessor + missingSuccessor) / denominator) * 100 : 0;
  return Object.freeze({ missingPredecessor, missingSuccessor, totalActivities: nonMilestones.length, percentMissing, pass: percentMissing <= DCMA_THRESHOLDS.maxMissingLogicPercent });
}

// Points 2/3 -- Leads (negative lag) and Lags (positive lag). DCMA treats any lead as a violation
// (0% allowed -- a lead means a successor can start before its predecessor finishes, which the
// standard considers bad practice regardless of how small); lags get the usual 5% threshold.
export function dcmaLeadsAndLags(dependencies) {
  const total = dependencies.length;
  const leads = dependencies.filter((dependency) => dependency.lag_days < 0).length;
  const lags = dependencies.filter((dependency) => dependency.lag_days > 0).length;
  const lagPercent = total > 0 ? (lags / total) * 100 : 0;
  return Object.freeze({
    total, leads, lags, lagPercent,
    leadsPass: leads === 0,
    lagsPass: lagPercent <= DCMA_THRESHOLDS.maxLagPercent,
  });
}

// Point 4 -- Relationship types: DCMA wants >=90% Finish-to-Start.
export function dcmaRelationshipTypes(dependencies) {
  const total = dependencies.length;
  const fsCount = dependencies.filter((dependency) => dependency.relationship_type === "FS").length;
  const fsPercent = total > 0 ? (fsCount / total) * 100 : 100;
  return Object.freeze({ total, fsCount, fsPercent, pass: fsPercent >= DCMA_THRESHOLDS.minFsPercent });
}

// Point 5 -- Hard constraints (must_start_on/must_finish_on), as a % of non-milestone activities.
export function dcmaHardConstraints(blocks) {
  const nonMilestones = blocks.filter((block) => block.block_type !== "milestone" && block.block_type !== "hammock");
  const hardCount = nonMilestones.filter((block) => block.constraint_type === "must_start_on" || block.constraint_type === "must_finish_on").length;
  const percent = nonMilestones.length > 0 ? (hardCount / nonMilestones.length) * 100 : 0;
  return Object.freeze({ hardCount, totalActivities: nonMilestones.length, percent, pass: percent <= DCMA_THRESHOLDS.maxHardConstraintPercent });
}

// Points 6/7 -- High float (>44d, informational bad-practice signal) and Negative float (a real
// scheduling problem -- a late constraint or broken logic -- 0 allowed).
export function dcmaFloatMetrics(blocks) {
  const scheduled = blocks.filter((block) => block.total_float_days != null);
  const highFloatCount = scheduled.filter((block) => block.total_float_days > DCMA_THRESHOLDS.highFloatDays).length;
  const negativeFloatCount = scheduled.filter((block) => block.total_float_days < 0).length;
  const highFloatPercent = scheduled.length > 0 ? (highFloatCount / scheduled.length) * 100 : 0;
  return Object.freeze({
    highFloatCount, negativeFloatCount, totalScheduled: scheduled.length, highFloatPercent,
    highFloatPass: highFloatPercent <= DCMA_THRESHOLDS.maxHighFloatPercent,
    negativeFloatPass: negativeFloatCount === 0,
  });
}

// Point 8 -- High duration: % of task activities (not milestones/hammocks) longer than 44 working
// days. duration_days is already a working-day count (see the CPM engine), matching DCMA's own
// working-day-based threshold with no unit conversion needed.
export function dcmaDurationMetrics(blocks) {
  const tasks = blocks.filter((block) => block.block_type === "task");
  const highDurationCount = tasks.filter((block) => block.duration_days > DCMA_THRESHOLDS.highDurationDays).length;
  const percent = tasks.length > 0 ? (highDurationCount / tasks.length) * 100 : 0;
  return Object.freeze({ highDurationCount, totalTasks: tasks.length, percent, pass: percent <= DCMA_THRESHOLDS.maxHighDurationPercent });
}

// Point 9 -- Invalid dates: an actual_start/actual_finish recorded AFTER the status date is a data-
// entry error (you can't have actually done work in the future). Narrower than some DCMA
// implementations (which also flag incomplete forecast dates in the past -- that's point 11, Missed
// Tasks, here, kept separate to avoid double-counting the same activity under two checks).
export function dcmaInvalidDates(blocks, asOfDate) {
  const invalid = blocks.filter((block) => (block.actual_start && block.actual_start > asOfDate) || (block.actual_finish && block.actual_finish > asOfDate));
  return Object.freeze({ invalidCount: invalid.length, taskCodes: Object.freeze(invalid.map((block) => block.task_code)), pass: invalid.length === 0 });
}

// Point 10 -- Resources: % of task/milestone activities with at least one resource assignment.
// Informational (no DCMA-standard hard threshold the way points 1-8 have one) -- reported as a
// ratio, not a pass/fail, matching how P6's own DCMA report treats this point.
export function dcmaResourceAssignment(blocks, assignments) {
  const relevant = blocks.filter((block) => block.block_type !== "hammock");
  const assignedBlockIds = new Set(assignments.map((assignment) => assignment.block_id));
  const assignedCount = relevant.filter((block) => assignedBlockIds.has(block.id)).length;
  const percent = relevant.length > 0 ? (assignedCount / relevant.length) * 100 : 0;
  return Object.freeze({ assignedCount, totalActivities: relevant.length, percent });
}

// Point 11 -- Missed tasks: baselined to finish by asOfDate, but not actually/fully complete.
// baselineBlocks/currentBlocks joined by task_code, same as schedulingBaselines.js's own compare
// logic -- a current block with no baseline counterpart (added since baseline) is excluded, since
// there was no baseline finish date to have missed.
export function dcmaMissedTasks(baselineBlocks, currentBlocksByTaskCode, asOfDate) {
  const due = baselineBlocks.filter((baselineBlock) => baselineBlock.baseline_finish != null && baselineBlock.baseline_finish <= asOfDate);
  const missed = due.filter((baselineBlock) => {
    const current = currentBlocksByTaskCode.get(baselineBlock.block_task_code);
    if (!current) return false; // removed since baseline -- not "missed", it no longer exists to miss.
    return (current.percent_complete ?? 0) < 100 && !current.actual_finish;
  });
  const percent = due.length > 0 ? (missed.length / due.length) * 100 : 0;
  return Object.freeze({ dueCount: due.length, missedCount: missed.length, percent, taskCodes: Object.freeze(missed.map((baselineBlock) => baselineBlock.block_task_code)) });
}

// Point 13 -- Critical Path Length Index: (time remaining to baseline finish + critical path total
// float) / time remaining to baseline finish. Target ~1.0 (0.95-1.05 is DCMA's healthy band);
// materially above 1 means float has been added to the network (schedule padding or a slipping
// finish milestone with unconsumed float), materially below means the critical path itself has
// grown longer than planned.
export function dcmaCriticalPathLengthIndex({ baselineProjectFinish, asOfDate, criticalPathTotalFloatDays }) {
  if (baselineProjectFinish == null || criticalPathTotalFloatDays == null) return Object.freeze({ cpli: null });
  const remainingDays = daysBetweenISO(asOfDate, baselineProjectFinish);
  if (remainingDays <= 0) return Object.freeze({ cpli: null }); // baseline finish already passed -- CPLI is undefined, not zero/infinite.
  return Object.freeze({ cpli: (remainingDays + criticalPathTotalFloatDays) / remainingDays });
}

// Point 14 -- Baseline Execution Index: of everything baselined to finish by asOfDate, what
// fraction actually did? Same "due" set as dcmaMissedTasks (1 - missedCount/dueCount, computed
// independently here rather than derived from it so each function stays self-contained/testable).
export function dcmaBaselineExecutionIndex(baselineBlocks, currentBlocksByTaskCode, asOfDate) {
  const due = baselineBlocks.filter((baselineBlock) => baselineBlock.baseline_finish != null && baselineBlock.baseline_finish <= asOfDate);
  if (due.length === 0) return Object.freeze({ bei: null, dueCount: 0, completedCount: 0 });
  const completed = due.filter((baselineBlock) => {
    const current = currentBlocksByTaskCode.get(baselineBlock.block_task_code);
    return !!current && ((current.percent_complete ?? 0) >= 100 || !!current.actual_finish);
  });
  return Object.freeze({ bei: completed.length / due.length, dueCount: due.length, completedCount: completed.length });
}

// Aggregates points 1-11/13/14 into one report. Point 12 (Critical Path Test) is deliberately
// excluded -- see runCriticalPathTest below, it needs the full CPM input set (calendars/lanes/
// hammocks), not just the flat block/dependency arrays every other point here operates on.
export function computeDcmaMetrics({ blocks, dependencies, assignments = [], baselineBlocks = [], asOfDate }) {
  const currentBlocksByTaskCode = new Map(blocks.map((block) => [block.task_code, block]));
  return Object.freeze({
    logic: dcmaLogicDensity(blocks, dependencies),
    leadsAndLags: dcmaLeadsAndLags(dependencies),
    relationshipTypes: dcmaRelationshipTypes(dependencies),
    hardConstraints: dcmaHardConstraints(blocks),
    float: dcmaFloatMetrics(blocks),
    duration: dcmaDurationMetrics(blocks),
    invalidDates: dcmaInvalidDates(blocks, asOfDate),
    resources: dcmaResourceAssignment(blocks, assignments),
    missedTasks: dcmaMissedTasks(baselineBlocks, currentBlocksByTaskCode, asOfDate),
    baselineExecutionIndex: dcmaBaselineExecutionIndex(baselineBlocks, currentBlocksByTaskCode, asOfDate),
  });
}

// Point 12 -- Critical Path Test. Two checks, matching what DCMA's real test actually catches:
//
// 1. Exactly one terminal activity (no successor) may exist among the Gantt blocks. More than one
//    means the network has open ends that don't tie into a single finish point -- fails outright,
//    no CPM re-run needed to know that.
// 2. Extending that one terminal activity's duration by testDays must push ITS OWN early_finish
//    forward by a positive amount. If it doesn't move at all, something else -- most commonly a
//    hard must_finish_on constraint the CPM engine honors over dependency-calculated dates --
//    is silently pinning the reported finish regardless of the network's actual logic.
//
// Deliberately NOT asserting shiftDays === testDays: duration_days is a WORKING-day count, but
// shiftDays here is CALENDAR days (daysBetweenISO, matching this module's calendar-day convention
// throughout) -- on a 5-day calendar those two units diverge by design (600 working days spans
// materially more than 600 calendar days), so comparing them numerically would be a unit-mismatch
// bug, not a meaningful check. "Moved forward at all" is the real signal; "moved by exactly N
// calendar days" is not, and a first draft of this function got that distinction wrong.
//
// The one DCMA point needing a real CPM re-run rather than arithmetic over already-computed fields
// -- reuses runCpmEngine as-is, no new algorithm.
export function runCriticalPathTest({ project, blocks, dependencies, calendars = [], holidays = [], hammockAnchors = [], lanes = [], testDays = 600 }) {
  const ganttBlocks = blocks.filter((block) => block.lane_id != null && block.block_type !== "hammock");
  if (ganttBlocks.length === 0) return Object.freeze({ pass: null, reason: "No Gantt blocks to test." });

  const hasSuccessor = new Set(dependencies.map((dependency) => dependency.predecessor_id));
  const terminalBlocks = ganttBlocks.filter((block) => !hasSuccessor.has(block.id));
  if (terminalBlocks.length === 0) {
    return Object.freeze({ pass: null, reason: "No terminal activity found (every activity has a successor -- a cycle or data error)." });
  }
  if (terminalBlocks.length > 1) {
    return Object.freeze({
      pass: false,
      reason: `${terminalBlocks.length} terminal activities found (open-ended logic) -- a healthy schedule ties every path into exactly one finish point.`,
      terminalTaskCodes: Object.freeze(terminalBlocks.map((block) => block.task_code).sort()),
    });
  }

  const [terminal] = terminalBlocks;
  const original = runCpmEngine({ project, blocks: ganttBlocks, dependencies, calendars, holidays, hammockAnchors, lanes });
  const originalFinish = original.blocks.find((block) => block.id === terminal.id)?.early_finish ?? null;
  if (originalFinish == null) return Object.freeze({ pass: null, reason: "Unable to compute an original finish date for the terminal activity." });

  const extendedBlocks = ganttBlocks.map((block) => (block.id === terminal.id ? { ...block, duration_days: block.duration_days + testDays } : block));
  const extended = runCpmEngine({ project, blocks: extendedBlocks, dependencies, calendars, holidays, hammockAnchors, lanes });
  const extendedFinish = extended.blocks.find((block) => block.id === terminal.id)?.early_finish ?? null;

  const shiftDays = extendedFinish != null ? daysBetweenISO(originalFinish, extendedFinish) : null;
  return Object.freeze({
    pass: shiftDays != null && shiftDays > 0,
    originalFinish, extendedFinish, shiftDays, testDays,
    drivingTaskCode: terminal.task_code,
  });
}
