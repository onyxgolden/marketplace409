# FORGE Capture — Rung 0 Repository & Architecture Audit

**Date:** 2026-09-20
**Branch:** `feat/forge-capture-rung0` (from `origin/main` @ `91ccebb`)
**Status:** Audit only. No product code written in this rung.

---

## 1. Product placement: standalone desktop utility first, FORGE integration optional

**Scope correction (2026-09-20, from Jason):** FORGE Capture is a **general-purpose,
system-wide desktop capture tool**, not a capture feature limited to FORGE or
marketplace409. FORGE integration is an **optional destination**, never a requirement.

Consequences:

- The primary product is a **standalone desktop utility** (Tauri shell, per ADR-CAP-001):
  launched independently or via a global keyboard shortcut, usable with **no FORGE
  account and no sign-in**. Users must always be able to save locally, copy to
  clipboard, or export without uploading anything.
- Capture targets: any website in Brave/Chrome/Edge/Firefox; any supported desktop
  application; an entire monitor; a selected application window; a rectangular screen
  region; existing images from clipboard, drag/drop, or filesystem; screen recordings;
  user-authorized workflows on selected websites or applications.
- The Rung 1 editor package ships **inside the standalone utility** and is also
  embeddable as an optional web surface at `/forge/capture` (peer FORGE application
  route in `ForgeApplicationRail.jsx`, following the Room Designer precedent) for
  users who want the editor in the browser with an opt-in "Save to FORGE" path.
- Rung 6's context-aware entry points (scheduling, floor-plan designer, Rental
  Manager, property inspection, help, dev tools) deep-link into the tool with a
  minimal, non-sensitive context allowlist — they are conveniences, not the product.

No navigation or product code changes were made in this rung.

## 2. Existing dependencies relevant to capture

| Capability | Present in repo | Notes |
|---|---|---|
| Canvas 2D (browser) | Yes (platform API) | No code in `src/` uses `getDisplayMedia` yet; `navigator.clipboard` used for text only (`ShareButton.js`, `ProgrammerDashboard.jsx`) |
| node-canvas `^3.0.0` | Transitive only (via lockfile) | Not a direct dependency; server-side render path would need an explicit, licensed add |
| sharp `^0.35.3` | Transitive only | Same as above |
| jszip `3.10.1` | Transitive only | Useful for project bundles / image-sequence export later |
| unpdf `^1.8.0` | Direct | PDF **reading** (HVAC invoice text extraction). No PDF **generation** lib present |
| PDF generation (jspdf / pdf-lib) | No | Rung 3/4 PDF export needs a new, license-checked add |
| Video muxing (webm-muxer / mp4-muxer) | No | Rung 4 needs evaluation |
| GIF encoding (gifenc) | No | Rung 4 needs evaluation |
| Image editor framework (tldraw / fabric / konva) | No | Rung 1 specifies a framework-neutral, FORGE-owned editor package — no third-party editor planned |
| FFmpeg | No | Must not be bundled until licensing/packaging approved (spec) |
| Transcription packages | No | None present; Rung 4 treats them separately |
| vitest / jsdom / playwright | Yes (dev) | Unit + component + e2e harness available |
| TypeScript `^6.0.3`, ESLint 9, eslint-config-next | Yes | Lint/type gates available |

**Next.js 16.3.0 / React 19.2.4 fit:** the editor (Rung 1) is a client-heavy canvas
surface. Next.js hosts it cleanly as a client component route (`"use client"`) with no
server rendering of the canvas. No SSR conflicts identified. `next.config.mjs` is
minimal; no custom webpack config to fight.

## 3. Tauri / native footprint

- **Tauri:** absent. No `tauri.conf.json`, no `src-tauri/`, no `@tauri-apps/*` packages,
  no references anywhere in the repo.
- **Rust in repo:** none. No `Cargo.toml`. Rust is installed on the operator's local
  machine (fleet notes) but is **not relevant to the repository**; it becomes relevant
  only if a Tauri/Rust native companion is built as a separate artifact outside this repo.
