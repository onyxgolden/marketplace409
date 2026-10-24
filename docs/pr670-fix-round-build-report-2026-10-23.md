# PR #670 fix round — build report (RECOVERY)

Date: 2026-10-23 (America/Chicago)
PR: onyxgolden/marketplace409 #670 — AI Lab P2a-2 Maintenance Manager wiring
Branch: `feat/ai-lab-p2a2-maintenance-manager-wiring`
Base head (reviewed, NEEDS CHANGES): `921f32703c8049eece408ab28cdc5e39831330b4`
New head: the PR #670 branch head after this commit lands (the local commit is replayed onto the PR branch via the GitHub API; the API-verified head SHA is recorded in the workspace copy of this report, ~/workspace/pr670-fix-round-build-report-2026-10-23.md).

## Recovery note

The first fix-round builder was killed mid-run by a VM reboot. Its work
survived UNCOMMITTED in `~/workspace/worktrees/p2a2-fix-round` (14 files,
+463/−72). This recovery builder audited every hunk of that diff against
ChatGPT's five findings (results/chatgpt/pr670-ai-lab-p2a2-maintenance-manager-review-2026-10-23.md)
and the panel CP9 item, adopted the diff where it matched the findings,
and produced all test evidence fresh in this run. Nothing in the adopted
diff contradicted a finding; no gap required new code.

Boundaries preserved: both jobs DISABLED, `execution_authorized:false`,
readiness WIRED_INERT / SYNTHETIC_RUNTIME_VERIFIED / LIVE_NOT_AUTHORIZED.
No merge, no activation, no deploy.

## Per-finding closure

### P670-001 — MM aging uses the UTC civil-day clock (was: shared Chicago date)
- `src/application/ai-lab/rental-ops/fieldMappings.js`: new `utcCivilDate(isoInstant)`
  helper, documented as a distinct calendar from the snapshot's Chicago date.
- `maintenanceManagerJob.js`: evaluation date is now `utcCivilDate(snapshot.as_of)`;
  the MM report exposes `as_of_date` = UTC civil date and `as_of_timezone: "UTC"`.
  The snapshot envelope keeps its America/Chicago labels untouched (PM contract).
- `scripts/ai-agents/rental-ops-wiring/battery-mm/oracle-mm.js`: the independent
  oracle's `chicagoDate` is replaced by the brief's UTC convention (the oracle had
  repeated the evaluator's error; corrected to the brief, not treated as truth).
- Frozen vectors (vitest `maintenanceManagerJob.test.js`, describe "P670-001"):
  ChatGPT's executed UTC_DAY_BOUNDARY probe (as_of 2026-10-23T02:00Z, created
  2026-10-15 → age **8**, bin_8_30; Chicago clock gave 7/bin_0_7), a Chicago-midnight
  vector (04:30Z), a DST fall-back vector (2026-11-02T05:30Z), and a DST
  spring-forward vector (2026-03-09T04:30Z) — all frozen at age 8 / bin_8_30, plus a
  separation test proving the snapshot keeps 2026-10-22 (Chicago) while the MM
  report evaluates on 2026-10-23 (UTC) for the same instant.
- Battery: MM case D03 is frozen to ChatGPT's exact probe (as_of 2026-10-23T02:00Z,
  clock 01:55Z, created 2026-10-15) and passes against the corrected oracle.

### P670-002 — future creation date published as verified negative age
- `maintenanceManagerJob.js`: negative age now emits named integrity row
  `WO_CREATED_DATE_IN_FUTURE`; the row's age is null, bin "unknown",
  `aging_verifiable:false`, counted in `unknown_age_count` — never clamped to
  zero, never counted in bin_0_7. Oracle mirrors the same rule.
- Frozen controls (vitest "P670-002"): future date flagged; created-today = verified
  age 0 and created-yesterday = verified age 1, neither flagged; missing/invalid
  creation-date behavior unchanged.

