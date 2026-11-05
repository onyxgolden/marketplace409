/**
 * recurrence.js — declarative recurrence rules + next-due PREVIEW math.
 * P1-A slice only: pure functions, no timers, no cron, no queue, no
 * scheduler registration of any kind. A rule is stored data; these
 * functions only compute what a rule WOULD do, for preview display.
 *
 * DST rules (pinned by tests, documented in README):
 * - Missing local time (spring-forward gap, e.g. 02:30 on the day
 *   America/Chicago jumps 02:00 -> 03:00): that day has NO occurrence.
 *   The rule never silently shifts to a time the operator did not ask for.
 * - Ambiguous local time (fall-back repeat, e.g. 01:30 occurring twice):
 *   the FIRST occurrence (earlier UTC instant) wins, deterministically.
 * - Monthly day-of-month with no such day that month (e.g. day 31 in
 *   February): that month is skipped, never clamped to the 30th.
 * - Weekly/daily times are wall-clock times in the job's IANA zone;
 *   the UTC instant moves with DST, the local time does not.
 *
 * Conversion uses only Intl.DateTimeFormat (Node 24, full-icu). No deps.
 */

import { CODES, refuse } from "./errors.js";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const UTC_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const MAX_SEARCH_DAYS = 400;
const MAX_PREVIEW_COUNT = 31;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** True iff tz is accepted by Intl as a time-zone identifier. */
export function isValidTimezone(tz) {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parseTime(time, where) {
  if (typeof time !== "string" || !TIME_RE.test(time)) {
    refuse(CODES.MALFORMED_RECURRENCE, `${where}.time must be 'HH:MM' 24-hour, got '${String(time)}'`);
  }
  const [h, m] = time.split(":").map(Number);
  return { hour: h, minute: m, time };
}

/**
 * Validate a recurrence object. Returns a normalized copy.
 * Shape: { timezone, rule } where rule is one of:
 *   { kind: "daily", time }
 *   { kind: "weekly", weekdays: [0..6] (0 = Sunday), time }
 *   { kind: "monthly", day: 1..31, time }
 */
export function validateRecurrence(rec) {
  if (!isPlainObject(rec)) refuse(CODES.MALFORMED_RECURRENCE, "recurrence must be an object");
  for (const k of Object.keys(rec)) {
    if (k !== "timezone" && k !== "rule") refuse(CODES.MALFORMED_RECURRENCE, `unknown recurrence property '${k}'`);
  }
  if (!("timezone" in rec) || !("rule" in rec)) {
    refuse(CODES.MALFORMED_RECURRENCE, "recurrence requires 'timezone' and 'rule'");
  }
  if (!isValidTimezone(rec.timezone)) {
    refuse(CODES.MALFORMED_RECURRENCE, `invalid IANA timezone '${String(rec.timezone)}'`);
  }
  const rule = rec.rule;
  if (!isPlainObject(rule)) refuse(CODES.MALFORMED_RECURRENCE, "recurrence.rule must be an object");
  const t = parseTime(rule.time, "recurrence.rule");
  if (rule.kind === "daily") {
    for (const k of Object.keys(rule)) {
      if (k !== "kind" && k !== "time") refuse(CODES.MALFORMED_RECURRENCE, `unknown daily rule property '${k}'`);
    }
    return { timezone: rec.timezone, rule: { kind: "daily", time: t.time } };
  }
  if (rule.kind === "weekly") {
    for (const k of Object.keys(rule)) {
      if (k !== "kind" && k !== "weekdays" && k !== "time") {
        refuse(CODES.MALFORMED_RECURRENCE, `unknown weekly rule property '${k}'`);
      }
    }
    const wd = rule.weekdays;
    if (!Array.isArray(wd) || wd.length === 0 || wd.length > 7) {
      refuse(CODES.MALFORMED_RECURRENCE, "weekly weekdays must be a non-empty array of at most 7 days");
    }
    const seen = new Set();
    for (const d of wd) {
      if (!Number.isInteger(d) || d < 0 || d > 6) {
        refuse(CODES.MALFORMED_RECURRENCE, `weekday must be an integer 0..6 (0 = Sunday), got '${String(d)}'`);
      }
      if (seen.has(d)) refuse(CODES.MALFORMED_RECURRENCE, `duplicate weekday ${d}`);
      seen.add(d);
    }
    return { timezone: rec.timezone, rule: { kind: "weekly", weekdays: [...wd].sort((a, b) => a - b), time: t.time } };
  }
  if (rule.kind === "monthly") {
    for (const k of Object.keys(rule)) {
      if (k !== "kind" && k !== "day" && k !== "time") {
        refuse(CODES.MALFORMED_RECURRENCE, `unknown monthly rule property '${k}'`);
      }
    }
    if (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > 31) {
      refuse(CODES.MALFORMED_RECURRENCE, `monthly day must be an integer 1..31, got '${String(rule.day)}'`);
    }
    return { timezone: rec.timezone, rule: { kind: "monthly", day: rule.day, time: t.time } };
  }
  refuse(CODES.MALFORMED_RECURRENCE, `unknown recurrence kind '${String(rule.kind)}'`);
}

/** Wall-clock parts of a UTC instant in a zone (hourCycle h23, with the hour-24 normalization some environments emit at midnight). */
export function partsInZone(ms, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  let year = get("year");
  let month = get("month");
  let day = get("day");
  let hour = get("hour");
  const minute = get("minute");
  const second = get("second");
  if (hour === 24) {
    hour = 0;
    const rolled = new Date(Date.UTC(year, month - 1, day) + 86400000);
    year = rolled.getUTCFullYear();
    month = rolled.getUTCMonth() + 1;
    day = rolled.getUTCDate();
  }
  return { year, month, day, hour, minute, second };
}

/**
 * Convert a wall-clock local time to a UTC instant, or null when the
 * local time does not exist that day (spring-forward gap). Iteration
 * converges for real times (including the fall-back first occurrence)
 * and oscillates without converging for gap times — that oscillation
 * IS the gap detection, not a bug: no UTC instant has that wall clock.
 */
export function zonedTimeToUtc(year, month, day, hour, minute, tz) {
  const targetWall = Date.UTC(year, month - 1, day, hour, minute, 0);
  let t = targetWall;
  for (let i = 0; i < 5; i++) {
    const w = partsInZone(t, tz);
    const wallAsUTC = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    if (wallAsUTC === targetWall) return t;
    t += targetWall - wallAsUTC;
  }
  return null;
}

function parseAfterInstant(after) {
  if (typeof after !== "string" || !UTC_INSTANT_RE.test(after) || Number.isNaN(Date.parse(after))) {
    refuse(CODES.BAD_JOB, "after must be an explicit UTC instant (Zulu)");
  }
  return Date.parse(after);
}

function ruleMatches(rule, year, month, day) {
  if (rule.kind === "daily") return true;
  if (rule.kind === "weekly") {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return rule.weekdays.includes(weekday);
  }
  return rule.day === day; // monthly: a month with no such day simply never matches
}

/**
 * Next occurrence strictly after `after` (UTC instant, Zulu), as an ISO
 * UTC string. Preview only — computes, never schedules.
 */
export function nextDueAfter(definition, after) {
  const raw = definition?.recurrence;
  if (!raw || typeof raw !== "object") {
    refuse(CODES.MALFORMED_RECURRENCE, "definition.recurrence is missing or malformed");
  }
  const rec = validateRecurrence(raw);
  const { hour, minute } = parseTime(rec.rule.time, "recurrence.rule");
  const afterMs = parseAfterInstant(after);
  const start = partsInZone(afterMs, rec.timezone);
  let cursor = Date.UTC(start.year, start.month - 1, start.day);
  for (let d = 0; d < MAX_SEARCH_DAYS; d++) {
    const cur = new Date(cursor);
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth() + 1;
    const day = cur.getUTCDate();
    if (ruleMatches(rec.rule, y, m, day)) {
      const t = zonedTimeToUtc(y, m, day, hour, minute, rec.timezone);
      if (t !== null && t > afterMs) return new Date(t).toISOString();
    }
    cursor += 86400000;
  }
  refuse(CODES.NO_OCCURRENCE, `no occurrence within ${MAX_SEARCH_DAYS} days`);
}

/** Next `count` occurrences after `from`, in order. Count 1..31. */
export function previewOccurrences(definition, from, count) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PREVIEW_COUNT) {
    refuse(CODES.BAD_JOB, `preview count must be an integer 1..${MAX_PREVIEW_COUNT}`);
  }
  const out = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const next = nextDueAfter(definition, cursor);
    out.push(next);
    cursor = next;
  }
  return out;
}
