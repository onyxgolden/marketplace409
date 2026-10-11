# Programmer Agent Phase 2 — Slice 1: offline fixture patch assistant (prototype)

Dormant, in-repo Node ESM CLI + library. No service, no API route, no UI,
no scheduler, no session activation, no root-package lifecycle hook, no new
runtime dependencies.

Given a strict task JSON, the assistant proposes a small patch against a
**synthetic fixture** (never a live checkout), validates the plan, and runs
independent acceptance oracles **inside a real OS-enforced sandbox**. A
trusted host-side evaluator compares oracle verdicts against the ticket's
expectation and writes a machine-readable result plus an append-only audit
log. Nothing here can commit, push, or open a PR.

## Layout

```
bin/pa2.mjs                 CLI (check-isolation, corpus-build, battery, propose, evaluate)
src/                        pure + host-side modules (no candidate code executes here)
  task-schema.mjs           strict Task JSON v1 validation + adversarial-input detectors
  plan-validator.mjs        plan/patch validation: scope, operations, budgets, hostile-diff tripwire
  generators.mjs            narrow candidate generators (pure: no fs, no network, no shell)
  diff.mjs                  unified-diff parse/render/exact-apply
  profiles.mjs              fixed oracle profile registry (syntax/baseline/candidate)
  isolation.mjs             sandbox launcher + availability probe (host side)
  evaluator.mjs             trusted evaluator: validate -> generate -> validate -> sandbox oracles
  fixture-store.mjs         git-backed fixture snapshot reader (read-only git object access)
  corpus.mjs / battery.mjs  deterministic corpus builder + acceptance battery
  rng.mjs / paths.mjs / budget.mjs / audit.mjs / constants.mjs / fixtures.mjs
host/driver.py              sandbox driver: user+mount+network namespaces (trusted, host-owned)
oracles/                    independent immutable acceptance oracles (one per fixture family)
test/                       vitest unit tests
```

## Runnable commands

```bash
# 1. Verify OS-enforced isolation is available (fails closed otherwise)
node bin/pa2.mjs check-isolation

# 2. Build the deterministic fixture corpus (1000 tickets, 9 fixture repos)
node bin/pa2.mjs corpus-build --out ~/workspace/progagent-corpus [--seed <s>]

# 3a. Validation-mode battery: no code executes, checks accept/refuse parity
node bin/pa2.mjs battery --corpus ~/workspace/progagent-corpus --mode validation --out <dir>

# 3b. Full-mode battery: executes oracles inside the sandbox (~10 min for 1000 tickets)
node bin/pa2.mjs battery --corpus ~/workspace/progagent-corpus --mode full --out <dir>

# 4. Propose a patch for one task (no execution)
node bin/pa2.mjs propose --task <task.json> --corpus ~/workspace/progagent-corpus --out <dir>

# 5. Full evaluate of one task (sandboxed oracle runs)
node bin/pa2.mjs evaluate --task <task.json> --corpus ~/workspace/progagent-corpus --out <dir>

# 6. Unit tests / lint (from the repo root)
npx vitest run scripts/ai-agents/programmer-prototype/test
npx eslint scripts/ai-agents/programmer-prototype/
```

`--task` takes the task **envelope** (`{schema_version, task_id, brief_ref,
fixture_ref, task, constraints, ...}`), i.e. the `.task` member of a corpus
ticket — not the whole ticket wrapper.

## Isolation prerequisites

The sandbox requires Linux with unprivileged-able namespace setup driven by
a **root** launcher (the driver writes the child's uid/gid map):

- Linux kernel with user, mount and network namespaces enabled
- `python3`, `unshare`, `/usr/bin/node` on PATH
- launcher runs as **root** (needed to write `/proc/<pid>/uid_map`)
- `/proc/self/mountinfo` readable; none of `/`, `/tmp`, `/home`, `/root`,
  `/proc` on a `shared:` mount propagation (the probe fails closed if they are)

If any prerequisite is missing, `probeIsolation()` reports
`available: false` / `BLOCKED_ISOLATION` and `runIsolated()` **refuses to
execute** — candidate code never runs. A temp dir, mock adapter, Node VM,
prompt prohibition or subprocess cwd is never treated as a boundary.

## Isolation mechanism

`linux-userns-mount-netns+ro-root+tmpfs-hide+rlimits`, implemented by
`host/driver.py` in two phases split at a privilege drop:

1. **Setup (trusted driver code only).** The child unshares
   `CLONE_NEWUSER | CLONE_NEWNS | CLONE_NEWNET`, then — still pre-exec, with
   full namespace capabilities — bind-mounts the scratch dir read-write at
   `/work`, covers `/home`, `/root`, `/tmp` with fresh `noexec` tmpfs,
   mounts an **empty** tmpfs over `/proc` (zero host-process visibility),
   remounts `/` read-only, and makes the mount tree private.
2. **Payload.** The child `setgid`/`setuid`s to inner uid/gid 65534 (mapped
   to outer 65534/`nobody`), clearing every capability, applies rlimits
   (`RLIMIT_AS` 2 GiB, `RLIMIT_NPROC` 64, `RLIMIT_FSIZE` 64 MiB,
   `RLIMIT_NOFILE` 64, no core dumps; JS heap additionally capped by
   `--max-old-space-size=512`), chdirs to `/work`, closes stdin, scrubs the
   environment (`PATH=/usr/bin:/bin`, `HOME=/nonexistent`, `SANDBOX=1`), and
   execs the payload.

Candidate code **only ever runs in phase 2**: uid/gid 65534, no
capabilities, no network namespace interfaces (DNS fails `EAI_AGAIN`),
read-only host tree (`/etc` writes fail `EROFS`), no home/credential mounts,
writes possible only under `/work` and `/tmp`. A namespace escape from the
payload phase yields outer uid 65534 (`nobody`), never host root. The
launcher kills the payload's process group on timeout (default 30 s per
profile) and verifies host canaries are unchanged afterwards.

