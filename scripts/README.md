# scripts/

Check, verification, and proof scripts for the repo. Most are one-off
tools; the long-running browser checks below share one convention.

## Progress heartbeat (long checks)

Any check/verification script whose MEASURED runtime exceeds ~2 minutes
prints timestamped progress lines to stdout — a start line naming the
measured expected duration, a line at each real phase transition, and a
completion line with the exit status. An agent must not kill a script
that is within its stated window and still emitting progress.

Use the shared helper — do not reimplement it per script:

```js
import { createProgress } from "./check-progress.mjs";
const progress = createProgress({
  script: "my-check",
  expected: "~10 min",
  measured: "run Nov 20, 2026, 9m41s in this VM",
});
progress.start();
progress.phase("dev server starting");
progress.heartbeat("waiting for dev server"); // at most once per 60s
progress.done("PASS", { exitCode: 0 });
```

While waiting on a blocking readiness probe (e.g. a fetch that may stay
pending for minutes in a cold compile), wrap the wait with
`startWaitHeartbeat(note)` / `stopWaitHeartbeat()` (in a `finally`, so
the timer clears on success, failure, and timeout; `done()` clears it
too as the teardown backstop). The timer only prints — it never resets
or extends the caller's independent wait timeout.

Rules: the stated window comes from a MEASURED run, never a guess. No
fake percentage progress — only real phase transitions. Labels are the
caller's responsibility: the helper prints exactly the labels it is
given, with no filtering — pass static non-sensitive labels only, never
environment values, filesystem paths, tokens, or customer data. The
helper itself never reads process.env and never echoes child-process
output. A heartbeat never resets an independent hard timeout and never
grants unlimited runtime — a script silent past its stated window is
still killable; do not change or add any timeout when adopting this.
Advisory discipline only, never a CI gate.

## Long checks (measured over 2 minutes — heartbeat applies)

| Script | Measured runtime | Heartbeat |
|---|---|---|
| `health-labs-manual-entry-phone-check.mjs` | 42s Nov 20, 2026; ~10 min Nov 18, 2026 — varies with VM load | Yes — first adopter, this PR |
| `rental-property-performance-phone-check.mjs` | 10m10s cold Nov 20, 2026; 36s cold re-run same day — varies with VM load | Yes — this PR |
| `health-dashboard-browser-check.mjs` | ~10 min (same shape) | Follow-up |
| `phone-layout-geometry-check.mjs` | ~10 min (same shape) | Follow-up — separate harness, adopt there |
| `test-data-fixture-check.mjs` | ~10 min (same shape, several widths × cases) | Follow-up |

Short checks (measured seconds — no heartbeat needed): `check-imports.sh`
(~5s), `doc-drift/checkDocDrift.mjs` (~2s),
`governance/verifyShadowGovernance.mjs` (<1s). The full vitest suite
streams per-file progress natively, so the convention does not apply to it.

## Fixture provenance guard (FORGE-P-20261120-CHATGPT-PUBLIC-FIXTURE-PROVENANCE)

`check-fixture-provenance.mjs` is a small repo-local, read-only checker
for the **changed tree only**. It never deletes, rewrites, uploads,
approves, or certifies a fixture; human review remains authoritative.
It exists because PR #838 committed a 1,829-line live-derived financial
fixture to this public repo (real account names, exact balances,
financial-account IDs, Stripe Financial Connections identifiers), and
repair needed a synthetic replacement plus a branch-history rewrite.

Usage (run from the repo root):

```sh
# Working-tree changes vs HEAD (default)
node scripts/check-fixture-provenance.mjs
# A PR range, e.g. against main
node scripts/check-fixture-provenance.mjs --diff main...HEAD
# Staged changes, or an explicit list
node scripts/check-fixture-provenance.mjs --staged
node scripts/check-fixture-provenance.mjs --files path/to/a.fixture.json
```

Exit 0 = PASS, 1 = REFUSE or UNKNOWN findings, 2 = usage/git error.
`--json` prints a machine-readable report instead of lines.

What it checks, per changed fixture/report artifact (files under a
`fixtures/`-style directory, `*.fixture.*`, `*.baseline.json`,
`*.snapshot.json`, `*.golden.json`, `*.test-data.*`, or any file with a
sidecar manifest — source code is out of scope, so a legacy fixture
elsewhere never blocks an unrelated PR):

1. **Provenance manifest.** Every in-scope fixture needs a sidecar
   `<fixture path with its last extension replaced by
   .provenance.json>`, e.g. `accounts.fixture.json` →
   `accounts.fixture.provenance.json`, carrying class, source, review
   date, and a sha256 digest of the fixture — class, source, date, and
   digest ONLY, never secrets or live identifiers. Classes:
   `synthetic`, `authorized-public-source-live`, `private` (private is
   always a refusal). Missing, malformed, or digest-mismatched
   manifests are refusals.
2. **Content scan (value-based, never field-name based).** Secrets
   (`sk_live_`, GitHub/AWS/Slack keys, private-key blocks), operational
   IDs (Stripe `acct_`/`fca_`/`cs_live_`/`pi_`/`ch_`/`cus_`/`sub_`/
   `in_`/`evt_`/`pm_`/`price_`/`prod_`/`seti_`/`txn_`, `sess_`),
   non-allowlisted emails, and private filesystem paths (`/Users/`,
   `/home/`, `C:\Users\`) are refusals. Anything unclassifiable — bare
   UUIDs, production-shaped hex-suffixed forge IDs, JWT shapes, long
   token-like strings, real-looking name+money pairs in a synthetic
   fixture — is UNKNOWN, never silently passed. Renaming a field does
   not evade the scan.
3. **Legitimate public-source fixtures pass** with an
   `authorized-public-source-live` manifest naming the public source
   (the Risk Radar R0 pattern: public NWS/USGS/Census data).

Synthetic-fixture conventions (so a synthetic fixture passes cleanly):
SYN- / synth- prefixed IDs (`SYN-01`, `forge_project_synth_demo`),
`example.com` / `.test` / `.invalid` emails, placeholder names
("Test Tenant", "Synthetic Bank"), test-mode keys only (`sk_test_`).
An example pair lives in `scripts/fixture-provenance-examples/`.

