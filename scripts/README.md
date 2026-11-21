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
