// Tests for forge-capture-app/ui/narration-core.js — Phase 3 Slice A
// narration logic. Pure functions only; no DOM, no Tauri invoke.
import { describe, it, expect } from "vitest";
import {
  validateScriptSegments,
  buildVtt,
  formatVttTimestamp,
  formatSec,
  segmentsOverlap,
  consentStatusLabel,
  enrollmentStatusLabel,
  acceptanceVerdictLabel,
} from "../narration-core.js";

// --- validateScriptSegments -------------------------------------------------

describe("validateScriptSegments", () => {
  const happy = [
    { stepId: "intro", text: "Welcome to the SOP.", captureStartSec: 0, captureEndSec: 4.5 },
    { stepId: "valve", text: "Next, open the valve.", captureStartSec: 4.5, captureEndSec: 12 },
  ];

  it("accepts a valid script", () => {
    expect(validateScriptSegments(happy, 30)).toEqual([]);
  });

  it("rejects an empty script", () => {
    expect(validateScriptSegments([], 30)).toEqual([
      "Script must contain at least one segment.",
    ]);
    expect(validateScriptSegments(null, 30)).toEqual([
      "Script must contain at least one segment.",
    ]);
    expect(validateScriptSegments("nope", 30)).toEqual([
      "Script must contain at least one segment.",
    ]);
  });

  it("rejects empty text, naming the step", () => {
    const segs = [
      { stepId: "intro", text: "   ", captureStartSec: 0, captureEndSec: 4 },
    ];
    const errors = validateScriptSegments(segs, 30);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("intro");
    expect(errors[0]).toMatch(/text/i);
  });

  it("rejects a missing stepId", () => {
    const segs = [
      { stepId: " ", text: "Hello.", captureStartSec: 0, captureEndSec: 4 },
    ];
    const errors = validateScriptSegments(segs, 30);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/stepId/i);
  });

  it("rejects a negative start, naming the step", () => {
    const segs = [
      { stepId: "intro", text: "Hello.", captureStartSec: -1, captureEndSec: 4 },
    ];
    const errors = validateScriptSegments(segs, 30);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("intro");
    expect(errors[0]).toMatch(/>= 0/);
  });

  it("rejects end <= start, naming the step", () => {
    for (const end of [0, -2]) {
      const segs = [
        { stepId: "intro", text: "Hello.", captureStartSec: 2, captureEndSec: end },
      ];
      const errors = validateScriptSegments(segs, 30);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("intro");
      expect(errors[0]).toMatch(/greater than/);
    }
  });

  it("rejects end past the capture duration, naming the step", () => {
    const segs = [
      { stepId: "intro", text: "Hello.", captureStartSec: 0, captureEndSec: 31 },
    ];
    const errors = validateScriptSegments(segs, 30);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("intro");
    expect(errors[0]).toMatch(/duration/);
  });

  it("allows end exactly at the capture duration", () => {
    const segs = [
      { stepId: "intro", text: "Hello.", captureStartSec: 0, captureEndSec: 30 },
    ];
    expect(validateScriptSegments(segs, 30)).toEqual([]);
  });

  it("rejects a duplicate step id, naming the step", () => {
    const segs = [
      { stepId: "intro", text: "One.", captureStartSec: 0, captureEndSec: 4 },
      { stepId: "intro", text: "Two.", captureStartSec: 4, captureEndSec: 8 },
    ];
    const errors = validateScriptSegments(segs, 30);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("intro");
    expect(errors[0]).toMatch(/duplicat/i);
  });

  it("rejects overlapping segments, naming the later step", () => {
    const segs = [
      { stepId: "intro", text: "One.", captureStartSec: 0, captureEndSec: 6 },
      { stepId: "valve", text: "Two.", captureStartSec: 4, captureEndSec: 9 },
    ];
    const errors = validateScriptSegments(segs, 30);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("valve");
    expect(errors[0]).toMatch(/overlap/i);
  });

  it("allows touching segments (start == previous end)", () => {
    expect(validateScriptSegments(happy, 30)).toEqual([]);
  });

  it("rejects unsorted segments, naming the out-of-order step", () => {
    const segs = [
      { stepId: "valve", text: "Two.", captureStartSec: 4, captureEndSec: 9 },
      { stepId: "intro", text: "One.", captureStartSec: 0, captureEndSec: 4 },
    ];
    const errors = validateScriptSegments(segs, 30);
    expect(errors.some((e) => e.includes("intro") && /sorted/i.test(e))).toBe(true);
  });
});

// --- timestamps + captions ---------------------------------------------------

describe("formatVttTimestamp", () => {
  it("formats HH:MM:SS.mmm", () => {
    expect(formatVttTimestamp(0)).toBe("00:00:00.000");
    expect(formatVttTimestamp(4.5)).toBe("00:00:04.500");
    expect(formatVttTimestamp(65.25)).toBe("00:01:05.250");
    expect(formatVttTimestamp(3723.456)).toBe("01:02:03.456");
  });
  it("lets hours exceed 24", () => {
    expect(formatVttTimestamp(90061.234)).toBe("25:01:01.234");
  });
  it("clamps negatives to zero", () => {
    expect(formatVttTimestamp(-3)).toBe("00:00:00.000");
  });
});

