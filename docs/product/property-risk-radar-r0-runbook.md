# Property Risk Radar R0 — runbook

R0 is the **offline source-contract pack** for the Property Risk Radar: a
versioned source/camera registry, a bounded preflight CLI, synthetic
contract fixtures, dated rights receipts, and a deterministic acceptance
report. It is never imported by Next.js runtime code. R1 may later consume
only a reviewed passing registry version.

## What R0 is — and is not

- R0 records contracts, rights, and shape evidence. It proves the registry
  is coherent, the fixtures match their contracts, and every negative fails
  closed.
- The live preflight ran 2026-11-20T19:20:44.232Z under Jason's separate
  authorization ("Authorize the bounded live preflight", 2026-11-20 12:44
  CST): 5 of 6 data adapters accepted with current live fixtures (NWS,
  USGS, WFIGS, NHC, Census). FEMA NFHL stays BLOCKED — its REST endpoint
  is unreachable from the preflight host (hazards.fema.gov closes the
  connection after the TLS handshake; www.fema.gov responds). No
  unofficial source was substituted; FEMA keeps its synthetic fixture.
  The live run also corrected four contract bugs the documentation had
  wrong (USGS depth coordinates, WFIGS poly_ fields / MultiPolygon /
  properties-level transfer flag, NHC empty-result transfer flag, Census
  object-form input) — see the acceptance report's live-run section.
- HTTP 200 is never rights evidence. One rights mode never implies another.

## Commands

From the repository root:

```sh
npm run risk-radar:r0:validate   # validate the registry (fail-closed rules)
npm run risk-radar:r0:test       # run the R0 node:test suites
```

From `scripts/property-risk-radar/r0/` (same commands, local scope):

```sh
npm run validate    # node src/validateRegistry.mjs
npm run preflight   # node src/preflight.mjs preflight --offline
npm run test        # node --test tests/
```

Generate the acceptance report (live output goes only to a
caller-supplied directory):

```sh
node scripts/property-risk-radar/r0/src/preflight.mjs report --out /tmp/r0-report
```

For a live report, pass the run's live record (only after promotion —
the CLI refuses a live record the registry does not agree with):

```sh
node scripts/property-risk-radar/r0/src/preflight.mjs report --out /tmp/r0-report --live-record /tmp/r0-live-20261120c/live-record.json
```

The committed report lives at
`scripts/property-risk-radar/r0/reports/r0-acceptance.{json,md}`. It is
deterministic: it records the registry `reviewedAt` as its timestamp (never
wall-clock time), so repeated runs are byte-identical. Verify with:

```sh
node scripts/property-risk-radar/r0/src/preflight.mjs report --out /tmp/r0-check
diff /tmp/r0-check/r0-acceptance.json scripts/property-risk-radar/r0/reports/r0-acceptance.json
diff /tmp/r0-check/r0-acceptance.md scripts/property-risk-radar/r0/reports/r0-acceptance.md
```

## Live preflight (separately authorized)

`preflight --live` is refused by the CLI (exit 2) without an explicit
`--authorization` reference naming who authorized it, when, and for
what. With authorization, the run is bounded (one concurrent request per
host, 10 s timeout, two allowlisted HTTPS redirects, 5 MiB cap, at most
one 429/5xx retry honoring Retry-After) and writes only to the
caller-supplied `--out` directory:

```sh
node scripts/property-risk-radar/r0/src/preflight.mjs preflight --live \
  --out /tmp/r0-live-20261120 \
  --authorization "Jason Morgan 2026-11-20 12:44 CST — Authorize the bounded live preflight (PR #840 verdict P1 fix)"
```

The run writes `live-record.json` plus `fixtures/<id>/{metadata,sample,
manifest}.json` per accepted adapter. A provider failure, 403, moved
identity, or unavailable current schema is recorded as BLOCKED — never
replaced with an unofficial source. A transport failure is recorded per
step (status 0 + the error), so the block reason names the step.

