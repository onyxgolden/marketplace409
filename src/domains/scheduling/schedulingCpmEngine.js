// Pure, framework-agnostic CPM (Critical Path Method) engine for the relational scheduling
// schema (supabase/migrations/20260827000000_create_scheduling_relational_schema.sql). Replaces
// schedulingBoardState.js's criticalPath(), which is an explicitly-labeled "simplified stand-in"
// (longest-path-by-duration, no calendars/lag/constraints) operating on the old week-index JSONB
// board shape. This module operates on the new day-granular relational row shapes instead and is
// not wired into any route or UI yet -- see docs/scheduling/SPEC.md section 4 for the (thin,
// four-sentence) original design; every algorithmic decision beyond that spec is made and
// explained here.
//
// UTC-only throughout, deliberately: schedulingBoardState.js's parseISODate builds local-time
// Date objects, which would silently disagree with schedulingRelationalMapping.js's addDaysISO
// (UTC) on this codebase's day-boundary math. This engine standardizes on UTC to match the newer
// file and this codebase's broader "always UTC, no per-owner timezone" convention.
//
// Every exported function is pure (no I/O, no mutation) and returns Object.freeze'd data.

import { addDaysISO } from "./schedulingRelationalMapping";

const MAX_CALENDAR_WALK_DAYS = 3660; // ~10 years -- guards a degenerate all-non-working calendar.

const SEVEN_DAY_FALLBACK_CALENDAR = Object.freeze({ id: null, working_days: Object.freeze([0, 1, 2, 3, 4, 5, 6]) });

// A block with a hard constraint (must_start_on/must_finish_on) or a deadline-style upper bound
// (SNLT/FNLT) is worth flagging as a conflict if it contradicts what the dependency network alone
// would produce. SNET/start_on/FNET/finish_on are soft lower bounds folded directly into the
// forward-pass candidate set (see forwardCandidatesForBlock) and never conflict by construction --
// a lower bound can only push a date later, which a dependency-driven date already satisfies or
// exceeds.
const HARD_OR_DEADLINE_CONSTRAINT_TYPES = Object.freeze(["must_start_on", "must_finish_on", "SNLT", "FNLT"]);

// --- Calendar primitives ---------------------------------------------------------------------

export function isWorkingDay(calendar, holidaySet, dateISO) {
  const weekday = new Date(`${dateISO}T00:00:00.000Z`).getUTCDay();
  if (!calendar.working_days.includes(weekday)) return false;
  return !(holidaySet && holidaySet.has(dateISO));
}

// dateISO itself is checked first -- a date that's already a working day rolls to itself, in
// either direction.
export function rollToWorkingDay(calendar, holidaySet, dateISO, direction) {
  let current = dateISO;
  let guard = 0;
  while (!isWorkingDay(calendar, holidaySet, current)) {
    current = addDaysISO(current, direction);
    guard += 1;
    if (guard > MAX_CALENDAR_WALK_DAYS) return null;
  }
  return current;
}

// fromISO is assumed to already be a working day (every caller in this module only ever passes a
// value that rollToWorkingDay has already produced). count may be 0, negative, or positive; a
// non-working day encountered while walking doesn't consume any of the count budget.
export function stepWorkingDays(calendar, holidaySet, fromISO, count) {
  if (count === 0) return fromISO;
  const direction = count > 0 ? 1 : -1;
  let remaining = Math.abs(count);
  let current = fromISO;
  let guard = 0;
  while (remaining > 0) {
    current = addDaysISO(current, direction);
    guard += 1;
    if (guard > MAX_CALENDAR_WALK_DAYS) return null;
    if (isWorkingDay(calendar, holidaySet, current)) remaining -= 1;
  }
  return current;
}

