// Work Package Planner slice 5 — domain validation tests.
import { describe, it, expect } from "vitest";
import {
  craftKeyFor,
  formatEstimate,
  validateWorkStepInput,
  validateWorkStepUpdateInput,
  validateWorkStepRetireInput,
  validateWorkStepReorderInput,
  validateWorkStepMoveInput,
  validateWorkStepLinkInput,
  validateWorkStepLinkRetireInput,
} from "./workSteps.js";

const VALID_INPUT = {
  title: "Fabricate pipe spool",
};

describe("validateWorkStepInput", () => {
  it("accepts a title-only step (no drawing needed)", () => {
    expect(validateWorkStepInput(VALID_INPUT)).toEqual({ ok: true, errors: [] });
  });

  it("accepts a fully specified step", () => {
    expect(validateWorkStepInput({
      title: "Install supports",
      description: "Shop-fabricated supports, field install per P&ID.",
      craftLabel: "Pipefitter",
      plannedDurationDays: 3,
      plannedPersonHours: 24.5,
      sourceNote: "Assumes two fitters.",
      insertAt: 1,
    })).toEqual({ ok: true, errors: [] });
  });

  it("rejects an empty, oversized, or HTML title", () => {
    expect(validateWorkStepInput({ title: "  " }).ok).toBe(false);
    expect(validateWorkStepInput({ title: "x".repeat(161) }).ok).toBe(false);
    expect(validateWorkStepInput({ title: "Install <b>supports</b>" }).ok).toBe(false);
    expect(validateWorkStepInput({ title: "Install supports\x01" }).ok).toBe(false);
    expect(validateWorkStepInput({ title: 42 }).ok).toBe(false);
  });

  it("rejects a description with HTML, control characters, or over 4000 chars", () => {
    expect(validateWorkStepInput({ ...VALID_INPUT, description: "See <a href=\"x\">this</a>" }).ok).toBe(false);
    expect(validateWorkStepInput({ ...VALID_INPUT, description: "note\x07" }).ok).toBe(false);
    expect(validateWorkStepInput({ ...VALID_INPUT, description: "x".repeat(4001) }).ok).toBe(false);
    expect(validateWorkStepInput({ ...VALID_INPUT, description: "x".repeat(4000) }).ok).toBe(true);
  });

  it("rejects a craft label outside the charset or length", () => {
    expect(validateWorkStepInput({ ...VALID_INPUT, craftLabel: "-Welder" }).ok).toBe(false);
    expect(validateWorkStepInput({ ...VALID_INPUT, craftLabel: "w".repeat(81) }).ok).toBe(false);
    expect(validateWorkStepInput({ ...VALID_INPUT, craftLabel: "Welder" }).ok).toBe(true);
  });

  it("rejects duration days outside 1–366 and non-integers", () => {
    for (const days of [0, 367, 1.5, "3"]) {
      expect(validateWorkStepInput({ ...VALID_INPUT, plannedDurationDays: days }).ok).toBe(false);
    }
    expect(validateWorkStepInput({ ...VALID_INPUT, plannedDurationDays: 366 }).ok).toBe(true);
  });

  it("rejects person-hours outside (0, 1000000] and past two decimals", () => {
    for (const hours of [0, -1, 1000001, 24.555, "24"]) {
      expect(validateWorkStepInput({ ...VALID_INPUT, plannedPersonHours: hours }).ok).toBe(false);
    }
    expect(validateWorkStepInput({ ...VALID_INPUT, plannedPersonHours: 1000000 }).ok).toBe(true);
    expect(validateWorkStepInput({ ...VALID_INPUT, plannedPersonHours: 24.5 }).ok).toBe(true);
  });

  it("rejects an overlong source note and a non-positive insert position", () => {
    expect(validateWorkStepInput({ ...VALID_INPUT, sourceNote: "x".repeat(1001) }).ok).toBe(false);
    expect(validateWorkStepInput({ ...VALID_INPUT, insertAt: 0 }).ok).toBe(false);
    expect(validateWorkStepInput({ ...VALID_INPUT, insertAt: 2.5 }).ok).toBe(false);
  });

  it("rejects a blank supersedes step id", () => {
    expect(validateWorkStepInput({ ...VALID_INPUT, supersedesStepId: "  " }).ok).toBe(false);
  });
});

describe("validateWorkStepUpdateInput", () => {
  const BASE = { expectedVersion: 2, title: "Install supports" };

  it("accepts a title change", () => {
    expect(validateWorkStepUpdateInput(BASE).ok).toBe(true);
  });

  it("requires a positive expected version and at least one change", () => {
    expect(validateWorkStepUpdateInput({}).ok).toBe(false);
    expect(validateWorkStepUpdateInput({ expectedVersion: 0, title: "x" }).ok).toBe(false);
    expect(validateWorkStepUpdateInput({ expectedVersion: 1 }).ok).toBe(false);
  });

  it("rejects a null title but allows explicit null clears on optional fields", () => {
    expect(validateWorkStepUpdateInput({ expectedVersion: 1, title: null }).ok).toBe(false);
    expect(validateWorkStepUpdateInput({ expectedVersion: 1, description: null }).ok).toBe(true);
    expect(validateWorkStepUpdateInput({ expectedVersion: 1, craftLabel: null }).ok).toBe(true);
    expect(validateWorkStepUpdateInput({ expectedVersion: 1, plannedDurationDays: null }).ok).toBe(true);
    expect(validateWorkStepUpdateInput({ expectedVersion: 1, plannedPersonHours: null }).ok).toBe(true);
    expect(validateWorkStepUpdateInput({ expectedVersion: 1, sourceNote: null }).ok).toBe(true);
  });

  it("validates supplied estimate values", () => {
    expect(validateWorkStepUpdateInput({ expectedVersion: 1, plannedDurationDays: 0 }).ok).toBe(false);
    expect(validateWorkStepUpdateInput({ expectedVersion: 1, plannedPersonHours: 0 }).ok).toBe(false);
    expect(validateWorkStepUpdateInput({ expectedVersion: 1, description: "<b>x</b>" }).ok).toBe(false);
  });

  it("refuses supersedesStepId after creation", () => {
    expect(validateWorkStepUpdateInput({ expectedVersion: 1, supersedesStepId: "step_x" }).ok).toBe(false);
  });

  it("requires a reason for a historical correction", () => {
    expect(validateWorkStepUpdateInput({ expectedVersion: 1, title: "x", historicalCorrection: true }).ok).toBe(false);
    expect(validateWorkStepUpdateInput({ expectedVersion: 1, title: "x", historicalCorrection: true, reason: "Fixed" }).ok).toBe(true);
  });
});