### P670-003 — contradictory unit/property linkage treated as clean
- `maintenanceManagerJob.js`: when a work order names a resolvable unit AND a
  property, the unit's admitted property is compared to the declared property;
  disagreement emits `WO_UNIT_PROPERTY_MISMATCH` carrying both source values
  (unit_ref, property_ref, unit_property_ref) — neither value overwritten.
  Oracle emits the same kind.
- Frozen controls (vitest "P670-003"): ChatGPT's executed vector (WO names unit-1
  + prop-2, unit-1 belongs to prop-1) produces exactly one mismatch row; matching
  linkage emits none; dangling unit emits WO_UNIT_DANGLING only; absent linkages
  emit nothing.
- Orphan-request case: `request_ref` remains an opaque source reference; the
  report now carries the explicit diagnostic `REQUEST_LINKAGE_NOT_VERIFIED`
  (no authoritative request register is admitted in this slice) — an explicit
  unavailable result instead of a silent pass, exactly as the verdict allows.

### P670-004 — window vocabulary not bound to the job
- `jobContracts.js` + `descriptors/job-descriptors.json`: each job descriptor
  now carries its bound `window_name` (PM: `lease-expiration-60d`; MM:
  `maintenance-backlog-open`).
- `validateJobRequest` refuses a window that is not the request job's bound
  window (`BAD_REQUEST`) — validation runs in the runner before any adapter
  is opened; no silent substitution.
- Frozen (node:test, wiring `tests/maintenance.test.js` "P670-004"): BOTH swapped
  combinations refuse with `adapter_opens: 0`, `adapter_calls: 0`, zero
  publication. Both correct PM/MM combinations remain positive controls (the
  rest of the wiring suite + both batteries).

### P670-005 — integrity row IDs alias across datasets
- Both evaluators now build row identity as `int:<kind>:<dataset>:<record_ref>`
  (MM: `maintenanceManagerJob.js`; PM: `propertyManagerJob.js`, kinds/counts/
  calendar unchanged). The three coverage gaps now publish
  `int:COVERAGE_UNATTESTED:properties:coverage`,
  `int:COVERAGE_UNATTESTED:units:coverage`,
  `int:COVERAGE_UNATTESTED:work_orders:coverage`.