// Signed working-day step distance from fromISO to toISO (0 if equal). Both dates are assumed to
// already be working days -- true for every call site in this module, since early/late dates are
// always the output of rollToWorkingDay/stepWorkingDays.
export function countWorkingDaysBetween(calendar, holidaySet, fromISO, toISO) {
  if (fromISO === toISO) return 0;
  const direction = toISO > fromISO ? 1 : -1;
  let current = fromISO;
  let count = 0;
  let guard = 0;
  while (current !== toISO) {
    current = addDaysISO(current, direction);
    guard += 1;
    if (guard > MAX_CALENDAR_WALK_DAYS) return null;
    if (isWorkingDay(calendar, holidaySet, current)) count += direction;
  }
  return count;
}

// block.calendar_id -> lane.calendar_id -> project.default_calendar_id -> a synthetic 7-day
// calendar. A block with no resolvable calendar anywhere becomes maximally permissive rather than
// unschedulable -- this is a legitimate state for calendar-less test/seed data, not an error.
export function resolveCalendarForBlock(block, { calendarsById, lanesById, project }) {
  if (block.calendar_id && calendarsById.has(block.calendar_id)) return calendarsById.get(block.calendar_id);
  const lane = block.lane_id ? lanesById.get(block.lane_id) : null;
  if (lane?.calendar_id && calendarsById.has(lane.calendar_id)) return calendarsById.get(lane.calendar_id);
  if (project?.default_calendar_id && calendarsById.has(project.default_calendar_id)) return calendarsById.get(project.default_calendar_id);
  return SEVEN_DAY_FALLBACK_CALENDAR;
}

// --- Graph / topological order ------------------------------------------------------------------

// Hammock blocks never enter the dependency graph -- they're resolved after the main pass purely
// from their anchors (see resolveHammocks), so they're excluded here as graph nodes entirely.
// Cycle handling: Kahn's algorithm's leftover set (in-degree never reaches 0) is exactly the cycle
// plus everything transitively downstream of it -- a free, correct byproduct of the algorithm, not
// extra work. That set is excluded from the pass; the rest of the graph computes normally. A
// silent wrong answer (the old criticalPath()'s cycle-tolerance-by-truncation) is worse than a
// visible one, but aborting an entire project's computation over one bad edge in an otherwise-valid
// schedule is disruptive -- partial results plus a conflict is the better default.
export function topologicalOrder(blocks, dependencies) {
  const blockIds = new Set(blocks.filter((block) => block.block_type !== "hammock").map((block) => block.id));
  const adjacency = new Map([...blockIds].map((id) => [id, []]));
  const inDegree = new Map([...blockIds].map((id) => [id, 0]));

  const danglingDependencies = [];
  const hammockDependencies = [];
  const validDependencies = [];
  for (const dependency of dependencies) {
    const { predecessor_id: predecessorId, successor_id: successorId } = dependency;
    const predecessorIsHammock = blocks.some((block) => block.id === predecessorId && block.block_type === "hammock");
    const successorIsHammock = blocks.some((block) => block.id === successorId && block.block_type === "hammock");
    if (predecessorIsHammock || successorIsHammock) {
      hammockDependencies.push(dependency);
      continue;
    }
    if (!blockIds.has(predecessorId) || !blockIds.has(successorId)) {
      danglingDependencies.push(dependency);
      continue;
    }
    validDependencies.push(dependency);
    adjacency.get(predecessorId).push(successorId);
    inDegree.set(successorId, inDegree.get(successorId) + 1);
  }

  const remainingInDegree = new Map(inDegree);
  const queue = [...blockIds].filter((id) => remainingInDegree.get(id) === 0);
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const next of adjacency.get(id)) {
      remainingInDegree.set(next, remainingInDegree.get(next) - 1);
      if (remainingInDegree.get(next) === 0) queue.push(next);
    }
  }

  const orderedSet = new Set(order);
  const cyclicBlockIds = new Set([...blockIds].filter((id) => !orderedSet.has(id)));

  return Object.freeze({
    order: Object.freeze(order),
    cyclicBlockIds: Object.freeze(cyclicBlockIds),
    validDependencies: Object.freeze(validDependencies),
    danglingDependencies: Object.freeze(danglingDependencies),
    hammockDependencies: Object.freeze(hammockDependencies),
  });
}

