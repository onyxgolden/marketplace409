# Rights receipt — wfigs-perimeters

- Source ID: `wfigs-perimeters`
- Owner: National Interagency Fire Center (NIFC)
- Product: WFIGS — Current Interagency Fire Perimeters
- Registry version: 1.0.0 (reviewed 2026-11-20)
- Evidence basis: parent scope §3 (S5), reviewed 2026-10-16; brief re-read 2026-11-20.
  **No live retrieval was performed in this offline build.** No content SHA-256
  from a fresh fetch exists; the excerpt below is the parent scope's recorded
  finding, not a fresh quote.
- Official landing: https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-interagency-fire-perimeters/about
- Official terms: https://data-nifc.opendata.arcgis.com/
- Attribution: National Interagency Fire Center (NIFC).
- Excerpt (recorded finding): inspected perimeter metadata has cacheMaxAge 300,
  maxRecordCount 2000, pagination support, geographic reference 4326. Dataset
  license/redistribution metadata must be captured in the source registry
  before activation; blank copyrightText is not a license grant.

## Modes

| Mode | Disposition | Note |
| --- | --- | --- |
| Metadata listing | allowed | Listing the service and its contract is permitted. |
| Image display | not_applicable | Data feed; no imagery. |
| Iframe/player embed | not_applicable | Data feed; no player. |
| Hotlinking | not_applicable | Data feed; no media. |
| Proxying | forbidden | FORGE does not rebroadcast NIFC data as its own feed. |
| Caching | allowed | Source snapshots may be cached with source times preserved. |
| Archive | unknown | No archive right established; do not archive without a receipt. |

- Credential / account / fee: none. No paid Esri account is required merely to
  consume an authorized public ArcGIS REST source.
- Quota: UNKNOWN (no published requests/second figure).
- Limitations: a missing perimeter means no fire is reported — never "no fire".
  Incident-location endpoint must be registered from the official catalog
  separately. Paginate deterministically; inspect exceededTransferLimit.
- Conclusion: metadata listing and caching allowed; the feed is disabled in
  the R0 seed registry pending the separately authorized live preflight. A
  current live fixture is still owed for this adapter.
- Unresolved questions: dataset license/redistribution metadata must be
  captured from the live service metadata at preflight; blank copyrightText
  is not a license grant.
