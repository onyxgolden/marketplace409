/**
 * Normalized-snapshot → scheduler-network mapping (P2b-1).
 *
 * This is the NEW assessment entrypoint the P2b brief (§7) requires:
 * it adapts admitted snapshot rows to the Scheduler prototype's
 * reviewed pure math WITHOUT widening the prototype's fixture-only
 * resolver to accept live-shaped records. The prototype's
 * analyzeComponent (imported, single-sourced, never copied) runs
 * unchanged over the adapted network; only its input construction
 * lives here.
 *
 * MAPPING CONTRACT — every rule below is hand-derived from the
 * inspected application contract (schedulingCpmEngine.js at base
 * d615c34) and the prototype's tick contract, and each adaptation
 * has a parity fixture proving it (or proving why it does NOT map):
 *
 * 1. POPULATION. A relational block enters the CPM network iff it
 *    is a real Gantt block: lane_id set and block_type != hammock
 *    (the app's selectGanttBlocks rule). Hammocks are explicit
 *    exclusions (never graph nodes, never anchor-resolved here —
 *    the app's hammock resolution is a different computation and
 *    P2b-1 does not claim it). WBS-only blocks (lane null) are
 *    outside the CPM population: listed in inventory, never math.
 *    A block with NEITHER axis violates the schema check and is an
 *    integrity finding.
 * 2. CALENDAR PRECEDENCE (from the app's resolveCalendarForBlock):
 *    block.calendar_id → lane.calendar_id →
 *    project.default_calendar_id. DIVERGENCE, named: the app falls
 *    back to a synthetic 7-day calendar when nothing resolves; P2b-1
 *    does NOT adopt any fallback (brief: no invented default) — an
 *    unresolvable calendar is a MISSING_CALENDAR finding and the
 *    component is UNVERIFIABLE. A calendar whose working_days mask
 *    is missing/invalid is likewise unusable, never defaulted.
 *    Weekday convention: source 0=Sun..6=Sat → prototype ISO
 *    1=Mon..7=Sun (0→7, else identity). Excluded dates per
 *    calendar = its holidays ∪ every project blackout window's
 *    dates (blackouts black out every calendar at once, per the
 *    app; expansion capped at 3660 days per window, as the app).
 * 3. DURATION PARITY (exact). duration_days IS working days in
 *    the app ("duration_days represents work being performed, which
 *    only progresses on working days") and duration_workdays IS
 *    working days in the prototype: duration_days →
 *    duration_workdays by identity. Milestones are duration 0
 *    (schema-enforced); a non-zero milestone is a finding and is
 *    excluded, never clamped.
 * 4. LAG NON-PARITY (the reason nonzero lag is NOT_MODELED). The
 *    app applies lag in CALENDAR days ("lag represents elapsed
 *    real-world waiting time"), then rolls to a working day; the
 *    prototype's lag_workdays is WORKING-day ticks. A calendar-day
 *    lag has no constant working-day equivalent (it depends on the
 *    weekends/holidays inside the lag window, which depend on dates
 *    the computation itself produces), so ties with lag_days != 0
 *    are excluded from the math and reported as NOT_MODELED ties;
 *    their components are QUALIFIED, never exact. Lag 0 maps
 *    exactly for all four types (parity fixture proves FS/SS/FF/SF).
 *    |lag_days| > 366 exceeds the prototype bound and is likewise
 *    NOT_MODELED.
 * 5. CONSTRAINT MAPPING (civil date → tick on the component
 *    calendar; the tick is the index of the rolled working day):
 *    - SNET / start_on → START_NO_EARLIER_THAN (tick of the
 *      forward-rolled date). Exact: a lower bound on start.
 *    - FNET / finish_on → START_NO_EARLIER_THAN with the
 *      ES-equivalent tick (step the rolled date back duration-1
 *      working steps — the app's own esEquivalent conversion).
 *      Exact for fixed durations.
 *    - FNLT → FINISH_NO_LATER_THAN (tick of the NEXT working day
 *      after the backward-rolled date — the prototype's LF is a
 *      boundary tick, the app's LF is the last occupied day).
 *    - must_finish_on → MUST_FINISH_ON (same boundary tick;
 *      the prototype pins both bounds, matching the app's hard
 *      finish override).
 *    - ALAP → ALAP (prototype math-inert; DIVERGENCE: the app's
 *      ALAP post-process override — reported early dates shifted
 *      to late dates — is NOT replicated; P2b-1 reports the
 *      prototype's dates and names the divergence).
 *    - ASAP → no constraint.
 *    - must_start_on → UNSUPPORTED (the prototype has no hard
 *      start override; a lower bound would understate it and
 *      silently drop the app's conflict semantics). Effect:
 *      the activity AND all its transitive successors have all
 *      computed dates withheld (their forward dates depend on the
 *      override, not on dependency math).
 *    - SNLT → UNSUPPORTED (no start-no-later kind in the
 *      prototype). Effect: the activity AND all its transitive
 *      predecessors have ls/lf/float/critical withheld (their
 *      late dates depend on the missing upper bound); es/ef stay
 *      exact (SNLT affects only the backward pass).
 *    - A constraint date that cannot be converted to a tick inside
 *      [anchor, anchor+366) is UNSUPPORTED_HORIZON with the same
 *      withhold effects as its kind.
 *    - Unknown constraint_type values are UNSUPPORTED findings.
 * 6. ANCHOR. Every component anchors at the project start_date
 *    (the app's default ES for predecessor-less blocks, rolled to
 *    a working day — which is exactly the prototype's tick 0, the
 *    first working day in [anchor, anchor+horizon)). Declared
 *    block start_dates are NOT anchors and NOT release ticks (the
 *    app's CPM ignores declared starts entirely); they are reported
 *    as declared values for the declared-vs-computed comparison
 *    and never move a block. A missing/invalid project start_date
 *    means no math at all (anchor finding).
 * 7. DEADLINE. None. The prototype runs with deadlineTick null
 *    (implicit maxEF). DIVERGENCE, named: the app's backward pass
 *    defaults to project end_date, but the brief (§7.3) forbids
 *    interpreting a generic project end_date as a mandatory
 *    deadline — P2b-1's late dates are maxEF-relative and labeled
 *    computed, never a promised finish. Criticality is the
 *    prototype's zero-float rule, NOT the app's graph-minimum-float
 *    rule (second named divergence).
 * 8. HORIZON. 366 civil days (the prototype's ABS_TICK_LIMIT).
 *    Dates beyond it are CALENDAR_HORIZON_EXCEEDED, never guessed.
 * 9. CYCLES / DANGLING / MIXED CALENDARS. The prototype fails
 *    the whole component (CYCLE_DETECTED / DANGLING_TIE /
 *    UNSUPPORTED_CALENDAR) and the assessment exposes no computed
 *    dates for it. DIVERGENCE, named: the app computes the rest of
 *    the graph around cycles/dangling ties; P2b-1 follows the
 *    prototype's all-or-nothing contract (brief §7.4: a
 *    cyclic/incomplete graph cannot yield a feasible COMPLETE
 *    critical path). Every finding is still inventoried.
 * 10. TIE SCOPE. The adapter serves ties touching the admitted
 *     project's blocks in BOTH directions (the app's assembly only
 *     fetches by predecessor, missing successor-side ties). A tie
 *     with one endpoint in the admitted set and one outside is a
 *     DANGLING/CROSS_SCOPE finding attached to the known
 *     endpoint's component (which then fails, per rule 9). A tie
 *     with NEITHER endpoint admitted is a scope finding and is
 *     dropped, never used.
 */

