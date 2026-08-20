import { describe, expect, it } from "vitest";
import {
  SMARTMOVE_DEFAULT_SCREENING_URL,
  isAllowedSmartMoveFallbackHost,
  isApprovedSmartMoveAffiliateHost,
  resolveSmartMoveDestination,
} from "./screeningProviderConfig";

describe("isAllowedSmartMoveFallbackHost", () => {
  it("allows the known SmartMove/TransUnion hosts, case-insensitively", () => {
    expect(isAllowedSmartMoveFallbackHost("www.mysmartmove.com")).toBe(true);
    expect(isAllowedSmartMoveFallbackHost("mysmartmove.com")).toBe(true);
    expect(isAllowedSmartMoveFallbackHost("TRANSUNION.com")).toBe(true);
  });
  it("rejects an arbitrary host and a subdomain-suffix attack", () => {
    expect(isAllowedSmartMoveFallbackHost("evil.example.com")).toBe(false);
    expect(isAllowedSmartMoveFallbackHost("mysmartmove.com.attacker.example")).toBe(false);
    expect(isAllowedSmartMoveFallbackHost("")).toBe(false);
  });
});

describe("isApprovedSmartMoveAffiliateHost", () => {
  it("is empty by default — no configuration value can activate affiliate mode on its own", () => {
    expect(isApprovedSmartMoveAffiliateHost("approved-network.example")).toBe(false);
    expect(isApprovedSmartMoveAffiliateHost("mysmartmove.com")).toBe(false);
  });
  it("matches only an exact host from an explicit allowlist, not a suffix", () => {
    const allowlist = ["approved-network.example"];
    expect(isApprovedSmartMoveAffiliateHost("approved-network.example", allowlist)).toBe(true);
    expect(isApprovedSmartMoveAffiliateHost("APPROVED-NETWORK.example", allowlist)).toBe(true);
    expect(isApprovedSmartMoveAffiliateHost("approved-network.example.attacker.example", allowlist)).toBe(false);
    expect(isApprovedSmartMoveAffiliateHost("evil-approved-network.example", allowlist)).toBe(false);
  });
});

describe("resolveSmartMoveDestination", () => {
  it("falls back to the official non-affiliate URL when unconfigured, on an allowed host", () => {
    const destination = resolveSmartMoveDestination({});
    expect(destination).toEqual({ url: SMARTMOVE_DEFAULT_SCREENING_URL, affiliateActive: false, configuredValueRejected: false });
    expect(isAllowedSmartMoveFallbackHost(new URL(destination.url).hostname)).toBe(true);
  });

  it("treats a blank configured value the same as unset", () => {
    expect(resolveSmartMoveDestination({ RENTAL_SCREENING_SMARTMOVE_AFFILIATE_URL: "   " }))
      .toEqual({ url: SMARTMOVE_DEFAULT_SCREENING_URL, affiliateActive: false, configuredValueRejected: false });
  });

  it("does NOT infer affiliate status merely from a syntactically valid https URL being present", () => {
    // No test-only allowlist passed — uses the real, empty production allowlist.
    const destination = resolveSmartMoveDestination({ RENTAL_SCREENING_SMARTMOVE_AFFILIATE_URL: "https://some-network.example/track/smartmove" });
    expect(destination).toEqual({ url: SMARTMOVE_DEFAULT_SCREENING_URL, affiliateActive: false, configuredValueRejected: true });
  });

  it("activates affiliate mode only once the host is on the approved allowlist", () => {
    const allowlist = ["approved-network.example"];
    const destination = resolveSmartMoveDestination(
      { RENTAL_SCREENING_SMARTMOVE_AFFILIATE_URL: "https://approved-network.example/track/smartmove?id=forge" },
      allowlist,
    );
    expect(destination).toEqual({ url: "https://approved-network.example/track/smartmove?id=forge", affiliateActive: true, configuredValueRejected: false });
  });

  it("rejects a non-https configured URL even on an approved host", () => {
    const allowlist = ["approved-network.example"];
    const destination = resolveSmartMoveDestination({ RENTAL_SCREENING_SMARTMOVE_AFFILIATE_URL: "http://approved-network.example/track" }, allowlist);
    expect(destination).toEqual({ url: SMARTMOVE_DEFAULT_SCREENING_URL, affiliateActive: false, configuredValueRejected: true });
  });

  it("rejects a URL carrying credentials even on an approved host", () => {
    const allowlist = ["approved-network.example"];
    const destination = resolveSmartMoveDestination({ RENTAL_SCREENING_SMARTMOVE_AFFILIATE_URL: "https://user:pass@approved-network.example/track" }, allowlist);
    expect(destination).toEqual({ url: SMARTMOVE_DEFAULT_SCREENING_URL, affiliateActive: false, configuredValueRejected: true });
  });

  it("rejects a subdomain-suffix attack against an approved host", () => {
    const allowlist = ["mysmartmove.com", "transunion.com"];
    for (const attack of ["https://mysmartmove.com.attacker.example/track", "https://transunion.com.attacker.example/track"]) {
      const destination = resolveSmartMoveDestination({ RENTAL_SCREENING_SMARTMOVE_AFFILIATE_URL: attack }, allowlist);
      expect(destination).toEqual({ url: SMARTMOVE_DEFAULT_SCREENING_URL, affiliateActive: false, configuredValueRejected: true });
    }
  });

  it("rejects a malformed configured URL and safely falls back", () => {
    const destination = resolveSmartMoveDestination({ RENTAL_SCREENING_SMARTMOVE_AFFILIATE_URL: "not a url" });
    expect(destination).toEqual({ url: SMARTMOVE_DEFAULT_SCREENING_URL, affiliateActive: false, configuredValueRejected: true });
  });
});
