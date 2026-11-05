import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateRecurrence, nextDueAfter, previewOccurrences, zonedTimeToUtc, partsInZone,
} from "../src/recurrence.js";
import { validDefinition, expectCode } from "./helpers.js";

const TZ = "America/Chicago";

function defWith(rule, timezone = TZ) {
  return validDefinition({ recurrence: { timezone, rule } });
}

test("recurrence shape validation", () => {
  assert.doesNotThrow(() => validateRecurrence({ timezone: TZ, rule: { kind: "daily", time: "09:00" } }));
  assert.doesNotThrow(() => validateRecurrence({ timezone: TZ, rule: { kind: "weekly", weekdays: [1, 3], time: "09:00" } }));
  assert.doesNotThrow(() => validateRecurrence({ timezone: TZ, rule: { kind: "monthly", day: 31, time: "09:00" } }));
  expectCode(() => validateRecurrence({ timezone: "Not/AZone", rule: { kind: "daily", time: "09:00" } }), "MALFORMED_RECURRENCE");
  expectCode(() => validateRecurrence({ timezone: TZ, rule: { kind: "daily", time: "24:00" } }), "MALFORMED_RECURRENCE");
  expectCode(() => validateRecurrence({ timezone: TZ, rule: { kind: "daily", time: "9:00" } }), "MALFORMED_RECURRENCE");
  expectCode(() => validateRecurrence({ timezone: TZ, rule: { kind: "hourly", time: "09:00" } }), "MALFORMED_RECURRENCE");
  expectCode(() => validateRecurrence({ timezone: TZ, rule: { kind: "weekly", weekdays: [], time: "09:00" } }), "MALFORMED_RECURRENCE");
  expectCode(() => validateRecurrence({ timezone: TZ, rule: { kind: "weekly", weekdays: [1, 1], time: "09:00" } }), "MALFORMED_RECURRENCE");
  expectCode(() => validateRecurrence({ timezone: TZ, rule: { kind: "weekly", weekdays: [7], time: "09:00" } }), "MALFORMED_RECURRENCE");
  expectCode(() => validateRecurrence({ timezone: TZ, rule: { kind: "monthly", day: 0, time: "09:00" } }), "MALFORMED_RECURRENCE");
  expectCode(() => validateRecurrence({ timezone: TZ, rule: { kind: "monthly", day: 32, time: "09:00" } }), "MALFORMED_RECURRENCE");
  expectCode(() => validateRecurrence({ timezone: TZ, rule: { kind: "daily", time: "09:00", extra: 1 } }), "MALFORMED_RECURRENCE");
});

test("daily next-due is strictly after, wall-clock stable", () => {
  const def = defWith({ kind: "daily", time: "09:00" });
  // 2026-11-04 06:00 CST = 12:00Z; next 09:00 CST = 15:00Z same day.
  assert.equal(nextDueAfter(def, "2026-11-04T12:00:00Z"), "2026-11-04T15:00:00.000Z");
  // Exactly at the occurrence: strictly after, so next day.
  assert.equal(nextDueAfter(def, "2026-11-04T15:00:00Z"), "2026-11-05T15:00:00.000Z");
  expectCode(() => nextDueAfter(def, "2026-11-04 12:00:00"), "BAD_JOB");
  expectCode(() => nextDueAfter(defWith({ kind: "daily", time: "09:00" }, "No/Such"), "2026-11-04T12:00:00Z"), "MALFORMED_RECURRENCE");
});

test("weekly next-due picks the next listed weekday", () => {
  const def = defWith({ kind: "weekly", weekdays: [1], time: "09:00" }); // Mondays
  // Wed 2026-11-04 -> Mon 2026-11-09 09:00 CST = 15:00Z.
  assert.equal(nextDueAfter(def, "2026-11-04T12:00:00Z"), "2026-11-09T15:00:00.000Z");
  // Monday before 09:00 local counts the same day.
  assert.equal(nextDueAfter(def, "2026-11-09T12:00:00Z"), "2026-11-09T15:00:00.000Z");
});

test("monthly day 31 skips short months, never clamps", () => {
  const def = defWith({ kind: "monthly", day: 31, time: "09:00" });
  assert.equal(nextDueAfter(def, "2026-01-15T00:00:00Z"), "2026-01-31T15:00:00.000Z");
  // February has no 31st: Jan 31 -> Mar 31 (CDT by then, 14:00Z).
  assert.equal(nextDueAfter(def, "2026-02-01T00:00:00Z"), "2026-03-31T14:00:00.000Z");
});

test("spring-forward gap day has no occurrence", () => {
  // America/Chicago jumps 02:00 -> 03:00 on 2026-03-08. 02:30 never exists.
  assert.equal(zonedTimeToUtc(2026, 3, 8, 2, 30, TZ), null);
  const def = defWith({ kind: "daily", time: "02:30" });
  // Mar 7 02:30 CST = 08:30Z; Mar 8 skipped; Mar 9 02:30 CDT = 07:30Z.
  assert.equal(nextDueAfter(def, "2026-03-07T09:00:00Z"), "2026-03-09T07:30:00.000Z");
});

test("fall-back duplicate local time takes the FIRST occurrence", () => {
  // 2026-11-01: 01:30 occurs at 06:30Z (CDT) and 07:30Z (CST). First wins.
  assert.equal(zonedTimeToUtc(2026, 11, 1, 1, 30, TZ), Date.parse("2026-11-01T06:30:00Z"));
  const def = defWith({ kind: "daily", time: "01:30" });
  assert.equal(nextDueAfter(def, "2026-10-31T12:00:00Z"), "2026-11-01T06:30:00.000Z");
});

test("weekly local time is preserved across the DST shift", () => {
  const def = defWith({ kind: "weekly", weekdays: [1], time: "09:00" });
  // Mon Mar 2 09:00 CST = 15:00Z; Mon Mar 9 09:00 CDT = 14:00Z.
  assert.deepEqual(previewOccurrences(def, "2026-03-01T00:00:00Z", 2), [
    "2026-03-02T15:00:00.000Z",
    "2026-03-09T14:00:00.000Z",
  ]);
});

test("preview count bounds and chaining", () => {
  const def = defWith({ kind: "daily", time: "09:00" });
  const occ = previewOccurrences(def, "2026-11-04T12:00:00Z", 3);
  assert.deepEqual(occ, [
    "2026-11-04T15:00:00.000Z",
    "2026-11-05T15:00:00.000Z",
    "2026-11-06T15:00:00.000Z",
  ]);
  expectCode(() => previewOccurrences(def, "2026-11-04T12:00:00Z", 0), "BAD_JOB");
  expectCode(() => previewOccurrences(def, "2026-11-04T12:00:00Z", 32), "BAD_JOB");
});

test("partsInZone round-trips a known instant", () => {
  const p = partsInZone(Date.parse("2026-11-04T15:00:00Z"), TZ);
  assert.deepEqual(p, { year: 2026, month: 11, day: 4, hour: 9, minute: 0, second: 0 });
});
