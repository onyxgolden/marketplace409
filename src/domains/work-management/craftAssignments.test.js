import { describe, expect, it } from "vitest";

import {
  COMMON_CRAFTS,
  computeDayPlannedTotals,
  craftKeyFor,
  crewKeyFor,
  isPastWorkDate,
  isValidWorkDate,
  normalizeCraftLabel,
  plannedPersonHours,
  shiftKeyFor,
  todayInOperatingZone,
  validateCraftAssignmentInput,
  validateCraftAssignmentRetireInput,
  validateCraftAssignmentUpdateInput,
} from "./craftAssignments.js";

const BASE = {
  workDate: "2026-11-09",
  craft: "Pipefitter",
  shiftKind: "day",
  crewSize: 6,
  hoursPerPerson: 8,
};

describe("craftAssignments domain: validation", () => {
  it("accepts a minimal valid assignment", () => {
    expect(validateCraftAssignmentInput(BASE)).toEqual({ ok: true, errors: [] });
  });

  it("accepts an other shift with a label and an unlabeled crew", () => {
    expect(validateCraftAssignmentInput({
      ...BASE,
      shiftKind: "other",
      shiftLabel: "Swing",
      crewLabel: "Crew A",
      note: "Night tie-ins",
    })).toEqual({ ok: true, errors: [] });
  });

  it("rejects bad dates, including Feb 30", () => {
    expect(validateCraftAssignmentInput({ ...BASE, workDate: "2026-02-30" }).ok).toBe(false);
    expect(validateCraftAssignmentInput({ ...BASE, workDate: "11/09/2026" }).ok).toBe(false);
    expect(validateCraftAssignmentInput({ ...BASE, workDate: undefined }).ok).toBe(false);
  });

  it("rejects an empty or overlong craft, and a craft starting with punctuation", () => {
    expect(validateCraftAssignmentInput({ ...BASE, craft: "" }).ok).toBe(false);
    expect(validateCraftAssignmentInput({ ...BASE, craft: "x".repeat(81) }).ok).toBe(false);
    expect(validateCraftAssignmentInput({ ...BASE, craft: "-welder" }).ok).toBe(false);
  });

  it("accepts any legitimate trade label — no fixed enum excludes trades", () => {
    for (const craft of ["Insulator", "Scaffold Builder", "Crane Operator", "QA/QC Inspector", "Pipefitter & Welder"]) {
      expect(validateCraftAssignmentInput({ ...BASE, craft }).ok).toBe(true);
    }
  });

  it("rejects an other shift without a label and a day shift with one", () => {
    expect(validateCraftAssignmentInput({ ...BASE, shiftKind: "other" }).ok).toBe(false);
    expect(validateCraftAssignmentInput({ ...BASE, shiftKind: "other", shiftLabel: "x".repeat(61) }).ok).toBe(false);
    expect(validateCraftAssignmentInput({ ...BASE, shiftKind: "day", shiftLabel: "Swing" }).ok).toBe(false);
    expect(validateCraftAssignmentInput({ ...BASE, shiftKind: "swing" }).ok).toBe(false);
  });

  it("rejects crew sizes outside 1–500 and non-integers", () => {
    expect(validateCraftAssignmentInput({ ...BASE, crewSize: 0 }).ok).toBe(false);
    expect(validateCraftAssignmentInput({ ...BASE, crewSize: 501 }).ok).toBe(false);
    expect(validateCraftAssignmentInput({ ...BASE, crewSize: 6.5 }).ok).toBe(false);
  });

  it("rejects hours at zero, over 24, and beyond two decimals", () => {
    expect(validateCraftAssignmentInput({ ...BASE, hoursPerPerson: 0 }).ok).toBe(false);
    expect(validateCraftAssignmentInput({ ...BASE, hoursPerPerson: 24.01 }).ok).toBe(false);
    expect(validateCraftAssignmentInput({ ...BASE, hoursPerPerson: 7.555 }).ok).toBe(false);
    expect(validateCraftAssignmentInput({ ...BASE, hoursPerPerson: 24 }).ok).toBe(true);
    expect(validateCraftAssignmentInput({ ...BASE, hoursPerPerson: 7.5 }).ok).toBe(true);
  });

  it("rejects overlong notes, crew labels, and reasons", () => {
    expect(validateCraftAssignmentInput({ ...BASE, note: "x".repeat(1001) }).ok).toBe(false);
    expect(validateCraftAssignmentInput({ ...BASE, crewLabel: "x".repeat(101) }).ok).toBe(false);
    expect(validateCraftAssignmentInput({
      ...BASE, historicalCorrection: true, reason: "x".repeat(1001),
    }).ok).toBe(false);
  });

  it("requires a reason when historical correction is declared", () => {
    expect(validateCraftAssignmentInput({ ...BASE, historicalCorrection: true }).ok).toBe(false);
    expect(validateCraftAssignmentInput({
      ...BASE, historicalCorrection: true, reason: "Foreman called in the correction",
    }).ok).toBe(true);
  });

  it("suggests common crafts without restricting to them", () => {
    expect(COMMON_CRAFTS).toContain("Pipefitter");
    expect(COMMON_CRAFTS).toContain("Welder");
    expect(COMMON_CRAFTS.length).toBeGreaterThan(0);
  });
});

