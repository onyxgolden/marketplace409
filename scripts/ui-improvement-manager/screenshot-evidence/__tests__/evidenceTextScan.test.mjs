import { describe, expect, it } from "vitest";
import { EvidenceTextRejectedError, assertEvidenceObjectClean, assertEvidenceTextClean } from "../evidenceTextScan.mjs";

describe("assertEvidenceTextClean", () => {
  it("passes clean, ordinary evidence text", () => {
    expect(() => assertEvidenceTextClean("routeLabel", "FORGE Financial Overview tab")).not.toThrow();
  });

  it("passes empty/non-string values without throwing", () => {
    expect(() => assertEvidenceTextClean("field", "")).not.toThrow();
    expect(() => assertEvidenceTextClean("field", undefined)).not.toThrow();
  });

  it("rejects text containing an SSN-shaped value (PII)", () => {
    expect(() => assertEvidenceTextClean("errorMessage", "Failed for tenant SSN 987-65-4321")).toThrow(EvidenceTextRejectedError);
  });

  it("rejects text containing a Stripe-shaped live secret key", () => {
    const secret = `sk_live_${"a".repeat(24)}`;
    expect(() => assertEvidenceTextClean("errorMessage", `auth failed: ${secret}`)).toThrow(EvidenceTextRejectedError);
  });

  it("never echoes the rejected text itself in the thrown error, only reason codes", () => {
    try {
      assertEvidenceTextClean("errorMessage", "Failed for tenant SSN 987-65-4321");
      throw new Error("expected assertEvidenceTextClean to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EvidenceTextRejectedError);
      expect(error.message).not.toContain("987-65-4321");
      expect(error.reasonCodes).toContain("ssn_like_value");
    }
  });
});

describe("assertEvidenceObjectClean", () => {
  it("scans every string field of a manifest-entry-shaped object", () => {
    expect(() => assertEvidenceObjectClean({ routeId: "home", routePath: "/", browserVersion: "Chromium 130.0" })).not.toThrow();
  });

  it("rejects the whole object if any single string field is flagged", () => {
    expect(() => assertEvidenceObjectClean({ routeId: "home", note: "owner SSN 555-12-3456" })).toThrow(EvidenceTextRejectedError);
  });

  it("ignores non-string fields (numbers, arrays, nested objects)", () => {
    expect(() => assertEvidenceObjectClean({ waitedMs: 42, readinessEvidence: [{ type: "fonts" }] })).not.toThrow();
  });
});
