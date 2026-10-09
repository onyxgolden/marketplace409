// Tests for forge-capture-app/ui/process-guide-compiler.js — PT-2's
// fixture-only, pure guide compiler. No DOM.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileGuide, GuideCompileError, GUIDE_SCHEMA_VERSION } from "../process-guide-compiler.js";
import { buildFixtureEvidence, QUEUE_OVERFLOW_STAGES } from "../process-training-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TARGET = { label: "Notepad", exeName: "notepad.exe" };

function fixtureEvent(overrides) {
  return {
    type: "Event",
    event: {
      sequenceId: 1,
      hookTimestampMs: 1000,
      captureTimestampMs: 1015,
      kind: "Click",
      point: [10, 20],
      target: { name: "Save", controlTypeId: 50000, automationId: "btn-save", processName: "fixture.exe" },
      screenshot: null,
      privacy: { trust: "Default", decision: "Withhold" },
      ...overrides,
    },
  };
}

describe("compileGuide — basic shape", () => {
  it("returns the fixed schemaVersion/source/status fields", () => {
    const guide = compileGuide([], { target: TARGET, trustScope: "default" });
    expect(guide.schemaVersion).toBe(GUIDE_SCHEMA_VERSION);
    expect(guide.source).toBe("fixture");
    expect(guide.status).toBe("draft_unverified");
    expect(guide.target).toEqual({ label: "Notepad", exeName: "notepad.exe" });
    expect(guide.trustScope).toBe("default");
  });

  it("requires evidence to be an array", () => {
    expect(() => compileGuide(null, {})).toThrow(GuideCompileError);
    expect(() => compileGuide(undefined, {})).toThrow(GuideCompileError);
    expect(() => compileGuide("nope", {})).toThrow(GuideCompileError);
  });

  it("works with no meta at all", () => {
    const guide = compileGuide([]);
    expect(guide.target).toBeNull();
    expect(guide.trustScope).toBeNull();
  });
});

describe("compileGuide — default and author-trusted fixture sets", () => {
  it("compiles the full default-trust fixture set without throwing", () => {
    const evidence = buildFixtureEvidence({ trustScope: "default", target: TARGET });
    const guide = compileGuide(evidence, { target: TARGET, trustScope: "default" });
    expect(guide.steps.length).toBe(4); // Click, Click, DoubleClick, Drag
    expect(guide.warnings.length).toBeGreaterThan(0);
  });

  it("compiles the full author-trusted fixture set without throwing", () => {
    const evidence = buildFixtureEvidence({ trustScope: "author_trusted", target: TARGET });
    const guide = compileGuide(evidence, { target: TARGET, trustScope: "author_trusted" });
    expect(guide.steps.length).toBe(4);
  });
});

describe("compileGuide — all event kinds", () => {
  it("describes each kind with observed-action language, no inferred intent", () => {
    const evidence = [
      fixtureEvent({ sequenceId: 1, kind: "Click" }),
      fixtureEvent({ sequenceId: 2, kind: "DoubleClick" }),
      fixtureEvent({ sequenceId: 3, kind: "Drag" }),
    ];
    const guide = compileGuide(evidence, {});
    expect(guide.steps.map((s) => s.action)).toEqual([
      "Click observed",
      "Double-click observed",
      "Drag observed",
    ]);
    for (const s of guide.steps) {
      expect(s.action.toLowerCase()).not.toMatch(/success|complete|verified|saved|finished/);
    }
  });
});

describe("compileGuide — all PipelineMessage variants represented", () => {
  it("includes gap, every loss stage, and uncertain as warnings", () => {
    const evidence = buildFixtureEvidence({ trustScope: "default", target: TARGET });
    const guide = compileGuide(evidence, {});
    const types = guide.warnings.map((w) => w.type);
    expect(types).toContain("gap");
    expect(types).toContain("uncertain");
    const lossStages = guide.warnings.filter((w) => w.type === "loss").map((w) => w.stage);
    for (const stage of QUEUE_OVERFLOW_STAGES) {
      expect(lossStages).toContain(stage);
    }
  });
});

