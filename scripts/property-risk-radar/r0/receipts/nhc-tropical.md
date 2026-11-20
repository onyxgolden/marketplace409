# Rights receipt — nhc-tropical

- Source ID: `nhc-tropical`
- Owner: NOAA / National Hurricane Center
- Product: NHC Tropical Weather — operational MapServer
- Registry version: 1.0.0 (reviewed 2026-11-20)
- Evidence basis: parent scope §3 (S6, S7), reviewed 2026-10-16; brief re-read 2026-11-20.
  **No live retrieval was performed in this offline build.** No content SHA-256
  from a fresh fetch exists; the excerpt below is the parent scope's recorded
  finding, not a fresh quote.
- Official landing: https://www.nhc.noaa.gov/gis/
- Official terms: https://www.weather.gov/disclaimer
- Attribution: National Hurricane Center (NOAA).
- Excerpt (recorded finding): service documents 6-hour/3-hour update cadence
  and a 2000-record limit. Track a storm by stormID+advisory, not reused
  AT1/AT2 slots. The cone boundary is not a storm footprint or an exact
  property impact probability.

## Modes

| Mode | Disposition | Note |
| --- | --- | --- |
| Metadata listing | allowed | Listing the service and its contract is permitted. |
| Image display | not_applicable | Data feed; no imagery. |
| Iframe/player embed | not_applicable | Data feed; no player. |
| Hotlinking | not_applicable | Data feed; no media. |
| Proxying | forbidden | FORGE does not rebroadcast NHC data as its own feed. |
| Caching | allowed | Source snapshots may be cached with source times preserved. |
| Archive | unknown | No archive right established; do not archive without a receipt. |

- Credential / account / fee: none. No key, no account, no fee.
- Quota: UNKNOWN (no published requests/second figure).
- Limitations: outside the cone does not mean safe. Quiet-season empty data
  passes only with metadata/schema proof. Do not mix experimental cones.
  Fresh HTTP retrieval is not fresh advisory.
- Conclusion: metadata listing and caching allowed; the feed is disabled in
  the R0 seed registry pending the separately authorized live preflight.
- Unresolved questions: forecast-points/track/cone layer IDs must be pinned
  by name+ID from the live layer list at preflight.
