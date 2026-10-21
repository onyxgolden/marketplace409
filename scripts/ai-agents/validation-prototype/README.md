# Validation Agent — Phase 2 slice 1 prototype

A fixture-only, offline, self-contained Node 24 ESM prototype of the
Validation Agent's core verification path: given a claim that a
synthetic test run happened (a claimed summary, an implementation pin,
a runner artifact, and an optional TrustedProvenanceRegistry record
reference), the agent verifies the claim against registered fixture
bytes and returns an advisory verification report.

## What the agent does

1. **Admits** the task through a closed schema (unknown control fields,
   caller-supplied provenance controls, and native Proxies are refused).
2. **Admission order**: structural task admission → task payload budget
   → prohibited-operation / command-descriptor gate → host trust gate
   (read grants, principal, test hooks) → provenance registry admission
   (every entry charged as a candidate BEFORE its fields are read) →
   runner-artifact resolution and pin checks (source registered,
   commit registered, Git blob recomputed) → injection scan →
   classification → the 11 claim comparisons → verified_by derivation.
3. **Classifies** the claimed runner summary through the is_pass
   predicate: `complete_summary && pass_count > 0 && fail_count == 0 &&
   suite_errors == 0 && !run_crashed && !timed_out && exit_code == 0 &&
   pass+fail+skip == test_count`.
   - Precedence: **FAIL** (fail>0, suite errors, nonzero exit, crash,
     timeout) **>** **BLOCKED** (test_count==0, no failure signal)
     **>** **UNKNOWN** (incomplete summary or all-skipped) **>** **PASS**.
   - Partial skips coexist with PASS and are disclosed as a limitation.
   - A malformed summary (wrong shape, broken arithmetic) is a
     domain-level **UNVERIFIABLE** outcome with a SUMMARY_UNVERIFIABLE
     diagnostic — never a refusal. A malformed *task control structure*
     is REFUSED INVALID_INPUT.
4. **Checks provenance** across three independent axes that are never
   conflated:
   - `observed_test_result` — the classification derived from the
     claimed summary;
   - `artifact_consistency` — the registered runner log's claimed
     bytes vs the task claim;
   - `independent_provenance` — the TrustedProvenanceRegistry record:
     entry exists, not revoked, recorded_at ≤ clock,
     implementation_ref pin matches exactly, sha256(command) matches,
     sha256(canonical summary) matches, sha256(artifact bytes)
     matches, suite identity agrees across expected/registry/summary,
     and the runner is not the implementer (after alias
     canonicalization). PER-005: the complete supplied identity tuple
     must also match the record — the task-declared
     implementer_principal_id (canonicalized; never overwritten with
     task data), agreement between request.run_id and
     registry_record_ref.run_id when both are cited, and the
     artifact's embedded run_id / suite_id. PER-005 round 2: the
     parsed artifact must additionally be fully valid and
     semantically consistent — the named artifact comparisons
     (command vs task, summary vs claimed) feed the same eligibility
     decision, and a malformed/unparseable artifact is explicitly
     unavailable: matching raw-byte hashes never stand in for the
     parsed tuple. (A genuine independent FAIL still authenticates;
     this is a consistency requirement, not a pass requirement.)
   - `verified_by` is `MOCK_INDEPENDENT_RUN` only on a full match
     (the registry is synthetic — that is the only verification method
     the fixture registry carries). No run cited → `none`. Any of the
     checks failing → `author_reported_unavailable`.
5. **Reports**: the envelope is advisory, fixture-only, and carries
   source citations with exact byte-span verification of the quoted
   command and suite against the registered artifact bytes, or an
   explicit unavailable status when a span cannot be quoted.

## Candidate / public-record taxonomy

The agent verifies claims made about the runner's artifacts; it does
not have opinions about the implementer. The TrustedProvenanceRegistry
is the public record: a run cited there is either confirmed by it
(`MOCK_INDEPENDENT_RUN`) or explicitly unavailable. A polished-looking
artifact with no registry entry (e.g. `run-00042`) is displayed
identically to a claim with no runner artifact at all — provenance is
unavailable either way. The implementer's own implementation pin binds
the registry record to the code under test; it is verified byte-exact,
never trusted on its own.

## Budget accounting

Every consulted candidate is charged before inspection:

- **64** consulted candidate objects (attempt 65 refuses
  BUDGET_EXCEEDED before the candidate's fields are read);
- **512** checked evidence spans; **256** output records;
- **256 KiB** aggregate input payload; **256 KiB** output;
- task graph depth **32**; guarded-run watchdog **5 s**.

The aggregate input cap is enforced twice: the launcher's transport
check (serialized task + context, refused as TRANSPORT_REFUSED) fires
first; the candidate's in-process INPUT_LIMIT fires for in-process
callers. Because both caps are 256 KiB and the artifact text is
transported inside the context, the transport check binds first
through the official launcher (exact fit: transport = 262144 bytes;
in-process exact fit: aggregate = 262144 bytes).

Host-only test hooks (validated at the grant gate, zero in
production): `test_hooks.prefill_output_records` (0–1024) and
`test_hooks.prefill_spans` (0–512), for exercising the output and
span boundaries through real runs.

## Running the official suites

The prototype ships with **zero npm scripts**; dispatch runs through
the host trust bootstrap in `~/workspace/validation-prototype-trust/`
(the externally supplied approval root). The bootstrap authenticates
the corpus manifest root digest against `VALIDATION_APPROVED_ROOT`
(and the pinned `approved-root.txt`) BEFORE opening any pinned file,
authenticates every pinned byte, refuses unlisted files/symlinks/npm
scripts, and only then spawns the launcher:

```sh
VALIDATION_APPROVED_ROOT=<64-hex> node ~/workspace/validation-prototype-trust/bootstrap.js <proto-dir> tests    # focused suite
VALIDATION_APPROVED_ROOT=<64-hex> node ~/workspace/validation-prototype-trust/bootstrap.js <proto-dir> battery   # 129-case battery x3
VALIDATION_APPROVED_ROOT=<64-hex> node ~/workspace/validation-prototype-trust/bootstrap.js <proto-dir> manual <task.json> <context.json>
```

Direct (unauthenticated) equivalents for development only:
`node --test tests/run-tests.js`, `node tests/run-battery.js`.

## Layout

- `src/` — the candidate: `canonical.js` (canonical JSON, digests,
  Git blob ids), `injection.js` (seeded directive-family scan),
  `resolver.js` (fixture source resolution, grants, per-task budget),
  `schemas.js` (closed schemas, admission), `verify.js` (is_pass,
  classification, verified_by, claim comparisons), `index.js`
  (run(): admission → verification → envelope).
- `runner/` — `run-guarded.js` (official launcher: serialized-JSON
  transport, 256 KiB caps, 5 s worker watchdog), `guarded-worker.js`,
  `timeout-hang-worker.js` (timeout probe fixture),
  `run-manual.js` (ad-hoc host launcher, bootstrap-spawned).
- `fixtures/` — `make-fixtures.js` (authoring tool) plus the
  generated `store.json` / `runs.json`: 33 synthetic registered
  sources and the run catalog (independent-mock positives, crash /
  nonzero-exit / suite-error / zero-test / all-skipped / partial-skip
  / incomplete cases, revoked / future / self-runner / runner-mismatch
  / wrong-command / wrong-suite / wrong-implementation / wrong-output /
  wrong-artifact-hash cases, a malformed artifact, and the forged
  `run-00042` Markdown log with no registry entry).
- `corpus/` — `oracle.js` (independent reference implementation of
  the decision rules, authored from the brief without importing the
  candidate), `make-battery.js` (authoring tool), `battery.json` (the
  frozen 129-case battery: 40 nominal/boundary, 30
  contradiction/incomplete/duplicate, 21 injection/prohibited-
  operation, 28 schema/provenance/permission, 10
  budget/replay/mutation), `freeze-corpus.js`,
  `manifest.json` + `corpus_digest.txt` (the frozen pins).
- `tests/` — `run-tests.js` (focused node:test suite), `run-battery.js`
  (battery launcher: each case 3× byte-identical through runGuarded,
  checked against frozen expectations).

## Limits

- Fixture-only: the TrustedProvenanceRegistry is synthetic and
  offline; `MOCK_INDEPENDENT_RUN` is the only verification method —
  no live CI, no real provenance.
- The agent is advisory: it verifies claims about test evidence and
  cannot execute commands, browse, publish, or mutate any record.
- Budgets are per task and fixed (see above); over-budget inputs are
  refused before inspection, never sampled.