- Per-citation discriminator (verdict: "any further discriminator needed for
  genuinely separate issues"): PM `SCHEDULE_LEASE_MISMATCH` is keyed by schedule
  but its payload names the citing charge's lease, so the row identity now also
  carries the charge_ref — two charges on different leases citing one schedule
  are two independently decidable findings (frozen in `propertyManagerJob.test.js`).
- `privateItemSerializer.js` `reportRowIds`: serializer deduplication no longer
  masks collisions — two DIFFERENT rows sharing one row_id throw
  ("duplicate public row identity"); the SAME row presented by two sections
  (intentional backlog/overdue presentation of one work-order row) still
  shares one identity.
- Frozen (node:test "P670-005"): the three coverage identities publish distinctly
  and each validates an independent decision via `validateDecision`; vitest
  "P670-005" freezes the evaluator-side identities; renderer compatibility:
  row IDs remain opaque string keys (renderer + decisionValidator index by the
  full string; the colon grammar is unchanged in shape).

### CP9 hardening — AGENT_ITEM prototype-chain lookup
- `privateItemSerializer.js`: `AGENT_ITEM` is now a `Map` read via `.get()`.
  Frozen (vitest "serializer identity hardening"): agent strings "constructor",
  "toString", "__proto__" fail closed through the unknown-agent refusal.

### Battery recalibration disclosure (B01)
The new `REQUEST_LINKAGE_NOT_VERIFIED` diagnostic is a real charged output
record in every MM report, so the MM battery's budget case B01 was
recalibrated from 47 to 46 work orders (largest completion under the SAME
64-candidate / 256-record caps — no cap was widened; verified against runJob
per the case comment). All battery + runner manifests were re-hashed
(make-battery-mm / make-manifest outputs committed with the change).

## Evidence (all produced in this recovery run; logs in ~/workspace/p670-fix-evidence/)

- Rental-ops vitest (CI JSON reporter): **106/106 tests, 25/25 suites pass**
  (88 at the reviewed head + 18 new P670/CP9 regression tests, all passing —
  including the 4 frozen UTC/DST vectors).
  Log: `vitest-rental-ops.json`.
- Wiring node:test suite (serial, `RENTAL_OPS_TRUST_ROOT` = sha256 of
  runner/manifest.json): 61 tests total (59 at the reviewed head + 2 new).
  Full-suite runs: **60/61** — the single failure is
  `deadline.test.js` "one deadline: slow reads across pages + fast evaluation
  settle inside the single boundary", a wall-clock test that settled at
  ~5.05–5.07s against its 5.0s boundary under host load average ~8–11.
  The deadline file run standalone passes **10/10**. ChatGPT's verdict
  documents the same load sensitivity for this test at the pre-fix head
  (failed under his concurrent run, passed serially); the deadline path
  (runner/deadline code) is untouched by this diff. Stated plainly: I do
  not claim 61/61 in-suite; the failure is environmental, reproduced
  three times in-suite and absent standalone.
  Logs: `wiring-nodetest-withroot.log`, `wiring-nodetest-run2.log`,
  `wiring-nodetest-run3.log`, `deadline-alone.log`.
- MM battery (via trust-entry, host root as above): **PASS — 80 cases**
  {domain 20, coverage 20, scope 20, budget 20}, each case run 3× internally
  with byte-identical published items vs the corrected oracle; the battery
  was invoked 3 times externally, all exit 0, PASS lines identical.
  Logs: `battery-mm-run1..3.log`.
- PM battery: **PASS — 80 cases**, same protocol, 3 external invocations,
  all exit 0. PM's Chicago calendar behavior and its oracle are unchanged.
  Logs: `battery-pm-run1..3.log`.
- Full repo vitest: attempted once (serial, `--maxWorkers=1`, CI JSON
  reporter, log on persistent disk). The run was KILLED by the
  environment ~20 minutes in — the runtime lost the background exec
  session (the VM also rebooted twice earlier tonight; host load
  average 8–11 throughout, with sibling slices running their own
  suites). No JSON summary was produced, so NO full-repo number is
  claimed. Fallback actually relied on (per brief): the touched-surface
  comparison below with identical commands.
- Base-vs-head chunk comparison (identical command, CI JSON reporter,
  logs on persistent disk, diff stashed/restored and verified intact
  14 files +463/−72): rental-ops vitest at base `921f3270` =
  **88/88 tests, 19/19 suites, 0 failed** (matches ChatGPT's verified
  base number); at the fix head = **106/106, 25/25 suites, 0 failed**.
  Delta = +18 tests / +6 describe suites, exactly the new P670/CP9
  regression tests; zero failures at either side, so the fix introduces
  no regression on the touched surface. Logs: `vitest-rental-ops.json`,
  `vitest-rental-ops-base.json`.
- Blast radius: grep-verified — no file outside
  `src/application/ai-lab/rental-ops/` and `scripts/ai-agents/rental-ops-wiring/`
  imports any changed module.

## Files changed (vs 921f3270)

14 files, +463/−72 — the adopted recovery diff:
fieldMappings.js, jobContracts.js, maintenanceManagerJob.js (+test),
propertyManagerJob.js (+test), privateItemSerializer.js (all under
src/application/ai-lab/rental-ops/); oracle-mm.js, make-battery-mm.js,
cases-mm.json, manifest-mm.json, job-descriptors.json, runner/manifest.json,
tests/maintenance.test.js (under scripts/ai-agents/rental-ops-wiring/).
Plus this report copy (docs/pr670-fix-round-build-report-2026-10-23.md).