// --- Forward / backward pass -------------------------------------------------------------------

function predecessorDependenciesFor(blockId, validDependencies) {
  return validDependencies.filter((dependency) => dependency.successor_id === blockId);
}

function successorDependenciesFor(blockId, validDependencies) {
  return validDependencies.filter((dependency) => dependency.predecessor_id === blockId);
}

// Converts a raw candidate date -- which may bound the successor's ES directly (FS/SS) or the
// successor's EF (FF/SF, since those relationship types constrain the finish, not the start) --
// into an ES-equivalent lower bound. For a milestone (duration 0), ES and EF are the same value,
// so an EF-bound candidate is used as the ES bound directly with no conversion.
function esEquivalent(calendar, holidaySet, bound, dateISO, block) {
  if (dateISO == null) return null;
  if (bound === "ES") return dateISO;
  if (block.block_type === "milestone") return dateISO;
  return stepWorkingDays(calendar, holidaySet, dateISO, -(block.duration_days - 1));
}

// Lag is applied in calendar days, not working days -- lag represents elapsed real-world waiting
// time independent of whether a crew is working (e.g. concrete curing over a weekend), whereas
// duration_days represents work being performed, which only progresses on working days. The
// lagged date is rolled to the successor's own working day exactly once, after combining with the
// relationship type, not per intermediate step.
function forwardCandidateFromDependency(dependency, predecessorRecord, calendar, holidaySet, useDependencyOnly) {
  const predecessorEarlyStart = useDependencyOnly ? predecessorRecord.dependencyOnlyEarlyStart : predecessorRecord.earlyStart;
  const predecessorEarlyFinish = useDependencyOnly ? predecessorRecord.dependencyOnlyEarlyFinish : predecessorRecord.earlyFinish;
  if (predecessorEarlyStart == null || predecessorEarlyFinish == null) return null;
  const lag = dependency.lag_days;
  switch (dependency.relationship_type) {
    case "FS": return { bound: "ES", dateISO: rollToWorkingDay(calendar, holidaySet, addDaysISO(predecessorEarlyFinish, 1 + lag), 1) };
    case "SS": return { bound: "ES", dateISO: rollToWorkingDay(calendar, holidaySet, addDaysISO(predecessorEarlyStart, lag), 1) };
    case "FF": return { bound: "EF", dateISO: rollToWorkingDay(calendar, holidaySet, addDaysISO(predecessorEarlyFinish, lag), 1) };
    case "SF": return { bound: "EF", dateISO: rollToWorkingDay(calendar, holidaySet, addDaysISO(predecessorEarlyStart, lag), 1) };
    default: return null;
  }
}

// SNET/start_on are treated as equivalent soft ES lower bounds, and FNET/finish_on as equivalent
// soft EF lower bounds (converted to ES-equivalent the same way a dependency's FF/SF candidate
// is) -- SPEC.md gives no finer distinction between the "on" and "no-earlier-than" variants to
// build against, so this is a deliberate, named simplification, not an oversight. must_start_on /
// must_finish_on are hard overrides: they replace the dependency-driven ES rather than
// participating in the max() with it. ASAP and ALAP have no forward-pass effect (ALAP is resolved
// as a post-process in applyAlapOverrides, matching SPEC.md's single unelaborated bullet on it).
function constraintForwardBound(block, calendar, holidaySet) {
  if (!block.constraint_type) return { kind: "none" };
  switch (block.constraint_type) {
    case "SNET":
    case "start_on":
      return { kind: "soft", esCandidate: rollToWorkingDay(calendar, holidaySet, block.constraint_date, 1) };
    case "FNET":
    case "finish_on":
      return { kind: "soft", esCandidate: esEquivalent(calendar, holidaySet, "EF", rollToWorkingDay(calendar, holidaySet, block.constraint_date, 1), block) };
    case "must_start_on":
      return { kind: "hard", esOverride: rollToWorkingDay(calendar, holidaySet, block.constraint_date, 1) };
    case "must_finish_on": {
      const ef = rollToWorkingDay(calendar, holidaySet, block.constraint_date, 1);
      return { kind: "hard", esOverride: esEquivalent(calendar, holidaySet, "EF", ef, block) };
    }
    default:
      return { kind: "none" };
  }
}

