# Rights receipt — census-geocoder

- Source ID: `census-geocoder`
- Owner: U.S. Census Bureau
- Product: Census Geocoder — onelineaddress
- Registry version: 1.0.0 (reviewed 2026-11-20)
- Evidence basis: parent scope §4 (S10), reviewed 2026-10-16; brief re-read 2026-11-20.
  **No live retrieval was performed in this offline build.** No content SHA-256
  from a fresh fetch exists; the excerpt below is the parent scope's recorded
  finding, not a fresh quote.
- Official landing: https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/census-geocoder.html
- Official terms: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
- Attribution: U.S. Census Bureau.
- Excerpt (recorded finding): the geocoder is explicitly an address-range /
  interpolated result, not rooftop or proof a structure exists. Persist the
  returned benchmark identity with results; Current is mutable. 10,000 is
  its documented batch-record limit, not permission for bulk public scraping.

## Modes

| Mode | Disposition | Note |
| --- | --- | --- |
| Metadata listing | allowed | Listing the service and its contract is permitted. |
| Image display | not_applicable | Data feed; no imagery. |
| Iframe/player embed | not_applicable | Data feed; no player. |
| Hotlinking | not_applicable | Data feed; no media. |
| Proxying | forbidden | FORGE does not rebroadcast Census data as its own feed. |
| Caching | allowed | Matched results may be cached with benchmark identity preserved. |
| Archive | unknown | No archive right established; do not archive without a receipt. |

- Credential / account / fee: none. No API key required.
- Quota: UNKNOWN (no numerical requests/second allowance established; 10,000
  is a batch-record limit, not a rate).
- Limitations: interpolated point only. Multiple matches require selection;
  unmatched/rural/new-construction addresses offer manual pin placement, never
  a guessed city center. Apartment/unit text stays display-only if only the
  street address resolves. No bulk address upload in v1.
- Conclusion: metadata listing and caching allowed; the service is disabled
  in the R0 seed registry pending the separately authorized live preflight.
- Unresolved questions: none for R0. The live preflight must confirm the
  current benchmark identity and the input/match/components contract.
