import { describe, expect, it } from "vitest";
import {
  canTransitionScreening,
  creditBandForScore,
  generateScreeningToken,
  isPublicLinkRateLimited,
  listProviderStatus,
  normalizeApplicantScreeningInput,
  requestScreeningReport,
  screeningConsentIsRecorded,
  screeningHasResults,
  suggestRecommendation,
  validateApplicantScreeningInput,
  validateManualResults,
  validateRecommendation,
  SCREENING_COMPLIANCE_NOTE,
  SCREENING_PROVIDERS,
} from "../screening";

describe("screening status machine", () => {
  it("walks not_requested → requested → in_progress → complete", () => {
    expect(canTransitionScreening("not_requested", "requested")).toBe(true);
    expect(canTransitionScreening("requested", "in_progress")).toBe(true);
    expect(canTransitionScreening("in_progress", "complete")).toBe(true);
  });
  it("allows requested → complete (owner records results directly)", () => {
    expect(canTransitionScreening("requested", "complete")).toBe(true);
  });
  it("rejects backwards and skipped-forward transitions; complete is terminal", () => {
    expect(canTransitionScreening("requested", "not_requested")).toBe(false);
    expect(canTransitionScreening("not_requested", "in_progress")).toBe(false);
    expect(canTransitionScreening("not_requested", "complete")).toBe(false);
    expect(canTransitionScreening("in_progress", "requested")).toBe(false);
    expect(canTransitionScreening("complete", "requested")).toBe(false);
    expect(canTransitionScreening("complete", "complete")).toBe(false);
  });
  it("rejects unknown statuses", () => {
    expect(canTransitionScreening("requested", "approved")).toBe(false);
    expect(canTransitionScreening("bogus", "requested")).toBe(false);
  });
});

describe("fail-closed consent", () => {
  it("accepts R21 application consent", () => {
    expect(screeningConsentIsRecorded({ answers: { consent: true } }, null)).toBe(true);
  });
  it("accepts applicant re-confirmation through the link", () => {
    expect(screeningConsentIsRecorded({ answers: {} }, { consent_recorded: true })).toBe(true);
  });
  it("fails closed when neither consent record exists", () => {
    expect(screeningConsentIsRecorded({ answers: {} }, null)).toBe(false);
    expect(screeningConsentIsRecorded({ answers: { consent: false } }, { consent_recorded: false })).toBe(false);
    expect(screeningConsentIsRecorded(null, null)).toBe(false);
  });
});

describe("manual result validation", () => {
  it("accepts a full valid result set", () => {
    expect(validateManualResults({
      creditScore: 720, creditBand: "good",
      criminalFlag: false, criminalNotes: "",
      evictionFlag: false, evictionNotes: "",
    })).toEqual([]);
  });
  it("rejects out-of-range credit scores", () => {
    expect(validateManualResults({ creditScore: 299 })).not.toEqual([]);
    expect(validateManualResults({ creditScore: 851 })).not.toEqual([]);
    expect(validateManualResults({ creditScore: 720.5 })).not.toEqual([]);
  });
  it("rejects a band that does not match the score", () => {
    expect(validateManualResults({ creditScore: 720, creditBand: "poor" })).not.toEqual([]);
  });
  it("rejects unknown bands and non-boolean flags", () => {
    expect(validateManualResults({ creditBand: "great" })).not.toEqual([]);
    expect(validateManualResults({ criminalFlag: "yes" })).not.toEqual([]);
  });
  it("rejects over-long notes", () => {
    expect(validateManualResults({ criminalNotes: "x".repeat(4001) })).not.toEqual([]);
  });
});

describe("credit band mapping", () => {
  it("maps boundary scores", () => {
    expect(creditBandForScore(300)).toBe("poor");
    expect(creditBandForScore(579)).toBe("poor");
    expect(creditBandForScore(580)).toBe("fair");
    expect(creditBandForScore(669)).toBe("fair");
    expect(creditBandForScore(670)).toBe("good");
    expect(creditBandForScore(739)).toBe("good");
    expect(creditBandForScore(740)).toBe("very_good");
    expect(creditBandForScore(799)).toBe("very_good");
    expect(creditBandForScore(800)).toBe("excellent");
    expect(creditBandForScore(850)).toBe("excellent");
  });
  it("returns null for invalid scores", () => {
    expect(creditBandForScore(299)).toBeNull();
    expect(creditBandForScore(null)).toBeNull();
  });
});

