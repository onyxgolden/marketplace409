/**
 * metrics.test.js — ticket validity classification and exact-rational
 * metrics (means, SLA ratio, CSAT), including the brief's own worked
 * examples (3.8 mean / 70% positive, exact SLA boundary).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ticketValidity, meanMinutesExact, slaRatioExact, csatExact } from "../src/metrics.js";
import { rToFixed, rToPercentFixed } from "../src/canonical.js";

function ticket(overrides) {
  return { created_at: "2026-06-01T10:00:00Z", first_response_at: null, resolved_at: null, status: "OPEN", ...overrides };
}
const CLOCK = Date.parse("2026-07-01T00:00:00Z");

test("OPEN with no first response is pending", () => {
  assert.equal(ticketValidity(ticket({}), CLOCK).state, "pending");
});

test("OPEN with a first response is valid and yields a response delta", () => {
  const v = ticketValidity(ticket({ first_response_at: "2026-06-01T10:05:00Z" }), CLOCK);
  assert.equal(v.state, "valid");
  assert.equal(v.responseMs, 5 * 60000);
  assert.equal(v.resolutionMs, null);
});

test("RESOLVED with both timestamps is valid and yields both deltas", () => {
  const v = ticketValidity(ticket({ status: "RESOLVED", first_response_at: "2026-06-01T10:05:00Z", resolved_at: "2026-06-01T11:00:00Z" }), CLOCK);
  assert.equal(v.state, "valid");
  assert.equal(v.responseMs, 5 * 60000);
  assert.equal(v.resolutionMs, 60 * 60000);
});

test("RESOLVED missing first_response_at is invalid (RESOLVED_INCOMPLETE)", () => {
  const v = ticketValidity(ticket({ status: "RESOLVED", resolved_at: "2026-06-01T11:00:00Z" }), CLOCK);
  assert.equal(v.state, "invalid");
  assert.equal(v.reason, "RESOLVED_INCOMPLETE");
});

test("RESOLVED missing resolved_at is invalid (RESOLVED_INCOMPLETE)", () => {
  const v = ticketValidity(ticket({ status: "RESOLVED", first_response_at: "2026-06-01T10:05:00Z" }), CLOCK);
  assert.equal(v.state, "invalid");
  assert.equal(v.reason, "RESOLVED_INCOMPLETE");
});

test("OPEN with a resolution timestamp set is invalid (STATUS_MISMATCH)", () => {
  const v = ticketValidity(ticket({ first_response_at: "2026-06-01T10:05:00Z", resolved_at: "2026-06-01T11:00:00Z" }), CLOCK);
  assert.equal(v.state, "invalid");
  assert.equal(v.reason, "STATUS_MISMATCH");
});

test("first_response before created is invalid (NEGATIVE_INTERVAL)", () => {
  const v = ticketValidity(ticket({ first_response_at: "2026-06-01T09:00:00Z" }), CLOCK);
  assert.equal(v.state, "invalid");
  assert.equal(v.reason, "NEGATIVE_INTERVAL");
});

test("resolved before first_response is invalid (NEGATIVE_INTERVAL)", () => {
  const v = ticketValidity(ticket({ status: "RESOLVED", first_response_at: "2026-06-01T11:00:00Z", resolved_at: "2026-06-01T10:00:00Z" }), CLOCK);
  assert.equal(v.state, "invalid");
  assert.equal(v.reason, "NEGATIVE_INTERVAL");
});

test("created_at after the clock is invalid (FUTURE_TIMESTAMP)", () => {
  const v = ticketValidity(ticket({ created_at: "2099-01-01T00:00:00Z" }), CLOCK);
  assert.equal(v.state, "invalid");
  assert.equal(v.reason, "FUTURE_TIMESTAMP");
});

test("meanMinutesExact is null with no observations (never a false zero)", () => {
  assert.equal(meanMinutesExact([]), null);
});

test("meanMinutesExact of a single 10-minute delta is exactly 10", () => {
  const r = meanMinutesExact([10 * 60000]);
  assert.equal(rToFixed(r, 2), "10.00");
});

test("meanMinutesExact of [10,20] minutes is exactly 15.00, not a float artifact", () => {
  const r = meanMinutesExact([10 * 60000, 20 * 60000]);
  assert.equal(rToFixed(r, 2), "15.00");
});

test("slaRatioExact: exact-boundary minute is compliant (inclusive)", () => {
  const { compliant, denominator } = slaRatioExact([{ num: 30n, den: 1n }], 30);
  assert.equal(compliant, 1);
  assert.equal(denominator, 1);
});

test("slaRatioExact: one minute over the boundary is not compliant", () => {
  const { compliant } = slaRatioExact([{ num: 31n, den: 1n }], 30);
  assert.equal(compliant, 0);
});

test("slaRatioExact with no observations returns null ratio, not zero", () => {
  assert.equal(slaRatioExact([], 30).ratio, null);
});

test("slaRatioExact matches the brief's own worked example: 10:00->14:00 is 240 minutes", () => {
  const responseMs = Date.parse("2026-06-01T14:00:00Z") - Date.parse("2026-06-01T10:00:00Z");
  assert.equal(responseMs / 60000, 240);
});

test("csatExact matches the brief's worked example: 7x5 + 3x1 -> mean 3.80, positive 70%", () => {
  const ratings = [...Array(7).fill(5), ...Array(3).fill(1)];
  const { mean, positiveShare } = csatExact(ratings);
  assert.equal(rToFixed(mean, 2), "3.80");
  assert.equal(rToPercentFixed(positiveShare, 2), "70.00");
});

test("csatExact mean and positive share are independent measures", () => {
  // All ratings exactly 3: mean is 3.00 but positive share (>=4) is 0% —
  // these must never be conflated into one number.
  const { mean, positiveShare } = csatExact([3, 3, 3, 3]);
  assert.equal(rToFixed(mean, 2), "3.00");
  assert.equal(rToPercentFixed(positiveShare, 2), "0.00");
});

test("csatExact with no ratings returns null, not UNDEFINED-as-zero", () => {
  const { mean, positiveShare, ratedCount } = csatExact([]);
  assert.equal(mean, null);
  assert.equal(positiveShare, null);
  assert.equal(ratedCount, 0);
});
