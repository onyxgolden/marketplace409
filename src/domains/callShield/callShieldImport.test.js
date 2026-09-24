import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildImportDedupeHash,
  findPossibleDuplicateCalls,
  normalizePhoneNumber,
  sha256Hex,
} from "./callShieldImport.js";

describe("normalizePhoneNumber", () => {
  it("strips formatting to digits only", () => {
    expect(normalizePhoneNumber("(713) 239-9946")).toBe("7132399946");
    expect(normalizePhoneNumber("+1 713-239-9946")).toBe("17132399946");
  });

  it("returns empty string for non-strings and unknowns", () => {
    expect(normalizePhoneNumber(null)).toBe("");
    expect(normalizePhoneNumber(undefined)).toBe("");
    expect(normalizePhoneNumber("")).toBe("");
  });
});

describe("sha256Hex", () => {
  it("matches the platform SHA-256 implementation", () => {
    for (const input of ["", "abc", "7132399946|2026-09-23T15:23:00.000Z|87|incoming"]) {
      expect(sha256Hex(input)).toBe(createHash("sha256").update(input, "utf8").digest("hex"));
    }
  });
});

describe("buildImportDedupeHash", () => {
  const record = {
    normalizedPhone: "7132399946",
    startedAtISO: "2026-09-23T15:23:00.000Z",
    durationSeconds: 87,
    callType: "incoming",
  };

  it("is stable for the same record", () => {
    expect(buildImportDedupeHash(record)).toBe(buildImportDedupeHash({ ...record }));
  });

  it("matches sha256 of the canonical composite", () => {
    const canonical = "7132399946|2026-09-23T15:23:00.000Z|87|incoming";
    expect(buildImportDedupeHash(record)).toBe(createHash("sha256").update(canonical, "utf8").digest("hex"));
  });

  it("changes when any component changes", () => {
    const base = buildImportDedupeHash(record);
    expect(buildImportDedupeHash({ ...record, durationSeconds: 88 })).not.toBe(base);
    expect(buildImportDedupeHash({ ...record, callType: "missed" })).not.toBe(base);
    expect(buildImportDedupeHash({ ...record, startedAtISO: "2026-09-23T15:23:31.000Z" })).not.toBe(base);
    expect(buildImportDedupeHash({ ...record, normalizedPhone: "7132399947" })).not.toBe(base);
  });

  it("rejects invalid inputs instead of hashing garbage", () => {
    expect(() => buildImportDedupeHash({ ...record, normalizedPhone: "" })).toThrow();
    expect(() => buildImportDedupeHash({ ...record, startedAtISO: "not-a-date" })).toThrow();
    expect(() => buildImportDedupeHash({ ...record, durationSeconds: -1 })).toThrow();
    expect(() => buildImportDedupeHash({ ...record, callType: "" })).toThrow();
  });
});

describe("findPossibleDuplicateCalls", () => {
  const staged = {
    phoneNumber: "(713) 239-9946",
    startedAt: "2026-09-23T15:23:00.000Z",
    durationSeconds: 87,
  };

  it("flags a manually logged call within the time and duration windows", () => {
    const existing = [{
      phoneNumber: "7132399946",
      startedAt: "2026-09-23T15:23:20.000Z", // +20s
      durationSeconds: 90, // +3s
    }];
    expect(findPossibleDuplicateCalls(staged, existing)).toHaveLength(1);
  });

  it("ignores different numbers", () => {
    const existing = [{ phoneNumber: "4694858280", startedAt: staged.startedAt, durationSeconds: 87 }];
    expect(findPossibleDuplicateCalls(staged, existing)).toHaveLength(0);
  });

  it("ignores calls outside the 30s time window", () => {
    const existing = [{
      phoneNumber: "7132399946",
      startedAt: "2026-09-23T15:24:01.000Z", // +61s
      durationSeconds: 87,
    }];
    expect(findPossibleDuplicateCalls(staged, existing)).toHaveLength(0);
  });

  it("ignores calls outside the 5s duration tolerance", () => {
    const existing = [{
      phoneNumber: "7132399946",
      startedAt: staged.startedAt,
      durationSeconds: 100, // +13s
    }];
    expect(findPossibleDuplicateCalls(staged, existing)).toHaveLength(0);
  });

  it("matches domain call shapes (numberShown/occurredAt, no duration) on phone + time", () => {
    const existing = [{
      numberShown: "(713) 239-9946",
      occurredAt: "2026-09-23T15:23:20.000Z",
    }];
    expect(findPossibleDuplicateCalls(staged, existing)).toHaveLength(1);
  });

  it("never merges: it returns candidates, and handles bad input safely", () => {
    expect(findPossibleDuplicateCalls(null, [])).toEqual([]);
    expect(findPossibleDuplicateCalls(staged, null)).toEqual([]);
    expect(findPossibleDuplicateCalls({ phoneNumber: "" }, [{ phoneNumber: "1" }])).toEqual([]);
  });
});
