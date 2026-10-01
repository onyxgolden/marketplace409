// Rentec parity R21 — listing syndication layer.
//
// HARD GATE (build-spend doctrine): syndication APIs (Zillow, HotPads/Trulia,
// Apartments.com, Realtor.com) may cost money or require paid partner
// agreements. NOTHING in this module ever makes a network call. The free
// layer ships three things owners can use today:
//   1. An RSS 2.0 feed of published listings (a genuine syndication standard
//      that aggregators and feed readers consume) with a documented
//      `forge:` namespace carrying the rental fields.
//   2. A copy-paste pack: plain-text ad copy + a schema.org JSON-LD snippet
//      the owner pastes manually into any listing site.
//   3. submitListingToSite(): the swappable stub for future auto-posting. It
//      ALWAYS returns { status: "not_connected" } and never calls a provider.
//      Going live requires Jason's word (which sites, what it costs) — see
//      SYNDICATION_GATE.md in this directory.
//
// Going live later means: implement a per-site adapter behind this stub's
// interface, register the partner credentials through the Secure Vault flow,
// and flip the per-site flag in the sites catalog below.

// Which sites a future auto-post could target, and what each needs.
// mode "manual" = copy-paste works today. mode "api_gated" = needs Jason's
// word: partner agreement and/or spend.
export const SYNDICATION_SITES = Object.freeze([
  { key: "zillow", name: "Zillow", mode: "api_gated", needs: "Zillow partner feed/API agreement; terms and cost to be confirmed with Jason before any integration." },
  { key: "hotpads", name: "HotPads", mode: "api_gated", needs: "Zillow Group partner agreement (same gate as Zillow); needs Jason's approval before any integration." },
  { key: "trulia", name: "Trulia", mode: "api_gated", needs: "Zillow Group partner agreement (same gate as Zillow); needs Jason's approval before any integration." },
  { key: "apartments_com", name: "Apartments.com", mode: "api_gated", needs: "Partner listing-feed agreement; cost to be confirmed with Jason." },
  { key: "realtor_com", name: "Realtor.com", mode: "api_gated", needs: "Partner listing-feed agreement; cost to be confirmed with Jason." },
  { key: "facebook_marketplace", name: "Facebook Marketplace", mode: "manual", needs: "Manual post with the copy-paste pack; no API in this slice." },
  { key: "craigslist", name: "Craigslist", mode: "manual", needs: "Manual post; paid in some markets — check before posting." },
]);

export const FORGE_FEED_NAMESPACE = "https://409marketplace.online/ns/rental-listing/1";

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function moneyCentsToDollars(cents) {
  if (cents === null || cents === undefined) return "";
  return (Number(cents) / 100).toFixed(2);
}

// RSS 2.0 feed of published listings. listings: rows shaped by
// shapeFeedListing(); baseUrl: e.g. "https://app.409marketplace.online".
export function buildListingFeedXml({ listings = [], baseUrl = "", generatedAt = new Date().toISOString() } = {}) {
  const safeBase = xmlEscape(String(baseUrl).replace(/\/+$/, ""));
  const items = listings.map((listing) => {
    const link = `${safeBase}/rentals/${xmlEscape(listing.publicSlug)}`;
    const details = [
      listing.bedsDisplay ? `${listing.bedsDisplay} bed` : null,
      listing.bathsDisplay ? `${listing.bathsDisplay} bath` : null,
      listing.squareFeet ? `${listing.squareFeet} sqft` : null,
    ].filter(Boolean).join(" · ");
    return [
      "    <item>",
      `      <title>${xmlEscape(listing.title)}</title>`,
      `      <link>${link}</link>`,
      `      <guid isPermaLink="true">${link}</guid>`,
      `      <description>${xmlEscape(listing.description || "")}</description>`,
      listing.publishedAt ? `      <pubDate>${xmlEscape(new Date(listing.publishedAt).toUTCString())}</pubDate>` : "",
      `      <forge:rent>${xmlEscape(moneyCentsToDollars(listing.rentCents))}</forge:rent>`,
      `      <forge:currency>${xmlEscape(listing.currencyCode || "USD")}</forge:currency>`,
      details ? `      <forge:details>${xmlEscape(details)}</forge:details>` : "",
      listing.petPolicy ? `      <forge:petPolicy>${xmlEscape(listing.petPolicy)}</forge:petPolicy>` : "",
      listing.availableAt ? `      <forge:availableAt>${xmlEscape(listing.availableAt)}</forge:availableAt>` : "",
      listing.applyUrl ? `      <forge:applyUrl>${xmlEscape(listing.applyUrl)}</forge:applyUrl>` : "",
      "    </item>",
    ].filter(Boolean).join("\n");
  }).join("\n");
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<rss version="2.0" xmlns:forge="${FORGE_FEED_NAMESPACE}">`,
    "  <channel>",
    "    <title>FORGE Rental Listings</title>",
    `    <link>${safeBase}/rentals</link>`,
    "    <description>Published rental listings from the FORGE Rental Manager.</description>",
    `    <lastBuildDate>${xmlEscape(new Date(generatedAt).toUTCString())}</lastBuildDate>`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

// Plain-text ad copy + schema.org JSON-LD for manual posting.
export function buildCopyPastePack(listing) {
  const lines = [
    listing.title || "",
    "",
    listing.description || "",
    "",
    [
      listing.rentCents ? `$${moneyCentsToDollars(listing.rentCents)}/mo` : null,
      listing.bedsDisplay ? `${listing.bedsDisplay} bed` : null,
      listing.bathsDisplay ? `${listing.bathsDisplay} bath` : null,
      listing.squareFeet ? `${listing.squareFeet} sqft` : null,
    ].filter(Boolean).join(" · "),
    listing.petPolicy ? `Pets: ${listing.petPolicy}` : null,
    listing.availableAt ? `Available: ${new Date(listing.availableAt).toLocaleDateString()}` : null,
    "",
    listing.applyUrl ? `Apply online: ${listing.applyUrl}` : null,
    listing.contactEmail ? `Contact: ${listing.contactEmail}` : null,
    listing.contactPhone ? listing.contactPhone : null,
  ].filter((line) => line !== null);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Apartment",
    name: listing.title,
    description: listing.description,
    ...(listing.rentCents ? {
      offers: {
        "@type": "Offer",
        price: moneyCentsToDollars(listing.rentCents),
        priceCurrency: listing.currencyCode || "USD",
      },
    } : {}),
    ...(listing.bedsDisplay ? { numberOfRooms: listing.bedsDisplay } : {}),
    ...(listing.applyUrl ? { url: listing.applyUrl } : {}),
  };
  return { adCopy: lines.join("\n").trim(), jsonLd };
}

// The swappable stub for future auto-posting. HARD GATE: this function MUST
// NOT perform network I/O. Every call reports "not_connected" so no site is
// ever posted to without Jason's explicit approval of the site and its cost.
export function submitListingToSite({ siteKey } = {}) {
  const site = SYNDICATION_SITES.find((entry) => entry.key === siteKey);
  if (!site) return { status: "not_connected", siteKey: siteKey || null, posted: false, reason: "Unknown syndication site." };
  return {
    status: "not_connected",
    siteKey: site.key,
    siteName: site.name,
    mode: site.mode,
    reason: site.mode === "api_gated"
      ? `Auto-posting to ${site.name} is gated: ${site.needs}`
      : `Posting to ${site.name} is manual in this slice — use the copy-paste pack.`,
    posted: false,
  };
}

export function listSyndicationStatus() {
  return SYNDICATION_SITES.map((site) => ({ ...submitListingToSite({ siteKey: site.key }), needs: site.needs }));
}
