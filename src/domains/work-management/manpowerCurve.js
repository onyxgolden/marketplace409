// Manpower curve (work package planner, slice 6) — pure domain logic.
//
// The manpower curve is a DERIVED view only: required labor by craft and
// outage day, computed from the active work-step plan, with craft-assignment
// staffing shown as an overlay. Nothing here mutates steps, assignments, or
// progress, and nothing here is stored — the service recomputes on every GET.
//
// Decimal rules (deterministic, exact):
// - Person-hours are integer hundredths (cents). Step hours are numeric(12,2),
//   so `Math.round(hours * 100)` is exact; totals are exact sums of cents.
// - Required equivalents per day/craft are hours / standard_hours_per_person_day,
//   rounded to 4 decimals. Totals use the total hours, never a sum of rounded
//   day equivalents, so totals stay consistent with the underlying hours.
// - Equal-spread baseline: a step with H hours over D days puts
//   floor(H / D) cents on each day and the fractional residual (H - D *
//   floor(H / D)) deterministically on the LAST allocated day, so the day
//   allocations sum to H exactly. The baseline placement is days 1..D.
//
// Reconciliation invariant (per craft): sum(day required hours) +
// unallocated known hours = sum(active steps' planned_person_hours for that
// craft). Steps with missing craft go in a separate unclassified bucket
// (never a fabricated craft); steps with missing hours are unknown, not 0.
// The curve is only "reconciled" when no known hours are excluded and no
// hours are unknown.

export const MAX_OUTAGE_DAYS = 366;
export const MIN_OUTAGE_DAYS = 1;
export const DEFAULT_STANDARD_HOURS_PER_PERSON_DAY = 8;
export const MAX_STANDARD_HOURS_PER_PERSON_DAY = 24;
export const EQUIVALENT_SCALE = 4;
export const MAX_REASON_LENGTH = 1000;
export const BASELINE_DISCLOSURE = "Unsequenced baseline — starts at outage day 1.";

export const EXCLUDED_REASONS = {
  WINDOW_NOT_CONFIGURED: "window_not_configured",
  MISSING_HOURS: "missing_hours",
  MISSING_CRAFT: "missing_craft",
  DURATION_EXCEEDS_OUTAGE: "duration_exceeds_outage",
  PLACEMENT_OUTSIDE_WINDOW: "placement_outside_window",
};

export function isValidCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

export function addDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

export function outageDates(outageStartDate, outageDays) {
  return Array.from({ length: outageDays }, (_, i) => addDays(outageStartDate, i));
}

export function outageEndDate(outageStartDate, outageDays) {
  return addDays(outageStartDate, outageDays - 1);
}

// 1-based outage day index for a calendar date, or null outside the window.
export function dayIndexForDate(outageStartDate, outageDays, workDate) {
  if (!isValidCalendarDate(workDate)) return null;
  const [sy, sm, sd] = outageStartDate.split("-").map(Number);
  const [wy, wm, wd] = workDate.split("-").map(Number);
  const index =
    Math.round(
      (Date.UTC(wy, wm - 1, wd) - Date.UTC(sy, sm - 1, sd)) / 86_400_000,
    ) + 1;
  return index >= 1 && index <= outageDays ? index : null;
}

export function hoursToCents(hours) {
  return Math.round(Number(hours) * 100);
}

export function centsToHours(cents) {
  return cents / 100;
}

export function equivalentsForHours(hours, standardHoursPerPersonDay) {
  const factor = 10 ** EQUIVALENT_SCALE;
  return Math.round((hours / standardHoursPerPersonDay) * factor) / factor;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function hasAtMostTwoDecimals(value) {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;
}

function isValidReason(value) {
  return value === undefined || value === null || typeof value === "string";
}

function invalid(message) {
  return { ok: false, error: message };
}

export function validateManpowerCurveSettingsInput(input) {
  if (!input || typeof input !== "object") return invalid("Manpower curve settings are required.");
  const { outageStartDate, outageDays, standardHoursPerPersonDay, expectedVersion, reason } = input;
  if (!isValidCalendarDate(outageStartDate)) {
    return invalid("Enter a valid outage start date (YYYY-MM-DD).");
  }
  if (!Number.isInteger(outageDays) || outageDays < MIN_OUTAGE_DAYS || outageDays > MAX_OUTAGE_DAYS) {
    return invalid(`Outage days must be a whole number from ${MIN_OUTAGE_DAYS} to ${MAX_OUTAGE_DAYS}.`);
  }
  if (standardHoursPerPersonDay !== undefined && standardHoursPerPersonDay !== null) {
    if (
      !isFiniteNumber(standardHoursPerPersonDay) ||
      standardHoursPerPersonDay <= 0 ||
      standardHoursPerPersonDay > MAX_STANDARD_HOURS_PER_PERSON_DAY ||
      !hasAtMostTwoDecimals(standardHoursPerPersonDay)
    ) {
      return invalid("Standard hours per person-day must be more than 0 and no more than 24, with at most 2 decimals.");
    }
  }
  if (expectedVersion !== undefined && expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 0)) {
    return invalid("The settings version must be a whole number (0 or more).");
  }
  if (!isValidReason(reason) || (typeof reason === "string" && reason.length > MAX_REASON_LENGTH)) {
    return invalid(`The reason must be ${MAX_REASON_LENGTH} characters or fewer.`);
  }
  return { ok: true };
}

