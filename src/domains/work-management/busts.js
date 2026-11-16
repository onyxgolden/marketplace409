// Busts — pure domain logic for Work Package Planner bust detection and
// disposition.
//
// A "bust" is a recorded, evidenced unfavorable variance against a
// specifically identified approved/frozen work-package plan. This
// module is pure: it never touches the database, never mutates, and
// never infers a figure it was not given. Every candidate it returns
// is a *proposal* — a human confirms it (with evidence) through the
// application layer, which calls the trusted RPCs. A bust never
// blocks work: status is informational only.
//
// Units (canonical for this module):
// - LABOR_COST values are whole US cents (USD_CENTS). The progress
//   snapshots and baselines store cost in DOLLARS (numeric(14,2));
//   the application layer converts dollars -> cents (x100, exact)
//   before calling this module. Never mix the two.
// - LABOR_HOURS / MANPOWER_SHORTFALL values are person-hours, up to
//   3 decimals. INSTALLED_QUANTITY values use the takeoff line's
//   unit, up to 4 decimals. SCHEDULE_DAYS values are whole days.
//
// Day counts: a calendar-day span is end exclusive of start
// (Mar 7 -> Mar 10 is 3 days), computed with UTC date-only math so
// a DST-transition day inside the window counts exactly once.
// This differs from the manpower curve's outageDayCount, which is
// INCLUSIVE (the window length in days) — the two are different
// quantities and must not be interchanged.

import { computeManpowerCurve } from "./manpowerCurve.js";

export const BUST_DIMENSIONS = [
  "INSTALLED_QUANTITY",
  "LABOR_HOURS",
  "LABOR_COST",
  "SCHEDULE_DAYS",
  "MANPOWER_SHORTFALL",
];

export const BUST_SCOPES = ["PACKAGE", "TAKEOFF_LINE", "WORK_STEP", "CRAFT_DAY"];

// Which scope each dimension may attach to. Quantity lives on a
// takeoff line (its allowance IS the line); manpower lives on a
// craft-day; schedule on a package or a step; labor hours/cost on a
// package or a takeoff line (a line's labor figures come from its
// verified actuals, never from progress quantities).
export const DIMENSION_SCOPES = {
  INSTALLED_QUANTITY: ["TAKEOFF_LINE"],
  LABOR_HOURS: ["PACKAGE", "TAKEOFF_LINE"],
  LABOR_COST: ["PACKAGE", "TAKEOFF_LINE"],
  SCHEDULE_DAYS: ["PACKAGE", "WORK_STEP"],
  MANPOWER_SHORTFALL: ["CRAFT_DAY"],
};

export const DIMENSION_UNITS = {
  LABOR_COST: "USD_CENTS",
  SCHEDULE_DAYS: "DAYS",
  LABOR_HOURS: "HOURS",
  MANPOWER_SHORTFALL: "HOURS",
  // INSTALLED_QUANTITY carries the takeoff line's own unit.
};

// Decimal scale each dimension's values are stored at.
export const DIMENSION_SCALE = {
  INSTALLED_QUANTITY: 4,
  LABOR_HOURS: 3,
  LABOR_COST: 0,
  SCHEDULE_DAYS: 0,
  MANPOWER_SHORTFALL: 3,
};

export const BUST_STATUSES = [
  "OPEN",
  "UNDER_REVIEW",
  "ACCEPTED_OVERRUN",
  "RESOLVED_BY_CHANGE",
  "INVALID_DATA",
  "RETIRED",
];

export const ACTIVE_BUST_STATUSES = ["OPEN", "UNDER_REVIEW"];
export const TERMINAL_BUST_STATUSES = [
  "ACCEPTED_OVERRUN",
  "RESOLVED_BY_CHANGE",
  "INVALID_DATA",
  "RETIRED",
];

