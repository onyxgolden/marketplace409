// Tests for forge-capture-app/ui/process-guide-wording.js —
// Capture PT-6 Slice W: deterministic, fixture-only wording prototype.
//
// Implements the twelve discovery acceptance fixtures (W1–W9, W3 split
// a–d) plus targeted negative tests beyond the named twelve, and the
// structural no-model/no-network/no-clock source scan the brief
// requires.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyGuideWording,
  WordingError,
  WORDING_RESULT_SCHEMA_VERSION,
  FIXTURE_WORDING_RULESET_V1,
} from "../process-guide-wording.js";
import { GUIDE_SCHEMA_VERSION } from "../process-guide-compiler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FROZEN_TIME = "2026-10-11T15:30:00Z";

// A plain (unfrozen) deep copy of the frozen v1 ruleset, so crafted
// variants can be tweaked per fixture without touching the shared one.
function customRuleset(overrides = {}) {
  return { ...JSON.parse(JSON.stringify(FIXTURE_WORDING_RULESET_V1)), ...overrides };
}

function makeStep(index, action, targetLabel) {
  return {
    stepIndex: index,
    sequenceId: 100 + index,
    action,
    targetLabel,
    point: [10, 20],
    processName: "fixture.exe",
    trust: "Default",
    decision: "Withhold",
    withheld: true,
    redacted: false,
    hasScreenshot: false,
    evidenceRef: { sequenceId: 100 + index },
  };
}

function makeGuide(stepDefs) {
  return {
    schemaVersion: GUIDE_SCHEMA_VERSION,
    source: "fixture",
    status: "draft_unverified",
    target: { label: "Notepad", exeName: "notepad.exe" },
    trustScope: "default",
    steps: stepDefs.map((d, i) => makeStep(i, d.action, d.targetLabel)),
    warnings: [],
    completeness: { isComplete: true },
  };
}

function happyGuide() {
  return makeGuide([
    { action: "Click observed", targetLabel: "btn-save" },
    { action: "Double-click observed", targetLabel: "E-101" },
    { action: "Drag observed", targetLabel: "SOP-1147" },
    { action: "Click observed", targetLabel: "btn-cancel" },
    { action: "Click observed", targetLabel: "btn-ok" },
  ]);
}

function expectedWording(action, targetLabel) {
  return `Observed action: ${action}. Target control: ${targetLabel}.`;
}

