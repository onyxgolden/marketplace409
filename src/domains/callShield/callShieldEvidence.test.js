import { describe, expect, it } from "vitest";
import {
  attachEvidence,
  buildManifest,
  validateEvidenceDescriptor,
  verifyManifest,
} from "./callShieldEvidence.js";
import { EVIDENCE_KINDS, EVENT_TYPES } from "./callShieldConstants.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function descriptor(overrides = {}) {
  return {
    kind: EVIDENCE_KINDS.AUDIO_RECORDING,
    fileName: "call-2026-09-23.m4a",
    mimeType: "audio/mp4",
    byteSize: 1024,
    sha256: SHA_A,
    capturedAt: "2026-09-23T10:23:00-05:00",
    ...overrides,
  };
}

describe("validateEvidenceDescriptor", () => {
  it("accepts a well-formed descriptor", () => {
    expect(validateEvidenceDescriptor(descriptor()).ok).toBe(true);
  });

  it("reports every problem without throwing", () => {
    const { ok, issues } = validateEvidenceDescriptor({
      kind: "hologram",
      fileName: "",
      mimeType: "application/x-executable",
      byteSize: -3,
      sha256: "xyz",
      capturedAt: "never",
    });
    expect(ok).toBe(false);
    expect(issues.length).toBeGreaterThanOrEqual(5);
  });
});

describe("attachEvidence", () => {
  it("emits an EVIDENCE_ATTACHED event with custody fields", () => {
    const { event } = attachEvidence("case-1", descriptor(), { callId: "call-9" });
    expect(event.type).toBe(EVENT_TYPES.EVIDENCE_ATTACHED);
    expect(event.payload.caseId).toBe("case-1");
    expect(event.payload.callId).toBe("call-9");
    expect(event.payload.sha256).toBe(SHA_A);
    expect(event.payload.capturedAt).toBeTruthy();
    expect(event.payload.evidenceId).toBeTruthy();
  });

  it("normalizes the hash to lowercase", () => {
    const { event } = attachEvidence("case-1", descriptor({ sha256: SHA_A.toUpperCase() }));
    expect(event.payload.sha256).toBe(SHA_A);
  });

  it("throws a descriptive TypeError for invalid descriptors", () => {
    expect(() => attachEvidence("case-1", descriptor({ sha256: "nope" }))).toThrow(/sha256/);
    expect(() => attachEvidence("", descriptor())).toThrow(/caseId/);
  });
});

describe("buildManifest", () => {
  it("orders evidence chronologically by capture time", () => {
    const e1 = attachEvidence("c", descriptor({ sha256: SHA_A, capturedAt: "2026-09-23T12:00:00-05:00", fileName: "b.png", mimeType: "image/png", kind: EVIDENCE_KINDS.CALL_LOG_SCREENSHOT })).event.payload;
    const e2 = attachEvidence("c", descriptor({ sha256: SHA_B, capturedAt: "2026-09-23T10:00:00-05:00", fileName: "a.m4a" })).event.payload;
    const manifest = buildManifest({
      evidence: [
        { ...e1, recordedAt: "2026-09-23T12:01:00Z" },
        { ...e2, recordedAt: "2026-09-23T10:01:00Z" },
      ],
    });
    expect(manifest.map((m) => m.sequence)).toEqual([1, 2]);
    expect(manifest[0].sha256).toBe(SHA_B);
    expect(manifest[1].sha256).toBe(SHA_A);
  });

  it("handles a case with no evidence", () => {
    expect(buildManifest({})).toEqual([]);
  });
});

describe("verifyManifest", () => {
  const manifest = [
    { evidenceId: "e1", fileName: "a.m4a", sha256: SHA_A },
    { evidenceId: "e2", fileName: "b.png", sha256: SHA_B },
  ];

  it("passes when every digest matches", () => {
    const result = verifyManifest(manifest, { e1: SHA_A, e2: SHA_B });
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(2);
  });

  it("flags tampered or missing files", () => {
    const result = verifyManifest(manifest, { e1: "c".repeat(64) });
    expect(result.ok).toBe(false);
    expect(result.mismatches).toHaveLength(2);
    expect(result.mismatches[0].expected).toBe(SHA_A);
    expect(result.mismatches[1].actual).toBeNull(); // missing file
  });
});
