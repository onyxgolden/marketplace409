# Property Risk Radar R0 — acceptance report

- Report version: 1.0.0
- Registry version: 1.0.0 (reviewed 2026-11-20)
- Mode: live (generated 2026-11-20T19:20:44.232Z; the live run's invocation time)
- Registry digest: `1e35a03133bb0323b405ede80b6245f22889356de49856cc12e3aa68b03e8cd4`
- Result: PASS (live subset)

## Live preflight

RUN 2026-11-20T19:20:44.232Z under authorization "Jason Morgan 2026-11-20 12:44 CST — Authorize the bounded live preflight (PR #840 verdict P1 fix)". 5 of 6 data adapters accepted, 1 blocked. No account, signup, key, contact, or spend. Raw response digests, source timestamps, and per-step outcomes are in live-record.json.

- nws-alerts: accepted — Live preflight 2026-11-20T19:20:44.232Z passed; current live fixture recorded.
  - Identity: NWS API
  - Source timestamps: alerts=243, earliestEffective=2026-11-18T16:00:00-09:00, latestExpires=2026-11-22T10:15:00-05:00
  - Fixture manifest.json: sha256 `dda0c4882035f7a5c8da30a3274fad8265bc9248d4471be4b36c21932953cb10` (761 bytes)
  - Fixture metadata.json: sha256 `4817f026739eb896f9f03a9ca4bfe9fe107122ebc219b2e4dd06fdc1c0cfd6d0` (1709 bytes)
  - Fixture sample.json: sha256 `9e0bd7b3675ee59b27be8687d443d1583d6a646c98d920089ce57ea16381d1d2` (760677 bytes)
  - Step 1 (Fetch the NWS OpenAPI document and digest it.): HTTP 200, 122897 bytes, sha256 `ae478b69cdac6449e3b834dca636300f830dde552ac6abc180b1d5e82e2f1d35`, 1203 ms, 0 redirect(s), 0 retr(ies)
  - Step 2 (Fetch the bounded active-alerts FeatureCollection.): HTTP 200, 934500 bytes, sha256 `0336245ec491e329ed007d87090dba70b6048febe7b29726fb78bc5470562464`, 466 ms, 0 redirect(s), 0 retr(ies)
- usgs-earthquakes: accepted — Live preflight 2026-11-20T19:20:44.232Z passed; current live fixture recorded.
  - Identity: USGS Earthquake Hazards Program
  - Source timestamps: count=284, features=284, generated=1795202429000
  - Fixture manifest.json: sha256 `100cf4eb64caeb125e4c4577e8c7e0c71a679e3625659b245a67cb7ce97eaff2` (766 bytes)
  - Fixture metadata.json: sha256 `163a3dfa840d6612491c9bb0091fa3329501f140868b1bbd343661a34c1eec14` (237 bytes)
  - Fixture sample.json: sha256 `7894d19f470dd6ce80bdc6442ba70021c6e28888439144edf8f8a2f354c72f6a` (312488 bytes)
  - Step 1 (Fetch the bounded all_day GeoJSON summary feed.): HTTP 200, 205304 bytes, sha256 `e7b207d6b7f985ed7ac6151330a32757f46b3f7509b62f7cc24de5bb425b4bf8`, 695 ms, 0 redirect(s), 0 retr(ies)
- wfigs-perimeters: accepted — Live preflight 2026-11-20T19:20:44.232Z passed; current live fixture recorded.
  - Identity: WFIGS / WFIGS_Interagency_Perimeters_Current / Perimeters / layer 0
  - Source timestamps: dateCurrent=1789590156000, exceededTransferLimit=true, features=1
  - Fixture manifest.json: sha256 `19228897db7cb98ac333ade21480ae2ea01c2587a0290e06e7dd2b90e53034db` (769 bytes)
  - Fixture metadata.json: sha256 `d4370c862be167e88009ebb7e7c1bd1ebc4284320d9b139e2a325285ffedd553` (58538 bytes)
  - Fixture sample.json: sha256 `a709fbe422e088336778896a3e8e85428c55116b552669013acaa72b8a7f4cc3` (1190214 bytes)
  - Step 1 (Fetch layer 0 metadata (identity, fields, record limit, pagination).): HTTP 200, 62880 bytes, sha256 `066cd1a24119b12644ccfeb91936fdff5367d4c2a614efc89fff8cb53c44bf59`, 655 ms, 0 redirect(s), 0 retr(ies)
  - Step 2 (Query exactly one record as GeoJSON; record exceededTransferLimit, do not crawl.): HTTP 200, 434846 bytes, sha256 `638d3b3c150770e338f054dd19e922521b55d112a57ad43a4c6351f03de2fe84`, 522 ms, 0 redirect(s), 0 retr(ies)
- nhc-tropical: accepted — Live preflight 2026-11-20T19:20:44.232Z passed; current live fixture recorded.
  - Identity: NHC / NHC_tropical_weather / AT1 Forecast Points / layer 6
  - Source timestamps: advisory=—, features=0
  - Fixture manifest.json: sha256 `f98395a94dab2029e3454a75c7769fc2f81cacd24e0666615099b4143d06d191` (761 bytes)
  - Fixture metadata.json: sha256 `8c91e2841206b91f559a9e98668fbf620966fd47d2e29575700f8a47959ca0fe` (131709 bytes)
  - Fixture sample.json: sha256 `312f9c5c93fd0e721e6741de91b9008dbd470bacff273af0c757cc54d59a7989` (74 bytes)
  - Step 1 (Fetch MapServer metadata (service identity, layer list).): HTTP 200, 116488 bytes, sha256 `e95a7d715555554f9b31f3e95550dee36a3faf6931077893d1d5dbac0fc4dd25`, 819 ms, 0 redirect(s), 0 retr(ies)
  - Step 2 (Fetch the layer list; pin one forecast-points/track/cone layer by name+ID.): HTTP 200, 3239832 bytes, sha256 `29ae2173bac9a090aa359825ea10ed58313fc342bdbd3ae567c4490c9c340d88`, 443 ms, 0 redirect(s), 0 retr(ies)
  - Step 3 (Query exactly one bounded record from the pinned layer.): HTTP 200, 42 bytes, sha256 `ed778c73ea51338d6576fb5992b189f2b94d9f3d5e199f46c1af520d6b0b3e6c`, 213 ms, 0 redirect(s), 0 retr(ies)
- fema-nfhl: blocked — Live metadata fetch failed (transport error: fetch failed).
  - Step 1 (Follow FEMA's current official NFHL link chain to the public ArcGIS REST service (outside the ArcGIS host allowlist; resolve, then record).): HTTP 200, 147702 bytes, sha256 `e3e5ad37623ef0872e3ee6239cc8dd30243e22db2dbd19fbb7232d070431f745`, 606 ms, 0 redirect(s), 0 retr(ies)
  - Step 2 (Fetch MapServer metadata; verify the current official layer identity (28 is a candidate only).): HTTP 0, 0 bytes, sha256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, 1005 ms, 0 redirect(s), 0 retr(ies)
- census-geocoder: accepted — Live preflight 2026-11-20T19:20:44.232Z passed; current live fixture recorded.
  - Identity: Census Geocoder
  - Source timestamps: benchmark=Public_AR_Current, matches=1
  - Fixture manifest.json: sha256 `20006d849c4e091273b2ddcfee8a0df583cce572e350b9eab33caded9916e605` (763 bytes)
  - Fixture metadata.json: sha256 `d46fbf4593dd5f4ef85201a0e71564901427855bb34d650b81555d3dce35a3ee` (117 bytes)
  - Fixture sample.json: sha256 `6396eeeaaf1247a9e0401b636deed871ef5ad4870eed5c61987b34ba4b94ce0b` (1069 bytes)
  - Step 1 (Geocode the official Census example address; record input/match/components/coordinates/returned benchmark.): HTTP 200, 663 bytes, sha256 `892055aa0125e1b7973d69b4641fd035e67a7ee8f429554820711ebfe97a519c`, 622 ms, 0 redirect(s), 0 retr(ies)

## Camera capability

BLOCKED — no authorized no-account/no-contact in-product display source has written display rights. Houston TranStar and EarthCam are link-only; TxDOT, Windy, and 511 are disabled. R0 does not contact providers.

## Pending items (not passed, not claimed)

- Live preflight follow-up: fema-nfhl blocked — Live metadata fetch failed (transport error: fetch failed).
- Camera capability: no authorized no-account/no-contact in-product display source has written display rights

## Counts

- Sources: 11 (6 data adapters/geocoder, 5 cameras)
- Accepted: 5; disabled: 5; blocked: 1

## Sources

| Source | Category | Status | Fixture | Live fixture | Checks |
| --- | --- | --- | --- | --- | --- |
| census-geocoder | geocoder | accepted | live | live | registry-valid, metadata-shape-ok, sample-shape-ok, manifest-digests-ok, manifest-digest-ok, schema-digest-ok |
| earthcam | camera | disabled | synthetic-contract | pending-live-preflight | registry-valid, evaluator-disposition-ok, rights-ok, schema-digest-ok |
| fema-nfhl | hazard-data | blocked | synthetic-contract | pending-live-preflight | registry-valid, metadata-shape-ok, sample-shape-ok, manifest-digests-ok, manifest-digest-ok, schema-digest-ok |
| houston-transtar | camera | disabled | synthetic-contract | pending-live-preflight | registry-valid, evaluator-disposition-ok, rights-ok, schema-digest-ok |
| nhc-tropical | hazard-data | accepted | live | live | registry-valid, metadata-shape-ok, sample-shape-ok, manifest-digests-ok, manifest-digest-ok, schema-digest-ok |
| nws-alerts | hazard-data | accepted | live | live | registry-valid, metadata-shape-ok, sample-shape-ok, manifest-digests-ok, manifest-digest-ok, schema-digest-ok |
| program-511 | camera | disabled | synthetic-contract | pending-live-preflight | registry-valid, evaluator-disposition-ok, rights-ok, schema-digest-ok |
| txdot | camera | disabled | synthetic-contract | pending-live-preflight | registry-valid, evaluator-disposition-ok, rights-ok, schema-digest-ok |
| usgs-earthquakes | hazard-data | accepted | live | live | registry-valid, metadata-shape-ok, sample-shape-ok, manifest-digests-ok, manifest-digest-ok, schema-digest-ok |
| wfigs-perimeters | hazard-data | accepted | live | live | registry-valid, metadata-shape-ok, sample-shape-ok, manifest-digests-ok, manifest-digest-ok, schema-digest-ok |
| windy | camera | disabled | synthetic-contract | pending-live-preflight | registry-valid, evaluator-disposition-ok, rights-ok, schema-digest-ok |

## Notes

- HTTP 200 is never rights evidence. One rights mode never implies another.
- An empty result (zero alerts, zero quakes, zero matches, unmapped point) is a valid observation, distinct from unavailable, unauthorized, drifted, or uncovered.
- Live fixtures (5) are sanitized live responses recorded at 2026-11-20T19:20:44.232Z and reviewed before commit; they prove current live shape for those sources.
- Synthetic fixtures are contracts invented for R0. They prove shape, not live availability or current live schema.
