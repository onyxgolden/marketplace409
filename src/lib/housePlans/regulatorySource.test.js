import {
  DEFAULT_JURISDICTION_STATE,
  FORBIDDEN_CONTENT_FIELDS,
  JURISDICTION_STATES,
  REGULATORY_SOURCE_FIELDS,
  isValidOfficialUrl,
  normalizeRegulatorySource,
  validateRegulatorySource,
} from "./regulatorySource";

const minimalValid = () => ({
  title: "2024 International Residential Code",
  issuingAuthority: "International Code Council",
  officialUrl: "https://codes.iccsafe.org/",
});

describe("regulatorySource (HP-L1)", () => {
  describe("jurisdiction-state vocabulary", () => {
    it("exposes exactly the four spec states", () => {
      expect(JURISDICTION_STATES).toEqual({
        UNRESOLVED: "UNRESOLVED",
        LIKELY: "LIKELY",
        CONFIRMED_BY_USER: "CONFIRMED_BY_USER",
        VERIFIED_SOURCE: "VERIFIED_SOURCE",
      });
    });

    it("is frozen", () => {
      expect(Object.isFrozen(JURISDICTION_STATES)).toBe(true);
    });

    it("defaults to UNRESOLVED", () => {
      expect(DEFAULT_JURISDICTION_STATE).toBe("UNRESOLVED");
    });
  });

  describe("metadata field list", () => {
    it("lists only factual metadata fields", () => {
      expect(REGULATORY_SOURCE_FIELDS).toEqual([
        "title",
        "sectionIdentifier",
        "issuingAuthority",
        "jurisdiction",
        "edition",
        "effectiveDate",
        "officialUrl",
        "topicTags",
        "provenance",
        "retrievalDate",
        "verificationDate",
        "jurisdictionState",
      ]);
    });

    it("contains no summary/content/explanation fields", () => {
      const lowered = REGULATORY_SOURCE_FIELDS.map((f) => f.toLowerCase());
      for (const banned of ["summary", "content", "description", "explanation", "paraphrase"]) {
        expect(lowered).not.toContain(banned);
      }
    });

    it("names the forbidden content fields", () => {
      expect(FORBIDDEN_CONTENT_FIELDS).toContain("summary");
      expect(FORBIDDEN_CONTENT_FIELDS).toContain("content");
      expect(FORBIDDEN_CONTENT_FIELDS).toContain("explanation");
    });
  });

  describe("isValidOfficialUrl", () => {
    it("accepts https URLs", () => {
      expect(isValidOfficialUrl("https://www.tdi.texas.gov/")).toBe(true);
    });

    it("rejects http URLs", () => {
      expect(isValidOfficialUrl("http://www.tdi.texas.gov/")).toBe(false);
    });

    it("rejects non-URL strings, empty strings, and non-strings", () => {
      expect(isValidOfficialUrl("not a url")).toBe(false);
      expect(isValidOfficialUrl("")).toBe(false);
      expect(isValidOfficialUrl(null)).toBe(false);
      expect(isValidOfficialUrl(undefined)).toBe(false);
      expect(isValidOfficialUrl(42)).toBe(false);
    });
  });

  describe("validateRegulatorySource", () => {
    it("accepts a minimal valid record", () => {
      const result = validateRegulatorySource(minimalValid());
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("accepts a fully populated valid record", () => {
      const result = validateRegulatorySource({
        ...minimalValid(),
        sectionIdentifier: "R311.7",
        jurisdiction: "Texas",
        edition: "2024",
        effectiveDate: "2024-01-01",
        topicTags: ["stairs", "means-of-egress"],
        provenance: "curated",
        retrievalDate: "2026-09-21",
        verificationDate: "2026-09-21",
        jurisdictionState: "VERIFIED_SOURCE",
      });
      expect(result.ok).toBe(true);
    });

    it("rejects non-object input without throwing", () => {
      for (const bad of [null, undefined, "x", 42, []]) {
        expect(validateRegulatorySource(bad).ok).toBe(false);
      }
    });

    it("requires title, issuingAuthority, and officialUrl", () => {
      const result = validateRegulatorySource({ title: "T" });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes('"issuingAuthority"'))).toBe(true);
      expect(result.errors.some((e) => e.includes('"officialUrl"'))).toBe(true);
    });

    it("rejects blank required strings", () => {
      const result = validateRegulatorySource({ title: "   ", issuingAuthority: "A", officialUrl: "https://a.example/" });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes('"title"'))).toBe(true);
    });

    it("rejects http official URLs", () => {
      const result = validateRegulatorySource({ ...minimalValid(), officialUrl: "http://a.example/" });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("https"))).toBe(true);
    });

    it("rejects forbidden content fields (link-only boundary)", () => {
      for (const field of ["summary", "content", "description", "explanation", "paraphrase", "interpretation"]) {
        const result = validateRegulatorySource({ ...minimalValid(), [field]: "some text" });
        expect(result.ok).toBe(false);
        expect(result.errors.some((e) => e.includes(`"${field}"`))).toBe(true);
      }
    });

    it("rejects an unknown jurisdictionState", () => {
      const result = validateRegulatorySource({ ...minimalValid(), jurisdictionState: "CONFIRMED" });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("UNRESOLVED"))).toBe(true);
    });

    it("accepts each valid jurisdictionState", () => {
      for (const state of Object.values(JURISDICTION_STATES)) {
        expect(validateRegulatorySource({ ...minimalValid(), jurisdictionState: state }).ok).toBe(true);
      }
    });

    it("rejects non-array or dirty topicTags", () => {
      expect(validateRegulatorySource({ ...minimalValid(), topicTags: "stairs" }).ok).toBe(false);
      expect(validateRegulatorySource({ ...minimalValid(), topicTags: ["stairs", "  "] }).ok).toBe(false);
      expect(validateRegulatorySource({ ...minimalValid(), topicTags: [] }).ok).toBe(true);
    });

    it("rejects invalid dates and accepts valid ones", () => {
      expect(validateRegulatorySource({ ...minimalValid(), effectiveDate: "not-a-date" }).ok).toBe(false);
      expect(validateRegulatorySource({ ...minimalValid(), retrievalDate: "2026-09-21" }).ok).toBe(true);
      expect(validateRegulatorySource({ ...minimalValid(), verificationDate: new Date("2026-09-21") }).ok).toBe(true);
    });

    it("rejects empty optional strings", () => {
      const result = validateRegulatorySource({ ...minimalValid(), edition: "   " });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes('"edition"'))).toBe(true);
    });
  });

  describe("normalizeRegulatorySource", () => {
    it("trims strings and defaults tags/state", () => {
      const out = normalizeRegulatorySource({ title: "  T  ", issuingAuthority: "A", officialUrl: "https://a.example/" });
      expect(out.title).toBe("T");
      expect(out.topicTags).toEqual([]);
      expect(out.jurisdictionState).toBe("UNRESOLVED");
    });

    it("keeps a valid jurisdictionState and cleans topicTags", () => {
      const out = normalizeRegulatorySource({
        ...minimalValid(),
        jurisdictionState: "LIKELY",
        topicTags: [" stairs ", ""],
      });
      expect(out.jurisdictionState).toBe("LIKELY");
      expect(out.topicTags).toEqual(["stairs"]);
    });

    it("falls back to UNRESOLVED for an invalid state", () => {
      const out = normalizeRegulatorySource({ ...minimalValid(), jurisdictionState: "BOGUS" });
      expect(out.jurisdictionState).toBe("UNRESOLVED");
    });

    it("does not mutate the input", () => {
      const input = { ...minimalValid(), title: "  T  " };
      normalizeRegulatorySource(input);
      expect(input.title).toBe("  T  ");
    });

    it("handles non-object input gracefully", () => {
      const out = normalizeRegulatorySource(null);
      expect(out.topicTags).toEqual([]);
      expect(out.jurisdictionState).toBe("UNRESOLVED");
    });
  });
});
