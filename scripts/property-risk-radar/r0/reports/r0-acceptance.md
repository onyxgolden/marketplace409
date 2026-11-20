# Property Risk Radar R0 — acceptance report

- Report version: 1.0.0
- Registry version: 1.0.0 (reviewed 2026-11-20)
- Mode: offline (generated 2026-11-20; no wall-clock time is recorded)
- Registry digest: `130ab98be72b9a6c110d713d793d711e3ff9e50f3468d103fa771ed222d7faf9`
- Result: PASS (offline subset)

## Live preflight

NOT RUN — live preflight requires separate authorization (Jason). No live endpoint was called in this build.

## Camera capability

BLOCKED — no authorized no-account/no-contact in-product display source has written display rights. Houston TranStar and EarthCam are link-only; TxDOT, Windy, and 511 are disabled. R0 does not contact providers.

## Pending items (not passed, not claimed)

- Live preflight for all six data adapters (requires Jason's separate authorization; no live endpoint was called in this build)
- Current live fixture: wfigs-perimeters (synthetic contract fixture only)
- Current live fixture: fema-nfhl (synthetic contract fixture only; layer 28 is an unverified candidate)
- Camera capability: no authorized no-account/no-contact in-product display source has written display rights

## Counts

- Sources: 11 (6 data adapters/geocoder, 5 cameras)
- Accepted: 0; disabled: 11; blocked: 0

## Sources

| Source | Category | Status | Fixture | Live fixture | Checks |
| --- | --- | --- | --- | --- | --- |
| census-geocoder | geocoder | disabled | synthetic-contract | pending-live-preflight | registry-valid, metadata-shape-ok, sample-shape-ok, manifest-digests-ok, manifest-digest-ok, schema-digest-ok |
| earthcam | camera | disabled | synthetic-contract | pending-live-preflight | registry-valid, evaluator-disposition-ok, rights-ok, schema-digest-ok |
| fema-nfhl | hazard-data | disabled | synthetic-contract | pending-live-preflight | registry-valid, metadata-shape-ok, sample-shape-ok, manifest-digests-ok, manifest-digest-ok, schema-digest-ok |
| houston-transtar | camera | disabled | synthetic-contract | pending-live-preflight | registry-valid, evaluator-disposition-ok, rights-ok, schema-digest-ok |
| nhc-tropical | hazard-data | disabled | synthetic-contract | pending-live-preflight | registry-valid, metadata-shape-ok, sample-shape-ok, manifest-digests-ok, manifest-digest-ok, schema-digest-ok |
| nws-alerts | hazard-data | disabled | synthetic-contract | pending-live-preflight | registry-valid, metadata-shape-ok, sample-shape-ok, manifest-digests-ok, manifest-digest-ok, schema-digest-ok |
| program-511 | camera | disabled | synthetic-contract | pending-live-preflight | registry-valid, evaluator-disposition-ok, rights-ok, schema-digest-ok |
| txdot | camera | disabled | synthetic-contract | pending-live-preflight | registry-valid, evaluator-disposition-ok, rights-ok, schema-digest-ok |
| usgs-earthquakes | hazard-data | disabled | synthetic-contract | pending-live-preflight | registry-valid, metadata-shape-ok, sample-shape-ok, manifest-digests-ok, manifest-digest-ok, schema-digest-ok |
| wfigs-perimeters | hazard-data | disabled | synthetic-contract | pending-live-preflight | registry-valid, metadata-shape-ok, sample-shape-ok, manifest-digests-ok, manifest-digest-ok, schema-digest-ok |
| windy | camera | disabled | synthetic-contract | pending-live-preflight | registry-valid, evaluator-disposition-ok, rights-ok, schema-digest-ok |

## Notes

- HTTP 200 is never rights evidence. One rights mode never implies another.
- An empty result (zero alerts, zero quakes, zero matches, unmapped point) is a valid observation, distinct from unavailable, unauthorized, drifted, or uncovered.
- Fixtures are synthetic contracts invented for R0. They prove shape, not live availability or current live schema.