describe("craftAssignments domain: normalization and keys", () => {
  it("normalizes labels and keys the same way the database does", () => {
    expect(normalizeCraftLabel("  Pipe   Fitter ")).toBe("Pipe Fitter");
    expect(craftKeyFor("  Pipe   Fitter ")).toBe("pipe-fitter");
    expect(craftKeyFor("Welder")).toBe("welder");
    expect(craftKeyFor("Instrument Technician")).toBe("instrument-technician");
    expect(craftKeyFor("QA/QC Inspector")).toBe("qa/qc-inspector");
    expect(crewKeyFor(null)).toBe("");
    expect(crewKeyFor("")).toBe("");
    expect(crewKeyFor("  Crew   A ")).toBe("crew-a");
  });

  it("builds shift keys: day/night bare, other prefixed", () => {
    expect(shiftKeyFor("day")).toBe("day");
    expect(shiftKeyFor("night")).toBe("night");
    expect(shiftKeyFor("other", "Swing")).toBe("other:swing");
    expect(shiftKeyFor("other", "  Grave  Yard ")).toBe("other:grave-yard");
    expect(shiftKeyFor("swing")).toBe(null);
  });

  it("computes planned person-hours exactly at two decimals", () => {
    expect(plannedPersonHours(8, 7.5)).toBe(60);
    expect(plannedPersonHours(3, 0.1)).toBe(0.3);
    expect(plannedPersonHours(6, 8.25)).toBe(49.5);
  });

  it("reports today in the America/Chicago operating zone", () => {
    // 2026-11-09 04:00 UTC is still Nov 8 in Chicago (CST, UTC-6).
    expect(todayInOperatingZone(new Date("2026-11-09T04:00:00Z"))).toBe("2026-11-08");
    expect(todayInOperatingZone(new Date("2026-11-09T13:00:00Z"))).toBe("2026-11-09");
  });

  it("identifies past work dates by string comparison", () => {
    expect(isPastWorkDate("2026-11-08", "2026-11-09")).toBe(true);
    expect(isPastWorkDate("2026-11-09", "2026-11-09")).toBe(false);
    expect(isPastWorkDate("2026-11-10", "2026-11-09")).toBe(false);
    expect(isValidWorkDate("2026-02-30")).toBe(false);
    expect(isValidWorkDate("2026-11-09")).toBe(true);
  });
});

describe("craftAssignments domain: update validation", () => {
  it("requires expectedVersion and at least one change", () => {
    expect(validateCraftAssignmentUpdateInput({}).ok).toBe(false);
    expect(validateCraftAssignmentUpdateInput({ expectedVersion: 0, crewSize: 4 }).ok).toBe(false);
    expect(validateCraftAssignmentUpdateInput({ expectedVersion: 1 }).ok).toBe(false);
    expect(validateCraftAssignmentUpdateInput({ expectedVersion: 1, crewSize: 4 }).ok).toBe(true);
  });

  it("distinguishes clear (null) from leave-untouched (undefined) for clearable fields", () => {
    expect(validateCraftAssignmentUpdateInput({ expectedVersion: 2, note: null }).ok).toBe(true);
    expect(validateCraftAssignmentUpdateInput({ expectedVersion: 2, crewLabel: null }).ok).toBe(true);
    expect(validateCraftAssignmentUpdateInput({ expectedVersion: 2, note: "x".repeat(1001) }).ok).toBe(false);
  });

  it("rejects null for required fields and bad shift transitions", () => {
    expect(validateCraftAssignmentUpdateInput({ expectedVersion: 1, craft: null }).ok).toBe(false);
    expect(validateCraftAssignmentUpdateInput({ expectedVersion: 1, workDate: null }).ok).toBe(false);
    expect(validateCraftAssignmentUpdateInput({ expectedVersion: 1, shiftKind: "other" }).ok).toBe(false);
    expect(validateCraftAssignmentUpdateInput({ expectedVersion: 1, shiftKind: "other", shiftLabel: "Swing" }).ok).toBe(true);
    expect(validateCraftAssignmentUpdateInput({ expectedVersion: 1, shiftKind: "day", shiftLabel: "Swing" }).ok).toBe(false);
  });
});

describe("craftAssignments domain: retire validation", () => {
  it("requires a version and a nonempty reason", () => {
    expect(validateCraftAssignmentRetireInput({ expectedVersion: 1, reason: "Crew stood down" }).ok).toBe(true);
    expect(validateCraftAssignmentRetireInput({ expectedVersion: 1, reason: "" }).ok).toBe(false);
    expect(validateCraftAssignmentRetireInput({ expectedVersion: 1 }).ok).toBe(false);
    expect(validateCraftAssignmentRetireInput({ reason: "x" }).ok).toBe(false);
  });
});

describe("craftAssignments domain: day totals", () => {
  it("totals active assignments per date and excludes retired ones", () => {
    const totals = computeDayPlannedTotals([
      { workDate: "2026-11-09", crewSize: 6, hoursPerPerson: 8, retiredAt: null },
      { workDate: "2026-11-09", crewSize: 2, hoursPerPerson: 10, retiredAt: null },
      { workDate: "2026-11-10", crewSize: 4, hoursPerPerson: 7.5, retiredAt: null },
      { workDate: "2026-11-10", crewSize: 9, hoursPerPerson: 8, retiredAt: "2026-11-01T00:00:00Z" },
    ]);
    expect(totals).toEqual([
      { workDate: "2026-11-09", plannedPersonHours: 68, assignmentCount: 2 },
      { workDate: "2026-11-10", plannedPersonHours: 30, assignmentCount: 1 },
    ]);
  });
});
