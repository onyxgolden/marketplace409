# Capture #639 — Grok assumption resolutions

Grok's draft (`results/grok/grok-capture-639-implementation-draft-2026-10-23-answer.md`,
§F) was advisory. Each assumption was checked against the real source at
PR #639 head `8adea310` (`forge-capture-app/`). The real code won every
conflict. Design authority: ChatGPT's verdict
`results/chatgpt/capture-639-right-monitor-hang-design-verdict-2026-10-23.md`
(Option C).

## F1 — backdrop/overlay call graph: CONFIRMED
`region_pick_backdrop` (app/src/main.rs) serves the stored PNG via
`stored_backdrop_png` and never calls `capture_region_backdrop`. Native
`FullMonitor` acquisition happens inside `open_region_overlay` *before*
`WebviewWindowBuilder` builds the overlay — exactly as the verdict's §1
correction states.

## F2 — command/hotkey entry points + invoke names: CONFIRMED
`overlay_context`, `region_pick_backdrop`, `retry_region_backdrop`,
`begin_region_pick`, `cancel_region_pick`, `capture` are all
`#[tauri::command]` fns registered in the invoke handler. Command path:
`begin_region_pick` → `open_region_overlay`. Hotkey path:
`handle_hotkey_action` → `open_region_overlay` (Shift+PrintScreen). Both
now enter the same supervisor, per the verdict.

## F3 — monitor/rect/scale/raw_rgba signatures: CONFIRMED with specifics
`Monitor { id, name, origin_virtual: (i32,i32), size_logical, scale: f64 }`
(core/src/coords.rs). `Rect` is `Copy` (f64 x/y/w/h). Raw pre-cursor
pixels stay transient inside the engine (C639-005); the worker returns the
engine's PNG `raster_bytes` plus provenance meta (cursor state, warnings,
`captured_at`, scale) and the parent rebuilds the `CaptureArtifact` —
no raw_rgba crosses the process boundary, the plumbing is unchanged.

## F4 — EXE path resolvable; `--capture-worker` free: CONFIRMED
No pre-existing `--capture-worker` handling (grep). The supervisor
resolves `std::env::current_exe()` once at startup — never caller-supplied,
no shell. Dispatch happens in `main()` before any Tauri initialization
(after the Windows DPI-awareness call, which the worker also needs).

## F5 — framing over stdin/stdout: CONFIRMED, protocol changed
No existing worker IPC existed. Implemented as length-prefixed
**fixed-binary** frames (not JSON): strict validation, trailing-byte
rejection, bounded lengths. Rationale: no serde on the worker path, no
parser to get wrong; every field is range-checked.

## F6 — blank hard-fail + raster limits preserved: CONFIRMED
The per-piece blank hard-fail (`validate_raw_blit` in
`native::capture_rect`) runs *inside the worker* via the unchanged
`NativeRasterEngine` — same code, same failure. `MAX_ARTIFACT_BYTES`
(128 MiB) bounds worker replies. The parent's `decode_own` +
`solid_frame_rgba` post-checks on backdrops are untouched, as is the
overlay's blank-frame warning (retry / proceed / cancel).

## F7 — overlay.js init shape: CONFIRMED
The original `init()` awaited `overlay_context`, then
`region_pick_backdrop`, then image load sequentially with no shared
budget, and assigned `onload`/`onerror` *after* setting `src`. Fixed per
the verdict: one shared 5,000 ms budget, handlers before `src`,
already-complete (cached) images resolve without waiting, honest
"preview unavailable" disables capture commit, Esc/right-click/aim stay
live from the start.

## F8 — no existing worker/kill patterns: CONFIRMED, std substituted
`std::process::Child` has no `kill_on_drop`; implemented with an owned
`Child` handle, explicit kill + 500 ms bounded confirmation, and a single
reaper thread for the unconfirmed case. Windows Job-object
(`KILL_ON_JOB_CLOSE`) containment is best-effort `#[cfg(windows)]`, with
signatures verified against the vendored `windows` 0.62 sources.

## F9 — Windows GDI is the stalling path: CONFIRMED as designed
The worker is platform-neutral framing; the native acquisition it calls
is the existing cfg-gated engine. No API or DPI math was changed (the
verdict forbids speculative changes on the unverified BitBlt hypothesis).

## F10 — session/generation/pending_overlay types: RESOLVED
`pending_overlay: Mutex<Option<OverlayContext>>`; `session_id: u64`
(`overlay_session` wrapping counter). The *generation* is new and owned
by the supervisor (wrapping u64 per admission) — it did not exist before.
`Slot::{Empty, Active, Fenced, Zombie}` encodes the fencing state.

## F11 — PR #532 mechanism: CONFIRMED absent, NOT reintroduced
No hide-until-ready / fallback-thread code remains in the tree (grep).
The worker design deliberately avoids it: process isolation instead of
in-process threads, no `TerminateThread`, no synchronous joins on the
hung worker, no async-timeout-as-preemption.

## F12 — Grok's tokio assumption: WRONG, corrected
**The workspace uses no tokio at all** — every Tauri command is
synchronous (they run on Tauri's command thread pool, never the UI
thread). Grok's `tokio::process::Child`, `tokio::time::timeout_at`, and
`kill_on_drop(true)` do not exist here. The supervisor uses
`std::process::Command` + short-lived helper threads whose lifetimes are
bounded by the child's (kill closes the pipes, unblocking the readers —
no thread-per-retry growth), with `recv_timeout` enforcing the deadline
on the calling pool thread.

## F13 — worker return shape: RESOLVED (not raw_rgba)
Grok suggested "PNG or raw as existing raw_rgba plumbing". The engine's
contract returns PNG `raster_bytes`; the worker returns exactly those
bytes plus provenance. Returning raw RGBA would have bypassed the PNG
encode the rest of the pipeline expects.

## Deliberate deviations from Grok's draft (all toward the verdict)
- **Deadline + delay**: Grok put `delay_ms` outside the deadline with no
  accounting. The implementation extends the parent deadline by the
  user-requested `delay_ms` (the delay runs worker-side so the acquisition
  timestamp stays truthful); the 3 s acquisition bound itself is never
  extended.
- **Slot::Fenced**: Grok fenced "before requesting termination" but had
  no explicit fenced state — a reply arriving between timeout and kill
  could have committed. The implementation marks the slot `Fenced` first,
  so timeout wins the race unless success was already admitted.
- **Reaper bound**: at most one zombie → at most one reaper thread; a
  second timeout while zombied is refused with `WORKER_UNAVAILABLE`
  before spawning anything.
- **Retry path**: Grok's wiring map kept `retry_region_backdrop`'s
  hide/sleep/recapture structure; the recapture call itself moved into
  the supervisor (the hide/show session guard is unchanged).
