// Pure, framework-agnostic resource leveling for the relational scheduling schema -- SCHED-09,
// the deferred fifth capability beyond the original four-area P6-parity build-out (CPM engine,
// baselines+progress, resources+costs, EVM+DCMA, all shipped; see those modules' own headers).
// Not wired into any route or UI yet -- a read-only "what-if" preview, same pattern as every prior
// schema/logic-first slice (most directly CPM's own Phase 0/SCHED-01 before SCHED-03 wired it in).
//
// Implements the standard "Serial SGS" (Serial Schedule Generation Scheme) heuristic -- the same
// approach real tools use, since exact resource-constrained scheduling optimization is NP-hard:
// process activities one at a time, highest-priority-first among those whose predecessors are
// already placed, delaying each just far enough to avoid any resource-capacity conflict with
// everything already placed. Priority = total float ascending (an activity with little slack stays
// where the CPM engine put it; a float-rich activity absorbs the delay instead), tie-broken by
// original early_start then task_code for determinism -- matching P6's own default leveling
// priority order.
//
// Reuses rather than reimplements: schedulingCpmEngine.js's computeForwardDatesForBlock (the exact
// dependency/relationship/lag/constraint logic that decides an activity's earliest possible start,
// now fed this module's own incrementally-built results instead of the CPM engine's full-pass one),
// resolveCalendarForBlock/stepWorkingDays for calendar walking, and schedulingResources.js's
// spreadUnitsAcrossWorkingDays for computing what a candidate placement would add to each
// resource's daily load. The only genuinely new logic here is the priority-ordered placement loop
// and the running per-resource-per-day ledger it checks candidates against.
//
// `blocks` are runCpmEngine's OUTPUT rows (post-CPM: early/late dates, total_float_days,
// is_critical already populated), matching how every other module in this family (baselines,
// resources, EVM/DCMA) consumes CPM output rather than raw schedule_blocks rows.

import { daysBetweenISO } from "./schedulingRelationalMapping";
import { computeForwardDatesForBlock, resolveCalendarForBlock, stepWorkingDays, topologicalOrder } from "./schedulingCpmEngine";
import { spreadUnitsAcrossWorkingDays } from "./schedulingResources";

const MAX_CALENDAR_WALK_DAYS = 3660; // matches the guard convention used throughout this module family.

function priorityCompare(a, b) {
  const floatA = a.total_float_days ?? Infinity;
  const floatB = b.total_float_days ?? Infinity;
  if (floatA !== floatB) return floatA - floatB;
  if (a.early_start !== b.early_start) return a.early_start < b.early_start ? -1 : 1;
  return a.task_code.localeCompare(b.task_code);
}

function ledgerKey(resourceId, date) {
  return `${resourceId} ${date}`;
}

// A block with no resource assignments returns an empty spread and therefore never conflicts --
// it's placed at its dependency-driven earliest start with zero delay, exactly as plain CPM would.
function spreadForCandidate(block, candidateStart, candidateFinish, calendar, holidaySet, assignmentsByBlockId) {
  const rows = [];
  for (const assignment of assignmentsByBlockId.get(block.id) ?? []) {
    const spread = spreadUnitsAcrossWorkingDays({ block: { early_start: candidateStart, early_finish: candidateFinish }, calendar, holidaySet, totalUnits: assignment.budgeted_units });
    for (const { date, units } of spread) rows.push({ resource_id: assignment.resource_id, date, units });
  }
  return rows;
}

// Checked against the ledger BEFORE this block's own spread is committed to it -- a block can never
// conflict with itself, only with everything already placed.
function findConflicts(candidateSpread, ledger, resourcesById) {
  const conflicts = [];
  for (const { resource_id: resourceId, date, units } of candidateSpread) {
    const resource = resourcesById.get(resourceId);
    if (!resource) continue; // orphaned assignment -- not this function's data to fix, same as schedulingResources.js.
    const allocated = (ledger.get(ledgerKey(resourceId, date)) ?? 0) + units;
    if (allocated > resource.max_units_per_day) {
      conflicts.push(Object.freeze({ resource_id: resourceId, date, allocated_units: allocated, max_units_per_day: resource.max_units_per_day, over_by: allocated - resource.max_units_per_day }));
    }
  }
  return conflicts;
}

function commitToLedger(candidateSpread, ledger) {
  for (const { resource_id: resourceId, date, units } of candidateSpread) {
    const key = ledgerKey(resourceId, date);
    ledger.set(key, (ledger.get(key) ?? 0) + units);
  }
}