import {
  analyzeComponent, workingDays as prototypeWorkingDays,
} from "../../../../scripts/ai-agents/scheduler-prototype/src/scheduler.js";
import {
  addCivilDays, isCivilDate, isoWeekdayOf, PLANNING_DATASETS,
} from "./fieldMappings.js";

export const MATH_HORIZON_DAYS = 366;
export const BLACKOUT_EXPAND_CAP = 3660;

/** Source weekday (0=Sun..6=Sat) → prototype ISO weekday (1=Mon..7=Sun). */
export function appDayToIso(d) {
  return d === 0 ? 7 : d;
}

/** Roll a civil date forward to the next working day in `workingSet` (bounded scan). */
function rollForward(date, workingSet, horizonEnd) {
  let cur = date;
  let guard = 0;
  while (!workingSet.has(cur)) {
    if (cur > horizonEnd || guard > MATH_HORIZON_DAYS + 366) return null;
    cur = addCivilDays(cur, 1);
    guard += 1;
  }
  return cur;
}

/** Roll a civil date backward to the previous working day in `workingSet` (bounded scan). */
function rollBackward(date, workingSet, horizonStart) {
  let cur = date;
  let guard = 0;
  while (!workingSet.has(cur)) {
    if (cur < horizonStart || guard > MATH_HORIZON_DAYS + 366) return null;
    cur = addCivilDays(cur, -1);
    guard += 1;
  }
  return cur;
}

/** Step `count` working days from a working day, using the ordered working list. Returns null when out of range. */
function stepOnList(workingList, fromDate, count) {
  const idx = workingList.indexOf(fromDate);
  if (idx < 0) return null;
  const target = idx + count;
  if (target < 0 || target >= workingList.length) return null;
  return workingList[target];
}

/** Expand blackout windows into a date set (capped per window, as the app caps). */
export function expandBlackouts(windows) {
  const dates = new Set();
  for (const w of windows) {
    if (!isCivilDate(w.start_date) || !isCivilDate(w.end_date)) continue;
    let cur = w.start_date;
    let guard = 0;
    while (cur <= w.end_date && guard < BLACKOUT_EXPAND_CAP) {
      dates.add(cur);
      cur = addCivilDays(cur, 1);
      guard += 1;
    }
  }
  return dates;
}

/**
 * Resolve a block's calendar by the app's precedence:
 * block → lane → project default. Returns { calendar, reason } with
 * calendar null when unresolvable (no fallback — see rule 2).
 * A calendar with a missing/invalid working_days mask is unusable.
 */