// Exported (SCHED-09) so schedulingResourceLeveling.js can compute one block's dependency-driven
// earliest start/finish against a partial, incrementally-built resultsById (its own leveled dates
// so far), without duplicating this relationship/lag/constraint logic. No behavior change --
// forwardPass below still uses it exactly as before.
export function computeForwardDatesForBlock(block, validDependencies, resultsById, calendar, holidaySet, project, useDependencyOnly) {
  const predecessors = predecessorDependenciesFor(block.id, validDependencies);
  const candidates = [];
  for (const dependency of predecessors) {
    const predecessorRecord = resultsById.get(dependency.predecessor_id);
    if (!predecessorRecord) continue; // predecessor excluded (cyclic / invalid calendar)
    const raw = forwardCandidateFromDependency(dependency, predecessorRecord, calendar, holidaySet, useDependencyOnly);
    if (!raw || raw.dateISO == null) continue;
    const esCandidate = esEquivalent(calendar, holidaySet, raw.bound, raw.dateISO, block);
    if (esCandidate != null) candidates.push(esCandidate);
  }

  let earlyStart;
  if (useDependencyOnly) {
    earlyStart = candidates.length > 0
      ? candidates.reduce((max, date) => (date > max ? date : max))
      : rollToWorkingDay(calendar, holidaySet, project.start_date, 1);
  } else {
    const constraint = constraintForwardBound(block, calendar, holidaySet);
    if (constraint.kind === "hard" && constraint.esOverride != null) {
      earlyStart = constraint.esOverride;
    } else {
      if (constraint.kind === "soft" && constraint.esCandidate != null) candidates.push(constraint.esCandidate);
      earlyStart = candidates.length > 0
        ? candidates.reduce((max, date) => (date > max ? date : max))
        : rollToWorkingDay(calendar, holidaySet, project.start_date, 1);
    }
  }

  if (earlyStart == null) return null; // calendar walk exceeded MAX_CALENDAR_WALK_DAYS
  const earlyFinish = block.block_type === "milestone" ? earlyStart : stepWorkingDays(calendar, holidaySet, earlyStart, block.duration_days - 1);
  return { earlyStart, earlyFinish };
}

export function forwardPass({ blocks, order, cyclicBlockIds, validDependencies, calendarsById, holidaysByCalendarId, lanesById, project }) {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const resultsById = new Map();

  for (const blockId of order) {
    if (cyclicBlockIds.has(blockId)) continue;
    const block = blocksById.get(blockId);
    const calendar = resolveCalendarForBlock(block, { calendarsById, lanesById, project });
    const holidaySet = holidaysByCalendarId.get(calendar.id) || new Set();

    const dependencyOnly = computeForwardDatesForBlock(block, validDependencies, resultsById, calendar, holidaySet, project, true);
    const constrained = computeForwardDatesForBlock(block, validDependencies, resultsById, calendar, holidaySet, project, false);

    if (!dependencyOnly || !constrained) continue; // invalid/degenerate calendar for this block

    resultsById.set(blockId, Object.freeze({
      blockId,
      earlyStart: constrained.earlyStart,
      earlyFinish: constrained.earlyFinish,
      dependencyOnlyEarlyStart: dependencyOnly.earlyStart,
      dependencyOnlyEarlyFinish: dependencyOnly.earlyFinish,
    }));
  }

  return Object.freeze(resultsById);
}