describe("compileGuide — withheld/redacted screenshots", () => {
  it("never includes an actual image or pixel reference for a withheld step", () => {
    const evidence = [fixtureEvent({ sequenceId: 1, screenshot: null, privacy: { trust: "Default", decision: "Withhold" } })];
    const guide = compileGuide(evidence, {});
    expect(guide.steps[0].hasScreenshot).toBe(false);
    expect(JSON.stringify(guide)).not.toMatch(/data:image|\.png|\.jpg|rgba/i);
  });

  it("a redacted step may report hasScreenshot true but never carries pixels", () => {
    const evidence = [
      fixtureEvent({
        sequenceId: 1,
        screenshot: { width: 64, height: 48, fixture: true },
        privacy: { trust: "AuthorTrusted", decision: "RedactRegion" },
      }),
    ];
    const guide = compileGuide(evidence, {});
    expect(guide.steps[0].hasScreenshot).toBe(true);
    expect(JSON.stringify(guide)).not.toMatch(/data:image|rgba/i);
  });

  it("generic-labels a withheld or redacted step's target, never the real control name", () => {
    const evidence = [
      fixtureEvent({
        sequenceId: 1,
        target: { name: "Secret Field", automationId: "txt-secret", processName: "fixture.exe" },
        privacy: { trust: "Default", decision: "Withhold" },
      }),
      fixtureEvent({
        sequenceId: 2,
        target: { name: "Secret Field 2", automationId: "txt-secret-2", processName: "fixture.exe" },
        privacy: { trust: "AuthorTrusted", decision: "RedactRegion" },
      }),
    ];
    const guide = compileGuide(evidence, {});
    for (const step of guide.steps) {
      expect(step.targetLabel).not.toContain("Secret Field");
      expect(step.targetLabel.toLowerCase()).toMatch(/withheld|redacted/);
    }
    expect(JSON.stringify(guide)).not.toContain("txt-secret");
  });

  it("keeps the real label for a ProceedNormally step", () => {
    const evidence = [
      fixtureEvent({
        sequenceId: 1,
        target: { name: "Save", automationId: "btn-save", processName: "fixture.exe" },
        privacy: { trust: "AuthorTrusted", decision: "ProceedNormally" },
      }),
    ];
    const guide = compileGuide(evidence, {});
    expect(guide.steps[0].targetLabel).toBe("Save");
  });
});

describe("compileGuide — unknown variant", () => {
  it("fails closed on an unrecognized message type rather than dropping it", () => {
    // This check lives one layer down, in the reused toEvidenceViewModel
    // (per the brief: reuse it rather than duplicate a second,
    // potentially-inconsistent pipeline schema) -- it throws its own
    // ConsentError, which compileGuide deliberately does not catch and
    // re-wrap. Either way, the important property is that it throws
    // rather than silently dropping the unrecognized message.
    expect(() => compileGuide([{ type: "SomethingNew" }], {})).toThrow(/unrecognized pipeline message type/);
  });
});

describe("compileGuide — sequence integrity", () => {
  it("fails closed on a missing sequenceId", () => {
    const evidence = [fixtureEvent({ sequenceId: undefined })];
    expect(() => compileGuide(evidence, {})).toThrow(GuideCompileError);
  });

  it("fails closed on a non-integer sequenceId", () => {
    const evidence = [fixtureEvent({ sequenceId: 1.5 })];
    expect(() => compileGuide(evidence, {})).toThrow(GuideCompileError);
  });

  it("fails closed on a negative sequenceId", () => {
    const evidence = [fixtureEvent({ sequenceId: -1 })];
    expect(() => compileGuide(evidence, {})).toThrow(GuideCompileError);
  });

  it("fails closed on a duplicate sequenceId -- never guesses an order", () => {
    const evidence = [fixtureEvent({ sequenceId: 5 }), fixtureEvent({ sequenceId: 5 })];
    expect(() => compileGuide(evidence, {})).toThrow(GuideCompileError);
  });

  it("sorts strictly by sequenceId regardless of input array order", () => {
    const evidence = [
      fixtureEvent({ sequenceId: 3 }),
      fixtureEvent({ sequenceId: 1 }),
      fixtureEvent({ sequenceId: 2 }),
    ];
    const guide = compileGuide(evidence, {});
    expect(guide.steps.map((s) => s.sequenceId)).toEqual([1, 2, 3]);
    expect(guide.steps.map((s) => s.stepIndex)).toEqual([0, 1, 2]);
  });
});

describe("compileGuide — out-of-order evidence is sorted, not treated as an error", () => {
  it("a Gap is ordinary evidence, not a sequence-integrity failure", () => {
    const evidence = [
      fixtureEvent({ sequenceId: 1 }),
      { type: "Gap", gap: { firstMissing: 2, lastMissing: 2 } },
      fixtureEvent({ sequenceId: 3 }),
    ];
    expect(() => compileGuide(evidence, {})).not.toThrow();
  });
});

describe("compileGuide — loss-only incomplete and zero-count loss", () => {
  it("a nonzero loss entry alone marks the guide incomplete", () => {
    const evidence = [
      fixtureEvent({ sequenceId: 1, privacy: { trust: "Default", decision: "Withhold" } }),
      { type: "QueueOverflow", stage: "capture-failure", droppedCount: 2 },
    ];
    const guide = compileGuide(evidence, {});
    expect(guide.completeness.isComplete).toBe(false);
    expect(guide.completeness.lossByStage["capture-failure"]).toBe(2);
  });

  it("a zero-count loss entry alone does not mark the guide incomplete", () => {
    const evidence = [
      fixtureEvent({ sequenceId: 1, privacy: { trust: "Default", decision: "Withhold" } }),
      { type: "QueueOverflow", stage: "capture-failure", droppedCount: 0 },
    ];
    const guide = compileGuide(evidence, {});
    expect(guide.completeness.isComplete).toBe(true);
  });
});

