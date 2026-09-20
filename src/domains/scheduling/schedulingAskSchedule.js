// Deterministic, read-only "Ask the Schedule" question engine.
//
// This module is the scheduling counterpart of the finance Brain's ask-the-books
// parser: a hand-built keyword parser over a fixed set of question types, with
// every answer computed from the CPM engine's output and baseline variance math.
// There is no LLM anywhere in this path -- an unrecognized question returns the
// supported-question list, never a guess.
//
// All functions are pure (no I/O, no mutation) and return Object.freeze'd data.

// Every question this engine can answer. The help/unknown path returns this list
// verbatim, and the UI renders it as preset question chips.
export const SUPPORTED_SCHEDULE_QUESTIONS = Object.freeze([
  Object.freeze({ id: "critical_path", label: "What is the critical path?", example: "What is the critical path?" }),
  Object.freeze({ id: "constraints", label: "Which activities have constraints?", example: "Which activities have constraints?" }),
  Object.freeze({ id: "float", label: "Which activities have the least float?", example: "Which activities have the least float?" }),
  Object.freeze({ id: "float_for", label: "What is the float for an activity?", example: "What is the float for Framing?" }),
  Object.freeze({ id: "late_milestones", label: "Which milestones are late?", example: "Which milestones are late?" }),
  Object.freeze({ id: "baseline_variance", label: "What changed since the baseline?", example: "What changed since the baseline?" }),
]);

const UNKNOWN_PARSE = Object.freeze({ type: "unknown" });