function backwardCandidateFromDependency(dependency, successorRecord, calendar, holidaySet) {
  const successorLateStart = successorRecord.lateStart;
  const successorLateFinish = successorRecord.lateFinish;
  if (successorLateStart == null || successorLateFinish == null) return null;
  const lag = dependency.lag_days;
  switch (dependency.relationship_type) {
    case "FS": return { bound: "LF", dateISO: rollToWorkingDay(calendar, holidaySet, addDaysISO(successorLateStart, -(1 + lag)), -1) };
    case "SS": return { bound: "LS", dateISO: rollToWorkingDay(calendar, holidaySet, addDaysISO(successorLateStart, -lag), -1) };
    case "FF": return { bound: "LF", dateISO: rollToWorkingDay(calendar, holidaySet, addDaysISO(successorLateFinish, -lag), -1) };
    case "SF": return { bound: "LS", dateISO: rollToWorkingDay(calendar, holidaySet, addDaysISO(successorLateFinish, -lag), -1) };
    default: return null;
  }
}

// Mirror of esEquivalent, converting a raw LS-bound candidate into an LF-equivalent upper bound.
function lfEquivalent(calendar, holidaySet, bound, dateISO, block) {
  if (dateISO == null) return null;
  if (bound === "LF") return dateISO;
  if (block.block_type === "milestone") return dateISO;
  return stepWorkingDays(calendar, holidaySet, dateISO, block.duration_days - 1);
}

function constraintBackwardBound(block, calendar, holidaySet) {
  if (!block.constraint_type) return { kind: "none" };
  switch (block.constraint_type) {
    case "SNLT":
      return { kind: "soft", lfCandidate: lfEquivalent(calendar, holidaySet, "LS", rollToWorkingDay(calendar, holidaySet, block.constraint_date, -1), block) };
    case "FNLT":
      return { kind: "soft", lfCandidate: rollToWorkingDay(calendar, holidaySet, block.constraint_date, -1) };
    case "must_start_on":
      return { kind: "hard", lfOverride: lfEquivalent(calendar, holidaySet, "LS", rollToWorkingDay(calendar, holidaySet, block.constraint_date, -1), block) };
    case "must_finish_on":
      return { kind: "hard", lfOverride: rollToWorkingDay(calendar, holidaySet, block.constraint_date, -1) };
    default:
      return { kind: "none" };
  }
}

export function backwardPass({ blocks, order, cyclicBlockIds, validDependencies, calendarsById, holidaysByCalendarId, lanesById, project, forwardResults }) {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const resultsById = new Map();
  const reverseOrder = [...order].reverse();

  for (const blockId of reverseOrder) {
    if (cyclicBlockIds.has(blockId) || !forwardResults.has(blockId)) continue;
    const block = blocksById.get(blockId);
    const calendar = resolveCalendarForBlock(block, { calendarsById, lanesById, project });
    const holidaySet = holidaysByCalendarId.get(calendar.id) || new Set();

    const successors = successorDependenciesFor(blockId, validDependencies);
    const candidates = [];
    for (const dependency of successors) {
      const successorRecord = resultsById.get(dependency.successor_id);
      if (!successorRecord) continue;
      const raw = backwardCandidateFromDependency(dependency, successorRecord, calendar, holidaySet);
      if (!raw || raw.dateISO == null) continue;
      const lfCandidate = lfEquivalent(calendar, holidaySet, raw.bound, raw.dateISO, block);
      if (lfCandidate != null) candidates.push(lfCandidate);
    }

    const constraint = constraintBackwardBound(block, calendar, holidaySet);
    let lateFinish;
    if (constraint.kind === "hard" && constraint.lfOverride != null) {
      lateFinish = constraint.lfOverride;
    } else {
      if (constraint.kind === "soft" && constraint.lfCandidate != null) candidates.push(constraint.lfCandidate);
      lateFinish = candidates.length > 0
        ? candidates.reduce((min, date) => (date < min ? date : min))
        : rollToWorkingDay(calendar, holidaySet, project.end_date, -1);
    }

    if (lateFinish == null) continue;
    const lateStart = block.block_type === "milestone" ? lateFinish : stepWorkingDays(calendar, holidaySet, lateFinish, -(block.duration_days - 1));
    if (lateStart == null) continue;

    resultsById.set(blockId, Object.freeze({ blockId, lateStart, lateFinish }));
  }

  return Object.freeze(resultsById);
}