export function validateManpowerCurvePlacementInput(input) {
  if (!input || typeof input !== "object") return invalid("Placement details are required.");
  const { stepId, startDayIndex, expectedVersion, reason } = input;
  if (typeof stepId !== "string" || stepId.trim() === "") {
    return invalid("Choose a work step to place.");
  }
  if (!Number.isInteger(startDayIndex) || startDayIndex < 1) {
    return invalid("The start day must be a whole number from 1.");
  }
  if (expectedVersion !== undefined && expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 0)) {
    return invalid("The placement version must be a whole number (0 or more).");
  }
  if (!isValidReason(reason) || (typeof reason === "string" && reason.length > MAX_REASON_LENGTH)) {
    return invalid(`The reason must be ${MAX_REASON_LENGTH} characters or fewer.`);
  }
  return { ok: true };
}

export function validateManpowerCurvePlacementClearInput(input) {
  if (!input || typeof input !== "object") return invalid("Placement details are required.");
  const { placementId, expectedVersion, reason } = input;
  if (typeof placementId !== "string" || placementId.trim() === "") {
    return invalid("Choose a placement to clear.");
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return invalid("The placement version is required to clear a placement.");
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    return invalid("A reason is required when clearing a placement.");
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return invalid(`The reason must be ${MAX_REASON_LENGTH} characters or fewer.`);
  }
  return { ok: true };
}

// Canonicalize a craft label the same way the step and assignment services do:
// trim, collapse inner whitespace, lower-case the key. A missing/blank label
// stays null — it is never coerced into a fabricated craft.
export function craftKeyFor(label) {
  if (typeof label !== "string") return null;
  const trimmed = label.trim().replace(/\s+/g, " ");
  return trimmed === "" ? null : trimmed.toLowerCase();
}

// Equal-spread allocation of `totalCents` person-hours over `dayCount` days.
// Returns an array of integer cents per day; the fractional residual goes to
// the last day, so the array always sums to totalCents exactly.
export function spreadHoursCents(totalCents, dayCount) {
  const base = Math.floor(totalCents / dayCount);
  const remainder = totalCents - base * dayCount;
  return Array.from({ length: dayCount }, (_, i) => (i === dayCount - 1 ? base + remainder : base));
}

