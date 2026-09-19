import { describe, expect, it } from "vitest";
import { ACTION_GATE, resolveActionGate } from "../actionGate.js";

describe("resolveActionGate", () => {
  it("is a single click for an explicit, reversible human choice", () => {
    expect(resolveActionGate({})).toBe(ACTION_GATE.SINGLE);
    expect(resolveActionGate({ confidence: 1, reversible: true })).toBe(ACTION_GATE.SINGLE);
  });

  it("requires the typed gate for ambiguous bulk inference", () => {
    expect(resolveActionGate({ ambiguous: true })).toBe(ACTION_GATE.TYPED);
    expect(resolveActionGate({ ambiguous: true, confidence: 1, reversible: true })).toBe(ACTION_GATE.TYPED);
  });

  it("requires the typed gate when there is no user-facing undo path", () => {
    expect(resolveActionGate({ reversible: false })).toBe(ACTION_GATE.TYPED);
  });

  it("requires the typed gate for debt/transfer pairing logic no matter what", () => {
    expect(resolveActionGate({ touchesDebtOrTransfer: true, confidence: 1, reversible: true })).toBe(
      ACTION_GATE.TYPED,
    );
  });

  it("treats below-threshold confidence as ambiguous (shared 0.8 threshold)", () => {
    expect(resolveActionGate({ confidence: 0.79 })).toBe(ACTION_GATE.TYPED);
    expect(resolveActionGate({ confidence: 0.8 })).toBe(ACTION_GATE.SINGLE);
    expect(resolveActionGate({ confidence: 0.95 })).toBe(ACTION_GATE.SINGLE);
  });

  it("ignores non-numeric confidence instead of crashing", () => {
    expect(resolveActionGate({ confidence: "high" })).toBe(ACTION_GATE.SINGLE);
    expect(resolveActionGate({ confidence: NaN })).toBe(ACTION_GATE.SINGLE);
  });

  it("assumes an explicit human choice when called with no options, but fails closed on a falsy reversible flag", () => {
    expect(resolveActionGate()).toBe(ACTION_GATE.SINGLE);
    expect(resolveActionGate(null)).toBe(ACTION_GATE.SINGLE);
    expect(resolveActionGate({ reversible: 0 })).toBe(ACTION_GATE.TYPED);
  });
});