// ALAP blocks are computed as ASAP throughout the main pass (no special forward/backward-pass
// handling), then their *reported* early dates are overridden here to equal their late dates --
// "pushed as late as safely possible," which is what ALAP means, and makes their float trivially
// 0 by construction. Known, named limitation: this override does not re-propagate to successors'
// forward-pass computation -- a true fixed-point ALAP re-solve (forward -> backward -> adjust ->
// forward again) isn't justified by SPEC.md's single unelaborated ALAP bullet. Successors of an
// ALAP block still key off its pass-1 (ASAP-equivalent) dates, not this override.
export function applyAlapOverrides(forwardResults, backwardResults, blocksById) {
  const overridden = new Map();
  for (const [blockId, forwardRecord] of forwardResults) {
    const block = blocksById.get(blockId);
    const backwardRecord = backwardResults.get(blockId);
    if (block?.constraint_type === "ALAP" && backwardRecord) {
      overridden.set(blockId, Object.freeze({
        ...forwardRecord,
        earlyStart: backwardRecord.lateStart,
        earlyFinish: backwardRecord.lateFinish,
      }));
    } else {
      overridden.set(blockId, forwardRecord);
    }
  }
  return Object.freeze(overridden);
}

// Float is expressed in working days of the block's own calendar, not calendar days -- matching
// the unit duration_days already uses, so the two stay comparable on the same block. Criticality
// is "float equals the graph-wide minimum float," not hardcoded to exactly zero, so an
// over-constrained schedule (negative achievable minimum) still has a well-defined critical path.
export function computeFloatAndCriticality(forwardResults, backwardResults, calendarsById, holidaysByCalendarId, lanesById, blocksById, project) {
  const floatByBlockId = new Map();
  for (const [blockId, forwardRecord] of forwardResults) {
    const backwardRecord = backwardResults.get(blockId);
    if (!backwardRecord) continue;
    const block = blocksById.get(blockId);
    const calendar = resolveCalendarForBlock(block, { calendarsById, lanesById, project });
    const holidaySet = holidaysByCalendarId.get(calendar.id) || new Set();
    const totalFloatDays = countWorkingDaysBetween(calendar, holidaySet, forwardRecord.earlyStart, backwardRecord.lateStart);
    if (totalFloatDays != null) floatByBlockId.set(blockId, totalFloatDays);
  }

  const floatValues = [...floatByBlockId.values()];
  const minFloat = floatValues.length > 0 ? Math.min(...floatValues) : 0;

  const criticalityById = new Map();
  for (const [blockId, totalFloatDays] of floatByBlockId) {
    criticalityById.set(blockId, totalFloatDays === minFloat);
  }

  return Object.freeze({ floatByBlockId: Object.freeze(floatByBlockId), criticalityById: Object.freeze(criticalityById), minFloat });
}

// --- Hammocks --------------------------------------------------------------------------------