// The status machine. Forward moves come from OPEN / UNDER_REVIEW;
// any terminal state (including RETIRED) reopens to UNDER_REVIEW.
// RETIRED is reached only through the retire operation, never here.
export const BUST_TRANSITIONS = {
  OPEN: ["UNDER_REVIEW", "ACCEPTED_OVERRUN", "RESOLVED_BY_CHANGE", "INVALID_DATA"],
  UNDER_REVIEW: ["ACCEPTED_OVERRUN", "RESOLVED_BY_CHANGE", "INVALID_DATA"],
  ACCEPTED_OVERRUN: ["UNDER_REVIEW"],
  RESOLVED_BY_CHANGE: ["UNDER_REVIEW"],
  INVALID_DATA: ["UNDER_REVIEW"],
  RETIRED: ["UNDER_REVIEW"],
};

export const TERMINAL_PACKAGE_STATUSES = ["cancelled", "verified_closed"];

export const EVIDENCE_MIN_LENGTH = 10;
export const EVIDENCE_MAX_LENGTH = 2000;
export const REASON_MAX_LENGTH = 1000;

export function isTerminalPackageStatus(status) {
  return TERMINAL_PACKAGE_STATUSES.includes(status);
}

export function isActiveBustStatus(status) {
  return ACTIVE_BUST_STATUSES.includes(status);
}

export function isTerminalBustStatus(status) {
  return TERMINAL_BUST_STATUSES.includes(status);
}

