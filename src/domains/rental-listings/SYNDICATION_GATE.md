# R21 syndication gate — what Jason must approve before auto-posting goes live

Rentec syndicates a listing to 20+ sites (Zillow/HotPads/Trulia, …) through
paid partner feeds. FORGE R21 ships the **free layer** only; auto-posting is
a hard-gated stub. This document is the decision record Jason asked for:
which sites, what each would need, and the exact flip that turns it on.

## What ships today (no approval needed)

- **Public listing page per vacant unit** (`/rentals/<slug>`): photos,
  description, rent, beds/baths, pet policy, "Apply now".
- **RSS 2.0 feed** of published listings at
  `GET /api/rental/syndication/feed` (owner-authenticated), using the
  documented `forge:` namespace (`src/domains/rental-listings/syndication.js`).
  Any feed reader or aggregator that consumes RSS can poll it today.
- **Copy-paste pack** per listing (`GET /api/rental/syndication?listingId=…`):
  plain-text ad copy plus a schema.org JSON-LD `Apartment` snippet. Paste it
  into Facebook Marketplace, Craigslist, or any site manually.

## What is gated (needs Jason's word)

`POST /api/rental/syndication` (auto-post) routes to
`submitListingToSite()` in `src/domains/rental-listings/syndication.js`,
which **always returns `{ status: "not_connected", posted: false }`** and
performs zero network I/O. The unit tests assert this for every catalogued
site, including unknown site keys.

| Site | Mode today | What going live needs |
|---|---|---|
| Zillow | `api_gated` | Zillow partner feed/API agreement — terms + cost confirmed with Jason |
| HotPads | `api_gated` | Zillow Group partner agreement (same gate as Zillow) |
| Trulia | `api_gated` | Zillow Group partner agreement (same gate as Zillow) |
| Apartments.com | `api_gated` | Partner listing-feed agreement — cost confirmed with Jason |
| Realtor.com | `api_gated` | Partner listing-feed agreement — cost confirmed with Jason |
| Facebook Marketplace | `manual` | Manual post with the copy-paste pack |
| Craigslist | `manual` | Manual post; paid in some markets — check before posting |

## The flip (when Jason approves a site)

1. Jason names the site and approves the cost/terms.
2. Implement a per-site adapter behind `submitListingToSite()`'s interface
   (`{ status: "connected"|"not_connected", posted, reason }`).
3. Credentials go through the Secure Vault flow — never chat, never env files
   in the repo.
4. Flip that site's catalog entry to `connected`; the route then posts and
   audits each attempt in `rental_application_decisions`-style audit rows.

Build-spend doctrine: free-to-build ships now; anything that costs money
waits for Jason's word. This gate is that doctrine in code.
