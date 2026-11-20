# Rights receipt — windy

- Source ID: `windy`
- Owner: Windy (Windy Webcams API v3)
- Product: Windy Webcams — free tier
- Registry version: 1.0.0 (reviewed 2026-11-20)
- Evidence basis: parent scope §5 (C4, C5, C6), reviewed 2026-10-16; brief re-read 2026-11-20.
  **No live retrieval was performed in this offline build.** No content SHA-256
  from a fresh fetch exists; the excerpt below is the parent scope's recorded
  finding, not a fresh quote.
- Official landing: https://api.windy.com/webcams/pricing
- Official terms: https://account.windy.com/agreements/windy-api-webcams-terms-of-use
- Attribution: Windy.
- Excerpt (recorded finding): free plan supports linked previews/provider
  timelapse embeds with constrained image size/URLs. Terms permit user
  applications but forbid paid-only placement, significant scanning,
  redistribution, and API-key disclosure. The free tier is application-only:
  no public reusable camera-catalog API, exported image dataset, camera-image
  social cards, republished video proxy, or generic passthrough of its API.

## Modes

| Mode | Disposition | Note |
| --- | --- | --- |
| Metadata listing | forbidden | No public reusable camera catalog; no catalog export. |
| Image display | forbidden | No image use without accepted terms + key and a verified application. |
| Iframe/player embed | forbidden | No provider player use without accepted terms + key. |
| Hotlinking | forbidden | No hotlinking without accepted terms + key. |
| Proxying | forbidden | No generic passthrough of the Windy API. |
| Caching | forbidden | No caching/export archive of content. |
| Archive | forbidden | No archive. |

- Credential / account / fee: terms acceptance and typically a key/account
  are required. No signup was performed in this build.
- Quota: UNKNOWN (free-tier quota and actual account quota unverified).
- Limitations: an "active" camera may merely have updated within 24h — not a
  live guarantee. Windy docs conflict on free image-token lifetime (15 vs 10
  minutes); use the actual expiry / shorter safe lifetime. Any unresolved
  application/redistribution interpretation is an eligibility gap, not
  permission to scrape.
- Conclusion: terms recorded only. The camera is disabled in the R0 seed
  registry; no mode is enabled.
- Unresolved questions: terms acceptance, account/key creation, commercial
  public use, and actual account quota all require separate authorization.
