# Process Training — PT-1

PT-1 is the first slice of FORGE Capture's Process Training program: record
a real Windows workflow as a sequence of evidenced steps. Plan, design, and
review trail live in `forge-ai-drop`:
`commands/chatgpt/forge-capture-process-training-scope.md` (program scope),
`forge-capture-pt1-design-review.md` through `-rereview5.md` (five review
rounds; final verdict GO at commit `ef775709`), and
`forge-capture-pt1-implementation-a-review.md` /
`-rereview.md` (sub-slice A, GO at commit `ca8099c1`).

PT-1 ships as two sub-slices, deliberately kept apart:

- **Sub-slice A** (`core/src/process_session.rs`, merged) — the pure,
  host-independent data model and decision logic: the session manifest,
  click/double-click/drag classification, sequence-gap detection, and the
  privacy decision. No OS calls; tested on any host.
- **Sub-slice B** (`core/src/process_capture.rs`) — the Windows-only OS
  boundary: a low-level mouse hook, a GDI capture worker, and a UI
  Automation evidence thread, wired together by the design's bounded
  queues. Reuses sub-slice A's types throughout rather than duplicating
  any decision logic.

## The privacy model (the part five review rounds were spent getting right)

**There is no automatic "verified safe" status for any third-party
window.** An earlier design (rounds 2–4) tried to prove a window's
rendering was safe by walking its control tree against a closed allowlist
of classic Win32 classes, checking owner-draw bits, and even comparing a
window's current procedure pointer against its class's registered one to
detect subclassing. That last check was retracted in round 5: comparing
`GWLP_WNDPROC` against `GCLP_WNDPROC` across a process boundary does not
reliably work — Windows is not obligated to return a directly comparable
value for a window owned by another process, so the comparison cannot
prove what it was built to prove. Nothing replaced it; the whole idea of
an automatically "verified" window was dropped.

The final model, implemented as-is in `process_capture.rs`:

- **`ProcessTrust::Default`** — the default for every process.
  `decide_sensitivity` returns `Withhold` unconditionally; no detection
  signal, present or absent, changes that. See
  `a_false_password_result_alone_does_not_prove_safety_without_trust` in
  `process_session.rs`'s own tests for the regression this pins.
- **`ProcessTrust::AuthorTrusted`** — an explicit, disclosed, session-scoped
  grant naming one process by its lowercase executable name
  (`ProcessCaptureConfig::author_trusted_processes`). Never persisted by
  this module; the caller (a future UI slice) owns showing the author the
  exact disclosure the design requires before adding an entry. Even
  inside a trusted process, detection still runs and still wins on any
  positive signal:
  - UI Automation `IsPassword` on the clicked element.
  - A native password-character check (`EM_GETPASSWORDCHAR`), attempted
    only on a control already confirmed to be a classic `Edit`/`RichEdit`
    class, bounded by `SendMessageTimeout` (not a bare `SendMessage`,
    since this dispatches into the target process's own message queue and
    can genuinely hang against an unresponsive target).
  - An owner-draw style bit (`BS_OWNERDRAW`/`LBS_OWNERDRAWFIXED`/
    `CBS_OWNERDRAWFIXED` and their variants), read via `GWL_STYLE` — a
    plain stored attribute, reliably readable cross-process, unlike a
    code pointer.
  - The sensitive-name heuristic
    (`process_session::name_matches_sensitive_heuristic`) against the
    element's name and automation id.

  A positive signal with a trustworthy bounding rectangle available
  redacts that region in place (`annotations::paint_redaction_rect`,
  reused verbatim — the same primitive the Capture annotation program's
  Slice 2 already proved). A positive signal with no rectangle withholds
  the screenshot entirely rather than guess at an unbounded region.

## Three threads, matching the design exactly

- **Hook thread**: `SetWindowsHookExW(WH_MOUSE_LL, ...)`, running only the
  minimal message loop a low-level hook requires. The `HOOKPROC` itself
  does the absolute minimum — read the raw `MSLLHOOKSTRUCT`, a cheap
  `WindowFromPoint`/`GetWindowThreadProcessId` pair for the owning PID
  (not a COM/UIA call), assign the next `sequenceId` from one atomic
  counter, and a bounded, non-blocking push. No GDI, no COM, no
  screenshot, nothing that can stall runs inside the callback or anywhere
  else on this thread — moving any of that here is exactly what the
  design's first review round caught and required fixing.
- **Capture worker thread**: drains the hook thread's queue in strict
  FIFO order (the single-consumer property that keeps `sequenceId` order
  intact end to end with no re-sorting anywhere) and captures the whole
  monitor containing the click via the existing, already-tested
  `native::capture_rect`/`native::list_monitors` — no new GDI code.
- **Evidence thread**: the only thread that owns `IUIAutomation`, via one
  `CoInitializeEx(COINIT_APARTMENTTHREADED)` for its whole life.
  Self-exclusion, `ClickClassifier` (reused from sub-slice A), UI
  Automation + native enrichment, `decide_sensitivity`, and applying the
  decision to the already-captured buffer all happen here before anything
  reaches the caller's sink.

Every queue between stages (`BoundedDropOldest`) is bounded by both item
count and an estimated byte budget, and never blocks a caller — it drops
the oldest queued item and counts the drop rather than ever stalling the
hook thread.

## PT-1C — consent/session UI shell (fixture-only)