- **Python in repo:** `tools/forge-os/*.py` are build/codegen-time scripts only. There is
  **no runtime Python** in the application. Introducing an OpenAdapt Python capture
  sidecar would add: a second runtime to install, version-pin, sign, and update; IPC
  surface between the web app and the sidecar; and antivirus/permissions friction on
  Windows 11. Verdict: **not acceptable as the default capture path.** A narrow Python
  adapter is only justifiable if the OpenAdapt audit shows a maintained, permissively
  licensed component with no reasonable Rust/JS equivalent — see license matrix.

## 4. Workspace authorization, RLS, storage, audit-event patterns

Authoritative patterns to reuse (Rung 5):

- **Auth:** `createAuthenticatedForgeApplication()` (`src/lib/supabase/createAuthenticatedForgeApplication.js`)
  returns `{ supabaseClient, user }` or a `{ response }` error. Every API route guards
  with it first.
- **RLS:** every policy ties `owner_id` to `auth.uid()::text` (e.g. migration
  `20260919130000_brain_debt_payoff.sql`). Capture tables must follow the same shape:
  `owner_id` on every row, policies on SELECT/INSERT/UPDATE/DELETE.
- **Storage:** Supabase Storage buckets with owner-scoped object paths
  (`${user.id}/<entity>/${entityId}/${uuid}.${ext}`), MIME allowlist, 5 MB cap
  (`rental-photos` precedent), `upsert: false`, signed URLs (1h) for reads, and
  storage cleanup on DB-write failure (`src/app/api/rental/photo/route.js`).
  Capture library (Rung 5) should use a dedicated bucket (e.g. `capture-library`)
  with the same shape.
- **Audit events:** `AutonomousAuditAgent` exists in ledger domains. Rung 5 must emit
  audit events for upload / share / revoke / delete **without captured content in
  payloads** — metadata only (actor, object id, timestamp, action).

## 5. Privacy, analytics, retention boundaries

- **Local use without a FORGE account is a hard requirement.** The standalone utility
  works fully signed-out: capture, edit, save locally, copy to clipboard, export.
  **No automatic upload, no analytics capture of user content, no background
  surveillance** — these are architectural bans, not settings.
- **PostHog is disabled** until Jason approves a privacy-safe configuration. The
  analytics client is allowlist-based: `buildApprovedAnalyticsEvent()` in
  `src/lib/analytics/policy.js` permits only named events (`forge_navigation`,
  `forge_feature_used`, …) with enumerated property values; IDs are pseudonymized.
  The standalone utility must apply the same discipline: even if product telemetry
  is ever enabled, it may only emit allowlisted, content-free events.
- The public privacy page (`src/app/privacy/page.js`) already states FORGE does **not**
  send screen recordings, clicks, typed text, names, emails, phones, addresses, tenant/
  borrower info, lease content, financial amounts, payment/bank details, or Supabase
  records to analytics. FORGE Capture's rule ("analytics must never receive screenshot
  pixels, OCR results, annotations, typed content, filenames, or captured metadata") is
  a strict subset of the existing policy — compliant by construction if the editor never
  calls `captureApprovedEvent` with capture-derived properties.
- **Data Retention Policy** (`docs/security/DATA_RETENTION_POLICY.md`, active, annual
  review) covers customer/financial/auth/application data. It has **no capture-specific
  section** yet. Rung 0 recommendation: add a capture addendum before Rung 5 defining
  local retention, secure deletion, and the raw-session vs approved-derivative split.
- **No LLM calls** exist in any capture-adjacent path today (nothing to remove); the
  "no LLM in capture/markup/redaction" rule is a build constraint, not a cleanup task.

## 6. Browser capture APIs (what the web platform gives us)

