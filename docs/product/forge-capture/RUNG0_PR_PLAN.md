# FORGE Capture — Ordered PR Plan, Architecture Verdict, Risks, Go/No-Go

**Date:** 2026-09-20 · Rung 0
**Scope note (2026-09-20):** FORGE Capture is a **standalone, general-purpose desktop
capture utility**. FORGE integration is an **optional destination**, never a
requirement. Scrolling capture is a **Rung 2 early parity requirement**.

## 1. Architecture verdict: standalone desktop utility first; browser editor core shared; FORGE optional

**Recommendation: standalone Tauri desktop utility as the primary product; the Rung 1
editor built as a framework-neutral package that ships inside the utility and is
also embeddable as an optional `/forge/capture` web surface; FORGE library/sharing
as an opt-in destination; no Python sidecar.**

| Option | Verdict | Reason |
|---|---|---|
| Standalone desktop utility (Tauri shell) | **Primary product** | Global shortcut/tray launch, system-wide capture (websites, apps, monitor, window, region, scrolling), local save/clipboard/export with no account and no upload. The browser cannot do this. |
| Rung 1 editor core (framework-neutral package) | **Go** | Canvas 2D + Clipboard API cover every editing capability with zero new dependencies. Ships inside the standalone utility; optionally hosted at `/forge/capture`. |
| Tauri/Rust (no Python sidecar) | **Go, Rung 2** | Small signed installer, no extra runtime, clean macOS path. OpenAdapt's own desktop repo confirms the signing pain (no trusted signed builds) — hence the Rung 2 signing gate. |
| OpenAdapt Python sidecar | **No** | Second runtime + IPC + Windows AV/permissions friction. Unacceptable packaging complexity for a standalone consumer utility. |
| Full OpenAdapt import | **No** | License/maintenance risk exceeds the value. See license matrix. |
| FORGE library / sharing | **Optional destination (Rung 5)** | Explicit "Save to FORGE" only. The local library in the standalone utility remains fully usable offline. |

The seam: the editor consumes captures through a `CaptureSource` interface. Region,
window, scrolling, and flow capture are new sources, not rewrites. The standalone
shell and the optional web surface both host the same editor package.

## 2. Ordered PR plan (one rung → one focused PR → architecture review → stop)

| PR | Rung | Scope | New deps (planned) | Key tests |
|---|---|---|---|---|
| #1 | 0 (this) | Audit docs only | none | n/a — baseline only |
| #2 | 1 | Editor foundation: framework-neutral editor package (Canvas 2D), versioned schema, all annotation tools, undo/redo, flatten export, local project save/recovery. Ships in the standalone utility and the optional web surface. Zero new deps | schema round-trips, undo invariants, coordinate transforms, redaction flattening, corrupt-project rejection, large-image limits, permission denial |
| #3 | 2 | Standalone utility: Tauri shell (Windows 11 first) — global shortcut, tray, fullscreen/monitor/window/region/delayed capture, cursor toggle, multi-monitor coords; **scrolling capture (required early parity)**: full vertical + horizontal scrolling, auto-stitch, fixed/sticky handling, duplicate/missing-region detection, manual alignment fallback, pixel/memory/page-length safeguards, infinite-scroll handling, incomplete-capture reporting; opens completed captures in the Rung-1 editor; export without FORGE auth | coordinate correctness per monitor layout, cancel/stop reliability, geometry-change stop, stitch accuracy on reference pages, safeguard enforcement, incomplete-capture reporting |
| #4 | 3 | Flow Capture documentation mode: permitted-surface action capture, draft guide, human review/redact/reorder, PDF/HTML/image-sequence export | PDF-gen lib (license-checked; shortlist after audit) | sensitivity gate blocks share, raw-vs-derived artifact split, no keylogging |
| #5 | 4 | Recording: screen/window/region video (MediaRecorder/WebM first), cursor highlight, trim/combine, GIF/MP4 export, magnifier/spotlight/templates | muxer/gif libs (fresh license audit per spec) | encoder output validity, trim correctness |
| #6 | 5 | **Optional** FORGE workspace library: explicit Save to FORGE, `capture-library` bucket, RLS tables, search/tags, expiring share links, audit events. Local library remains fully usable without it | none (existing Supabase patterns) | hostile cross-workspace RLS tests, revoke/expiry enforcement |
| #7 | 6 | Context entry points (scheduling, designer, rental, help, dev tools) deep-linking into the tool with minimal non-sensitive context | none | context allowlist tests (no tenant/ledger/payment data leaks) |
| #8 | 7 | **Research only:** deterministic replay feasibility on synthetic fixtures, kill-switch design | none | n/a — report, no production activation |