describe("compileGuide — gap alone forces incomplete", () => {
  it("a Gap with no loss/uncertainty still marks the guide incomplete", () => {
    const evidence = [
      fixtureEvent({ sequenceId: 1 }),
      { type: "Gap", gap: { firstMissing: 2, lastMissing: 2 } },
      fixtureEvent({ sequenceId: 3 }),
    ];
    const guide = compileGuide(evidence, {});
    expect(guide.completeness.isComplete).toBe(false);
  });

  it("attaches a step-adjacent hint to a gap when the preceding sequence id is present", () => {
    const evidence = [
      fixtureEvent({ sequenceId: 1 }),
      { type: "Gap", gap: { firstMissing: 2, lastMissing: 2 } },
      fixtureEvent({ sequenceId: 3 }),
    ];
    const guide = compileGuide(evidence, {});
    const gap = guide.warnings.find((w) => w.type === "gap");
    expect(gap.stepIndexHint).toBe(0); // the step with sequenceId 1
  });

  it("leaves stepIndexHint null when the preceding sequence id is not present", () => {
    const evidence = [{ type: "Gap", gap: { firstMissing: 50, lastMissing: 50 } }];
    const guide = compileGuide(evidence, {});
    expect(guide.warnings[0].stepIndexHint).toBeNull();
  });
});

describe("compileGuide — shutdown uncertainty", () => {
  it("SessionReconciliationUncertain forces incomplete and is surfaced distinctly, never as a gap", () => {
    const evidence = [
      fixtureEvent({ sequenceId: 1 }),
      { type: "SessionReconciliationUncertain", lastProcessedSeq: 1 },
    ];
    const guide = compileGuide(evidence, {});
    expect(guide.completeness.isComplete).toBe(false);
    expect(guide.completeness.reconciliationUncertain).toBe(true);
    const uncertain = guide.warnings.find((w) => w.type === "uncertain");
    expect(uncertain).toBeDefined();
    expect(guide.warnings.some((w) => w.type === "gap")).toBe(false);
  });
});

describe("compileGuide — empty evidence", () => {
  it("compiles cleanly with zero steps, zero warnings, and isComplete true", () => {
    const guide = compileGuide([], {});
    expect(guide.steps).toEqual([]);
    expect(guide.warnings).toEqual([]);
    expect(guide.completeness.isComplete).toBe(true);
    expect(guide.completeness.totalEvents).toBe(0);
  });
});

describe("compileGuide — determinism and immutability", () => {
  it("produces deep-equal output across two calls on the same input", () => {
    const evidence = buildFixtureEvidence({ trustScope: "author_trusted", target: TARGET });
    const a = compileGuide(evidence, { target: TARGET, trustScope: "author_trusted" });
    const b = compileGuide(evidence, { target: TARGET, trustScope: "author_trusted" });
    expect(a).toEqual(b);
  });

  it("never mutates the input evidence array or its objects", () => {
    const evidence = buildFixtureEvidence({ trustScope: "default", target: TARGET });
    const before = JSON.parse(JSON.stringify(evidence));
    compileGuide(evidence, { target: TARGET, trustScope: "default" });
    expect(evidence).toEqual(before);
  });
});

describe("compileGuide — no 'verified'/'successful'/'complete' claims anywhere in output", () => {
  it("the serialized guide never claims success/verification/completion", () => {
    const evidence = buildFixtureEvidence({ trustScope: "author_trusted", target: TARGET });
    const guide = compileGuide(evidence, { target: TARGET, trustScope: "author_trusted" });
    const json = JSON.stringify(guide).toLowerCase();
    // "draft_unverified" and "status" legitimately contain "verif" as a
    // substring of the NEGATION ("unverified") -- check for the
    // affirmative claims specifically, not every substring.
    expect(json).not.toMatch(/"verified"|successful|all clear|all done/);
  });
});

describe("structural guarantee — no capture, no IPC, no filesystem, no network", () => {
  it("process-guide-compiler.js never references invoke(), the real session commands, filesystem writes, or network calls", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "process-guide-compiler.js"), "utf8");
    expect(source).not.toMatch(/invoke\s*\(/);
    expect(source).not.toContain("process_capture_start_session");
    expect(source).not.toContain("process_capture_stop_session");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket/);
    expect(source).not.toMatch(/writeFile|readFile|require\(["']fs["']\)|from ["']fs["']/);
  });
});