describe("buildVtt", () => {
  it("renders exact WEBVTT output for two segments", () => {
    const vtt = buildVtt([
      { stepId: "intro", text: "Welcome to the SOP.", captureStartSec: 0, captureEndSec: 4.5 },
      { stepId: "valve", text: "Next, open the valve.", captureStartSec: 4.5, captureEndSec: 12 },
    ]);
    expect(vtt).toBe(
      "WEBVTT\n\n" +
        "00:00:00.000 --> 00:00:04.500\n" +
        "Welcome to the SOP.\n\n" +
        "00:00:04.500 --> 00:00:12.000\n" +
        "Next, open the valve.\n\n",
    );
  });
  it("keeps text verbatim and handles hour rollover", () => {
    const vtt = buildVtt([
      { stepId: "late", text: "  spaced  text  ", captureStartSec: 3600, captureEndSec: 3605.5 },
    ]);
    expect(vtt).toBe("WEBVTT\n\n01:00:00.000 --> 01:00:05.500\n  spaced  text  \n\n");
  });
  it("is just the header for an empty script", () => {
    expect(buildVtt([])).toBe("WEBVTT\n\n");
  });
});

describe("formatSec", () => {
  it("formats M:SS.s", () => {
    expect(formatSec(0)).toBe("0:00.0");
    expect(formatSec(4.5)).toBe("0:04.5");
    expect(formatSec(65.5)).toBe("1:05.5");
    expect(formatSec(3723.4)).toBe("62:03.4");
  });
  it("clamps negatives to zero", () => {
    expect(formatSec(-2)).toBe("0:00.0");
  });
});

// --- segmentsOverlap -----------------------------------------------------------

describe("segmentsOverlap", () => {
  it("is true for overlapping windows", () => {
    expect(segmentsOverlap({ start: 0, end: 6 }, { start: 4, end: 9 })).toBe(true);
    expect(segmentsOverlap({ start: 4, end: 9 }, { start: 0, end: 6 })).toBe(true);
    expect(segmentsOverlap({ start: 2, end: 5 }, { start: 0, end: 10 })).toBe(true);
  });
  it("is false for touching or disjoint windows", () => {
    expect(segmentsOverlap({ start: 0, end: 4 }, { start: 4, end: 9 })).toBe(false);
    expect(segmentsOverlap({ start: 0, end: 4 }, { start: 5, end: 9 })).toBe(false);
  });
});

// --- status labels ---------------------------------------------------------------

describe("consentStatusLabel", () => {
  it("labels a null receipt", () => {
    expect(consentStatusLabel(null)).toBe("No receipt");
    expect(consentStatusLabel(undefined)).toBe("No receipt");
  });
  it("labels an active voice receipt", () => {
    expect(consentStatusLabel({ status: "active", scope: ["voice"] })).toBe("Active");
    expect(consentStatusLabel({ status: "active", scope: ["voice", "face"] })).toBe("Active");
  });
  it("labels a revoked receipt", () => {
    expect(consentStatusLabel({ status: "revoked", scope: ["voice"] })).toBe("Revoked");
  });
  it("labels a receipt without the voice scope", () => {
    expect(consentStatusLabel({ status: "active", scope: ["face"] })).toBe("Voice scope missing");
    expect(consentStatusLabel({ status: "active", scope: [] })).toBe("Voice scope missing");
    expect(consentStatusLabel({ status: "active" })).toBe("Voice scope missing");
  });
});

describe("enrollmentStatusLabel", () => {
  it("labels a null enrollment", () => {
    expect(enrollmentStatusLabel(null)).toBe("Not enrolled");
    expect(enrollmentStatusLabel(undefined)).toBe("Not enrolled");
  });
  it("labels each enrollment state", () => {
    expect(enrollmentStatusLabel({ status: "pending" })).toBe("Pending");
    expect(enrollmentStatusLabel({ status: "active" })).toBe("Active");
    expect(enrollmentStatusLabel({ status: "revoked" })).toBe("Revoked");
  });
});

describe("acceptanceVerdictLabel", () => {
  it("labels a null receipt", () => {
    expect(acceptanceVerdictLabel(null)).toBe("Not reviewed");
    expect(acceptanceVerdictLabel(undefined)).toBe("Not reviewed");
  });
  it("passes only when both decisions approve", () => {
    expect(
      acceptanceVerdictLabel({ presenter_decision: "approved", reviewer_decision: "approved" }),
    ).toBe("PASS");
  });
  it("fails when either decision rejects", () => {
    expect(
      acceptanceVerdictLabel({ presenter_decision: "rejected", reviewer_decision: "approved" }),
    ).toBe("FAIL");
    expect(
      acceptanceVerdictLabel({ presenter_decision: "approved", reviewer_decision: "rejected" }),
    ).toBe("FAIL");
    expect(
      acceptanceVerdictLabel({ presenter_decision: "rejected", reviewer_decision: "rejected" }),
    ).toBe("FAIL");
  });
});