Empirically verified (`check-isolation` smoke + escape probe): `/etc`
write → `EROFS`; `~/.ssh` unreadable (`ENOENT`, tmpfs-hidden `/root`);
`/proc` empty; `kill -0 1` → `EPERM`; DNS → `EAI_AGAIN`; `mknod` on the
scratch fs → denied; `/work` and `/tmp` writable (functional sanity).

## Supported families

| family               | generator does                                  |
|----------------------|-------------------------------------------------|
| `literal-correction` | single unique anchor string replacement         |
| `boundary-correction` | single-expression boundary fix                  |
| `add-helper`         | add one pure helper under `lib/` (purity-checked)|

Oracle profiles per task: `syntax` (node `--check`), `baseline` (oracle on
unpatched tree, expected FAIL), `candidate` (oracle on patched tree,
expected PASS).

## Limits

- Pure generators: no fs, no network, no shell, no clock reads; determinism
  enforced by seeded rng (`rng.mjs`).
- Budgets (`budget.mjs`): ≤ 40 scoped reads, ≤ 256 KiB/file, ≤ 2 MiB total
  context, ≤ 3 target files, ≤ 200 changed lines, ≤ 64 KiB patch, ≤ 3
  profiles, ≤ 30 s/profile, ≤ 120 s wall per task, 1 worker.
- Snapshot reader uses only read-only git object commands (`cat-file`,
  `ls-tree`, `rev-parse`) against immutable fixture commits; symlink
  (`mode 120000`) entries are rejected.
- The hostile-diff scan (`scanHostileDiff`) is a **heuristic tripwire**,
  not a universal injection detector: capability/resource hits are surfaced
  as `uncertainty_flags` and audit events, not validator blocks. The
  sandbox is the enforcement boundary for execution.
- In-process generator CPU is bounded by output-size budgets, not
  preemptible — generators are trivial pure functions by construction.

## Threat model

- **Untrusted:** task JSON (validated strictly; injection / secret /
  production-data patterns refused), candidate diffs (scope, operation,
  budget and snapshot-applicability enforced; executed only in the
  sandbox), oracle stdout (parsed defensively, size-capped).
- **Trusted:** `host/driver.py`, the snapshot reader, the evaluator, the
  oracles, the fixture corpus (built by the operator via `corpus-build`).
- **Out of scope:** kernel-namespace escapes (mitigated: payload is outer
  uid 65534), side channels, malicious operator, compromised host.
- Escape containment is attested by **host-observed** canaries (hashes
  taken before/after each run), never by in-sandbox self-report.

## Cleanup

Every run uses a fresh `mkdtemp` run dir; the launcher `rm -rf`s it after
the run (including after timeouts/kills). Namespaces, mounts, tmpfs and the
network namespace die with the payload process. Corpus repos live outside
the product repo (default `~/workspace/progagent-corpus/repos/`) and are
never mutated by evaluation — fixture bases stay immutable.

## Failure states

| state | meaning |
|---|---|
| `BLOCKED` | envelope/schema/authorization failure; nothing executed |
| `REFUSED` | adversarial input, forbidden operation, or profile tamper |
| `FAILED_VERIFICATION` | plan invalid, patch inapplicable, oracle mismatch, or audit failure |
| `READY_FOR_REVIEW` | advisory proposal; candidate oracles passed, baseline failed as expected |
| `BLOCKED_ISOLATION` | isolation unavailable — candidate code is never executed |

Reason codes are machine-readable (`src/constants.mjs` `REASON`); results
are JSON (`result.json` per task) plus an append-only, hash-chained audit
JSONL per run under `<out>/runs/audits/`.