A separate slice (`ui/process-training.js` + `ui/process-training-core.js`,
its own "Process Training" tab in `index.html`) builds the consent/session
*shell* ahead of any real UI wiring to the pipeline above: a guarded state
machine (`idle -> preflight -> consented_preview -> review -> discarded`),
an explicit per-session trust-scope choice (clarified after round-1
review: the dialog preselects the safer `Default`/withhold option on
every opening — `author_trusted` is never preselected or pre-checked,
and neither option is itself a consent grant; consent only happens on
the explicit "Start preview" click, never on opening or closing the
dialog), and a review screen that maps the real
`PipelineMessage` shape from `process_capture.rs` to a read-only view
model — every variant (`Event`, `Gap`, `QueueOverflow` including
`capture-capacity-exhausted`, `SessionReconciliationUncertain`) shown
distinctly, never collapsed, never rounded up to a "complete" claim when
a gap or reconciliation uncertainty is present.

**This slice never captures anything.** `buildFixtureEvidence` generates
demo data only; there is no IPC call anywhere in either file to either
real session command, and a dedicated test (`process-training.test.js`)
asserts that structurally by scanning both files' source for any
reference to them. The disabled-capture banner is shown unconditionally,
in every state. `SESSIONS_ENABLED` and the real pipeline are completely
untouched by this slice.

## PT-2 — guide compiler (fixture-only)

`ui/process-guide-compiler.js` is a pure, deterministic compiler: turns a
finalized fixture evidence array (the same shape PT-1C's review screen
already shows, via `process-training-core.js`'s `toEvidenceViewModel`/
`summarizeEvidence` — reused, not duplicated into a second schema) into
an in-memory draft guide artifact (`schemaVersion`, `source: "fixture"`,
`status: "draft_unverified"`, ordered steps, guide-level and
step-adjacent warnings, a completeness summary). No persistence, no
export, no AI calls, no network, no filesystem — nothing is written
anywhere; the artifact exists only in memory for the life of the
review screen's render.

`sequenceId` is the one authoritative ordering signal (matching
`RawHookEvent`'s own doc comment in `process_capture.rs`): the compiler
sorts strictly by it and fails closed (`GuideCompileError`) rather than
guessing at an order when it's missing, non-integer, or duplicated
across events — a `Gap` is normal, already-honest evidence and becomes a
warning instead, never a compile failure. A withheld or redacted step
never carries its real control name/automation id into the guide
(generic label only); `hasScreenshot` is the only screenshot-related
field that ever appears, never an actual image or a reference to one.
Minimal integration in `ui/process-training.js`: compiles only in the
`review` state, from `session.evidence`, under a DEMO/DRAFT/NOT VERIFIED
badge; discard/reset clears the compiled guide from the DOM, not just
hides it.

## PT-3 — guide markup (fixture-only, in-memory)

`ui/process-guide-markup.js` adds a per-step annotation overlay (rect,
arrow, text label) for a PT-2 compiled guide, kept entirely separate from
the guide/evidence itself and associated by the evidence's own immutable
`sequenceId`, never list index. Required source audit (per the brief)
found the existing annotation system (`core/src/annotations.rs`,
`ui/annotations-render.js`, slices 1–4) has no reusable interactive
editing logic at all — `docs/annotations.md`'s own "What is not yet
wired" section is explicit that slices 1–4 built the data contract and a
renderer, never a toolbar/pointer-event editor. The data schema and
`resolveDrawOps` are additionally bound to a real source image
(`sourceSha256`, real `canvas` dimensions), structurally incompatible
with PT-3 having no real image at all. The one thing genuinely reused:
`drawOpsToCanvas`, which was already decoupled from where its `ops` came
from — PT-3's own `resolveMarkupDrawOps` emits ops in that same
vocabulary so the existing renderer draws them unmodified.

Editing is form-based (labeled numeric/text inputs), not drag-based —
inherently keyboard-operable, satisfying the brief's "simple non-pointer
editing path" requirement directly. A neutral placeholder canvas ("No
image in fixture guide") is shown for every step regardless of
`hasScreenshot`; markup never upgrades `source`/`status`, never carries a
withheld/redacted step's real control name into itself, and user-typed
text is rendered via `textContent` only, never `innerHTML`. Discard/
reset/a failed recompile clears all markup and closes the panel, not
just hides it.

## What is not yet wired

- **No UI.** `process_capture_start_session`/`_stop_session` (Tauri
  commands in `app/src/main.rs`) exist and are registered, but nothing —
  no startup path, no test, no JS/webview code — calls them. Confirmed by
  `grep`: zero references anywhere besides their own definitions. This is
  the deliberate "implemented, not activated" line the design's safety
  gate requires; installing a live global mouse hook needs its own
  explicit authorization, separate from writing the code that could.
- **No durable session format yet.** `process_capture_events` collects
  `PipelineMessage`s in memory for the lifetime of a session; writing
  them to the crash-recoverable `session.json` + `events.ndjson` format
  `process_session::SessionManifest` already models is a later slice.
- **No runtime verification.** Per this codebase's established convention
  for Windows-only code (see `native.rs`'s own doc comment), this module
  is compile-verified for the Windows target and carefully reasoned
  about, but its actual runtime behavior — the hook firing, UI Automation
  actually answering, the three threads behaving correctly under real
  load — is unverified without a live desktop session, which requires the
  explicit authorization this sub-slice does not grant itself.