// Today's date in the project's operating timezone (America/Chicago), formatted
// as a date-only "YYYY-MM-DD" string so it compares correctly against the
// schedule's date-only fields. `new Date().toISOString().slice(0, 10)` is UTC --
// during the evening in Chicago that is already tomorrow, which would mark a
// milestone late a day early. The optional `now` parameter makes the boundary
// injectable for tests.
export function chicagoTodayISO(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// Parses a natural-language question into a question type. Deterministic keyword
// matching only -- "near critical" is deliberately routed to float (a near-
// critical activity is defined by low float, not by being on the critical path).
export function parseScheduleQuestion(question) {
  const text = String(question ?? "").trim().toLowerCase();
  if (!text) return UNKNOWN_PARSE;

  if (/\bwhat can you\b|\bwhat do you\b|\bhelp\b|\bexamples?\b/.test(text)) {
    return Object.freeze({ type: "help" });
  }
  if (/\bnear[- ]critical\b/.test(text)) return Object.freeze({ type: "float" });
  if (/\bbaseline\b|\bvariance\b|\bchanged\b|\bdrift/.test(text)) {
    return Object.freeze({ type: "baseline_variance" });
  }
  if (/\bmilestone/.test(text)) return Object.freeze({ type: "late_milestones" });
  if (/\bconstraint/.test(text)) return Object.freeze({ type: "constraints" });
  if (/\bfloat\b/.test(text)) {
    // "What is the float for Framing?" / "float of A1010" -- capture the activity
    // reference so the answer can target one activity instead of ranking all.
    const match = text.match(/\bfloat\b\s+(?:for|of)\s+(.+?)[?.!]*$/);
    const activityQuery = match ? match[1].trim() : null;
    return Object.freeze({ type: "float", activityQuery });
  }
  if (/\bcritical\b/.test(text)) return Object.freeze({ type: "critical_path" });
  return UNKNOWN_PARSE;
}

// --- Answer builders -------------------------------------------------------------------------
//
// Each takes the parsed question plus a context assembled by the route:
//   cpmBlocks:  full runCpmEngine block rows (task_code, label, block_type,
//               early_start/finish, late_start/finish, total_float_days,
//               is_critical, constraint_type, constraint_date, percent_complete)
//   conflicts:  runCpmEngine conflicts (for constraint conflict reporting)
//   baseline:   null | { name, compared, addedSinceBaseline, removedSinceBaseline, rollup }
//   todayISO:   "YYYY-MM-DD" in America/Chicago (see chicagoTodayISO), for
//               past-due milestone detection

function blockLabel(block) {
  return `${block.task_code} — ${block.label}`;
}

function formatVarianceDays(days) {
  if (days == null) return "n/a";
  if (days === 0) return "on schedule";
  return `${days > 0 ? "+" : ""}${days}d`;
}

export function answerCriticalPath(_parsed, { cpmBlocks = [] }) {
  const critical = cpmBlocks
    .filter((block) => block.is_critical)
    .sort((a, b) => String(a.early_start ?? "").localeCompare(String(b.early_start ?? "")));
  const finishDates = cpmBlocks.map((block) => block.early_finish).filter((date) => date != null);
  const projectFinish = finishDates.length > 0 ? finishDates.reduce((max, date) => (date > max ? date : max)) : null;
  const summary = critical.length === 0
    ? "No critical activities found in the current schedule."
    : `${critical.length} critical ${critical.length === 1 ? "activity" : "activities"}${projectFinish ? `; project finishes ${projectFinish}` : ""}.`;
  return Object.freeze({
    questionType: "critical_path",
    summary,
    items: Object.freeze(critical.map((block) => Object.freeze({
      taskCode: block.task_code,
      label: block.label,
      detail: `${block.early_start ?? "?"} → ${block.early_finish ?? "?"}`,
    }))),
  });
}

export function answerConstraints(_parsed, { cpmBlocks = [], conflicts = [] }) {
  const constrained = cpmBlocks
    .filter((block) => block.constraint_type != null)
    .sort((a, b) => String(a.task_code).localeCompare(String(b.task_code)));
  // The CPM engine's real contract: detectConflicts emits
  // { type: "constraint_conflict", blockId, ... } -- blockId is the relational
  // block id, which CPM result rows carry as `id`. There is no task_code /
  // task_codes field on conflict objects.
  const conflictBlockIds = new Set(
    conflicts
      .filter((conflict) => conflict.type === "constraint_conflict" && conflict.blockId != null)
      .map((conflict) => conflict.blockId),
  );
  const summary = constrained.length === 0
    ? "No activities carry a date constraint."
    : `${constrained.length} ${constrained.length === 1 ? "activity has" : "activities have"} a date constraint.`;
  return Object.freeze({
    questionType: "constraints",
    summary,
    items: Object.freeze(constrained.map((block) => {
      const inConflict = conflictBlockIds.has(block.id);
      return Object.freeze({
        taskCode: block.task_code,
        label: block.label,
        detail: `${block.constraint_type} ${block.constraint_date ?? ""}`.trim() + (inConflict ? " — conflicts with the dependency network" : ""),
      });
    })),
  });
}

// Resolves an activity query against CPM blocks. Match order:
//   1. exact task code (case-insensitive),
//   2. exact normalized label (case-insensitive) -- collected, not .find():
//      duplicate labels return an ambiguity result, never an arbitrary pick,
//   3. partial label match -- but only when it resolves to exactly one block.
// A query matching several blocks returns { ambiguous, candidates } instead of
// silently picking the first row, so "float for framing" can never select an
// arbitrary framing activity.
function resolveActivityQuery(cpmBlocks, query) {
  const normalized = String(query ?? "").trim().toLowerCase();
  if (!normalized) return { match: null };
  const byTaskCode = cpmBlocks.find(
    (block) => String(block.task_code ?? "").trim().toLowerCase() === normalized,
  );
  if (byTaskCode) return { match: byTaskCode };
  const byLabel = cpmBlocks.filter(
    (block) => String(block.label ?? "").trim().toLowerCase() === normalized,
  );
  if (byLabel.length === 1) return { match: byLabel[0] };
  if (byLabel.length > 1) return { ambiguous: true, candidates: byLabel };
  const partial = cpmBlocks.filter(
    (block) => String(block.label ?? "").toLowerCase().includes(normalized),
  );
  if (partial.length === 1) return { match: partial[0] };
  if (partial.length > 1) return { ambiguous: true, candidates: partial };
  return { match: null };
}

// Criticality in this engine means "at the graph-wide minimum float" -- that
// minimum can be negative, so summaries must report the actual float values of
// the critical blocks, never claim they are zero.
function criticalFloatSummary(cpmBlocks) {
  const critical = cpmBlocks.filter((block) => block.is_critical);
  if (critical.length === 0) return { count: 0, detail: "" };
  const floats = critical
    .map((block) => block.total_float_days)
    .filter((floatDays) => floatDays != null);
  const detail = floats.length > 0
    ? ` (min float ${Math.min(...floats)}d)`
    : "";
  return { count: critical.length, detail };
}

export function answerFloat(parsed, { cpmBlocks = [] }) {
  const query = (parsed.activityQuery || "").trim();
  if (query) {
    const resolved = resolveActivityQuery(cpmBlocks, query);
    if (resolved.ambiguous) {
      const candidates = resolved.candidates
        .slice()
        .sort((a, b) => String(a.task_code).localeCompare(String(b.task_code)));
      return Object.freeze({
        questionType: "float",
        summary: `"${query}" matches ${candidates.length} activities -- ask again with a task code to pick one.`,
        items: Object.freeze(candidates.map((block) => Object.freeze({
          taskCode: block.task_code,
          label: block.label,
          detail: `Total float: ${block.total_float_days ?? "?"}d`,
        }))),
      });
    }
    const match = resolved.match;
    if (!match) {
      return Object.freeze({
        questionType: "float",
        summary: `No activity matches "${query}".`,
        items: Object.freeze([]),
      });
    }
    return Object.freeze({
      questionType: "float",
      summary: `${blockLabel(match)} has ${match.total_float_days ?? "unknown"} days of total float${match.is_critical ? " (critical)" : ""}.`,
      items: Object.freeze([Object.freeze({
        taskCode: match.task_code,
        label: match.label,
        detail: `Total float: ${match.total_float_days ?? "?"}d · Early ${match.early_start ?? "?"} → ${match.early_finish ?? "?"} · Late ${match.late_start ?? "?"} → ${match.late_finish ?? "?"}`,
      })]),
    });
  }

  const ranked = cpmBlocks
    .filter((block) => !block.is_critical && block.total_float_days != null)
    .sort((a, b) => a.total_float_days - b.total_float_days)
    .slice(0, 10);
  const critical = criticalFloatSummary(cpmBlocks);
  const summary = ranked.length === 0
    ? (critical.count > 0
        ? `Every scheduled activity is critical${critical.detail}.`
        : "No float data in the current schedule.")
    : `Lowest float first (top ${ranked.length}); ${critical.count} critical ${critical.count === 1 ? "activity" : "activities"}${critical.detail}.`;
  return Object.freeze({
    questionType: "float",
    summary,
    items: Object.freeze(ranked.map((block) => Object.freeze({
      taskCode: block.task_code,
      label: block.label,
      detail: `${block.total_float_days}d float · ${block.early_start ?? "?"} → ${block.early_finish ?? "?"}`,
    }))),
  });
}

const FINISH_SIDE_CONSTRAINTS = Object.freeze(["FNLT", "must_finish_on", "finish_on"]);

export function answerLateMilestones(_parsed, { cpmBlocks = [], todayISO = null }) {
  const milestones = cpmBlocks.filter((block) => block.block_type === "milestone");
  const late = [];
  for (const block of milestones) {
    // A 100%-complete milestone is done and therefore never late -- this applies
    // before both the finish-constraint check and the past-due check, so a
    // completed milestone with a constraint violation is not reported as late.
    if ((block.percent_complete ?? 0) >= 100) continue;
    const reasons = [];
    if (
      block.constraint_type != null
      && FINISH_SIDE_CONSTRAINTS.includes(block.constraint_type)
      && block.constraint_date != null
      && block.early_finish != null
      && block.early_finish > block.constraint_date
    ) {
      reasons.push(`scheduled ${block.early_finish}, constrained to finish by ${block.constraint_date}`);
    }
    if (
      todayISO != null
      && block.early_finish != null
      && block.early_finish < todayISO
    ) {
      reasons.push(`past due (was ${block.early_finish}, ${block.percent_complete ?? 0}% complete)`);
    }
    if (reasons.length > 0) {
      late.push(Object.freeze({ taskCode: block.task_code, label: block.label, detail: reasons.join("; ") }));
    }
  }
  late.sort((a, b) => String(a.taskCode).localeCompare(String(b.taskCode)));
  const summary = milestones.length === 0
    ? "The schedule has no milestones."
    : late.length === 0
      ? `All ${milestones.length} ${milestones.length === 1 ? "milestone is" : "milestones are"} on track.`
      : `${late.length} of ${milestones.length} ${milestones.length === 1 ? "milestone is" : "milestones are"} late.`;
  return Object.freeze({ questionType: "late_milestones", summary, items: Object.freeze(late) });
}

export function answerBaselineVariance(_parsed, { baseline = null }) {
  if (!baseline) {
    return Object.freeze({
      questionType: "baseline_variance",
      summary: "No baseline has been captured for this project yet, so there is nothing to compare against.",
      items: Object.freeze([]),
    });
  }
  const moved = (baseline.compared || [])
    .filter((row) => (row.startVarianceDays != null && row.startVarianceDays !== 0)
      || (row.finishVarianceDays != null && row.finishVarianceDays !== 0))
    .sort((a, b) => Math.abs(b.finishVarianceDays ?? 0) - Math.abs(a.finishVarianceDays ?? 0));
  const items = [
    ...moved.map((row) => Object.freeze({
      taskCode: row.taskCode,
      label: "",
      detail: `Start ${formatVarianceDays(row.startVarianceDays)} · Finish ${formatVarianceDays(row.finishVarianceDays)}`,
    })),
    ...(baseline.removedSinceBaseline || []).map((row) => Object.freeze({
      taskCode: row.taskCode, label: row.label, detail: "Removed since baseline",
    })),
    ...(baseline.addedSinceBaseline || []).map((row) => Object.freeze({
      taskCode: row.taskCode, label: row.label, detail: "Added since baseline",
    })),
  ];
  const rollup = baseline.rollup || {};
  const finishShift = rollup.projectFinishVarianceDays;
  const summary = `Compared against baseline "${baseline.name}": `
    + `${moved.length} moved, ${baseline.addedSinceBaseline?.length ?? 0} added, ${baseline.removedSinceBaseline?.length ?? 0} removed`
    + (finishShift != null ? `; project finish ${formatVarianceDays(finishShift)}.` : ".");
  return Object.freeze({ questionType: "baseline_variance", summary, items: Object.freeze(items) });
}

export function answerHelp() {
  return Object.freeze({
    questionType: "help",
    summary: "I can answer these questions about the current schedule:",
    items: Object.freeze(SUPPORTED_SCHEDULE_QUESTIONS.filter((question) => question.id !== "float_for").map((question) => Object.freeze({
      taskCode: question.id,
      label: question.label,
      detail: `Try: "${question.example}"`,
    }))),
  });
}

// Dispatches a parsed question to its answer builder. The "unknown" branch never
// guesses -- it returns the supported-question list.
export function answerScheduleQuestion(parsed, context) {
  switch (parsed?.type) {
    case "critical_path": return answerCriticalPath(parsed, context);
    case "constraints": return answerConstraints(parsed, context);
    case "float": return answerFloat(parsed, context);
    case "late_milestones": return answerLateMilestones(parsed, context);
    case "baseline_variance": return answerBaselineVariance(parsed, context);
    case "help": return answerHelp();
    default:
      return Object.freeze({
        questionType: "unknown",
        summary: "I don't understand that question yet. Here is what I can answer:",
        items: answerHelp().items,
      });
  }
}