export function resolveCalendarForBlock(block, { calendarsById, lanesById, project }) {
  const tryRef = (ref) => {
    if (!ref) return null;
    const cal = calendarsById.get(ref);
    if (!cal) return null;
    if (!Array.isArray(cal.working_days)) return { unusable: true, ref };
    return cal;
  };
  const fromBlock = tryRef(block.calendar_ref);
  if (fromBlock) {
    if (fromBlock.unusable) return { calendar: null, reason: "CALENDAR_MASK_INVALID", ref: fromBlock.ref };
    return { calendar: fromBlock, reason: null };
  }
  const lane = block.lane_ref ? lanesById.get(block.lane_ref) : null;
  const fromLane = lane ? tryRef(lane.calendar_ref) : null;
  if (fromLane) {
    if (fromLane.unusable) return { calendar: null, reason: "CALENDAR_MASK_INVALID", ref: fromLane.ref };
    return { calendar: fromLane, reason: null };
  }
  const fromProject = project ? tryRef(project.default_calendar_ref) : null;
  if (fromProject) {
    if (fromProject.unusable) return { calendar: null, reason: "CALENDAR_MASK_INVALID", ref: fromProject.ref };
    return { calendar: fromProject, reason: null };
  }
  return { calendar: null, reason: "MISSING_CALENDAR", ref: null };
}

function evidenceFor(dataset, recordRef) {
  return [{ dataset, record_ref: recordRef }];
}

/**
 * Build the scheduler network from an admitted snapshot.
 * Returns { project, anchor, components, inventory, findings }.
 * Findings are flat integrity rows: { kind, dataset, record_ref,
 * detail, evidence }. Components carry the prototype result plus
 * P2b-1 conclusion/withhold post-processing (rules 5, 9).
 */
