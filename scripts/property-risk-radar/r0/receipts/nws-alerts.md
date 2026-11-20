# Rights receipt — nws-alerts

- Source ID: `nws-alerts`
- Owner: NOAA / National Weather Service
- Product: NWS API — active alerts
- Registry version: 1.0.0 (reviewed 2026-11-20)
- Evidence basis: parent scope §3 (S1, S2), reviewed 2026-10-16; brief re-read 2026-11-20.
  **No live retrieval was performed in this offline build.** No content SHA-256
  from a fresh fetch exists; the excerpt below is the parent scope's recorded
  finding, not a fresh quote.
- Official landing: https://www.weather.gov/documentation/services-web-api
- Official terms: https://www.weather.gov/disclaimer
- Attribution: National Weather Service (NOAA). No NOAA endorsement is implied.
- Excerpt (recorded finding): free open API; identifying User-Agent required;
  actual rate limit undisclosed; alerts guidance recommends requests no more
  often than 30 seconds.

## Modes

| Mode | Disposition | Note |
| --- | --- | --- |
| Metadata listing | allowed | Listing the feed and its contract is permitted. |
| Image display | not_applicable | Data feed; no imagery. |
| Iframe/player embed | not_applicable | Data feed; no player. |
| Hotlinking | not_applicable | Data feed; no media. |
| Proxying | forbidden | FORGE does not rebroadcast NWS data as its own feed. |
| Caching | allowed | Source snapshots may be cached with source times preserved. |
| Archive | unknown | No archive right established; do not archive without a receipt. |

- Credential / account / fee: none. No key, no account, no fee.
- Quota: UNKNOWN (rate limit undisclosed by the provider).
- Limitations: alerts may have null geometry (zone-only warnings); a missing
  polygon is resolved via official affectedZones geometries, never guessed
  county bounding boxes. Canceled/expired warnings cease to be current.
- Conclusion: metadata listing and caching allowed; the feed is disabled in
  the R0 seed registry pending the separately authorized live preflight.
- Unresolved questions: none for R0. The live preflight must confirm the
  current OpenAPI digest and the active-alerts schema.
