# Capture #639 Option C — Integration Report (2026-10-23)

**PR:** #639 · **Branch:** `fix/capture-scribe-workflow` · **Base:** main `6eae30db`
**Scope:** code only — no merge, no deploy, no daemon/bridge actions.

## What was implemented

Grok's advisory implementation draft
(`results/grok/grok-capture-639-implementation-draft-2026-10-23-answer.md`)
was integrated against the binding design verdict
(`results/chatgpt/capture-639-right-monitor-hang-design-verdict-2026-10-23.md`,
Option C: bounded capture worker). Every signature was aligned to the real
source; where Grok's assumptions differed from the code, the code won (see
`capture-639-integration/assumption-resolutions.md` for all 13 resolutions).

### New: `forge-capture-app/app/src/capture_worker.rs` (std-only)

- **Wire protocol:** length-prefixed binary frames (u32 LE length + JSON
  body), strict request validation (op/target match, non-negative
  geometry, nonzero dims, u32 length cap), trailing-byte rejection,
  `MAX_ARTIFACT_BYTES` (128 MiB) PNG cap on replies.
- **`RingLog`:** 512-entry drop-oldest phase log with monotonic + wall-clock
  timestamps and stage names (`supervisor`, `worker-err`, `exe_identity`,
  `overlay`, …).
- **`CaptureSupervisor`:** one worker max, **zero queue** (second admission
  → immediate `CAPTURE_BUSY`); **3,000 ms total parent deadline** on the
  reply read (child's own deadline is separately bounded at ~4 s so the
  fence cannot be evaded); **generation fencing** with an explicit
  `Slot::Fenced` state — a late reply can never mutate a freed slot;
  **500 ms termination-confirmation bound** performed off the UI thread
  (detached reaper); unconfirmed termination → slot stays occupied and the
  next admission returns `WORKER_UNAVAILABLE`; single reaper thread only
  (no thread-per-retry).
- **Windows Job containment:** best-effort `KILL_ON_JOB_CLOSE` on the child
  (`#[cfg(windows)]`; all call signatures verified against the vendored
  windows 0.62.2 sources — including the `Option<&PCWSTR>` `Param` fix
  found during this review); non-Windows builds skip it (parent is a
  Windows-only app).
- No tokio anywhere (verified: the workspace has no tokio — Grok's
  `tokio::process` assumption was wrong); supervisor built on
  `std::process::Child` + short-lived helper threads, no async, no
  `TerminateThread`, no synchronous joins.

### main.rs wiring

- `mod capture_worker`; `AppState.capture_supervisor`; pre-Tauri
  `--capture-worker` dispatch in `main()` (after DPI awareness; Tauri and
  its `AppState` are never initialized in the child).
- `capture_region_backdrop(state, session_id, monitor_id)` now runs through
  the supervisor — both callers (initial backdrop in `open_region_overlay`,
  `retry_region_backdrop`) updated; the session id is minted **before**
  acquisition so the worker request carries the session identity the
  overlay/watchdog will use.
- `run_capture_inner`: pure `worker_region_request()` routing — only the
  **region-overlay** final live read goes through
  `run_capture_via_worker()`; all other modes keep the existing direct
  engine path. The worker's reply is validated and rebuilt into a
  `CaptureArtifact` preserving the engine's provenance: cursor state,
  solid-color warnings, `captured_at`, and DPI scale.
- The worker runs the **same `NativeRasterEngine` acquisition** the parent
  ran inline — including the per-piece blank hard-fail
  (`validate_raw_blit`) — so the hard-fail blank policy and the
  `raw_rgba` plumbing are unchanged; only the execution boundary moved.
- `capture_phase_log` + `capture_overlay_phase` Tauri commands registered
  for the verdict's §5 instrumentation.
- build.rs bakes `FORGE_BUILD_GIT_SHA` into the binary; main.rs logs the
  EXE identity (path, size, SHA-256) into the ring at startup (sha2 0.10
  added to app/Cargo.toml — same version core already uses).
- PR #532's mechanism was **not** reintroduced (verified absent from the
  tree).

### ui/overlay.js — one shared init budget

- Refactored to the `createOverlayController` factory (preview-controller
  pattern): **one shared 5,000 ms init budget** across context + backdrop +
  image (deadline propagates, not resets); **handlers assigned before
  `src`**; cached-image (`complete`/`naturalWidth`) and broken-image
  paths; honest "preview unavailable" state that **disables capture
  commit** while keeping Esc / right-click / aim live; generation guard
  against stale inits; phase markers (`page_boot`, `context`, `backdrop`,
  `image`, `aim_ready`, `preview_unavailable`) reported to the backend
  ring via `capture_overlay_phase` (fire-and-forget). Page wiring guarded
  so the node test harness can import the factory.

## Tests