export function buildNetwork(snapshot, { horizonDays = MATH_HORIZON_DAYS } = {}) {
  const findings = [];
  const find = (kind, dataset, recordRef, detail, evidence) =>
    findings.push({ kind, dataset, record_ref: recordRef, detail, evidence: evidence ?? evidenceFor(dataset, recordRef) });

  const records = snapshot.records ?? {};
  const projects = records.schedule_projects ?? [];
  const calendars = records.schedule_calendars ?? [];
  const lanes = records.schedule_lanes ?? [];
  const blocks = records.schedule_blocks ?? [];
  const dependencies = records.schedule_dependencies ?? [];
  const holidays = records.schedule_calendar_holidays ?? [];
  const blackouts = records.schedule_blackout_windows ?? [];

  // P676-001: dataset coverage/consistency gates conclusion
  // eligibility. A dataset whose collection did not complete
  // (failed page, unattested expected total, revision conflict)
  // leaves its population incomplete, and no conclusion drawn
  // from it may publish READY. P676-001A/003A: a dataset that
  // completed collection but carries invalid projected fields is
  // NOT usable either — the invalid value is undefined in the
  // admitted row, so an invalid calendar exclusion is ABSENT from
  // the exclusion set, and dates computed without it are not
  // all-clear. The gate therefore reads usable (complete AND no
  // FIELD_INVALID), never the completeness booleans alone. When
  // the snapshot carries no per-dataset facts at all but is
  // PARTIAL, coverage is unknown and is treated as incomplete
  // (fail-closed). A complete population with a merely stale or
  // duplicate-conflicted snapshot keeps its conclusions —
  // staleness and first-wins conflicts are diagnosed, not
  // coverage gaps.
  const datasetFacts = snapshot.datasets ?? {};
  const incompleteDatasets = PLANNING_DATASETS.filter((ds) => {
    const facts = datasetFacts[ds];
    if (facts) return facts.complete !== true;
    return snapshot.consistency === "PARTIAL";
  });
  const unusableDatasets = PLANNING_DATASETS.filter((ds) => {
    const facts = datasetFacts[ds];
    // usable === false is the only unusable signal; a missing
    // usable field (hand-built snapshots in older tests) is
    // treated as usable, exactly as before this gate existed.
    return facts ? facts.usable === false : false;
  });
  const coverageQualification = incompleteDatasets.length > 0
    ? `incomplete coverage: ${[...incompleteDatasets].sort().join(", ")} — conclusions from incomplete populations are qualified, never all-clear`
    : null;
  const unusableQualification = unusableDatasets.length > 0
    ? `unusable input: ${[...unusableDatasets].sort().join(", ")} — invalid projected fields make the admitted population unusable as a basis; conclusions from it are qualified, never all-clear`
    : null;

  const calendarsById = new Map(calendars.map((c) => [c.calendar_ref, c]));
  const lanesById = new Map(lanes.map((l) => [l.lane_ref, l]));
  const blocksById = new Map(blocks.map((b) => [b.block_ref, b]));

  const project = projects.length === 1 ? projects[0] : null;
  if (projects.length === 0) {
    find("PROJECT_MISSING", "schedule_projects", snapshot.project_scope_ref?.id ?? "scope",
      "no admitted project row for the requested scope; no math is possible", []);
    return { project: null, anchor: null, components: [], inventory: emptyInventory(), findings };
  }
  if (projects.length > 1) {
    find("PROJECT_AMBIGUOUS", "schedule_projects", project?.project_ref ?? "scope",
      `${projects.length} admitted project rows for one scope; refusing math`, []);
    return { project: null, anchor: null, components: [], inventory: emptyInventory(), findings };
  }
  const anchor = isCivilDate(project.start_date) ? project.start_date : null;
  if (!anchor) {
    find("ANCHOR_MISSING", "schedule_projects", project.project_ref,
      "project start_date is missing or not a real civil date; components need an explicit anchor");
    return { project, anchor: null, components: [], inventory: emptyInventory(), findings };
  }
  const horizonEnd = addCivilDays(anchor, horizonDays);

  const blackoutDates = expandBlackouts(blackouts);
  const holidaysByCalendar = new Map();
  for (const h of holidays) {
    if (!isCivilDate(h.holiday_date)) {
      find("INVALID_HOLIDAY_DATE", "schedule_calendar_holidays", h.holiday_ref,
        `holiday_date '${String(h.holiday_date)}' is not a real civil date; ignored`);
      continue;
    }
    if (!holidaysByCalendar.has(h.calendar_ref)) holidaysByCalendar.set(h.calendar_ref, new Set());
    holidaysByCalendar.get(h.calendar_ref).add(h.holiday_date);
  }

  // --- population (rule 1) ---
  const activities = new Map(); // block_ref -> adapted activity
  const inventory = emptyInventory();
  inventory.projects = 1;
  inventory.calendars = calendars.length;
  inventory.lanes = lanes.length;
  inventory.blocks_total = blocks.length;
  inventory.dependencies_total = dependencies.length;
  for (const b of blocks) {
    if (b.block_type === "hammock") {
      inventory.hammocks += 1;
      find("HAMMOCK_EXCLUDED", "schedule_blocks", b.block_ref,
        "hammock blocks never enter the dependency graph; their dates are anchor-derived in the app, not recomputed here");
      continue;
    }
    if (b.lane_ref === undefined || b.lane_ref === null) {
      if (b.wbs_node_ref !== undefined && b.wbs_node_ref !== null) {
        inventory.wbs_only += 1;
        continue; // WBS-only: inventoried, not math (rule 1)
      }
      inventory.neither_axis += 1;
      find("BLOCK_NEITHER_AXIS", "schedule_blocks", b.block_ref,
        "block has neither lane nor WBS axis; the schema requires at least one; excluded from the network");
      continue;
    }
    if (b.block_type !== "task" && b.block_type !== "milestone") {
      inventory.unsupported_type += 1;
      find("UNSUPPORTED_BLOCK_TYPE", "schedule_blocks", b.block_ref,
        `block_type '${String(b.block_type)}' is not task/milestone/hammock; excluded, never approximated`);
      continue;
    }
    if (!Number.isInteger(b.duration_days) || b.duration_days < 0) {
      inventory.missing_duration += 1;
      find("MISSING_DURATION", "schedule_blocks", b.block_ref,
        `duration_days '${String(b.duration_days)}' is not a non-negative integer; excluded, never defaulted to 0`);
      continue;
    }
    if (b.block_type === "milestone" && b.duration_days !== 0) {
      inventory.milestone_duration += 1;
      find("MILESTONE_NONZERO_DURATION", "schedule_blocks", b.block_ref,
        `milestone with duration_days ${b.duration_days}; the schema requires 0; excluded, never clamped`);
      continue;
    }
    activities.set(b.block_ref, {
      id: b.block_ref,
      duration_workdays: b.duration_days,
      release_tick: 0,
      block: b,
    });
    inventory.gantt += 1;
  }

  // --- ties (rules 4, 10) ---
  const supportedTies = [];
  const tieById = new Map();
  const danglingByActivity = new Map(); // activity id -> [tie] (known-endpoint dangling ties)
  for (const d of dependencies) {
    const pred = activities.get(d.predecessor_ref);
    const succ = activities.get(d.successor_ref);
    const predBlock = blocksById.get(d.predecessor_ref);
    const succBlock = blocksById.get(d.successor_ref);
    if (!pred && !succ) {
      find("TIE_OUT_OF_SCOPE", "schedule_dependencies", d.dependency_ref,
        "tie touches no admitted activity; dropped, never used for math",
        [ { dataset: "schedule_dependencies", record_ref: d.dependency_ref } ]);
      inventory.ties_out_of_scope += 1;
      continue;
    }
    if (predBlock?.block_type === "hammock" || succBlock?.block_type === "hammock") {
      inventory.ties_hammock += 1;
      find("HAMMOCK_TIE", "schedule_dependencies", d.dependency_ref,
        "a hammock block cannot participate in a predecessor/successor dependency; excluded from the graph");
      continue;
    }
    if (!pred || !succ) {
      inventory.ties_dangling += 1;
      const known = pred ?? succ;
      const missingRef = pred ? d.successor_ref : d.predecessor_ref;
      const missingBlock = blocksById.get(missingRef);
      const kind = missingBlock
        ? (missingBlock.lane_ref === undefined || missingBlock.lane_ref === null ? "TIE_CROSS_SCOPE_WBS" : "TIE_DANGLING")
        : "TIE_DANGLING";
      find(kind, "schedule_dependencies", d.dependency_ref,
        `tie references ${pred ? "successor" : "predecessor"} '${missingRef}' outside the admitted Gantt population; the known endpoint's component cannot yield a feasible complete critical path`);
      if (!danglingByActivity.has(known.id)) danglingByActivity.set(known.id, []);
      danglingByActivity.get(known.id).push(d);
      continue;
    }
    if (!["FS", "SS", "FF", "SF"].includes(d.relationship_type)) {
      inventory.ties_unsupported_type += 1;
      find("UNSUPPORTED_TIE_TYPE", "schedule_dependencies", d.dependency_ref,
        `relationship_type '${String(d.relationship_type)}' is not FS/SS/FF/SF; excluded, never reinterpreted`);
      // P676-002: an unsupported both-endpoint tie IS conclusion-
      // affecting — it joins the component's qualification set
      // (supported: false with its reason), never silently a
      // non-edge. Withholding is applied per component below.
      tieById.set(d.dependency_ref, { ...d, supported: false, reason: "UNSUPPORTED_TIE_TYPE" });
      continue;
    }
    if (!Number.isInteger(d.lag_days) || d.lag_days !== 0) {
      inventory.ties_nonzero_lag += 1;
      find("NONZERO_LAG_NOT_MODELED", "schedule_dependencies", d.dependency_ref,
        `lag_days ${String(d.lag_days)} uses the app's calendar-day clock, not the prototype's working-day clock; no constant working-day equivalent exists, so the tie is excluded and its component is QUALIFIED, never exact`);
      // Still joins the component (rule: connectivity), but not the math.
      tieById.set(d.dependency_ref, { ...d, supported: false });
      continue;
    }
    const tie = {
      id: d.dependency_ref, predecessor: d.predecessor_ref, successor: d.successor_ref,
      type: d.relationship_type, lag_workdays: 0, source: d,
    };
    supportedTies.push(tie);
    tieById.set(d.dependency_ref, { ...d, supported: true });
  }
  inventory.ties_supported = supportedTies.length;

  // --- components (union-find over all both-endpoint Gantt ties) ---
  const parent = new Map([...activities.keys()].map((id) => [id, id]));
  const findRoot = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const nxt = parent.get(x); parent.set(x, r); x = nxt; }
    return r;
  };
  const union = (a, b) => { parent.set(findRoot(a), findRoot(b)); };
  for (const d of dependencies) {
    if (activities.has(d.predecessor_ref) && activities.has(d.successor_ref)) union(d.predecessor_ref, d.successor_ref);
  }
  const componentMembers = new Map();
  for (const id of activities.keys()) {
    const root = findRoot(id);
    if (!componentMembers.has(root)) componentMembers.set(root, []);
    componentMembers.get(root).push(id);
  }
  // Deterministic component ids: smallest member id, sorted.
  const componentList = [...componentMembers.values()]
    .map((members) => members.sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const components = [];
  for (const members of componentList) {
    const componentId = `comp-${members[0]}`;
    const memberSet = new Set(members);
    const compTies = supportedTies.filter((t) => memberSet.has(t.predecessor) && memberSet.has(t.successor));
    const compDangling = [];
    for (const m of members) for (const d of danglingByActivity.get(m) ?? []) compDangling.push(d);
    const compNonzeroLag = dependencies.filter((d) =>
      memberSet.has(d.predecessor_ref) && memberSet.has(d.successor_ref)
      && tieById.get(d.dependency_ref)?.supported === false
      && tieById.get(d.dependency_ref)?.reason !== "UNSUPPORTED_TIE_TYPE");
    // P676-002: unsupported-type ties are their own conclusion-
    // affecting set — never folded into the nonzero-lag label.
    const compUnsupportedType = dependencies.filter((d) =>
      memberSet.has(d.predecessor_ref) && memberSet.has(d.successor_ref)
      && tieById.get(d.dependency_ref)?.supported === false
      && tieById.get(d.dependency_ref)?.reason === "UNSUPPORTED_TIE_TYPE");

    // Calendar resolution per member (rule 2).
    const resolved = new Map(); // activity id -> { calendar, reason, ref }
    for (const m of members) {
      resolved.set(m, resolveCalendarForBlock(activities.get(m).block, { calendarsById, lanesById, project }));
    }
    const calendarRefs = [...new Set([...resolved.values()].filter((r) => r.calendar).map((r) => r.calendar.calendar_ref))];
    const missingCal = [...resolved.values()].some((r) => !r.calendar);

    const qualifications = [];
    if (compNonzeroLag.length > 0) qualifications.push(`nonzero-lag ties excluded from math: ${compNonzeroLag.map((d) => d.dependency_ref).sort().join(", ")}`);
    if (compDangling.length > 0) qualifications.push(`dangling/cross-scope ties: ${compDangling.map((d) => d.dependency_ref).sort().join(", ")}`);
    if (compUnsupportedType.length > 0) qualifications.push(`unsupported relationship types excluded from math: ${compUnsupportedType.map((d) => d.dependency_ref).sort().join(", ")}`);
    // P676-001: incomplete coverage qualifies every conclusion
    // drawn from it — a READY below degrades to QUALIFIED via
    // qualifications.length, and NOT_MODELED rows carry the note.
    if (coverageQualification) qualifications.push(coverageQualification);
    // P676-001A/003A: unusable input qualifies the same way.
    // Qualifying the component automatically qualifies its
    // lookahead rows, because their computed_conclusion is the
    // component's conclusion (schedulerAssessment).
    if (unusableQualification) qualifications.push(unusableQualification);

    if (missingCal) {
      for (const m of members) {
        const r = resolved.get(m);
        if (!r.calendar) {
          find("MISSING_CALENDAR", "schedule_blocks", m,
            `no resolvable calendar (block → lane → project default); reason ${r.reason}; no fallback calendar is invented, so the component is UNVERIFIABLE`);
        }
      }
      components.push({
        component_id: componentId, activity_ids: members, calendar_ref: null,
        anchor_date: anchor, horizon_days: horizonDays, conclusion: "NOT_MODELED",
        prototype_status: "UNVERIFIABLE", prototype_reason: "a member activity has no resolvable calendar",
        working_days_count: 0, activities: [], edges: [], critical_subgraph: { activities: [], edges: [] },
        qualifications, withheld: {},
      });
      continue;
    }
    if (calendarRefs.length > 1) {
      find("MIXED_CALENDARS", "schedule_blocks", members[0],
        `component resolves to ${calendarRefs.length} distinct calendars (${calendarRefs.sort().join(", ")}); the prototype takes exactly one calendar per component, so the component is NOT_MODELED`,
        members.map((m) => ({ dataset: "schedule_blocks", record_ref: m })));
      components.push({
        component_id: componentId, activity_ids: members, calendar_ref: null,
        anchor_date: anchor, horizon_days: horizonDays, conclusion: "NOT_MODELED",
        prototype_status: "UNSUPPORTED_CALENDAR", prototype_reason: "mixed calendars within one component are not converted or approximated",
        working_days_count: 0, activities: [], edges: [], critical_subgraph: { activities: [], edges: [] },
        qualifications, withheld: {},
      });
      continue;
    }
    const calendar = calendarsById.get(calendarRefs[0]);
    const isoWeekdays = [...new Set(calendar.working_days.map(appDayToIso))].sort((a, b) => a - b);
    const excluded = new Set([...(holidaysByCalendar.get(calendar.calendar_ref) ?? []), ...blackoutDates]);
    const workingList = prototypeWorkingDays(anchor, horizonDays, isoWeekdays, excluded);
    const workingSet = new Set(workingList);

    // Constraint conversion (rule 5).
    const constraints = [];
    const withholdAll = new Set(); // must_start_on: activity + transitive successors
    const withholdLate = new Set(); // SNLT: activity + transitive predecessors
    const succEdges = new Map(members.map((m) => [m, []]));
    const predEdges = new Map(members.map((m) => [m, []]));
    for (const t of compTies) { succEdges.get(t.predecessor).push(t.successor); predEdges.get(t.successor).push(t.predecessor); }
    const closure = (seeds, edges) => {
      const out = new Set(seeds);
      const stack = [...seeds];
      while (stack.length > 0) {
        const cur = stack.pop();
        for (const nxt of edges.get(cur) ?? []) if (!out.has(nxt)) { out.add(nxt); stack.push(nxt); }
      }
      return out;
    };
    for (const m of members) {
      const b = activities.get(m).block;
      if (!b.constraint_type || b.constraint_type === "ASAP") continue; // ASAP carries no bound
      const ct = b.constraint_type;
      const date = b.constraint_date;
      const conv = convertConstraint({ ct, date, activity: activities.get(m), workingList, workingSet, anchor, horizonEnd });
      if (conv.unsupported) {
        find(conv.kind, "schedule_blocks", m, conv.detail);
        // Withhold routing (rule 5): forward-affecting bounds
        // (lower bounds, hard starts, horizon-unconvertible lowers)
        // withhold the activity and its transitive successors;
        // backward-only bounds (SNLT, horizon-unconvertible uppers)
        // withhold late fields for the activity and its transitive
        // predecessors. Withholding is fail-closed: it never yields
        // a date the missing bound could contradict.
        if (ct === "must_start_on") {
          for (const x of closure([m], succEdges)) withholdAll.add(x);
        } else if (ct === "SNLT") {
          for (const x of closure([m], predEdges)) withholdLate.add(x);
        } else if (conv.kind === "UNSUPPORTED_CONSTRAINT_HORIZON") {
          if (ct === "SNET" || ct === "start_on" || ct === "FNET" || ct === "finish_on") {
            for (const x of closure([m], succEdges)) withholdAll.add(x);
          } else {
            for (const x of closure([m], predEdges)) withholdLate.add(x);
          }
        }
        continue;
      }
      constraints.push(conv.constraint);
    }

    // P676-002: an unsupported relationship type could change
    // EVERY computed date in its component (FS vs SS vs FF vs SF
    // change all forward/backward math), so the whole component's
    // computed fields are withheld — QUALIFIED with nothing
    // computed-looking exposed. This differs from nonzero lag (a
    // known edge with an unconvertible magnitude, QUALIFIED with
    // dates shown): an unknown edge type is unknown structure,
    // not an unknown magnitude.
    let unsupportedWithholdReason = null;
    if (compUnsupportedType.length > 0) {
      unsupportedWithholdReason = `all-computed-withheld: unsupported relationship type ${compUnsupportedType.map((d) => d.dependency_ref).sort().join(", ")} could change every computed date in this component; all computed fields withheld`;
      for (const m of members) withholdAll.add(m);
    }

    // Dangling ties fail the component in the prototype: pass a
    // synthetic tie record for each dangling tie so analyzeComponent
    // reports DANGLING_TIE (it checks endpoints against activities).
    const protoTies = [...compTies];
    for (const d of compDangling) {
      protoTies.push({
        id: d.dependency_ref, predecessor: d.predecessor_ref, successor: d.successor_ref,
        type: "FS", lag_workdays: 0,
      });
    }
    const protoActivities = members.map((m) => {
      const a = activities.get(m);
      return { id: a.id, duration_workdays: a.duration_workdays, release_tick: 0 };
    });
    const protoCalendars = [{ working_weekdays: isoWeekdays, excluded_dates: [...excluded].sort() }];
    const result = analyzeComponent({
      componentId, activities: protoActivities, ties: protoTies, calendars: protoCalendars,
      anchorDate: anchor, horizonDays, deadlineTick: null, constraints,
    });

    if (result.status !== "READY") {
      components.push({
        component_id: componentId, activity_ids: members, calendar_ref: calendar.calendar_ref,
        anchor_date: anchor, horizon_days: horizonDays, conclusion: "NOT_MODELED",
        prototype_status: result.status, prototype_reason: result.reason,
        prototype_detail: result.detail ?? null,
        working_days_count: workingList.length, activities: [], edges: [],
        critical_subgraph: { activities: [], edges: [] },
        qualifications, withheld: {},
      });
      continue;
    }
    // Post-process withhold sets (rule 5).
    const withheld = {};
    const outActivities = result.activities.map((row) => {
      if (withholdAll.has(row.id)) {
        withheld[row.id] = unsupportedWithholdReason ?? "all-computed-withheld: unsupported hard start constraint at or upstream of this activity";
        return { ...row, es: null, ef: null, ls: null, lf: null, total_float: null, critical: null,
          civil_start: null, civil_finish_boundary: null, withheld: withheld[row.id] };
      }
      if (withholdLate.has(row.id)) {
        withheld[row.id] = "late-withheld: unsupported start-no-later constraint at or downstream of this activity";
        return { ...row, ls: null, lf: null, total_float: null, critical: null, withheld: withheld[row.id] };
      }
      return row;
    });
    // P676-002A: withholding applies to EVERY computed edge result
    // in the report, not just the activities. An edge whose
    // endpoint activity is withholdAll was computed from the same
    // relaxed graph, so its weight, tight, critical AND driving
    // conclusions are withheld — publishing them would re-assert
    // the exact conclusions the activity withholding retracts.
    // Declared identity/type/lag_workdays are preserved (they are
    // source facts, not computations). An edge touching only a
    // withholdLate activity keeps its forward-derived weight and
    // tight (they depend on early dates only) but loses critical,
    // which depends on late dates and float. critical_subgraph
    // filtering below already excludes withheld members.
    const outEdges = result.edges.map((e) => {
      if (withholdAll.has(e.predecessor) || withholdAll.has(e.successor)) {
        return { ...e, weight: null, tight: null, critical: null, driving: null,
          withheld: "all-computed-withheld: an endpoint activity's computed fields are withheld, so this edge's computed values are withheld" };
      }
      if (withholdLate.has(e.predecessor) || withholdLate.has(e.successor)) {
        return { ...e, critical: null,
          withheld: "late-withheld: an endpoint activity's late dates are withheld, so this edge's criticality is withheld" };
      }
      return e;
    });
    const criticalActivities = result.critical_subgraph.activities.filter((id) => !withholdAll.has(id) && !withholdLate.has(id));
    const criticalEdges = result.critical_subgraph.edges.filter((tid) => {
      const t = compTies.find((x) => x.id === tid);
      return t && !withholdAll.has(t.predecessor) && !withholdAll.has(t.successor) && !withholdLate.has(t.predecessor) && !withholdLate.has(t.successor);
    });
    if (withholdAll.size > 0) qualifications.push(`computed dates withheld for ${[...withholdAll].sort().join(", ")} (unsupported hard start constraint upstream)`);
    if (withholdLate.size > 0) qualifications.push(`late dates/float/criticality withheld for ${[...withholdLate].sort().join(", ")} (unsupported start-no-later constraint downstream)`);
    components.push({
      component_id: componentId, activity_ids: members, calendar_ref: calendar.calendar_ref,
      anchor_date: anchor, horizon_days: horizonDays,
      conclusion: qualifications.length > 0 ? "QUALIFIED" : "READY",
      prototype_status: "READY", prototype_reason: null,
      working_days_count: workingList.length,
      activities: outActivities, edges: outEdges,
      critical_subgraph: { activities: criticalActivities, edges: criticalEdges },
      qualifications, withheld,
    });
  }

  return { project, anchor, components, inventory, findings };
}