// Runs after the full forward+backward pass completes, since hammocks only read anchors' already-
// computed dates -- they never enter the topological sort (see topologicalOrder). SPEC.md only
// defines a hammock's early_start/early_finish; extending it: total_float_days is the minimum
// float across its anchors (a hammock is only as critical as its most critical covered activity),
// is_critical follows the same graph-wide-minimum rule as every other block, and late dates are
// derived by shifting the early dates by that float using the calendar of whichever anchor block
// determined early_start (an arbitrary but deterministic tie-break). A hammock's own
// duration_days/calendar_id columns are ignored as input -- its dates are 100% anchor-derived.
export function resolveHammocks({ blocks, hammockAnchors, forwardResults, floatByBlockId, calendarsById, holidaysByCalendarId, lanesById, project }) {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const hammockBlocks = blocks.filter((block) => block.block_type === "hammock");
  const results = new Map();
  const anomalies = [];

  for (const hammock of hammockBlocks) {
    const anchors = hammockAnchors.filter((anchor) => anchor.hammock_block_id === hammock.id);
    const validAnchors = [];
    for (const anchor of anchors) {
      const anchorBlock = blocksById.get(anchor.anchor_block_id);
      if (!anchorBlock || anchorBlock.block_type === "hammock" || !forwardResults.has(anchor.anchor_block_id)) {
        anomalies.push({ type: "hammock_anchor_anomaly", blockId: hammock.id, detail: { anchorId: anchor.id } });
        continue;
      }
      validAnchors.push(anchor);
    }
    if (validAnchors.length === 0) continue;

    const starts = validAnchors
      .filter((anchor) => anchor.anchor_role === "start" || anchor.anchor_role === "both")
      .map((anchor) => ({ id: anchor.anchor_block_id, date: forwardResults.get(anchor.anchor_block_id).earlyStart }));
    const finishes = validAnchors
      .filter((anchor) => anchor.anchor_role === "finish" || anchor.anchor_role === "both")
      .map((anchor) => forwardResults.get(anchor.anchor_block_id).earlyFinish);

    if (starts.length === 0 || finishes.length === 0) continue;

    const earlyStartEntry = starts.reduce((min, entry) => (entry.date < min.date ? entry : min));
    const earlyStart = earlyStartEntry.date;
    const earlyFinish = finishes.reduce((max, date) => (date > max ? date : max));

    const anchorFloats = validAnchors.map((anchor) => floatByBlockId.get(anchor.anchor_block_id)).filter((value) => value != null);
    const totalFloatDays = anchorFloats.length > 0 ? Math.min(...anchorFloats) : 0;

    const tieBreakBlock = blocksById.get(earlyStartEntry.id);
    const calendar = resolveCalendarForBlock(tieBreakBlock, { calendarsById, lanesById, project });
    const holidaySet = holidaysByCalendarId.get(calendar.id) || new Set();
    const lateStart = stepWorkingDays(calendar, holidaySet, earlyStart, totalFloatDays);
    const lateFinish = stepWorkingDays(calendar, holidaySet, earlyFinish, totalFloatDays);

    results.set(hammock.id, Object.freeze({ earlyStart, earlyFinish, lateStart, lateFinish, totalFloatDays }));
  }

  return Object.freeze({ resultsById: Object.freeze(results), anomalies: Object.freeze(anomalies) });
}

// --- Conflict detection ------------------------------------------------------------------------

export function detectConflicts({ blocks, cyclicBlockIds, danglingDependencies, hammockDependencies, forwardResults, hammockAnomalies }) {
  const conflicts = [];
  const blocksById = new Map(blocks.map((block) => [block.id, block]));

  if (cyclicBlockIds.size > 0) {
    conflicts.push({ type: "cycle", blockIds: [...cyclicBlockIds], message: "A dependency cycle excludes these blocks from CPM computation." });
  }
  for (const dependency of danglingDependencies) {
    conflicts.push({ type: "dependency_out_of_scope", dependencyId: dependency.id, message: "This dependency references a block outside the blocks passed to this run." });
  }
  for (const dependency of hammockDependencies) {
    conflicts.push({ type: "hammock_in_dependency_graph", dependencyId: dependency.id, message: "A hammock block cannot participate in a predecessor/successor dependency." });
  }
  for (const anomaly of hammockAnomalies) {
    conflicts.push(anomaly);
  }

  for (const [blockId, record] of forwardResults) {
    const block = blocksById.get(blockId);
    if (!block?.constraint_type || !HARD_OR_DEADLINE_CONSTRAINT_TYPES.includes(block.constraint_type)) continue;
    const dependencyDate = block.constraint_type === "must_finish_on" || block.constraint_type === "FNLT"
      ? record.dependencyOnlyEarlyFinish
      : record.dependencyOnlyEarlyStart;
    if (dependencyDate != null && dependencyDate > block.constraint_date) {
      conflicts.push({
        type: "constraint_conflict",
        blockId,
        constraintType: block.constraint_type,
        constraintDate: block.constraint_date,
        computedDate: dependencyDate,
        message: "The dependency network alone would produce a later date than this constraint allows.",
      });
    }
  }

  return Object.freeze(conflicts.map((conflict) => Object.freeze(conflict)));
}