Available in Chromium (the operator's Brave browser) with explicit user permission:

| API | Capability | Limitation |
|---|---|---|
| `navigator.mediaDevices.getDisplayMedia()` | Tab / window / entire-screen capture, user-chosen per prompt | Cannot be triggered silently; user picks the surface every time; no global shortcut; no capture outside what the compositor offers |
| `MediaRecorder` | Local WebM video encoding | No MP4 without muxer lib; no system audio without native help |
| `ImageCapture` / canvas `drawImage` + `toBlob` | Frame extraction, PNG/JPG export | Fine |
| `navigator.clipboard` (`ClipboardItem`) | Paste images in, copy flattened PNG out | Requires focus + permission; image MIME support varies |
| Canvas 2D | Full editor surface (Rung 1) | Performance limits on very large images — needs the spec's dimension/memory caps |
| `EyeDropper` (Chromium) | Color picking | Minor |

**Capabilities requiring a native companion** (cannot be done from the browser):
global shortcut, system tray, native region selection (drag a rectangle over any app),
multi-monitor coordinate correctness for region/window capture, capture of windows
outside the browser without a picker prompt each time, input-event synchronization for
flow capture (Rung 3), system audio capture, persistent capture indicator outside the
browser chrome, and **reliable scrolling capture of desktop applications**.

## 6b. Scrolling capture — required early capability (moved from Rung 4 to Rung 2)

Per the scope correction, scrolling capture is an **early parity requirement** in
Rung 2, not a later advanced feature. Required behavior:

- Full vertically scrolling webpages; horizontal scrolling for wide pages, schedules,
  and tables.
- Automatic capture and stitching; fixed-header and sticky-element handling.
- Detection of duplicated or missing stitched regions.
- Manual alignment/correction when automatic stitching cannot resolve the page.
- Maximum pixel, memory, and page-length safeguards.
- Graceful handling of infinite-scroll and dynamically loading pages.
- Clear reporting when a page cannot be captured completely.
- The completed scrolling capture opens immediately in the Rung 1 editor.
- Export works without FORGE storage or authentication.

Two implementation paths must be evaluated in Rung 2:

1. **Browser-assisted capture** using page/DOM awareness for supported websites
   (scroll the document programmatically, capture viewport frames, stitch with known
   offsets — deterministic geometry, handles fixed/sticky elements by DOM inspection).
2. **Image-based controlled scrolling and stitching** for desktop applications or
   unsupported pages (drive scroll input, capture frames, align by image overlap).

**Limitation honesty:** do not claim universal desktop scrolling support. Where the
target application does not expose reliable scrolling or stable content, document the
supported surfaces and limitations explicitly and surface the incomplete-capture
report instead of a silently broken stitch.

## 7. Baseline test / lint / build status (this rung, this branch)

Commands run on `feat/forge-capture-rung0` @ `91ccebb` (docs-only tree; `src/` untouched
from `origin/main`):

- `npx vitest run` — **Test Files: 1 failed | 1099 passed | 16 skipped (1116).
  Tests: 1 failed | 8099 passed | 215 skipped (8315). Duration 786.71s.**
  The single failure is `scripts/governance/__tests__/buildSessionCloseoutProposal.test.mjs`
  > "produces a concise, policy-complete proposal even when governance state is stale
  and the intervening history is a large, unrelated commit dump" —
  `Error: Test timed out in 5000ms`. It **passes in isolation (12/12, 4.35s)**:
  a full-suite-only timing flake under parallel load, pre-existing on main and
  unrelated to this docs-only change. Documented per
  `docs/architecture/TEST_BASELINE_RECORD.md` (no standing "pre-existing failures"
  exception is claimed; this one was independently reproduced).
- `npx eslint src/` — **98 problems: 64 errors, 34 warnings**, all pre-existing on
  `origin/main` (dominated by `@next/next/no-html-link-for-pages` in home/marketplace
  components and `@next/next/no-img-element` warnings). This rung adds no source
  files, so it introduces zero new lint findings. (Prior PRs reported "ESLint clean"
  because they linted only touched files.)
- `npx next build` — **green (EXIT=0).** Compiled successfully; 134 static pages
  generated, 199 routes total. Run with dummy Supabase env
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) to satisfy the
  pre-existing budgeting-route collection requirement.

`node_modules` was provisioned by a real `cp -r` from the idle designer worktree per
`AGENTS.md` (no symlinks between active worktrees).

## 8. Open-source audit (OpenAdapt)

See `RUNG0_LICENSE_MATRIX.md` for the per-repo audit (commit reviewed, license,
copied/adapted/wrapped/concept-only verdicts, transitive deps, red flags, FFmpeg and
transcription packages treated separately).