export function canTransition(fromStatus, toStatus) {
  if (!fromStatus || !toStatus) return false;
  return (BUST_TRANSITIONS[fromStatus] ?? []).includes(toStatus);
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// The direction of an unfavorable variance. For every dimension
// except manpower, observed above plan is unfavorable; for manpower
// the required figure above the assigned capacity is unfavorable.
export function isUnfavorableVariance(dimension, plannedValue, observedValue) {
  if (plannedValue === null || plannedValue === undefined
    || observedValue === null || observedValue === undefined) return false;
  if (dimension === "MANPOWER_SHORTFALL") return plannedValue > observedValue;
  return observedValue > plannedValue;
}

// The absolute variance for a dimension, rounded to the dimension's
// scale. Returns null when either figure is missing; returns 0 when
// the variance is not unfavorable (a favorable variance is not a
// bust, and is never reported as one).
export function computeVariance(dimension, plannedValue, observedValue) {
  if (plannedValue === null || plannedValue === undefined
    || observedValue === null || observedValue === undefined) return null;
  if (!isUnfavorableVariance(dimension, plannedValue, observedValue)) return 0;
  const scale = DIMENSION_SCALE[dimension] ?? 4;
  if (dimension === "MANPOWER_SHORTFALL") {
    return roundTo(plannedValue - observedValue, scale);
  }
  return roundTo(observedValue - plannedValue, scale);
}

// Percent variance against the plan, 4 decimals. A zero plan has no
// percent — null, never infinity.
export function computePercentVariance(plannedValue, varianceValue) {
  if (plannedValue === null || plannedValue === undefined
    || varianceValue === null || varianceValue === undefined) return null;
  if (plannedValue === 0) return null;
  return roundTo((varianceValue / plannedValue) * 100, 4);
}

// Calendar-day span, end exclusive of start, UTC date-only math.
// Mar 7 -> Mar 10 is 3 days; a DST-transition day inside the span
// counts exactly once; a span crossing New Year counts the same way.
export function calendarDaySpan(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const parse = (value) => {
    const parts = String(value).split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    return Date.UTC(parts[0], parts[1] - 1, parts[2]);
  };
  const start = parse(startDate);
  const end = parse(endDate);
  if (start === null || end === null) return null;
  return Math.round((end - start) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Fingerprint — the canonical identity of one comparison, shared with
// the database (forge_work_package_bust_fingerprint). The two MUST
// agree byte for byte: the confirm RPC recomputes the fingerprint
// from the submitted values and rejects a stale one, and the
// candidates endpoint matches candidates to already-recorded busts
// by fingerprint. Numbers render canonically (trailing zeros and a
// trailing point stripped: 100.0000 -> "100", 40.5000 -> "40.5"),
// nulls render as "", dates as YYYY-MM-DD, fields joined by "|".
// ---------------------------------------------------------------------------

export function formatFingerprintNumber(value) {
  if (value === null || value === undefined) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  let s = n.toFixed(4);
  s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0" || s === "") s = "0";
  return s;
}

function fingerprintField(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

// Pure-JavaScript MD5 (RFC 1321), hex digest. Kept in-module so the
// domain stays isomorphic (browser + Node) with no dependency; the
// test suite checks it against Node's crypto for a set of vectors.
const MD5_SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);

export function md5Hex(message) {
  const bytes = new TextEncoder().encode(message);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Array(16);
    for (let j = 0; j < 16; j += 1) words[j] = view.getUint32(offset + j * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + MD5_K[i] + words[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((f << MD5_SHIFT[i]) | (f >>> (32 - MD5_SHIFT[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a0, true);
  out.setUint32(4, b0, true);
  out.setUint32(8, c0, true);
  out.setUint32(12, d0, true);
  return [...new Uint8Array(out.buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function computeFingerprint(input) {
  const fields = [
    fingerprintField(input.ownerId),
    fingerprintField(input.packageId),
    fingerprintField(input.dimension),
    fingerprintField(input.scopeType),
    fingerprintField(input.takeoffLineId),
    fingerprintField(input.workStepId),
    fingerprintField(input.craft),
    fingerprintField(input.workDate),
    fingerprintField(input.shiftKey),
    fingerprintField(input.baselineId),
    input.baselineVersion === null || input.baselineVersion === undefined
      ? "" : String(input.baselineVersion),
    formatFingerprintNumber(input.plannedValue),
    formatFingerprintNumber(input.observedValue),
    fingerprintField(input.unit),
    fingerprintField(input.comparisonAsOf),
  ];
  return md5Hex(fields.join("|"));
}

// ---------------------------------------------------------------------------
// Detection — buildCandidates(snapshot)
//
// Input: ONE normalized snapshot (the application layer normalizes
// the snapshot RPC result: snake_case -> camelCase, string numerics
// -> numbers, dollars -> cents for cost figures):
// {
//   ownerId, packageId, packageStatus, asOf (YYYY-MM-DD),
//   baseline: { id, versionNumber, baselineStart, baselineFinish,
//               baselineHours, baselineCostCents, frozenAt } | null,
//   progressBaseline: { id, versionNumber, baselineStart,
//               baselineFinish, baselineHours, baselineCostCents,
//               frozenAt } | null — the baseline the latest progress
//               snapshot was measured against (may be older than the
//               current frozen baseline after a re-baseline),
//   takeoffLines: [{ id, drawingId, quantity, unit, installedQuantity }],
//   steps: [{ id, title, sequenceNo, craftKey, craftLabel,
//             plannedDurationDays, plannedPersonHours, version }],
//   placements: [{ id, stepId, baselineVersion, startDayIndex, version }],
//   assignments: [{ workDate, craftKey, craftLabel, shiftKey,
//                   crewSize, hoursPerPerson }],
//   latestProgress: { statusDate, actualHours, actualCostCents,
//                     baselineVersion } | null,
//   controlEstimate: { originalControlEstimateCents,
//                      currentEstimateCents } | null,
//   activeBusts: [{ id, sourceFingerprint, status, dimension }],
// }
//
// Output: { candidates, insufficiencies }. A candidate is a proposal
// only — nothing here writes. An insufficiency names a dimension
// that could not be evaluated and why, so the UI says "insufficient
// evidence" instead of silently omitting it. Missing inputs are
// never treated as zero and never produce a confirmed overrun.
//
// Detection rules (each reads ONLY this one snapshot):
// - INSTALLED_QUANTITY: per takeoff line, installed-as-of above the
//   line's planned quantity. The line's unit travels with it. A
//   quantity overrun is never converted into a labor-cost figure.
// - LABOR_HOURS / LABOR_COST: the latest progress snapshot's actual
//   hours/cost above the frozen baseline's hours/cost (cents for
//   cost). The baseline named by the snapshot is the allowance; a
//   later re-baseline cannot rewrite what the snapshot measured.
// - SCHEDULE_DAYS (package): the latest progress status date past
//   the frozen baseline finish. Planned = the baseline span
//   (finish exclusive of start); observed = the span from baseline
//   start to the status date. Step-level schedule overruns have no
//   evidenced actual finish in the slice-6 data, so they are not
//   auto-detected — they can be recorded manually with evidence.
// - MANPOWER_SHORTFALL: per (date, craft) from the slice-6 curve
//   inputs — required hours from the curve's equal-spread placement
//   of the frozen baseline, capacity = summed crew_size x
//   hours_per_person for that craft on that day. The curve's unit
//   is (day, craft): demand is not shift-specific, so an
//   auto-detected candidate carries shiftKey null and sums capacity
//   across shifts. A shift-specific shortfall can be recorded
//   manually with its own evidenced figures.
// ---------------------------------------------------------------------------

function candidateBase({
  ownerId, packageId, dimension, scopeType, takeoffLineId, workStepId,
  craft, workDate, shiftKey, baselineId, baselineVersion, plannedValue,
  observedValue, unit, comparisonAsOf, activeBusts, targetLabel,
}) {
  const varianceValue = computeVariance(dimension, plannedValue, observedValue);
  const variancePercent = computePercentVariance(plannedValue, varianceValue);
  const sourceFingerprint = computeFingerprint({
    ownerId, packageId, dimension, scopeType, takeoffLineId, workStepId,
    craft, workDate, shiftKey, baselineId, baselineVersion,
    plannedValue, observedValue, unit, comparisonAsOf,
  });
  const recorded = (activeBusts ?? []).find(
    (bust) => bust.sourceFingerprint === sourceFingerprint
      && isActiveBustStatus(bust.status),
  ) ?? null;
  return {
    dimension,
    scopeType,
    takeoffLineId: takeoffLineId ?? null,
    workStepId: workStepId ?? null,
    craft: craft ?? null,
    workDate: workDate ?? null,
    shiftKey: shiftKey ?? null,
    baselineId: baselineId ?? null,
    baselineVersion: baselineVersion ?? null,
    plannedValue,
    observedValue,
    varianceValue,
    variancePercent,
    unit,
    comparisonAsOf,
    sourceFingerprint,
    alreadyRecorded: recorded !== null,
    alreadyRecordedBustId: recorded ? recorded.id : null,
    // A human-readable target — names, never raw ids. The UI shows
    // this, not the takeoffLineId / workStepId / craft key.
    targetLabel: targetLabel ?? null,
    suggestedEvidenceSummary: null,
  };
}

export function buildCandidates(snapshot) {
  const candidates = [];
  const insufficiencies = [];
  const ownerId = snapshot?.ownerId ?? null;
  const packageId = snapshot?.packageId ?? null;
  const asOf = snapshot?.asOf ?? null;
  const baseline = snapshot?.baseline ?? null;
  const activeBusts = snapshot?.activeBusts ?? [];
  const latestProgress = snapshot?.latestProgress ?? null;

  if (isTerminalPackageStatus(snapshot?.packageStatus)) {
    insufficiencies.push({
      dimension: null,
      reason: `Package is ${snapshot.packageStatus}; bust detection does not run on a terminal package.`,
    });
    return { candidates, insufficiencies };
  }

  // -- Installed quantity: per takeoff line, installed-as-of vs plan.
  for (const line of snapshot?.takeoffLines ?? []) {
    if (line.installedQuantity === null || line.installedQuantity === undefined
      || line.quantity === null || line.quantity === undefined) {
      insufficiencies.push({
        dimension: "INSTALLED_QUANTITY",
        reason: `Takeoff line ${line.id ?? "?"} has no installed-as-of quantity to compare.`,
      });
      continue;
    }
    if (!isUnfavorableVariance("INSTALLED_QUANTITY", line.quantity, line.installedQuantity)) continue;
    const candidate = candidateBase({
      ownerId, packageId,
      dimension: "INSTALLED_QUANTITY",
      scopeType: "TAKEOFF_LINE",
      takeoffLineId: line.id,
      baselineId: null,
      baselineVersion: null,
      plannedValue: line.quantity,
      observedValue: line.installedQuantity,
      unit: line.unit,
      comparisonAsOf: asOf,
      activeBusts,
      targetLabel: line.drawingNumber
        ? `Drawing ${line.drawingNumber} — ${line.quantity} ${line.unit} planned`
        : `Takeoff line — ${line.quantity} ${line.unit} planned`,
    });
    candidate.suggestedEvidenceSummary =
      `Installed ${line.installedQuantity} ${line.unit} against a planned quantity of `
      + `${line.quantity} ${line.unit} as of ${asOf}.`;
    candidates.push(candidate);
  }

  // -- Labor hours / labor cost: latest progress actuals vs the
  //    frozen baseline. The allowance is the baseline the progress
  //    snapshot was measured against (progressBaseline), which may
  //    be an older version than the current frozen baseline — a
  //    later re-baseline must not rewrite what the snapshot measured.
  //    When the snapshot names no baseline, the current frozen
  //    baseline is the allowance.
  const allowanceBaseline = snapshot?.progressBaseline ?? baseline;
  if (!baseline) {
    insufficiencies.push({
      dimension: "LABOR_HOURS",
      reason: "No frozen baseline — labor hours have no allowance to compare against.",
    });
    insufficiencies.push({
      dimension: "LABOR_COST",
      reason: "No frozen baseline — labor cost has no allowance to compare against.",
    });
    insufficiencies.push({
      dimension: "SCHEDULE_DAYS",
      reason: "No frozen baseline — schedule has no planned finish to compare against.",
    });
  } else if (!latestProgress) {
    insufficiencies.push({
      dimension: "LABOR_HOURS",
      reason: "No progress snapshot — no actual hours to compare against the baseline.",
    });
    insufficiencies.push({
      dimension: "LABOR_COST",
      reason: "No progress snapshot — no actual cost to compare against the baseline.",
    });
    insufficiencies.push({
      dimension: "SCHEDULE_DAYS",
      reason: "No progress snapshot — no status date to compare against the baseline finish.",
    });
  } else if (latestProgress.baselineVersion !== null && latestProgress.baselineVersion !== undefined
    && latestProgress.baselineVersion !== baseline.versionNumber
    && !snapshot?.progressBaseline) {
    // The snapshot was measured against a baseline version that is
    // no longer on file. Comparing its actuals against the current
    // baseline's allowance would be a false comparison — say so and
    // evaluate nothing for these dimensions.
    insufficiencies.push({
      dimension: "LABOR_HOURS",
      reason: `The progress snapshot names baseline v${latestProgress.baselineVersion}, which is no longer on file — labor hours have no allowance to compare against.`,
    });
    insufficiencies.push({
      dimension: "LABOR_COST",
      reason: `The progress snapshot names baseline v${latestProgress.baselineVersion}, which is no longer on file — labor cost has no allowance to compare against.`,
    });
    insufficiencies.push({
      dimension: "SCHEDULE_DAYS",
      reason: `The progress snapshot names baseline v${latestProgress.baselineVersion}, which is no longer on file — schedule has no planned finish to compare against.`,
    });
  } else {
    const baselineNote = allowanceBaseline.versionNumber === baseline.versionNumber
      ? `baseline v${baseline.versionNumber}`
      : `the snapshot's named baseline v${allowanceBaseline.versionNumber} (current frozen baseline is v${baseline.versionNumber})`;
    if (latestProgress.actualHours !== null && latestProgress.actualHours !== undefined
      && allowanceBaseline.baselineHours !== null && allowanceBaseline.baselineHours !== undefined
      && isUnfavorableVariance("LABOR_HOURS", allowanceBaseline.baselineHours, latestProgress.actualHours)) {
      const candidate = candidateBase({
        ownerId, packageId,
        dimension: "LABOR_HOURS",
        scopeType: "PACKAGE",
        baselineId: allowanceBaseline.id,
        baselineVersion: allowanceBaseline.versionNumber,
        plannedValue: allowanceBaseline.baselineHours,
        observedValue: latestProgress.actualHours,
        unit: "HOURS",
        comparisonAsOf: latestProgress.statusDate,
        activeBusts,
        targetLabel: "Whole package",
      });
      candidate.suggestedEvidenceSummary =
        `Actual ${latestProgress.actualHours} person-hours against ${allowanceBaseline.baselineHours} planned hours `
        + `(${baselineNote}) as of ${latestProgress.statusDate}.`;
      candidates.push(candidate);
    }
    if (latestProgress.actualCostCents !== null && latestProgress.actualCostCents !== undefined
      && allowanceBaseline.baselineCostCents !== null && allowanceBaseline.baselineCostCents !== undefined
      && isUnfavorableVariance("LABOR_COST", allowanceBaseline.baselineCostCents, latestProgress.actualCostCents)) {
      const candidate = candidateBase({
        ownerId, packageId,
        dimension: "LABOR_COST",
        scopeType: "PACKAGE",
        baselineId: allowanceBaseline.id,
        baselineVersion: allowanceBaseline.versionNumber,
        plannedValue: allowanceBaseline.baselineCostCents,
        observedValue: latestProgress.actualCostCents,
        unit: "USD_CENTS",
        comparisonAsOf: latestProgress.statusDate,
        activeBusts,
        targetLabel: "Whole package",
      });
      candidate.suggestedEvidenceSummary =
        `Actual cost ${formatCents(latestProgress.actualCostCents)} against `
        + `${formatCents(allowanceBaseline.baselineCostCents)} planned (${baselineNote}) as of ${latestProgress.statusDate}.`;
      candidates.push(candidate);
    }
    // -- Schedule days (package): status date past the frozen finish.
    if (!allowanceBaseline.baselineStart || !allowanceBaseline.baselineFinish) {
      insufficiencies.push({
        dimension: "SCHEDULE_DAYS",
        reason: "The frozen baseline has no start/finish window — schedule has no planned finish to compare against.",
      });
    } else {
      const plannedSpan = calendarDaySpan(allowanceBaseline.baselineStart, allowanceBaseline.baselineFinish);
      const observedSpan = calendarDaySpan(allowanceBaseline.baselineStart, latestProgress.statusDate);
      if (plannedSpan !== null && observedSpan !== null
        && isUnfavorableVariance("SCHEDULE_DAYS", plannedSpan, observedSpan)) {
        const candidate = candidateBase({
          ownerId, packageId,
          dimension: "SCHEDULE_DAYS",
          scopeType: "PACKAGE",
          baselineId: allowanceBaseline.id,
          baselineVersion: allowanceBaseline.versionNumber,
          plannedValue: plannedSpan,
          observedValue: observedSpan,
          unit: "DAYS",
          comparisonAsOf: latestProgress.statusDate,
          activeBusts,
          targetLabel: "Whole package",
        });
        candidate.suggestedEvidenceSummary =
          `As of ${latestProgress.statusDate} the package is ${observedSpan - plannedSpan} day(s) past its `
          + `baseline finish ${allowanceBaseline.baselineFinish} (planned span ${plannedSpan} days from ${allowanceBaseline.baselineStart}).`;
        candidates.push(candidate);
      }
    }
  }

  // -- Manpower shortfall: per (date, craft) from the slice-6 curve.
  //    Required comes from the curve's equal-spread placement of the
  //    frozen baseline; capacity is the summed assignments for that
  //    craft on that day. Steps the curve excludes (missing hours,
  //    missing craft, placement outside the window) are NOT in the
  //    required figure — the evidence summary says so when any exist.
  if (baseline) {
    const curve = computeManpowerCurve({
      baseline: {
        versionNumber: baseline.versionNumber,
        baselineStart: baseline.baselineStart,
        baselineFinish: baseline.baselineFinish,
        frozenAt: baseline.frozenAt ?? null,
      },
      steps: snapshot?.steps ?? [],
      placements: snapshot?.placements ?? [],
      assignments: snapshot?.assignments ?? [],
    });
    const excludedNote = curve.excludedSteps.length > 0
      ? ` ${curve.excludedSteps.length} step(s) are excluded from the curve (missing hours, craft, or placement), so their hours are not in the required figure.`
      : "";
    for (const day of curve.days ?? []) {
      for (const craftKey of Object.keys(day.crafts ?? {})) {
        const cell = day.crafts[craftKey];
        if (!isUnfavorableVariance("MANPOWER_SHORTFALL", cell.requiredHours, cell.assignedHours)) continue;
        const candidate = candidateBase({
          ownerId, packageId,
          dimension: "MANPOWER_SHORTFALL",
          scopeType: "CRAFT_DAY",
          craft: craftKey,
          workDate: day.date,
          shiftKey: null,
          baselineId: baseline.id,
          baselineVersion: baseline.versionNumber,
          plannedValue: cell.requiredHours,
          observedValue: cell.assignedHours,
          unit: "HOURS",
          comparisonAsOf: asOf,
          activeBusts,
          targetLabel: `${cell.craftLabel ?? craftKey} — ${day.date}`,
        });
        candidate.suggestedEvidenceSummary =
          `On ${day.date}, ${cell.craftLabel ?? craftKey} requires ${cell.requiredHours} person-hours `
          + `but only ${cell.assignedHours} are assigned (short ${cell.requiredHours - cell.assignedHours} hours).${excludedNote}`;
        candidates.push(candidate);
      }
    }
    if (curve.excludedSteps.length > 0) {
      insufficiencies.push({
        dimension: "MANPOWER_SHORTFALL",
        reason: `${curve.excludedSteps.length} step(s) are excluded from the manpower curve — their required hours are not in any shortfall figure.`,
      });
    }
  } else {
    insufficiencies.push({
      dimension: "MANPOWER_SHORTFALL",
      reason: "No frozen baseline — manpower demand cannot be placed on days.",
    });
  }

  return { candidates, insufficiencies };
}

// Plain-words cents: 207500 -> "$2,075.00".
export function formatCents(cents) {
  if (cents === null || cents === undefined) return "—";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(remainder).padStart(2, "0")}`;
}

// Plain-words variance for display: "12.5 EA over plan (10 EA)" etc.
export function formatVarianceLabel(candidate) {
  if (!candidate) return "—";
  const { dimension, plannedValue, observedValue, varianceValue, variancePercent, unit } = candidate;
  const value = (n) => (dimension === "LABOR_COST" ? formatCents(n) : `${n} ${unit}`);
  const base = dimension === "MANPOWER_SHORTFALL"
    ? `${varianceValue} ${unit} short (required ${value(plannedValue)}, assigned ${value(observedValue)})`
    : `${value(observedValue)} vs ${value(plannedValue)} planned — ${value(varianceValue)} over`;
  return variancePercent === null || variancePercent === undefined
    ? base
    : `${base} (${variancePercent}%)`;
}

// ---------------------------------------------------------------------------
// Input validation for a confirm (create) call — mirrors the RPC's
// rules so the application can return a 400 without a round-trip.
// The RPC remains the validator of record; this never widens it.
// Returns an array of error codes (empty = valid).
// ---------------------------------------------------------------------------

export function validateConfirmInput(input) {
  const errors = [];
  const dimension = input?.dimension;
  const scopeType = input?.scopeType;
  if (!BUST_DIMENSIONS.includes(dimension)) errors.push("INVALID_DIMENSION");
  if (!BUST_SCOPES.includes(scopeType)) errors.push("INVALID_SCOPE");
  if (dimension && scopeType && !(DIMENSION_SCOPES[dimension] ?? []).includes(scopeType)) {
    errors.push("INVALID_TARGET");
  }
  if (scopeType === "TAKEOFF_LINE" && !input?.takeoffLineId) errors.push("INVALID_TARGET");
  if (scopeType === "WORK_STEP" && !input?.workStepId) errors.push("INVALID_TARGET");
  if (scopeType === "CRAFT_DAY" && (!input?.craft || !input?.workDate)) errors.push("INVALID_TARGET");
  if (dimension && dimension !== "INSTALLED_QUANTITY" && (!input?.baselineId || input?.baselineVersion === null || input?.baselineVersion === undefined)) {
    errors.push("INVALID_BASELINE");
  }
  const expectedUnit = dimension === "INSTALLED_QUANTITY" ? input?.unit : DIMENSION_UNITS[dimension];
  if (dimension && dimension !== "INSTALLED_QUANTITY" && input?.unit !== expectedUnit) {
    errors.push("INVALID_UNIT");
  }
  const planned = input?.plannedValue;
  const observed = input?.observedValue;
  if (planned === null || planned === undefined || observed === null || observed === undefined
    || !Number.isFinite(planned) || !Number.isFinite(observed)) {
    errors.push("INVALID_VALUE");
  } else {
    const scale = DIMENSION_SCALE[dimension] ?? 4;
    const atScale = (n) => Math.round(n * 10 ** scale) / 10 ** scale === n;
    if (planned < 0 || observed < 0) {
      errors.push("INVALID_VALUE");
    } else if (dimension === "LABOR_COST" && (!Number.isInteger(planned) || !Number.isInteger(observed))) {
      // Costs are whole cents — checked before the scale rule, so a
      // fractional-cent figure reports INVALID_COST (as the RPC does),
      // not the generic INVALID_VALUE.
      errors.push("INVALID_COST");
    } else if (!atScale(planned) || !atScale(observed)) {
      errors.push("INVALID_VALUE");
    } else if (!isUnfavorableVariance(dimension, planned, observed)) {
      errors.push("INVALID_VALUE");
    }
  }
  const summary = input?.evidenceSummary;
  if (typeof summary !== "string" || summary.trim().length < EVIDENCE_MIN_LENGTH
    || summary.length > EVIDENCE_MAX_LENGTH || /[\u0000-\u001F]/.test(summary)) {
    errors.push("INVALID_EVIDENCE");
  }
  if (input?.evidenceRef !== null && input?.evidenceRef !== undefined
    && (typeof input.evidenceRef !== "string" || input.evidenceRef.length > 500
      || /[\u0000-\u001F]/.test(input.evidenceRef))) {
    errors.push("INVALID_EVIDENCE");
  }
  if (!input?.comparisonAsOf || !/^\d{4}-\d{2}-\d{2}$/.test(input.comparisonAsOf)) {
    errors.push("INVALID_VALUE");
  }
  if (input?.reason !== null && input?.reason !== undefined
    && (typeof input.reason !== "string" || input.reason.length > REASON_MAX_LENGTH)) {
    errors.push("REASON_TOO_LONG");
  }
  return errors;
}