describe("recommendation suggestion (decision support only)", () => {
  it("suggests deny on criminal or eviction flags", () => {
    expect(suggestRecommendation({ criminalFlag: true }).recommendation).toBe("deny");
    expect(suggestRecommendation({ evictionFlag: true }).recommendation).toBe("deny");
  });
  it("suggests conditional on poor credit", () => {
    expect(suggestRecommendation({ creditScore: 550 }).recommendation).toBe("conditional");
    expect(suggestRecommendation({ creditBand: "poor" }).recommendation).toBe("conditional");
  });
  it("suggests approve when nothing is flagged", () => {
    const result = suggestRecommendation({ creditScore: 720 });
    expect(result.recommendation).toBe("approve");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
  it("never decides by itself — the owner records the real recommendation", () => {
    expect(validateRecommendation({ recommendation: "deny", reasons: "Owner's call" })).toEqual([]);
    expect(validateRecommendation({ recommendation: "maybe" })).not.toEqual([]);
    expect(validateRecommendation(null)).not.toEqual([]);
  });
});

describe("screening completion guard", () => {
  it("requires something recorded before completing", () => {
    expect(screeningHasResults({})).toBe(false);
    // Explicit "no flags" with nothing else recorded is NOT a recorded
    // result — it is indistinguishable from the column defaults.
    expect(screeningHasResults({ criminal_flag: false, eviction_flag: false })).toBe(false);
    expect(screeningHasResults({ credit_score: 700 })).toBe(true);
    expect(screeningHasResults({ credit_band: "good" })).toBe(true);
    expect(screeningHasResults({ criminal_flag: true })).toBe(true);
    expect(screeningHasResults({ eviction_notes: "none found" })).toBe(true);
  });
  it("treats results_recorded_at as the source of truth (finding 2)", () => {
    // results_recorded_at is written atomically with the results by
    // record_results, so explicit "no flags" results complete the screening.
    expect(screeningHasResults({
      criminal_flag: false, eviction_flag: false,
      results_recorded_at: "2026-10-01T00:00:00Z",
    })).toBe(true);
    expect(screeningHasResults({
      credit_score: null, credit_band: null,
      criminal_flag: false, criminal_notes: null,
      eviction_flag: false, eviction_notes: null,
      results_recorded_at: "2026-10-01T00:00:00Z",
    })).toBe(true);
  });
});

describe("provider stub (HARD GATE)", () => {
  it("always reports not_connected and pulls nothing, for every catalogued provider", () => {
    for (const provider of SCREENING_PROVIDERS) {
      const result = requestScreeningReport({ providerKey: provider.key });
      expect(result.status).toBe("not_connected");
      expect(result.pulled).toBe(false);
    }
  });
  it("reports not_connected for unknown provider keys", () => {
    const result = requestScreeningReport({ providerKey: "acme-screening" });
    expect(result.status).toBe("not_connected");
    expect(result.pulled).toBe(false);
  });
  it("performs zero network I/O (no fetch/global side effects on call)", () => {
    // The stub is a pure function: calling it must not touch the network.
    // If it ever did, this test's fetch spy would catch it.
    let fetched = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { fetched = true; throw new Error("no network in test"); };
    try {
      requestScreeningReport({ providerKey: "transunion" });
      listProviderStatus();
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetched).toBe(false);
  });
  it("lists every provider as gated", () => {
    const statuses = listProviderStatus();
    expect(statuses).toHaveLength(SCREENING_PROVIDERS.length);
    for (const entry of statuses) {
      expect(entry.status).toBe("not_connected");
      expect(entry.pulled).toBe(false);
      expect(entry.needs).toMatch(/Jason/);
    }
  });
});

describe("screening token", () => {
  it("generates 24-char URL-safe tokens", () => {
    const token = generateScreeningToken();
    expect(token).toHaveLength(24);
    expect(token).toMatch(/^[A-Za-z0-9]{24}$/);
  });
  it("generates distinct tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateScreeningToken()));
    expect(tokens.size).toBe(100);
  });
});

describe("public link rate limit", () => {
  it("allows under the cap inside the window", () => {
    const now = Date.now();
    const recentAttempts = Array.from({ length: 14 }, (_, i) => now - i * 1000);
    expect(isPublicLinkRateLimited({ recentAttempts, now })).toBe(false);
  });
  it("blocks at the cap", () => {
    const now = Date.now();
    const recentAttempts = Array.from({ length: 15 }, (_, i) => now - i * 1000);
    expect(isPublicLinkRateLimited({ recentAttempts, now })).toBe(true);
  });
  it("ignores attempts outside the window", () => {
    const now = Date.now();
    const recentAttempts = Array.from({ length: 50 }, () => now - 2 * 60 * 60 * 1000);
    expect(isPublicLinkRateLimited({ recentAttempts, now })).toBe(false);
  });
});

describe("applicant screening input", () => {
  it("requires consent", () => {
    expect(validateApplicantScreeningInput({})).not.toEqual([]);
    expect(validateApplicantScreeningInput({ consent: false })).not.toEqual([]);
    expect(validateApplicantScreeningInput({ consent: true })).toEqual([]);
  });
  it("validates optional identity fields", () => {
    expect(validateApplicantScreeningInput({ consent: true, dateOfBirth: "1990-13-99x" })).not.toEqual([]);
    expect(validateApplicantScreeningInput({ consent: true, dateOfBirth: "1990-05-01" })).toEqual([]);
    expect(validateApplicantScreeningInput({ consent: true, ssnLast4: "123" })).not.toEqual([]);
    expect(validateApplicantScreeningInput({ consent: true, ssnLast4: "1234" })).toEqual([]);
  });
  it("normalizes by dropping blank fields", () => {
    expect(normalizeApplicantScreeningInput({ consent: true, fullName: "  ", phone: "555-0100" }))
      .toEqual({ phone: "555-0100" });
  });
});

describe("compliance note", () => {
  it("is plain-English FCRA guidance, not legal advice", () => {
    expect(SCREENING_COMPLIANCE_NOTE).toMatch(/adverse action notice/i);
    expect(SCREENING_COMPLIANCE_NOTE).toMatch(/not legal advice/i);
    expect(SCREENING_COMPLIANCE_NOTE).toMatch(/attorney/i);
  });
});