function emptyInventory() {
  return {
    projects: 0, calendars: 0, lanes: 0, blocks_total: 0, dependencies_total: 0,
    gantt: 0, hammocks: 0, wbs_only: 0, neither_axis: 0, unsupported_type: 0,
    missing_duration: 0, milestone_duration: 0,
    ties_supported: 0, ties_hammock: 0, ties_dangling: 0, ties_unsupported_type: 0,
    ties_nonzero_lag: 0, ties_out_of_scope: 0,
  };
}

/**
 * Convert one source constraint to a prototype constraint (rule 5).
 * Returns { constraint } or { unsupported: true, kind, detail }.
 * Tick convention: the prototype's LF is a boundary tick (the working
 * day AFTER the last occupied day), while the app's LF is the last
 * occupied day — so upper-bound ticks point at the NEXT working day
 * after the rolled constraint date.
 */
function convertConstraint({ ct, date, activity, workingList, workingSet, anchor, horizonEnd }) {
  const d = activity.duration_workdays;
  if (!isCivilDate(date)) {
    return { unsupported: true, kind: "UNSUPPORTED_CONSTRAINT_DATE",
      detail: `constraint ${ct} has constraint_date '${String(date)}' that is not a real civil date; no bound is invented` };
  }
  if (ct === "SNET" || ct === "start_on") {
    const rolled = rollForward(date, workingSet, horizonEnd);
    if (!rolled) return { unsupported: true, kind: "UNSUPPORTED_CONSTRAINT_HORIZON",
      detail: `constraint ${ct} date ${date} rolls beyond the ${MATH_HORIZON_DAYS}-day horizon; no bound is invented` };
    return { constraint: { activity_id: activity.id, kind: "START_NO_EARLIER_THAN", tick: workingList.indexOf(rolled) } };
  }
  if (ct === "FNET" || ct === "finish_on") {
    const rolled = rollForward(date, workingSet, horizonEnd);
    if (!rolled) return { unsupported: true, kind: "UNSUPPORTED_CONSTRAINT_HORIZON",
      detail: `constraint ${ct} date ${date} rolls beyond the horizon; no bound is invented` };
    // Milestones: the ES-equivalent of a finish bound is the date
    // itself (the app's esEquivalent returns dateISO for milestones).
    const esDate = d === 0 ? rolled : stepOnList(workingList, rolled, -(d - 1));
    if (!esDate && d > 0) return { unsupported: true, kind: "UNSUPPORTED_CONSTRAINT_HORIZON",
      detail: `constraint ${ct} ES-equivalent steps beyond the horizon; no bound is invented` };
    return { constraint: { activity_id: activity.id, kind: "START_NO_EARLIER_THAN", tick: workingList.indexOf(esDate ?? rolled) } };
  }
  if (ct === "FNLT") {
    const rolled = rollBackward(date, workingSet, anchor);
    if (!rolled) return { unsupported: true, kind: "UNSUPPORTED_CONSTRAINT_HORIZON",
      detail: `constraint ${ct} date ${date} rolls before the anchor; no bound is invented` };
    const boundary = stepOnList(workingList, rolled, 1);
    if (!boundary) return { unsupported: true, kind: "UNSUPPORTED_CONSTRAINT_HORIZON",
      detail: `constraint ${ct} boundary tick is beyond the horizon; no bound is invented` };
    return { constraint: { activity_id: activity.id, kind: "FINISH_NO_LATER_THAN", tick: workingList.indexOf(boundary) } };
  }
  if (ct === "must_finish_on") {
    const rolled = rollForward(date, workingSet, horizonEnd);
    if (!rolled) return { unsupported: true, kind: "UNSUPPORTED_CONSTRAINT_HORIZON",
      detail: `constraint must_finish_on date ${date} rolls beyond the horizon; no bound is invented` };
    const boundary = stepOnList(workingList, rolled, 1);
    if (!boundary) return { unsupported: true, kind: "UNSUPPORTED_CONSTRAINT_HORIZON",
      detail: `constraint must_finish_on boundary tick is beyond the horizon; no bound is invented` };
    return { constraint: { activity_id: activity.id, kind: "MUST_FINISH_ON", tick: workingList.indexOf(boundary) } };
  }
  if (ct === "ALAP") {
    return { constraint: { activity_id: activity.id, kind: "ALAP", tick: 0 } };
  }
  if (ct === "must_start_on") {
    return { unsupported: true, kind: "UNSUPPORTED_CONSTRAINT",
      detail: "must_start_on is a hard start override; the prototype has no hard-start kind, so a lower bound would understate it and drop the app's conflict semantics — computed dates for this activity and its transitive successors are withheld" };
  }
  if (ct === "SNLT") {
    return { unsupported: true, kind: "UNSUPPORTED_CONSTRAINT",
      detail: "SNLT (start no later than) has no prototype kind; late dates, float and criticality for this activity and its transitive predecessors are withheld" };
  }
  return { unsupported: true, kind: "UNSUPPORTED_CONSTRAINT",
    detail: `constraint_type '${String(ct)}' is not a mapped constraint kind; no bound is invented` };
}