// Canonical serialization: object keys sorted recursively, so byte
// comparison is a true semantic comparison (W6/W7).
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}}`;
  }
  return JSON.stringify(value);
}

function expectWordingError(fn, code) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(WordingError);
    expect(e.code).toBe(code);
    // The attempt record is always bounded, plain, serializable data.
    expect(JSON.parse(JSON.stringify(e.attemptRecord))).toEqual(e.attemptRecord);
    return e;
  }
  throw new Error(`expected WordingError with code "${code}" but nothing was thrown`);
}

describe("W1 happy path — five-step fixture guide", () => {
  it("keeps identities/order, preserves evidence, and produces deterministic wording + complete diff", () => {
    const guide = happyGuide();
    const before = JSON.parse(JSON.stringify(guide));
    const { guide: out, diffReport } = applyGuideWording({
      guide,
      ruleset: FIXTURE_WORDING_RULESET_V1,
      provenanceTime: FROZEN_TIME,
    });

    expect(out.steps).toHaveLength(5);
    out.steps.forEach((step, i) => {
      expect(step.stepIndex).toBe(i);
      expect(step.sequenceId).toBe(100 + i);
      // Evidence fields byte-for-byte preserved.
      expect(step.action).toBe(before.steps[i].action);
      expect(step.targetLabel).toBe(before.steps[i].targetLabel);
      expect(step.wording).toBe(expectedWording(before.steps[i].action, before.steps[i].targetLabel));
      expect(step.wordingPass).toEqual({
        schemaVersion: WORDING_RESULT_SCHEMA_VERSION,
        rulesetId: FIXTURE_WORDING_RULESET_V1.rulesetId,
        rulesetVersion: FIXTURE_WORDING_RULESET_V1.rulesetVersion,
        provenanceTime: FROZEN_TIME,
      });
    });

    expect(out.schemaVersion).toBe(GUIDE_SCHEMA_VERSION);
    expect(out.source).toBe("fixture");
    expect(out.status).toBe("draft_unverified");

    expect(diffReport.schemaVersion).toBe(WORDING_RESULT_SCHEMA_VERSION);
    expect(diffReport.rulesetId).toBe(FIXTURE_WORDING_RULESET_V1.rulesetId);
    expect(diffReport.provenanceTime).toBe(FROZEN_TIME);
    expect(diffReport.steps).toHaveLength(5);
    diffReport.steps.forEach((entry, i) => {
      expect(entry.stepIndex).toBe(i);
      expect(entry.before).toBe(entry.after);
      expect(entry.changed).toBe(false);
      expect(entry.mappings).toEqual([]);
    });

    // Input never mutated.
    expect(guide).toEqual(before);
  });
});

describe("W2 no invention — unsupported operations and unbound templates refuse", () => {
  it("refuses a ruleset carrying an append/add-step operation", () => {
    const guide = happyGuide();
    const before = JSON.parse(JSON.stringify(guide));
    const err = expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: customRuleset({ operations: ["append-step"] }),
          provenanceTime: FROZEN_TIME,
        }),
      "unsupported-operation"
    );
    expect(err.attemptRecord.code).toBe("unsupported-operation");
    expect(guide).toEqual(before);
  });

  it("refuses a template not bound one-to-one to an input step", () => {
    const guide = happyGuide();
    const before = JSON.parse(JSON.stringify(guide));
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: customRuleset({ template: "A fixed sentence with no placeholders." }),
          provenanceTime: FROZEN_TIME,
        }),
      "template-not-one-to-one"
    );
    expect(guide).toEqual(before);
  });
});

describe("W3a source-token survival", () => {
  it("keeps btn-save, E-101, and SOP-1147 byte-for-byte in original fields and generated wording", () => {
    const guide = happyGuide();
    const { guide: out } = applyGuideWording({
      guide,
      ruleset: FIXTURE_WORDING_RULESET_V1,
      provenanceTime: FROZEN_TIME,
    });
    const tokens = ["btn-save", "E-101", "SOP-1147"];
    out.steps.slice(0, 3).forEach((step, i) => {
      expect(step.action).toContain("observed");
      expect(step.targetLabel).toBe(tokens[i]);
      // Surrounding fixed phrasing normalized, source token verbatim.
      expect(step.wording).toContain(tokens[i]);
      expect(step.wording.startsWith("Observed action: ")).toBe(true);
    });
  });
});

describe("W3b unmapped replacement refusal", () => {
  it("fails closed when a ruleset replacement directive tries to change E-101 without a mapping", () => {
    const guide = happyGuide();
    const before = JSON.parse(JSON.stringify(guide));
    const err = expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: customRuleset({ replacements: [{ from: "E-101", to: "Something else" }] }),
          provenanceTime: FROZEN_TIME,
        }),
      "unknown-ruleset-key"
    );
    expect(err.message.length).toBeGreaterThan(0);
    expect(guide).toEqual(before);
  });
});

describe("W3c mapped replacement recorded", () => {
  it("projects the mapped wording, keeps evidence E-101, and records exactly one stable mapping", () => {
    const guide = happyGuide();
    const mapping = [{ from: "E-101", to: "Pump P-101" }];
    const { guide: out, diffReport } = applyGuideWording({
      guide,
      ruleset: FIXTURE_WORDING_RULESET_V1,
      mapping,
      provenanceTime: FROZEN_TIME,
    });

    const step = out.steps[1];
    expect(step.wording).toContain("Pump P-101");
    expect(step.wording).not.toContain("E-101");
    // Original evidence field still the source token.
    expect(step.action).toBe("Double-click observed");
    expect(step.targetLabel).toBe("E-101");
    // All other source tokens remain verbatim everywhere.
    expect(out.steps[0].wording).toContain("btn-save");
    expect(out.steps[2].wording).toContain("SOP-1147");

    const entry = diffReport.steps[1];
    expect(entry.changed).toBe(true);
    expect(entry.before).toContain("E-101");
    expect(entry.after).toContain("Pump P-101");
    expect(entry.mappings).toEqual([
      { stepIndex: 1, field: "targetLabel", from: "E-101", to: "Pump P-101", occurrences: 1 },
    ]);
    // No other step records a mapping.
    diffReport.steps
      .filter((_, i) => i !== 1)
      .forEach((e) => expect(e.mappings).toEqual([]));
  });
});

describe("W3d introduced terminology gate", () => {
  it("fails closed on a non-allowlisted invented term with no partial output", () => {
    const guide = happyGuide();
    const before = JSON.parse(JSON.stringify(guide));
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: customRuleset({
            template: "TurboFix {action}.",
            terminologyAllowlist: ["observed", "action"],
          }),
          provenanceTime: FROZEN_TIME,
        }),
      "terminology-violation"
    );
    expect(guide).toEqual(before);
  });

  it("succeeds with an allowlisted industry-standard term and never rejects source spans for allowlist absence", () => {
    const guide = makeGuide([{ action: "XyZz-999 unlisted gizmo", targetLabel: "btn-save" }]);
    const { guide: out } = applyGuideWording({
      guide,
      ruleset: customRuleset({
        template: "Observed action: {action}.",
        terminologyAllowlist: ["observed", "action"],
      }),
      provenanceTime: FROZEN_TIME,
    });
    // The source span "XyZz-999 unlisted gizmo" survives verbatim even
    // though none of its words are allowlisted.
    expect(out.steps[0].wording).toBe("Observed action: XyZz-999 unlisted gizmo.");
  });
});

describe("W4 malformed schema", () => {
  it("refuses a guide missing schemaVersion", () => {
    const guide = happyGuide();
    delete guide.schemaVersion;
    expectWordingError(
      () => applyGuideWording({ guide, ruleset: FIXTURE_WORDING_RULESET_V1, provenanceTime: FROZEN_TIME }),
      "unsupported-schema-version"
    );
  });

  it("refuses each independently malformed step case with no partial output", () => {
    const badGuides = [
      () => {
        const g = happyGuide();
        g.steps[2] = "not-an-object";
        return g;
      },
      () => {
        const g = happyGuide();
        g.steps[1].action = 42;
        return g;
      },
      () => {
        const g = happyGuide();
        delete g.steps[0].targetLabel;
        return g;
      },
      () => {
        const g = happyGuide();
        g.steps[3].stepIndex = 1; // out of ascending order
        return g;
      },
      () => {
        const g = happyGuide();
        g.steps = "not-an-array";
        return g;
      },
    ];
    for (const build of badGuides) {
      const guide = build();
      const before = JSON.parse(JSON.stringify(guide));
      expectWordingError(
        () => applyGuideWording({ guide, ruleset: FIXTURE_WORDING_RULESET_V1, provenanceTime: FROZEN_TIME }),
        "invalid-guide"
      );
      expect(guide).toEqual(before);
    }
  });
});

describe("W5 non-fixture source", () => {
  it.each([["live"], ["session"]])(
    "refuses source %p before wording with a safe bounded attempt record and no guide contents",
    (source) => {
      const guide = happyGuide();
      guide.source = source;
      const before = JSON.parse(JSON.stringify(guide));
      const err = expectWordingError(
        () => applyGuideWording({ guide, ruleset: FIXTURE_WORDING_RULESET_V1, provenanceTime: FROZEN_TIME }),
        "non-fixture-source"
      );
      expect(err.attemptRecord).toEqual({
        code: "non-fixture-source",
        source,
        rulesetId: FIXTURE_WORDING_RULESET_V1.rulesetId,
        rulesetVersion: FIXTURE_WORDING_RULESET_V1.rulesetVersion,
      });
      // The record must not leak guide contents (no steps, no tokens).
      expect(err.attemptRecord).not.toHaveProperty("steps");
      expect(JSON.stringify(err.attemptRecord)).not.toContain("btn-save");
      expect(guide).toEqual(before);
    }
  );
});

describe("W6 repeatability", () => {
  it("two runs with identical inputs and frozen time produce byte-identical canonical output", () => {
    const mapping = [{ from: "E-101", to: "Pump P-101" }];
    const run = () =>
      applyGuideWording({
        guide: happyGuide(),
        ruleset: FIXTURE_WORDING_RULESET_V1,
        mapping,
        provenanceTime: FROZEN_TIME,
      });
    expect(canonicalJson(run())).toBe(canonicalJson(run()));
  });
});

describe("W7 idempotence", () => {
  it("reapplying the pass to its own output returns byte-identical semantic output", () => {
    const mapping = [{ from: "E-101", to: "Pump P-101" }];
    const first = applyGuideWording({
      guide: happyGuide(),
      ruleset: FIXTURE_WORDING_RULESET_V1,
      mapping,
      provenanceTime: FROZEN_TIME,
    });
    const second = applyGuideWording({
      guide: first.guide,
      ruleset: FIXTURE_WORDING_RULESET_V1,
      mapping,
      provenanceTime: FROZEN_TIME,
    });
    expect(canonicalJson(second)).toBe(canonicalJson(first));
    // No nested or duplicated provenance: exactly one wordingPass per
    // step, and the diff's changed flags are stable (not flipped to
    // "unchanged" on the second run).
    second.guide.steps.forEach((step) => {
      expect(Object.keys(step.wordingPass).sort()).toEqual([
        "provenanceTime",
        "rulesetId",
        "rulesetVersion",
        "schemaVersion",
      ]);
    });
    expect(second.diffReport.steps[1].changed).toBe(true);
    expect(second.diffReport.steps[1].mappings).toHaveLength(1);
  });
});

describe("W8 status preservation — no verification claims", () => {
  it("keeps every status draft_unverified", () => {
    const { guide } = applyGuideWording({
      guide: happyGuide(),
      ruleset: FIXTURE_WORDING_RULESET_V1,
      provenanceTime: FROZEN_TIME,
    });
    expect(guide.status).toBe("draft_unverified");
  });

  it("refuses a template asserting a verified claim, even if the word is allowlisted", () => {
    const guide = happyGuide();
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: customRuleset({
            template: "Verified action: {action}.",
            terminologyAllowlist: ["verified", "action"],
          }),
          provenanceTime: FROZEN_TIME,
        }),
      "verification-claim"
    );
  });

  it("refuses an input guide whose status is not draft_unverified", () => {
    const guide = happyGuide();
    guide.status = "verified";
    expectWordingError(
      () => applyGuideWording({ guide, ruleset: FIXTURE_WORDING_RULESET_V1, provenanceTime: FROZEN_TIME }),
      "unsupported-status"
    );
  });

  it("serialized output contains no affirmative verification claim", () => {
    const result = applyGuideWording({
      guide: happyGuide(),
      ruleset: FIXTURE_WORDING_RULESET_V1,
      provenanceTime: FROZEN_TIME,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/\bverified\b/i);
    expect(serialized).not.toMatch(/\bcertified\b/i);
    expect(serialized).not.toMatch(/\bsuccessful\b/i);
    expect(serialized).not.toMatch(/\bapproved\b/i);
  });
});

describe("W9 no-model-call gate", () => {
  it("refuses a ruleset carrying provider/model/network/executable configuration", () => {
    const guide = happyGuide();
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: customRuleset({ model: "gpt-4" }),
          provenanceTime: FROZEN_TIME,
        }),
      "ruleset-forbidden-config"
    );
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: customRuleset({ provider: { name: "acme-ai" } }),
          provenanceTime: FROZEN_TIME,
        }),
      "ruleset-forbidden-config"
    );
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: customRuleset({ callback: "onWordingDone" }),
          provenanceTime: FROZEN_TIME,
        }),
      "ruleset-forbidden-config"
    );
  });

  it("refuses a ruleset containing executable (function) values", () => {
    const guide = happyGuide();
    const ruleset = customRuleset();
    ruleset.template = { render: () => "x" };
    expectWordingError(
      () => applyGuideWording({ guide, ruleset, provenanceTime: FROZEN_TIME }),
      "ruleset-not-declarative"
    );
  });

  it("process-guide-wording.js has no imports or references for fetch/XHR/WebSocket/Tauri IPC/model SDKs/filesystem/storage/dynamic eval/clock reads", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "process-guide-wording.js"), "utf8");
    expect(source).not.toContain("process_capture_start_session");
    expect(source).not.toContain("process_capture_stop_session");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket/);
    expect(source).not.toMatch(/\binvoke\s*\(/);
    expect(source).not.toMatch(/writeFile|readFile|localStorage|sessionStorage|indexedDB/);
    expect(source).not.toMatch(/\beval\s*\(|new Function/);
    expect(source).not.toMatch(/Date\.now|new Date\(|performance\.now/);
    expect(source).not.toMatch(/from\s+["'](@tauri|fs|node:)/);
  });
});

describe("targeted negatives — mapping", () => {
  it("rejects malformed mapping entries", () => {
    const cases = [
      [{ from: "", to: "x" }],
      [{ from: "E-101", to: "" }],
      [{ from: "E-101" }],
      ["not-an-object"],
      [{ from: 42, to: "x" }],
    ];
    for (const mapping of cases) {
      const guide = happyGuide();
      expectWordingError(
        () => applyGuideWording({ guide, ruleset: FIXTURE_WORDING_RULESET_V1, mapping, provenanceTime: FROZEN_TIME }),
        "invalid-mapping"
      );
      expect(guide).toEqual(happyGuide());
    }
  });

  it("rejects a non-array mapping", () => {
    const guide = happyGuide();
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: FIXTURE_WORDING_RULESET_V1,
          mapping: "nope",
          provenanceTime: FROZEN_TIME,
        }),
      "invalid-mapping"
    );
  });

  it("rejects duplicate and overlapping mapping keys", () => {
    const guide = happyGuide();
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: FIXTURE_WORDING_RULESET_V1,
          mapping: [
            { from: "E-101", to: "A" },
            { from: "E-101", to: "B" },
          ],
          provenanceTime: FROZEN_TIME,
        }),
      "invalid-mapping"
    );
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: FIXTURE_WORDING_RULESET_V1,
          mapping: [
            { from: "E-101", to: "A" },
            { from: "E-10", to: "B" },
          ],
          provenanceTime: FROZEN_TIME,
        }),
      "invalid-mapping"
    );
  });

  it("rejects a mapping whose from matches no source span", () => {
    const guide = happyGuide();
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: FIXTURE_WORDING_RULESET_V1,
          mapping: [{ from: "NO-SUCH-TOKEN", to: "x" }],
          provenanceTime: FROZEN_TIME,
        }),
      "mapping-source-not-found"
    );
  });

  it("does not trust caller array order — reversed mappings give identical output", () => {
    const guide = happyGuide();
    const a = applyGuideWording({
      guide,
      ruleset: FIXTURE_WORDING_RULESET_V1,
      mapping: [
        { from: "E-101", to: "Pump P-101" },
        { from: "SOP-1147", to: "Guide G-1147" },
      ],
      provenanceTime: FROZEN_TIME,
    });
    const b = applyGuideWording({
      guide,
      ruleset: FIXTURE_WORDING_RULESET_V1,
      mapping: [
        { from: "SOP-1147", to: "Guide G-1147" },
        { from: "E-101", to: "Pump P-101" },
      ],
      provenanceTime: FROZEN_TIME,
    });
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("applies mapping in a single pass against original spans (no chaining)", () => {
    const guide = makeGuide([{ action: "E-101 observed", targetLabel: "btn-save" }]);
    const { guide: out } = applyGuideWording({
      guide,
      ruleset: FIXTURE_WORDING_RULESET_V1,
      mapping: [{ from: "E-101", to: "SOP-1147" }],
      provenanceTime: FROZEN_TIME,
    });
    // The mapping target is not re-scanned: the original "SOP-1147" span
    // in the targetLabel is untouched, and the replaced text is literal.
    expect(out.steps[0].wording).toContain("SOP-1147 observed");
    expect(out.steps[0].targetLabel).toBe("btn-save");
  });
});

describe("targeted negatives — ruleset and template shape", () => {
  it("rejects unknown ruleset keys", () => {
    const guide = happyGuide();
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: customRuleset({ extraStep: true }),
          provenanceTime: FROZEN_TIME,
        }),
      "unknown-ruleset-key"
    );
  });

  it("rejects unknown placeholders", () => {
    const guide = happyGuide();
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: customRuleset({ template: "Do {action} on {mystery}." }),
          provenanceTime: FROZEN_TIME,
        }),
      "unknown-placeholder"
    );
  });

  it("rejects malformed templates with unbalanced braces", () => {
    const guide = happyGuide();
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: customRuleset({ template: "Broken {action and {targetLabel}." }),
          provenanceTime: FROZEN_TIME,
        }),
      "malformed-template"
    );
  });

  it("rejects an unsupported ruleset schema version", () => {
    const guide = happyGuide();
    expectWordingError(
      () =>
        applyGuideWording({
          guide,
          ruleset: customRuleset({ schemaVersion: 999 }),
          provenanceTime: FROZEN_TIME,
        }),
      "unsupported-ruleset-version"
    );
  });
});

describe("targeted negatives — provenance time, immutability, serializability", () => {
  it("requires a bounded RFC 3339 provenanceTime and never reads the clock", () => {
    const guide = happyGuide();
    for (const provenanceTime of [undefined, "", "not-a-time", "2026-13-99T99:99:99Z", "x".repeat(500)]) {
      expectWordingError(
        () => applyGuideWording({ guide, ruleset: FIXTURE_WORDING_RULESET_V1, provenanceTime }),
        "invalid-provenance-time"
      );
    }
    // The injected time is copied verbatim, including offsets.
    const { diffReport } = applyGuideWording({
      guide,
      ruleset: FIXTURE_WORDING_RULESET_V1,
      provenanceTime: "2026-10-11T10:30:00.123-05:00",
    });
    expect(diffReport.provenanceTime).toBe("2026-10-11T10:30:00.123-05:00");
  });

  it("never mutates frozen inputs and works on them without throwing", () => {
    const guide = happyGuide();
    const mapping = Object.freeze([{ from: "E-101", to: "Pump P-101" }].map((e) => Object.freeze(e)));
    const snapshot = JSON.parse(JSON.stringify({ guide, mapping }));
    const { guide: out } = applyGuideWording({
      guide: deepFreezeForTest(guide),
      ruleset: FIXTURE_WORDING_RULESET_V1,
      mapping,
      provenanceTime: FROZEN_TIME,
    });
    expect(JSON.parse(JSON.stringify({ guide, mapping }))).toEqual(snapshot);
    expect(out.steps[1].wording).toContain("Pump P-101");
  });

  it("returns JSON-serializable output", () => {
    const result = applyGuideWording({
      guide: happyGuide(),
      ruleset: FIXTURE_WORDING_RULESET_V1,
      mapping: [{ from: "E-101", to: "Pump P-101" }],
      provenanceTime: FROZEN_TIME,
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("ships one frozen v1 fixture ruleset with industry-standard generic terms", () => {
    expect(Object.isFrozen(FIXTURE_WORDING_RULESET_V1)).toBe(true);
    expect(Object.isFrozen(FIXTURE_WORDING_RULESET_V1.placeholderFields)).toBe(true);
    expect(Object.isFrozen(FIXTURE_WORDING_RULESET_V1.terminologyAllowlist)).toBe(true);
    expect(WORDING_RESULT_SCHEMA_VERSION).toBe(1);
    expect(FIXTURE_WORDING_RULESET_V1.rulesetId).toBe("fixture-wording-v1");
    expect(FIXTURE_WORDING_RULESET_V1.placeholderFields).toEqual(["action", "targetLabel"]);
  });
});

function deepFreezeForTest(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreezeForTest(value[key]);
    Object.freeze(value);
  }
  return value;
}