- **Rust supervisor module:** 22/22 pass (`rustc --edition 2021 --test`,
  the app crate cannot link in-sandbox — see unprovable list). Covers
  protocol round-trips, malformed/oversize/trailing-byte rejection,
  negative-origin geometry, ring cap, and 7 real-process fixtures
  (`/bin/sh` stand-ins): never-reply → `Timeout` at ~3 s with slot freed;
  crash → `Malformed` fast; garbage → `Malformed`; late reply (4 s) →
  `Timeout` with fence holding; concurrent second admission →
  immediate `CAPTURE_BUSY`; spawn failure → `SpawnFailed`.
- **New JS suite** `ui/__tests__/overlay-worker-init.test.js`: 18/18 pass —
  shared-budget enforcement (incl. a proof the budget is shared, not per
  step), handler-before-src ordering, cached/broken images, commit gating
  when the preview is unavailable, escape hatches, retry, generation guard,
  and phase-marker ordering/content.
- **Capture UI suite** (`forge-capture-app/ui/__tests__`): 22 files /
  1091 tests, all pass (base was 21 files / 1073; the +18 are the new
  overlay-worker-init suite).
- **Full repo JS suite** (serial, `--no-coverage --maxWorkers=1`, chunked
  by directory because three single full runs were killed by the sandbox
  environment before completing — /tmp wipe once, process deaths twice;
  logs at `~/workspace/cw-chunk-*.log`):
  - Files: **1727 passed / 288 failed to load / 9 skipped** (2024 total)
  - Tests: **17378 passed / 13 failed / 154 skipped / 1 expected-fail**
  - **Every failure is pre-existing/environmental, verified not caused by
    this change:**
    - 283 file-load failures: missing npm packages in this worktree's
      `node_modules` copy (`three`, `gifenc`, `fflate`, incomplete
      `pdfjs-dist`, `@electric-sql/pglite`) — the source worktree the
      copy came from lacks them too; unrelated to this change.
    - 9 financial API test failures (`src/app/api/financial/*`, "expected
      500 to be 200"): reproduced on the pristine base via `git stash`
      with changes shelved — identical failures.
    - 1 rental UI failure (`RentalExceptionViewFilters`): date-relative
      fixture (`Date.now() - 10 days` renders "due 2026-10-14", tripping a
      `not.toContain("2026-10")` assertion) — reproduced on the pristine
      base; a calendar time-bomb, fails at base today.
    - 1 `pdfWasm.sync` failure: ENOENT on
      `node_modules/pdfjs-dist/wasm/LICENSE_JBIG2` (incomplete package).
    - 2 `receipt-ledger-watchdog` failures: missing `@electric-sql/pglite`.

## Could NOT be proven in this sandbox (do not fake)

1. **App-crate compilation** (`cargo check`/`cargo build` for the Tauri
   app): the sandbox lacks the system GTK (`gdk-3.0`) the Tauri build
   needs. main.rs, capture_worker.rs, and build.rs are rustfmt-parse-clean
   and were line-reviewed against the real core types, but this is not a
   compiler proof.
2. **`#[cfg(windows)]` code** (Job containment, `ensure_dpi_awareness`,
   GDI acquisition inside the worker): written for the Windows target,
   signatures verified against vendored windows 0.62.2 sources, but no
   Windows toolchain exists here.
3. **Worker round-trip against the real EXE**: only `/bin/sh` stand-ins
   were used for the process fixtures; the true parent→child
   `--capture-worker` round trip needs the packaged Windows binary.
4. **The DISPLAY5 hardware gate** (verdict §5–6): daemon restart,
   PrintScreen proof, installed-EXE region pick on Jason's 2560×1440
   display, forced worker stall, phase-log collection.
5. **The 3 new main.rs unit tests** (`worker_region_request` routing):
   written in the app crate's test module — same compilation blocker as (1).
6. Windows EXE packaging / installer flow (belongs to the normal release
   path, not this change).

## Next step (explicit)

**Daemon hardware gate on Jason's machine** (main agent's lane — no
bridge/daemon actions in this task): daemon restart with the new build,
PrintScreen on the right monitor, real-EXE `--capture-worker` round trip,
DISPLAY5 2560×1440 region pick, forced worker stall (never-reply) to
prove the 3 s deadline + fencing + `WORKER_UNAVAILABLE`, and
`capture_phase_log` collection. Only a panel GO at the exact head merges.

## Files changed

- `forge-capture-app/app/src/capture_worker.rs` (new)
- `forge-capture-app/app/src/main.rs`
- `forge-capture-app/app/Cargo.toml`
- `forge-capture-app/app/build.rs`
- `forge-capture-app/ui/overlay.js`
- `forge-capture-app/ui/__tests__/overlay-worker-init.test.js` (new)
- `capture-639-integration/assumption-resolutions.md` (new)
- `capture-639-integration/integration-report-2026-10-23.md` (this file)
