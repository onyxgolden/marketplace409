import { describe, expect, test } from "vitest";
import { reconcileTransactionDuplicates } from "../reconcileTransactionDuplicates";

describe("reconcileTransactionDuplicates", () => {
  test("an unambiguous single match is confirmed", () => {
    const result = reconcileTransactionDuplicates({
      transactionRows: [{ id: "t1", eventDate: "2026-03-28", amount: -1550 }],
      rentecRows: [{ id: "r1", eventDate: "2026-03-26", amount: 1550 }],
    });
    expect(result.confirmedDuplicates).toEqual([{ transactionId: "t1", rentecId: "r1" }]);
    expect(result.ambiguous).toEqual([]);
  });

  test("zero candidates within the window is not a duplicate", () => {
    const result = reconcileTransactionDuplicates({
      transactionRows: [{ id: "t1", eventDate: "2026-03-28", amount: -1550 }],
      rentecRows: [{ id: "r1", eventDate: "2026-01-01", amount: 1550 }], // way outside tolerance
    });
    expect(result.confirmedDuplicates).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  test("multiple candidates for one transaction row are never auto-resolved", () => {
    const result = reconcileTransactionDuplicates({
      transactionRows: [{ id: "t1", eventDate: "2026-03-28", amount: -1550 }],
      rentecRows: [
        { id: "r1", eventDate: "2026-03-26", amount: 1550 },
        { id: "r2", eventDate: "2026-03-29", amount: 1550 },
        { id: "r3", eventDate: "2026-03-27", amount: 1550 },
      ],
    });
    expect(result.confirmedDuplicates).toEqual([]);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].transactionId).toBe("t1");
    expect(result.ambiguous[0].candidateRentecIds).toEqual(["r1", "r2", "r3"]);
    expect(result.ambiguous[0].reason).toBe("multiple_candidates");
  });

  test("two transaction rows contending for the same single rentec row are both left ambiguous", () => {
    const result = reconcileTransactionDuplicates({
      transactionRows: [
        { id: "t1", eventDate: "2026-03-28", amount: -1550 },
        { id: "t2", eventDate: "2026-03-29", amount: -1550 },
      ],
      rentecRows: [{ id: "r1", eventDate: "2026-03-27", amount: 1550 }],
    });
    expect(result.confirmedDuplicates).toEqual([]);
    expect(result.ambiguous).toHaveLength(2);
    const transactionIds = result.ambiguous.map((entry) => entry.transactionId).sort();
    expect(transactionIds).toEqual(["t1", "t2"]);
    for (const entry of result.ambiguous) {
      expect(entry.reason).toBe("contended_rentec_row");
      expect(entry.candidateRentecIds).toEqual(["r1"]);
    }
  });

  test("amounts a full cent or more apart are never treated as a match", () => {
    const result = reconcileTransactionDuplicates({
      transactionRows: [{ id: "t1", eventDate: "2026-03-28", amount: -1550.0 }],
      rentecRows: [{ id: "r1", eventDate: "2026-03-27", amount: 1549.98 }], // 2 cents off
    });
    expect(result.confirmedDuplicates).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  // Cent-level rounding (matching minorUnitsToDecimalDollars.ts's convention elsewhere in this
  // domain) means an amount within half a cent of another IS treated as the same cent value --
  // that's correct float-noise tolerance, not a bug, since real dollar amounts read back from
  // Postgres numeric can carry sub-cent float representation error.
  test("sub-cent float noise within half a cent still matches", () => {
    const result = reconcileTransactionDuplicates({
      transactionRows: [{ id: "t1", eventDate: "2026-03-28", amount: -1550.0 }],
      rentecRows: [{ id: "r1", eventDate: "2026-03-27", amount: 1549.995 }],
    });
    expect(result.confirmedDuplicates).toEqual([{ transactionId: "t1", rentecId: "r1" }]);
  });

  test("respects a custom toleranceDays", () => {
    const rows = {
      transactionRows: [{ id: "t1", eventDate: "2026-03-28", amount: -1550 }],
      rentecRows: [{ id: "r1", eventDate: "2026-03-24", amount: 1550 }], // 4 days away
    };
    expect(reconcileTransactionDuplicates({ ...rows, toleranceDays: 3 }).confirmedDuplicates).toEqual([]);
    expect(reconcileTransactionDuplicates({ ...rows, toleranceDays: 4 }).confirmedDuplicates).toEqual([{ transactionId: "t1", rentecId: "r1" }]);
  });

  test("unrelated rows with different amounts never match regardless of date proximity", () => {
    const result = reconcileTransactionDuplicates({
      transactionRows: [{ id: "t1", eventDate: "2026-03-28", amount: -238.02 }],
      rentecRows: [{ id: "r1", eventDate: "2026-03-28", amount: 1550 }],
    });
    expect(result.confirmedDuplicates).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  test("multiple independent transaction rows each match their own distinct rentec row", () => {
    const result = reconcileTransactionDuplicates({
      transactionRows: [
        { id: "t1", eventDate: "2026-03-28", amount: -1550 },
        { id: "t2", eventDate: "2026-04-16", amount: -255.12 },
      ],
      rentecRows: [
        { id: "r1", eventDate: "2026-03-26", amount: 1550 },
        { id: "r2", eventDate: "2026-04-16", amount: 255.12 },
      ],
    });
    expect(result.confirmedDuplicates).toEqual(
      expect.arrayContaining([
        { transactionId: "t1", rentecId: "r1" },
        { transactionId: "t2", rentecId: "r2" },
      ]),
    );
    expect(result.confirmedDuplicates).toHaveLength(2);
    expect(result.ambiguous).toEqual([]);
  });

  test("rejects non-array inputs", () => {
    expect(() => reconcileTransactionDuplicates({ transactionRows: null, rentecRows: [] })).toThrow("transactionRows must be an array");
    expect(() => reconcileTransactionDuplicates({ transactionRows: [], rentecRows: null })).toThrow("rentecRows must be an array");
  });
});