// Compute the derived manpower curve for one package.
//
// Inputs (all already owner-scoped and package-scoped by the service):
// - settings: { outageStartDate, outageDays, standardHoursPerPersonDay } | null
// - steps: active work steps, each { id, title, sequenceNo, craftKey,
//   craftLabel, plannedDurationDays, plannedPersonHours, version }
// - placements: active placements, each { stepId, startDayIndex }
// - assignments: active craft assignments, each { workDate, craftKey,
//   craftLabel, crewSize, hoursPerPerson } (any date; out-of-window rows are
//   counted, never mapped to a day)
// The result is pure derived data: days, per-craft totals, excluded steps,
// reconciliation, warnings, and the per-step placement view the UI needs.
export function computeManpowerCurve({ settings, steps, placements, assignments }) {
  const emptyTotals = {
    requiredHours: 0,
    requiredEquivalents: 0,
    assignedHours: 0,
    assignedEquivalents: 0,
    gapHours: 0,
    stepCount: 0,
  };
  const empty = {
    window: null,
    windowConfigured: false,
    days: [],
    crafts: [],
    totals: { ...emptyTotals },
    excludedSteps: [],
    unallocated: { knownHours: 0, unclassifiedHours: 0, unknownSteps: 0 },
    reconciliation: {
      requiredHoursTotal: 0,
      unallocatedKnownHours: 0,
      unclassifiedKnownHours: 0,
      knownActiveStepHours: 0,
      reconciled: false,
    },
    capacity: { assignedHours: 0, inWindowAssignmentHours: 0, outOfWindowAssignmentCount: 0 },
    warnings: [],
    steps: [],
    baselineDisclosure: BASELINE_DISCLOSURE,
  };

  const placementByStepId = new Map((placements ?? []).map((p) => [p.stepId, p]));
  const stepViews = (steps ?? []).map((step) => ({
    stepId: step.id,
    title: step.title ?? null,
    sequenceNo: step.sequenceNo ?? null,
    craftKey: step.craftKey ?? null,
    craftLabel: step.craftLabel ?? null,
    plannedDurationDays: step.plannedDurationDays ?? null,
    plannedPersonHours: step.plannedPersonHours ?? null,
    placement: placementByStepId.has(step.id)
      ? {
          id: placementByStepId.get(step.id).id ?? null,
          startDayIndex: placementByStepId.get(step.id).startDayIndex,
          version: placementByStepId.get(step.id).version ?? null,
        }
      : null,
    excludedReason: null,
  }));

  if (!settings) {
    const excludedSteps = stepViews.map((step) => ({
      ...step,
      reason: EXCLUDED_REASONS.WINDOW_NOT_CONFIGURED,
      detail: "No outage window is set, so this step's hours cannot be placed on days.",
    }));
    return {
      ...empty,
      excludedSteps,
      steps: stepViews.map((step) => ({ ...step, excludedReason: EXCLUDED_REASONS.WINDOW_NOT_CONFIGURED })),
      warnings: [
        {
          code: "WINDOW_NOT_CONFIGURED",
          message: "Set the outage window to see the manpower curve — no dates are assumed.",
        },
      ],
    };
  }

  const outageDays = settings.outageDays;
  const standard = settings.standardHoursPerPersonDay;
  const dates = outageDates(settings.outageStartDate, outageDays);
  const window = {
    outageStartDate: settings.outageStartDate,
    outageEndDate: outageEndDate(settings.outageStartDate, outageDays),
    outageDays,
    standardHoursPerPersonDay: standard,
  };

  // Per-day, per-craft accumulator in integer cents.
  const dayCraft = dates.map(() => new Map());
  // dayCraft[dayIndex].get(craftKey) = { requiredCents, assignedCents, assignedSlots }
  const craftMeta = new Map();
  const noteCraft = (craftKey, craftLabel) => {
    if (!craftKey) return;
    if (!craftMeta.has(craftKey)) craftMeta.set(craftKey, craftLabel ?? craftKey);
  };
  const dayCell = (dayIndex, craftKey, craftLabel) => {
    noteCraft(craftKey, craftLabel);
    const day = dayCraft[dayIndex];
    if (!day.has(craftKey)) day.set(craftKey, { requiredCents: 0, assignedCents: 0, assignedSlots: 0 });
    return day.get(craftKey);
  };

  const excludedSteps = [];
  let unallocatedKnownCents = 0;
  let unclassifiedKnownCents = 0;
  let unknownSteps = 0;
  let knownActiveStepCents = 0;
  let baselineUsed = false;

  for (const step of stepViews) {
    const hours = step.plannedPersonHours;
    if (hours === null || hours === undefined || !Number.isFinite(hours)) {
      unknownSteps += 1;
      step.excludedReason = EXCLUDED_REASONS.MISSING_HOURS;
      excludedSteps.push({
        ...step,
        reason: EXCLUDED_REASONS.MISSING_HOURS,
        detail: "This step has no planned person-hours, so its demand is unknown — not zero.",
      });
      continue;
    }
    const cents = hoursToCents(hours);
    knownActiveStepCents += cents;
    if (!step.craftKey) {
      unclassifiedKnownCents += cents;
      step.excludedReason = EXCLUDED_REASONS.MISSING_CRAFT;
      excludedSteps.push({
        ...step,
        reason: EXCLUDED_REASONS.MISSING_CRAFT,
        detail: "This step has no craft, so its hours cannot be shown under any craft — they are listed as unclassified.",
      });
      continue;
    }
    const duration = step.plannedDurationDays ?? outageDays;
    if (duration > outageDays) {
      unallocatedKnownCents += cents;
      step.excludedReason = EXCLUDED_REASONS.DURATION_EXCEEDS_OUTAGE;
      excludedSteps.push({
        ...step,
        reason: EXCLUDED_REASONS.DURATION_EXCEEDS_OUTAGE,
        detail: `This step spans ${duration} days, longer than the ${outageDays}-day outage window, so its hours are unallocated.`,
      });
      continue;
    }
    const placement = step.placement;
    const startDay = placement ? placement.startDayIndex : 1;
    if (!placement) baselineUsed = true;
    if (startDay < 1 || startDay + duration - 1 > outageDays) {
      unallocatedKnownCents += cents;
      step.excludedReason = EXCLUDED_REASONS.PLACEMENT_OUTSIDE_WINDOW;
      excludedSteps.push({
        ...step,
        reason: EXCLUDED_REASONS.PLACEMENT_OUTSIDE_WINDOW,
        detail: `This step's placement (day ${startDay} for ${duration} day${duration === 1 ? "" : "s"}) runs past the ${outageDays}-day outage window, so its hours are unallocated.`,
      });
      continue;
    }
    const perDay = spreadHoursCents(cents, duration);
    for (let i = 0; i < duration; i += 1) {
      dayCell(startDay - 1 + i, step.craftKey, step.craftLabel).requiredCents += perDay[i];
    }
  }

  // Assignments are an overlay only: they add capacity, never move demand.
  let outOfWindowAssignmentCount = 0;
  let inWindowAssignmentCents = 0;
  for (const assignment of assignments ?? []) {
    const dayIndex = dayIndexForDate(settings.outageStartDate, outageDays, assignment.workDate);
    if (dayIndex === null) {
      outOfWindowAssignmentCount += 1;
      continue;
    }
    const craftKey = assignment.craftKey ?? craftKeyFor(assignment.craftLabel);
    if (!craftKey) continue;
    const cents = (assignment.crewSize ?? 0) * hoursToCents(assignment.hoursPerPerson ?? 0);
    inWindowAssignmentCents += cents;
    const cell = dayCell(dayIndex - 1, craftKey, assignment.craftLabel);
    cell.assignedCents += cents;
    cell.assignedSlots += assignment.crewSize ?? 0;
  }

  const craftKeys = [...craftMeta.keys()].sort((a, b) =>
    String(craftMeta.get(a)).localeCompare(String(craftMeta.get(b))),
  );
  const craftTotals = new Map(craftKeys.map((key) => [key, {
    craftKey: key,
    craftLabel: craftMeta.get(key),
    requiredCents: 0,
    assignedCents: 0,
    stepCount: 0,
  }]));
  for (const step of stepViews) {
    if (step.craftKey && !step.excludedReason && craftTotals.has(step.craftKey)) {
      craftTotals.get(step.craftKey).stepCount += 1;
    }
  }

  const days = dates.map((date, dayIndex) => {
    const crafts = {};
    let totalRequiredCents = 0;
    let totalAssignedCents = 0;
    for (const craftKey of craftKeys) {
      const cell = dayCraft[dayIndex].get(craftKey);
      if (!cell || (cell.requiredCents === 0 && cell.assignedCents === 0)) continue;
      const requiredHours = centsToHours(cell.requiredCents);
      const assignedHours = centsToHours(cell.assignedCents);
      crafts[craftKey] = {
        craftKey,
        craftLabel: craftMeta.get(craftKey),
        requiredHours,
        requiredEquivalents: equivalentsForHours(requiredHours, standard),
        assignedHours,
        assignedEquivalents: equivalentsForHours(assignedHours, standard),
        assignedShiftPersonSlots: cell.assignedSlots,
        gapHours: assignedHours - requiredHours,
        gapEquivalents: equivalentsForHours(assignedHours - requiredHours, standard),
      };
      totalRequiredCents += cell.requiredCents;
      totalAssignedCents += cell.assignedCents;
      const totals = craftTotals.get(craftKey);
      totals.requiredCents += cell.requiredCents;
      totals.assignedCents += cell.assignedCents;
    }
    const totalRequiredHours = centsToHours(totalRequiredCents);
    const totalAssignedHours = centsToHours(totalAssignedCents);
    return {
      dayIndex: dayIndex + 1,
      date,
      crafts,
      totalRequiredHours,
      totalRequiredEquivalents: equivalentsForHours(totalRequiredHours, standard),
      totalAssignedHours,
      totalAssignedEquivalents: equivalentsForHours(totalAssignedHours, standard),
      totalGapHours: totalAssignedHours - totalRequiredHours,
    };
  });

  const crafts = craftKeys.map((craftKey) => {
    const totals = craftTotals.get(craftKey);
    const requiredHours = centsToHours(totals.requiredCents);
    const assignedHours = centsToHours(totals.assignedCents);
    return {
      craftKey,
      craftLabel: totals.craftLabel,
      totalRequiredHours: requiredHours,
      totalRequiredEquivalents: equivalentsForHours(requiredHours, standard),
      totalAssignedHours: assignedHours,
      totalAssignedEquivalents: equivalentsForHours(assignedHours, standard),
      totalGapHours: assignedHours - requiredHours,
      stepCount: totals.stepCount,
    };
  });
  // The unclassified bucket is not a craft: it has hours but no daily curve.
  if (unclassifiedKnownCents > 0) {
    crafts.push({
      craftKey: null,
      craftLabel: "Unclassified",
      totalRequiredHours: centsToHours(unclassifiedKnownCents),
      totalRequiredEquivalents: equivalentsForHours(centsToHours(unclassifiedKnownCents), standard),
      totalAssignedHours: 0,
      totalAssignedEquivalents: 0,
      totalGapHours: -centsToHours(unclassifiedKnownCents),
      stepCount: stepViews.filter((s) => s.excludedReason === EXCLUDED_REASONS.MISSING_CRAFT).length,
    });
  }

  const requiredCents = days.reduce(
    (sum, day) => sum + Math.round(day.totalRequiredHours * 100),
    0,
  );
  const assignedCents = days.reduce(
    (sum, day) => sum + Math.round(day.totalAssignedHours * 100),
    0,
  );
  const requiredHours = centsToHours(requiredCents);
  const assignedHours = centsToHours(assignedCents);
  const totals = {
    requiredHours,
    requiredEquivalents: equivalentsForHours(requiredHours, standard),
    assignedHours,
    assignedEquivalents: equivalentsForHours(assignedHours, standard),
    gapHours: assignedHours - requiredHours,
    stepCount: stepViews.filter((s) => !s.excludedReason).length,
  };

  const unallocated = {
    knownHours: centsToHours(unallocatedKnownCents),
    unclassifiedHours: centsToHours(unclassifiedKnownCents),
    unknownSteps,
  };
  const reconciliation = {
    requiredHoursTotal: requiredHours,
    unallocatedKnownHours: unallocated.knownHours,
    unclassifiedKnownHours: unallocated.unclassifiedHours,
    knownActiveStepHours: centsToHours(knownActiveStepCents),
    reconciled:
      unallocatedKnownCents === 0 && unclassifiedKnownCents === 0 && unknownSteps === 0,
  };

  const warnings = [];
  if (baselineUsed) {
    warnings.push({
      code: "BASELINE_UNSEQUENCED",
      message: `${BASELINE_DISCLOSURE} Steps without an explicit start day are spread evenly from outage day 1 — set a start day to place them.`,
    });
  }
  if (excludedSteps.length > 0) {
    warnings.push({
      code: "EXCLUDED_STEPS",
      message: `${excludedSteps.length} step${excludedSteps.length === 1 ? "" : "s"} could not be placed on the curve. See the excluded steps below — their hours are not silently dropped.`,
    });
  }
  if (unknownSteps > 0) {
    warnings.push({
      code: "UNKNOWN_HOURS",
      message: `${unknownSteps} step${unknownSteps === 1 ? " has" : "s have"} no planned person-hours, so the totals do not include them.`,
    });
  }
  if (outOfWindowAssignmentCount > 0) {
    warnings.push({
      code: "OUT_OF_WINDOW_ASSIGNMENTS",
      message: `${outOfWindowAssignmentCount} assignment${outOfWindowAssignmentCount === 1 ? "" : "s"} fall${outOfWindowAssignmentCount === 1 ? "s" : ""} outside the outage window and are not shown as capacity.`,
    });
  }

  return {
    window,
    windowConfigured: true,
    days,
    crafts,
    totals,
    excludedSteps,
    unallocated,
    reconciliation,
    capacity: {
      assignedHours,
      inWindowAssignmentHours: centsToHours(inWindowAssignmentCents),
      outOfWindowAssignmentCount,
    },
    warnings,
    steps: stepViews,
    baselineDisclosure: BASELINE_DISCLOSURE,
  };
}