### Promotion (review before commit — the run never writes to the repo)

1. Review the output directory: read every live fixture (no keys,
   headers, private addresses/coordinates, tokens, or restricted media),
   confirm the resolved identities, and confirm the per-step digests in
   `live-record.json`.
2. Copy the accepted adapters' fixtures + manifests into
   `scripts/property-risk-radar/r0/fixtures/<id>/`. Blocked adapters keep
   their synthetic fixtures.
3. Update the adapter CONTRACTs (the single source of truth) — status,
   statusReason, lastPreflight, liveFixtureStatus, fixtureKind — and the
   registry mirror, then recompute schema digests from the contract +
   manifest. Never patch a digest by hand.
4. Regenerate the acceptance report with `--live-record <path>` into
   `reports/` and verify the offline battery (validate, full tests,
   deterministic report twice, eslint) is green.
5. Commit the registry, fixtures, receipts, and report together.

## Registry rules (enforced by `validateRegistry.mjs`)

- `defaultNetworkPolicy` is `"deny"`. Every source lists exact HTTPS hosts
  and path prefixes; only `GET`; at most 2 redirects; `credentialMode`
  is `"none"` in R0.
- Every source has a kill switch (`killSwitch: true`), a quota or literal
  `UNKNOWN`, conservative caps (5 MiB body, 10 s timeout, 1 concurrent
  request per host), and separate observation-time / retrieval-time fields.
- An `accepted` source needs a schema digest, a fixture manifest, a
  last-preflight record, and a receipt for every allowed rights mode.
- A disabled/blocked source enables no display mode. A camera display mode
  with unknown rights fails validation.
- Terms and schemas are rechecked at release and quarterly; a terms/schema
  change invalidates acceptance.

## Camera dispositions (R0 seed — all disabled)

| Camera | Disposition |
| --- | --- |
| Houston TranStar | LINK_ONLY — copying, framing, and hotlinking specific images forbidden without written TxDOT consent. |
| TxDOT | Disabled — viewer metadata may be recorded; image/player use needs a direct reusable-feed/license receipt. |
| Windy v3 | Disabled — terms acceptance + typically a key/account; application-only, no catalog export. |
| 511 programs | Disabled — one contract per program; registration/key/agreement sources remain disabled. |
| EarthCam | LINK_ONLY — licensed media integration only; no assumed free network API. |

Final camera capability remains **blocked** until an already-authorized
no-account/no-contact source has written in-product display rights.

## Changing the registry

1. Edit the adapter/camera contract module under `src/` (the single source
   of truth), not the registry JSON by hand.
2. Re-run the one-off assembly logic (manifest digests + registry) and
   re-validate: `npm run risk-radar:r0:validate`.
3. Re-run the offline preflight and regenerate the acceptance report.
4. Commit the registry, fixtures, receipts, and report together. Review the
   fixture diff before committing: fixtures must not contain keys, headers,
   private addresses/coordinates, tokens, or restricted media.
5. Never edit `reports/r0-acceptance.*` by hand — they are generated.

## Kill switches

Every source has `killSwitch: true` in the registry. R1 consumers must
honor it: a killed source is skipped entirely, never retried, and reported
as disabled — not as empty data.

## Troubleshooting

- `registry validation FAILED` — read the listed errors; the usual causes
  are a missing quota, a missing receipt for an allowed mode, or a display
  mode enabled on a disabled source.
- `schema digest does not match` — the registry was hand-edited or a
  fixture changed without re-running assembly. Regenerate, do not patch
  the digest by hand.
- `LIVE PREFLIGHT REFUSED` — the run was called without `--authorization`
  (or without `--out`). Pass the authorization reference that Jason gave;
  the refusal is the guard working, not a failure.
- A test that touches the network is a bug: all R0 tests use injected fake
  fetches or committed fixtures. Report it, do not add a live call.