// --- Orchestrator ------------------------------------------------------------------------------

export function runCpmEngine({ project, blocks = [], dependencies = [], calendars = [], holidays = [], hammockAnchors = [], lanes = [] }) {
  const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
  const lanesById = new Map(lanes.map((lane) => [lane.id, lane]));
  const holidaysByCalendarId = new Map();
  for (const holiday of holidays) {
    if (!holidaysByCalendarId.has(holiday.calendar_id)) holidaysByCalendarId.set(holiday.calendar_id, new Set());
    holidaysByCalendarId.get(holiday.calendar_id).add(holiday.holiday_date);
  }

  const { order, cyclicBlockIds, validDependencies, danglingDependencies, hammockDependencies } = topologicalOrder(blocks, dependencies);

  const forwardResults = forwardPass({ blocks, order, cyclicBlockIds, validDependencies, calendarsById, holidaysByCalendarId, lanesById, project });
  const backwardResultsRaw = backwardPass({ blocks, order, cyclicBlockIds, validDependencies, calendarsById, holidaysByCalendarId, lanesById, project, forwardResults });

  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const finalForwardResults = applyAlapOverrides(forwardResults, backwardResultsRaw, blocksById);

  const { floatByBlockId, criticalityById } = computeFloatAndCriticality(finalForwardResults, backwardResultsRaw, calendarsById, holidaysByCalendarId, lanesById, blocksById, project);

  const { resultsById: hammockResults, anomalies: hammockAnomalies } = resolveHammocks({
    blocks, hammockAnchors, forwardResults: finalForwardResults, floatByBlockId, calendarsById, holidaysByCalendarId, lanesById, project,
  });

  const conflicts = detectConflicts({
    blocks, cyclicBlockIds, danglingDependencies, hammockDependencies, forwardResults: finalForwardResults, hammockAnomalies,
  });

  const outputBlocks = blocks.map((block) => {
    if (block.block_type === "hammock") {
      const hammockResult = hammockResults.get(block.id);
      return Object.freeze({
        ...block,
        early_start: hammockResult?.earlyStart ?? null,
        early_finish: hammockResult?.earlyFinish ?? null,
        late_start: hammockResult?.lateStart ?? null,
        late_finish: hammockResult?.lateFinish ?? null,
        total_float_days: hammockResult?.totalFloatDays ?? null,
        is_critical: hammockResult ? hammockResult.totalFloatDays <= 0 : false,
      });
    }
    const forwardRecord = finalForwardResults.get(block.id);
    const backwardRecord = backwardResultsRaw.get(block.id);
    const totalFloatDays = floatByBlockId.get(block.id) ?? null;
    return Object.freeze({
      ...block,
      early_start: forwardRecord?.earlyStart ?? null,
      early_finish: forwardRecord?.earlyFinish ?? null,
      late_start: backwardRecord?.lateStart ?? null,
      late_finish: backwardRecord?.lateFinish ?? null,
      total_float_days: totalFloatDays,
      is_critical: criticalityById.get(block.id) ?? false,
    });
  });

  return Object.freeze({ blocks: Object.freeze(outputBlocks), conflicts });
}
