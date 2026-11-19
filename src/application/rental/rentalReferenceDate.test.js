import { afterEach, describe, expect, it, vi } from "vitest";
import { RENTAL_TIME_ZONE, rentalReferenceDate } from "./rentalReferenceDate";

describe("rentalReferenceDate", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("defaults to the current America/Chicago date, not the UTC date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T03:20:00Z"));
    expect(rentalReferenceDate()).toBe("2026-11-18");
  });
  it("uses America/Chicago, not UTC", () => {
    expect(RENTAL_TIME_ZONE).toBe("America/Chicago");
  });

  it("maps 2026-11-19T03:20:00Z to 2026-11-18 in Chicago (CST, UTC-6)", () => {
    // 03:20 UTC is 21:20 the previous evening in Chicago — the UTC date is
    // already the next day, so a toISOString() reference date would be wrong.
    expect(rentalReferenceDate(new Date("2026-11-19T03:20:00Z"))).toBe("2026-11-18");
  });

  it("holds the November month-end in CST", () => {
    // 05:30 UTC on Dec 1 is 23:30 Nov 30 in Chicago; 06:30 UTC is 00:30 Dec 1.
    expect(rentalReferenceDate(new Date("2026-12-01T05:30:00Z"))).toBe("2026-11-30");
    expect(rentalReferenceDate(new Date("2026-12-01T06:30:00Z"))).toBe("2026-12-01");
  });

  it("holds the year-end in CST", () => {
    expect(rentalReferenceDate(new Date("2027-01-01T05:30:00Z"))).toBe("2026-12-31");
    expect(rentalReferenceDate(new Date("2027-01-01T06:30:00Z"))).toBe("2027-01-01");
  });

  it("holds the June month-end in CDT (UTC-5)", () => {
    // 04:30 UTC on Jul 1 is 23:30 Jun 30 in Chicago; 05:30 UTC is 00:30 Jul 1.
    expect(rentalReferenceDate(new Date("2026-07-01T04:30:00Z"))).toBe("2026-06-30");
    expect(rentalReferenceDate(new Date("2026-07-01T05:30:00Z"))).toBe("2026-07-01");
  });

  it("holds the October month-end across the DST fallback (CDT to CST)", () => {
    // DST ends Nov 1, 2026 at 2:00 AM local (07:00 UTC). 06:30 UTC is still
    // 01:30 CDT on Nov 1; 07:30 UTC is 01:30 CST on Nov 1. Both are Nov 1 —
    // the repeated hour must not shift the calendar date.
    expect(rentalReferenceDate(new Date("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
    expect(rentalReferenceDate(new Date("2026-11-01T06:30:00Z"))).toBe("2026-11-01");
    expect(rentalReferenceDate(new Date("2026-11-01T07:30:00Z"))).toBe("2026-11-01");
    // And the last evening of October is still October in Chicago.
    expect(rentalReferenceDate(new Date("2026-11-01T04:30:00Z"))).toBe("2026-10-31");
  });

  it("holds the spring-forward day in CDT", () => {
    // DST starts Mar 8, 2026 at 2:00 AM local (08:00 UTC). 07:30 UTC is
    // 01:30 CST; 08:30 UTC is 03:30 CDT. Both are Mar 8.
    expect(rentalReferenceDate(new Date("2026-03-08T07:30:00Z"))).toBe("2026-03-08");
    expect(rentalReferenceDate(new Date("2026-03-08T08:30:00Z"))).toBe("2026-03-08");
  });

  it("returns a YYYY-MM-DD string", () => {
    expect(rentalReferenceDate(new Date("2026-11-18T15:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
