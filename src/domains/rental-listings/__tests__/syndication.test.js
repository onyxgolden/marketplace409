import { describe, expect, it, vi } from "vitest";
import {
  FORGE_FEED_NAMESPACE,
  SYNDICATION_SITES,
  buildCopyPastePack,
  buildListingFeedXml,
  listSyndicationStatus,
  submitListingToSite,
} from "../syndication";

const listing = () => ({
  publicSlug: "abcDEF123456",
  title: "Sunny 2-bed near downtown",
  description: "Fresh paint & new floors. <b>Move-in ready</b> & pet friendly.",
  rentCents: 160000,
  currencyCode: "USD",
  bedsDisplay: "2",
  bathsDisplay: "1.5",
  squareFeet: 980,
  petPolicy: "Cats and small dogs with deposit",
  availableAt: "2026-11-01T00:00:00.000Z",
  publishedAt: "2026-10-01T12:00:00.000Z",
  applyUrl: "https://app.example/rentals/abcDEF123456/apply",
  contactEmail: "leasing@example.com",
});

describe("listing feed generation", () => {
  it("emits valid RSS 2.0 with the forge namespace and escaped content", () => {
    const xml = buildListingFeedXml({ listings: [listing()], baseUrl: "https://app.example/" });
    expect(xml).toContain("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
    expect(xml).toContain("<rss version=\"2.0\"");
    expect(xml).toContain(`xmlns:forge="${FORGE_FEED_NAMESPACE}"`);
    expect(xml).toContain("<title>Sunny 2-bed near downtown</title>");
    expect(xml).toContain("<link>https://app.example/rentals/abcDEF123456</link>");
    expect(xml).toContain("<forge:rent>1600.00</forge:rent>");
    expect(xml).toContain("<forge:currency>USD</forge:currency>");
    expect(xml).toContain("<forge:details>2 bed · 1.5 bath · 980 sqft</forge:details>");
    expect(xml).toContain("<forge:petPolicy>Cats and small dogs with deposit</forge:petPolicy>");
    // HTML in the description is escaped, never injected raw.
    expect(xml).toContain("&lt;b&gt;Move-in ready&lt;/b&gt; &amp; pet friendly.");
    expect(xml).not.toContain("<b>Move-in ready</b>");
    // No stray "&" that would break XML parsers.
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it("handles an empty listing set and missing optionals", () => {
    const xml = buildListingFeedXml({ listings: [{ publicSlug: "x", title: "T" }], baseUrl: "https://app.example" });
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("forge:details");
    expect(buildListingFeedXml({ listings: [], baseUrl: "https://app.example" })).toContain("<channel>");
  });
});

describe("copy-paste pack", () => {
  it("builds ad copy and a schema.org snippet", () => {
    const pack = buildCopyPastePack(listing());
    expect(pack.adCopy).toContain("Sunny 2-bed near downtown");
    expect(pack.adCopy).toContain("$1600.00/mo");
    expect(pack.adCopy).toContain("Apply online: https://app.example/rentals/abcDEF123456/apply");
    expect(pack.jsonLd["@type"]).toBe("Apartment");
    expect(pack.jsonLd.offers.price).toBe("1600.00");
    expect(pack.jsonLd.offers.priceCurrency).toBe("USD");
  });
});

describe("syndication stub — the hard gate", () => {
  it("never posts: every catalogued site reports not_connected", () => {
    const network = vi.fn();
    for (const site of SYNDICATION_SITES) {
      const result = submitListingToSite({ siteKey: site.key });
      expect(result.status).toBe("not_connected");
      expect(result.posted).toBe(false);
      expect(result.reason).toBeTruthy();
    }
    expect(network).not.toHaveBeenCalled();
  });

  it("handles unknown site keys without a call", () => {
    const result = submitListingToSite({ siteKey: "nope" });
    expect(result.status).toBe("not_connected");
    expect(result.posted).toBe(false);
  });

  it("marks Zillow-family sites as api_gated with the spend warning", () => {
    const status = listSyndicationStatus();
    expect(status).toHaveLength(SYNDICATION_SITES.length);
    for (const entry of ["zillow", "hotpads", "trulia"]) {
      const site = status.find((s) => s.siteKey === entry);
      expect(site.mode).toBe("api_gated");
      expect(site.reason).toMatch(/gated/);
      expect(site.needs).toMatch(/Jason/);
    }
  });
});
