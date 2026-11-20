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
- R0 does **not** call any live endpoint. No live preflight, live fixture
  fetch, provider signup, terms acceptance, account, key, or contact has
  happened in this build. The live preflight needs Jason's separate word.
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

The committed report lives at
`scripts/property-risk-radar/r0/reports/r0-acceptance.{json,md}`. It is
deterministic: it records the registry `reviewedAt` as its timestamp (never
wall-clock time), so repeated runs are byte-identical. Verify with:

```sh
node scripts/property-risk-radar/r0/src/preflight.mjs report --out /tmp/r0-check
diff /tmp/r0-check/r0-acceptance.json scripts/property-risk-radar/r0/reports/r0-acceptance.json
diff /tmp/r0-check/r0-acceptance.md scripts/property-risk-radar/r0/reports/r0-acceptance.md
```

## Live preflight (separately authorized — NOT part of R0)

`preflight --live` is refused by the CLI (exit 2) until the live preflight
is separately authorized. When it is authorized, the operator runs the
preflight with an explicit `--out` directory, reviews the output before
committing anything, and records:

- exact invocation and time,
- per-adapter HTTP status, bytes, redirects, retries,
- fixture digests for the live responses,
- the FEMA official service/item/layer resolution (layer 28 is a candidate
  only; a 403, a moved service, or unverifiable identity means BLOCKED),
- current live fixtures for FEMA and WFIGS (the R0 acceptance criterion
  that is still pending).

Live output is never committed without review.

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
- `LIVE PREFLIGHT REFUSED` — expected. The live preflight needs Jason's
  separate authorization.
- A test that touches the network is a bug: all R0 tests use injected fake
  fetches or committed fixtures. Report it, do not add a live call.