**Rung 2 may split** into 2a (core native capture) and 2b (scrolling capture) at
architecture review — scrolling capture's two paths (browser-assisted DOM-aware vs
image-based controlled scrolling/stitching) each need their own evaluation, and the
limitation documentation (supported surfaces vs unsupported) is a deliverable, not
an afterthought.

Each PR: focused tests + `vitest run` + `npx eslint` + `npx next build` + `git diff --check`.
Migrations (Rung 5 tables) ship in-PR but are **never applied without Jason's explicit
approval**, per standing rules. Nothing merges without architecture review.

## 2a. Amendment (2026-09-22): Print Screen takeover + MSIX packaging

**Approved by Jason 2026-09-22 — build now (tokens only).** This slice
complements Rung 6 entry wiring; it does not change any rung's scope.

- **Print Screen system-default takeover:** the Tauri shell registers
  `PrintScreen` as a global shortcut so pressing it brings up FORGE Capture,
  replacing the Snipping Tool invocation. Registration is best-effort and
  degrades gracefully (log + status flag, never a startup failure) because
  the OS or another capture tool may already hold the key.
- **Microsoft Store (MSIX) packaging scaffolding:** manifest template +
  `pack-msix.ps1` (raw exe → `makeappx` → unsigned `.msix`) under
  `forge-capture-app/packaging/msix/`, plus
  `docs/product/forge-capture/MSIX_STORE_CHECKLIST.md` with the exact
  remaining manual steps. Tauri v2 does not emit MSIX natively, so the
  package is assembled from the `--no-bundle` exe; Partner Center re-signs
  Store submissions, so no certificate is bought or stored in-repo.
- **Explicitly later (Jason's action):** Partner Center developer account
  (~$19 one-time), app-name reservation (Identity Name / Publisher), the
  submission itself, and any real-device install testing.

## 3. Per-rung risk estimates

| Rung | Risk | Main risks |
|---|---|---|
| 1 | **Low** | Editor core is pure browser APIs; biggest work is undo/redo + transform correctness. Mitigated by pure, unit-tested geometry. |
| 2 | **Medium-high** | Native packaging: Windows code signing, installer size, auto-update path, AV false positives, permission prompts. **Plus scrolling capture:** two implementation paths to evaluate, stitch-accuracy testing, and honest limitation documentation. May split into 2a/2b. De-risked by keeping everything local and account-free. |
| 3 | **Medium** | Privacy surface is the risk, not the code: input-event capture must provably exclude secrets. Mitigated by source-time exclusion + human review gate + unresolved-findings block. |
| 4 | **Medium** | Encoder licensing (fresh audit required) and performance on long recordings. WebM-first keeps Rung 4 shippable without FFmpeg. |
| 5 | **Medium** | RLS/storage misconfiguration is the classic failure. Mitigated by reusing the exact `owner_id` + bucket patterns and hostile cross-workspace tests. Optional-destination framing means a Rung 5 delay never blocks the standalone product. |
| 6 | **Low** | Entry-point wiring only; risk is context leakage — mitigated by an explicit context allowlist. |
| 7 | **High (research)** | Replay against real systems is never activated in this program. Research stays on synthetic fixtures. |

## 4. Go / No-Go

**GO for Rung 1** (editor core). Conditions already satisfied:

- All required editing capabilities exist in the browser platform; no new dependencies needed.
- The editor core serves both the standalone utility and the optional web surface.
- Privacy posture is strong: standalone-first with no account required; local-first;
  **no automatic upload, no analytics capture of user content, no background
  surveillance** (architectural bans); no LLM in the loop; existing retention policy
  with a capture addendum to write before Rung 5.
- Baseline test/lint/build status is established in this rung (see audit doc §7 and
  PR body for exact totals).

**CONDITIONAL GO for Rung 2+**: proceed rung-by-rung with architecture review gates.
Rung 2 needs a signing/packaging decision (Windows cert) before its PR opens, and
its scrolling-capture path evaluation (browser-assisted vs image-based) with explicit
limitation documentation. Rung 4 needs its fresh encoder license audit. Rung 5 needs
the capture retention addendum and Jason's migration approval. Rung 7 stays
research-only.

**NO-GO items (carried as hard constraints):** Python sidecar; FFmpeg bundling without
explicit approval; any replay against payments/banking/ledgers/leases/tenant
actions/scheduling mutations; LLM in capture/markup/redaction/replay; merging any
rung without architecture review; any capture, upload, or telemetry without an
explicit visible user action.
