import { describe, expect, it } from "vitest";
import { formatServerInstant, SERVER_INSTANT_TIME_ZONE } from "./serverDates";

describe("formatServerInstant", () => {
  it("renders the same text regardless of the host time zone", () => {
    // 2026-11-05T02:30:00Z is 11/5/2026 2:30 AM in UTC but 11/4/2026
    // 8:30 PM in America/Chicago — a locale-dependent render would
    // differ; the pinned formatter must not.
    const prevTz = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const utc = formatServerInstant("2026-11-05T02:30:00Z");
      process.env.TZ = "America/Chicago";
      const chicago = formatServerInstant("2026-11-05T02:30:00Z");
      expect(utc).toBe("11/4/2026, 8:30:00 PM");
      expect(chicago).toBe("11/4/2026, 8:30:00 PM");
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });

  it("accepts Date instances as well as ISO strings", () => {
    expect(formatServerInstant(new Date("2026-11-05T02:30:00Z"))).toBe("11/4/2026, 8:30:00 PM");
  });

  it("returns an empty string for missing or invalid input", () => {
    expect(formatServerInstant(null)).toBe("");
    expect(formatServerInstant(undefined)).toBe("");
    expect(formatServerInstant("")).toBe("");
    expect(formatServerInstant("not-a-date")).toBe("");
  });

  it("pins America/Chicago", () => {
    expect(SERVER_INSTANT_TIME_ZONE).toBe("America/Chicago");
  });
});