describe("validateWorkStepRetireInput", () => {
  it("requires version and reason", () => {
    expect(validateWorkStepRetireInput({ expectedVersion: 1, reason: "No longer needed" }).ok).toBe(true);
    expect(validateWorkStepRetireInput({ expectedVersion: 1 }).ok).toBe(false);
    expect(validateWorkStepRetireInput({ reason: "x" }).ok).toBe(false);
    expect(validateWorkStepRetireInput({ expectedVersion: 1, reason: "  " }).ok).toBe(false);
  });
});

describe("validateWorkStepReorderInput", () => {
  it("accepts a permutation plus a generation", () => {
    expect(validateWorkStepReorderInput({ stepIds: ["a", "b", "c"], expectedGeneration: 0 }).ok).toBe(true);
  });

  it("rejects empty, duplicate, or blank step ids and a missing generation", () => {
    expect(validateWorkStepReorderInput({ stepIds: [], expectedGeneration: 0 }).ok).toBe(false);
    expect(validateWorkStepReorderInput({ stepIds: ["a", "a"], expectedGeneration: 0 }).ok).toBe(false);
    expect(validateWorkStepReorderInput({ stepIds: ["a", " "], expectedGeneration: 0 }).ok).toBe(false);
    expect(validateWorkStepReorderInput({ stepIds: ["a"] }).ok).toBe(false);
    expect(validateWorkStepReorderInput({ stepIds: ["a"], expectedGeneration: -1 }).ok).toBe(false);
    expect(validateWorkStepReorderInput({ stepIds: "a", expectedGeneration: 0 }).ok).toBe(false);
  });
});

describe("validateWorkStepMoveInput", () => {
  it("accepts a step, a target position, and a generation", () => {
    expect(validateWorkStepMoveInput({
      stepId: "a", targetSequenceNo: 3, expectedGeneration: 2,
    })).toEqual({ ok: true, errors: [] });
    expect(validateWorkStepMoveInput({
      stepId: "a", targetSequenceNo: 1, expectedGeneration: 0, reason: "Sequence fix",
    }).ok).toBe(true);
  });

  it("rejects a missing step, a non-positive or fractional target, and a missing generation", () => {
    const base = { stepId: "a", targetSequenceNo: 2, expectedGeneration: 0 };
    expect(validateWorkStepMoveInput({ ...base, stepId: "" }).ok).toBe(false);
    expect(validateWorkStepMoveInput({ ...base, stepId: " " }).ok).toBe(false);
    expect(validateWorkStepMoveInput({ ...base, targetSequenceNo: 0 }).ok).toBe(false);
    expect(validateWorkStepMoveInput({ ...base, targetSequenceNo: -1 }).ok).toBe(false);
    expect(validateWorkStepMoveInput({ ...base, targetSequenceNo: 1.5 }).ok).toBe(false);
    expect(validateWorkStepMoveInput({ ...base, targetSequenceNo: "2" }).ok).toBe(false);
    expect(validateWorkStepMoveInput({ stepId: "a", targetSequenceNo: 2 }).ok).toBe(false);
    expect(validateWorkStepMoveInput({ ...base, expectedGeneration: -1 }).ok).toBe(false);
    expect(validateWorkStepMoveInput({ ...base, reason: "x".repeat(1001) }).ok).toBe(false);
  });
});

describe("validateWorkStepLinkInput / validateWorkStepLinkRetireInput", () => {
  it("requires step and drawing ids", () => {
    expect(validateWorkStepLinkInput({ stepId: "s1", drawingId: "d1" }).ok).toBe(true);
    expect(validateWorkStepLinkInput({ drawingId: "d1" }).ok).toBe(false);
    expect(validateWorkStepLinkInput({ stepId: "s1" }).ok).toBe(false);
    expect(validateWorkStepLinkInput({ stepId: "s1", drawingId: "d1", refinementNote: "x".repeat(1001) }).ok).toBe(false);
  });

  it("requires version and reason to retire a link", () => {
    expect(validateWorkStepLinkRetireInput({ expectedVersion: 1, reason: "Wrong drawing" }).ok).toBe(true);
    expect(validateWorkStepLinkRetireInput({ expectedVersion: 1 }).ok).toBe(false);
  });
});

describe("craftKeyFor and formatEstimate", () => {
  it("normalizes craft labels the same way slice 4 does", () => {
    expect(craftKeyFor("Pipe Fitter")).toBe("pipe-fitter");
    expect(craftKeyFor("  Welder  ")).toBe("welder");
  });

  it("renders a null estimate as Not estimated, never zero", () => {
    expect(formatEstimate(null, "days")).toBe("Not estimated");
    expect(formatEstimate(3, "days")).toBe("Planned 3 days");
    expect(formatEstimate(24.5, "person-hours")).toBe("Planned 24.5 person-hours");
  });
});