// allowExtension=false (default): an activity is never delayed past its own CPM-computed
// late_start -- if no conflict-free day exists within its float, it's placed AT late_start and
// reported in unresolvedConflicts rather than silently pushed further out. allowExtension=true:
// keeps delaying past late_start (and therefore past the original project finish) until resolved,
// bounded only by MAX_CALENDAR_WALK_DAYS as a degenerate-input guard.
//
// Cyclic blocks (per topologicalOrder's own cycle detection) are excluded entirely, same as the
// CPM engine's own forward/backward pass -- they're already flagged by runCpmEngine's conflict
// detection; this module doesn't duplicate that reporting.
export function levelResources({
  project, blocks, dependencies = [], assignments = [], resourcesById,
  calendarsById = new Map(), lanesById = new Map(), holidaysByCalendarId = new Map(),
  allowExtension = false,
}) {
  const ganttBlocks = blocks.filter((block) => block.lane_id != null && block.block_type !== "hammock");
  const blocksById = new Map(ganttBlocks.map((block) => [block.id, block]));
  const assignmentsByBlockId = new Map();
  for (const assignment of assignments) {
    if (!assignmentsByBlockId.has(assignment.block_id)) assignmentsByBlockId.set(assignment.block_id, []);
    assignmentsByBlockId.get(assignment.block_id).push(assignment);
  }

  const { validDependencies, cyclicBlockIds } = topologicalOrder(ganttBlocks, dependencies);
  const eligibleBlocks = ganttBlocks.filter((block) => !cyclicBlockIds.has(block.id));

  // Priority-driven Kahn's algorithm: topologicalOrder's own queue is FIFO with no priority
  // concept, reused here only for its cycle/dangling-edge detection (validDependencies/
  // cyclicBlockIds) -- the in-degree bookkeeping and queue below are this module's own, so the
  // ready set can be picked by priority instead of arrival order.
  const successorsOf = new Map(eligibleBlocks.map((block) => [block.id, []]));
  const inDegree = new Map(eligibleBlocks.map((block) => [block.id, 0]));
  for (const dependency of validDependencies) {
    if (!successorsOf.has(dependency.predecessor_id) || !inDegree.has(dependency.successor_id)) continue;
    successorsOf.get(dependency.predecessor_id).push(dependency.successor_id);
    inDegree.set(dependency.successor_id, inDegree.get(dependency.successor_id) + 1);
  }

  let ready = eligibleBlocks.filter((block) => inDegree.get(block.id) === 0);
  const resultsById = new Map(); // finalized leveled dates so far, keyed by block id -- feeds computeForwardDatesForBlock for not-yet-placed successors.
  const ledger = new Map(); // `${resourceId} ${date}` -> cumulative allocated units across every already-placed block.
  const leveledBlocks = [];
  const unresolvedConflicts = [];

  while (ready.length > 0) {
    ready.sort(priorityCompare);
    const block = ready.shift();

    const calendar = resolveCalendarForBlock(block, { calendarsById, lanesById, project });
    const holidaySet = holidaysByCalendarId.get(calendar.id) ?? null;

    const dependencyDates = computeForwardDatesForBlock(block, validDependencies, resultsById, calendar, holidaySet, project, false);
    let candidateStart = dependencyDates?.earlyStart ?? block.early_start;
    let candidateFinish = dependencyDates?.earlyFinish ?? block.early_finish;

    // A hard constraint (must_start_on/must_finish_on) pins this block's date by user decree --
    // computeForwardDatesForBlock already returns that fixed date as candidateStart regardless of
    // resource contention, but WITHOUT this guard the advance loop below would still try to slide
    // it later on a conflict, silently overriding what "must" means. Found and fixed while
    // implementing SCHED-10's apply action, which writes leveled dates back as start_on
    // constraints -- applying a moved date onto an already-must-pinned block would have been a
    // real, user-visible correctness bug, not a cosmetic one.
    const isHardPinned = block.constraint_type === "must_start_on" || block.constraint_type === "must_finish_on";

    let conflicts = findConflicts(spreadForCandidate(block, candidateStart, candidateFinish, calendar, holidaySet, assignmentsByBlockId), ledger, resourcesById);
    let guard = 0;
    while (conflicts.length > 0 && guard <= MAX_CALENDAR_WALK_DAYS) {
      if (isHardPinned) break; // never move a hard-constrained block -- report the conflict, don't override the constraint.
      if (!allowExtension && block.late_start != null && candidateStart >= block.late_start) break; // out of float -- stop here, report unresolved.
      candidateStart = stepWorkingDays(calendar, holidaySet, candidateStart, 1);
      candidateFinish = block.block_type === "milestone" ? candidateStart : stepWorkingDays(calendar, holidaySet, candidateStart, block.duration_days - 1);
      conflicts = findConflicts(spreadForCandidate(block, candidateStart, candidateFinish, calendar, holidaySet, assignmentsByBlockId), ledger, resourcesById);
      guard += 1;
    }

    commitToLedger(spreadForCandidate(block, candidateStart, candidateFinish, calendar, holidaySet, assignmentsByBlockId), ledger);
    resultsById.set(block.id, { earlyStart: candidateStart, earlyFinish: candidateFinish });

    leveledBlocks.push(Object.freeze({
      id: block.id, task_code: block.task_code,
      original_start: block.early_start, original_finish: block.early_finish,
      leveled_start: candidateStart, leveled_finish: candidateFinish,
      delay_days: daysBetweenISO(block.early_start, candidateStart),
    }));
    if (conflicts.length > 0) {
      unresolvedConflicts.push(Object.freeze({ task_code: block.task_code, leveled_start: candidateStart, leveled_finish: candidateFinish, conflicts: Object.freeze(conflicts) }));
    }

    for (const successorId of successorsOf.get(block.id) ?? []) {
      inDegree.set(successorId, inDegree.get(successorId) - 1);
      if (inDegree.get(successorId) === 0) ready.push(blocksById.get(successorId));
    }
  }

  const originalFinish = ganttBlocks.reduce((latest, block) => (block.early_finish && (!latest || block.early_finish > latest) ? block.early_finish : latest), null);
  const leveledFinish = leveledBlocks.reduce((latest, block) => (block.leveled_finish && (!latest || block.leveled_finish > latest) ? block.leveled_finish : latest), null);
  const projectFinishExtensionDays = (originalFinish != null && leveledFinish != null) ? Math.max(0, daysBetweenISO(originalFinish, leveledFinish)) : 0;

  return Object.freeze({
    leveledBlocks: Object.freeze(leveledBlocks),
    unresolvedConflicts: Object.freeze(unresolvedConflicts),
    projectFinishExtensionDays,
  });
}
