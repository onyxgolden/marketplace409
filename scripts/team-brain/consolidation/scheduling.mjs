// Team Brain P6 — due-slot scheduling, pure functions (no I/O).
//
// One logical 03:00 America/Chicago run per civil date. Due-slot
// logic only: a run executes only when its slot instant has arrived,
// never early, never ad hoc for a future date. A missed slot is
// recorded MISSED, never silently backfilled.
//
// 03:00 always exists on both DST transition days in America/Chicago
// (spring forward skips 02:00–02:59; fall back repeats 01:00–01:59),
// so the slot instant is unambiguous — but the conversion still
// round-trips through Intl and refuses if the result does not read
// back as 03:00 on the requested civil date, rather than trusting
// arithmetic.

import { P6_CODES, fail } from "./errors.mjs";

export const SLOT_TIME_ZONE = "America/Chicago";
export const SLOT_HOUR = 3;
export const SLOT_MINUTE = 0;

// Strict YYYY-MM-DD with a real calendar date behind it.
export function assertCivilDate(civilDate) {
  if (typeof civilDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(civilDate)) {
    fail(P6_CODES.INVALID_RUN_DATE, `run date must be YYYY-MM-DD: ${civilDate}`, {
      runDate: civilDate,
    });
  }
  const [y, mo, d] = civilDate.split("-").map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) {
    fail(P6_CODES.INVALID_RUN_DATE, `run date is not a real calendar date: ${civilDate}`, {
      runDate: civilDate,
    });
  }
  return civilDate;
}

function tzOffsetMs(timeZone, date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// 03:00 America/Chicago on the civil date, as a UTC ISO string.
export function slotInstantForCivilDate(civilDate) {
  assertCivilDate(civilDate);
  const [y, mo, d] = civilDate.split("-").map(Number);
  const wallClock = Date.UTC(y, mo - 1, d, SLOT_HOUR, SLOT_MINUTE, 0);
  let guess = wallClock;
  for (let i = 0; i < 3; i += 1) {
    const next = wallClock - tzOffsetMs(SLOT_TIME_ZONE, new Date(guess));
    if (next === guess) break;
    guess = next;
  }
  const instant = new Date(guess);
  // Round-trip guard: the instant must read back as 03:00 on the
  // requested civil date in America/Chicago. A DST hole or fold that
  // broke the conversion fails loudly instead of scheduling a wrong
  // instant.
  const back = new Intl.DateTimeFormat("en-US", {
    timeZone: SLOT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type) => partsValue(back, type);
  const backDate = `${get("year")}-${get("month")}-${get("day")}`;
  if (backDate !== civilDate || Number(get("hour")) !== SLOT_HOUR || Number(get("minute")) !== SLOT_MINUTE) {
    fail(
      P6_CODES.INVALID_RUN_DATE,
      `03:00 ${SLOT_TIME_ZONE} on ${civilDate} does not round-trip (got ${backDate} ${get("hour")}:${get("minute")})`,
      { runDate: civilDate },
    );
  }
  return instant.toISOString();
}

function partsValue(parts, type) {
  return parts.find((p) => p.type === type).value;
}

// The civil date in America/Chicago for a UTC instant.
export function civilDateInChicago(utcIso) {
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) {
    fail(P6_CODES.INVALID_RUN_DATE, `not a valid UTC instant: ${utcIso}`, {});
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SLOT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${partsValue(parts, "year")}-${partsValue(parts, "month")}-${partsValue(parts, "day")}`;
}

// True when the run's slot instant has arrived at `now`.
export function isSlotDue(civilDate, nowIso) {
  const slot = slotInstantForCivilDate(civilDate);
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) {
    fail(P6_CODES.INVALID_RUN_DATE, `not a valid UTC instant: ${nowIso}`, {});
  }
  return now.getTime() >= Date.parse(slot);
}
