# FORGE Capture — Architecture Decision Records (Rung 0)

**Program:** FORGE Capture (provisional name)
**Date:** 2026-09-20
**Status:** Proposed (Rung 0) — accepted only after architecture review of the Rung 0 PR.

These records follow the format of `docs/architecture/ARCHITECTURE_DECISIONS.md`.
They will be merged into that file's numbering if the program proceeds past Rung 0.

---

## ADR-CAP-001 — Standalone desktop utility is the primary product; browser editor core ships inside it

### Context

FORGE Capture is a general-purpose, system-wide desktop capture tool (scope
correction 2026-09-20), not a FORGE-limited feature. Users must be able to launch it
independently or via a global shortcut and capture any website, application, monitor,
window, or region — with no FORGE account and no sign-in. The browser gives us the
editor completely; it cannot give us global shortcut, tray, native region selection,
window capture, input-event sync, system audio, or reliable desktop scrolling capture.

### Decision

- The **primary product is a standalone desktop utility** (Tauri shell): global
  shortcut / tray launch, system-wide capture, local save / clipboard / export with
  zero authentication and zero upload.
- The Rung 1 editor is a **framework-neutral package** that ships **inside the
  standalone utility** and is also embeddable as an optional web surface
  (`/forge/capture`). One editor core, two hosts.
- The editor consumes captures through a `CaptureSource` interface, so each new
  capture capability (region, window, scrolling, flow) is a new source, not a rewrite.
- The standalone utility is fully useful with no FORGE account; FORGE integration
  (library, sharing) is an opt-in destination (Rung 5).

### Consequences

- Rung 1 builds the editor core with no native packaging work.
- Rung 2 builds the Tauri shell around it, now including scrolling capture as a
  required early capability (ADR-CAP-008).
- Rung 2 requires a Windows code-signing decision before its PR opens.
- No Python runtime is introduced into the product.

---

## ADR-CAP-002 — No Python capture sidecar, no wholesale OpenAdapt import

### Context

OpenAdaptAI publishes capture/privacy/flow/desktop components that overlap Rungs 2–3.
A Python sidecar was evaluated as a capture path.

### Decision

- **No Python sidecar** as a product path: second runtime to install/pin/sign/update,
  new IPC surface, Windows AV/permissions friction. Unacceptable packaging complexity
  for the value.
- **No wholesale import** of any OpenAdapt project. Reuse is limited to narrow,
  permissively licensed adapters only where the Rung 0 license audit justifies it;
  concept-level ideas (event+frame synchronization) may inform our own implementation.
- Any incorporated third-party code gets its notices in `THIRD_PARTY_NOTICES.md`.

### Consequences

- Rungs 2–3 are implemented FORGE-owned, against the audited license matrix
  (`RUNG0_LICENSE_MATRIX.md`).

---

## ADR-CAP-003 — FORGE integration is an optional destination, not the product

### Context

Capture needs to be reachable from FORGE surfaces (scheduling, floor-plan designer,
Rental Manager, property inspection, help, dev tools — Rung 6), but the product is
standalone and must work without any FORGE account.

### Decision

- An optional web surface may live at **`/forge/capture`** as a peer application in
  `ForgeApplicationRail` (Room Designer precedent) for users who want the editor in
  the browser with an opt-in "Save to FORGE" path.
- Rung 6 adds context-aware deep links (`/forge/capture?context=…` or the standalone
  app's deep link) with a minimal, non-sensitive context allowlist.
- The FORGE library and sharing (Rung 5) are an **opt-in cloud destination**; the
  local library in the standalone utility remains fully usable offline.

### Consequences

- One editor core serves the standalone app and the optional web surface; FORGE
  surfaces get stable deep-link targets without owning the product.

---

## ADR-CAP-004 — Local-first with explicit, visible upload

### Context

Screenshots routinely contain credentials, PII, financial and tenant data. Silent
sync or telemetry of capture content is an unacceptable exfiltration surface.

### Decision

- Capture, editing, redaction, and project save work with **no server**.
- **Nothing crosses the network without an explicit, visible user action**
  ("Save to FORGE", "Share", "Export"). No background sync.
- Raw session and approved derivative are **different artifacts**; sharing operates
  on the approved derivative only.
- Analytics may receive allowlisted events only — never pixels, OCR results,
  annotations, typed content, filenames, or capture metadata (enforced by the
  existing `src/lib/analytics/policy.js` allowlist).

### Consequences

- Rung 5's library is opt-in cloud; the local library remains fully usable offline.
- A capture addendum to the Data Retention Policy is required before Rung 5.

---

## ADR-CAP-005 — No LLM in capture, markup, redaction, or replay control

### Context

LLM involvement in capture pipelines risks exfiltration of whatever is on screen and
non-deterministic behavior in redaction and replay.

### Decision

Architectural ban (not a filter): **no LLM calls** in capture, markup, redaction, or
the replay control loop. Any future AI capability (e.g. layout suggestions) is a
separately reviewed slice, off by default, and never in the redaction or replay path.

---

## ADR-CAP-006 — No replay in documentation phases; replay stays research-only

### Context

Deterministic workflow replay is a stated future direction (Rung 7).

### Decision

- Rungs 1–6 ship **zero replay**: no automation, clicking, or form submission.
- Rung 7 is **research only** on synthetic fixtures, behind a kill switch, with a
  hard ban on replay against payments, banking, ledgers, leases, tenant actions, or
  scheduling mutations. Production replay needs separate authorization.

---

## ADR-CAP-007 — Framework-neutral, FORGE-owned editor package

### Context

No image-editor framework (tldraw/fabric/konva) is in the dependency tree, and the
spec requires a reusable, framework-neutral package with a versioned deterministic
schema. The same editor core must serve the standalone desktop utility and the
optional web surface.

### Decision

Rung 1 builds the editor as a framework-neutral package (working name
`@forge/capture-editor`): pure geometry/document logic unit-tested independently of
React, Canvas 2D as the render backend, proposed schema in
`RUNG0_DOCUMENT_SCHEMA.md`. The Tauri standalone shell (Rung 2) and the optional
`/forge/capture` web surface both host this package.

### Consequences

- Editor logic is portable across hosts; tests run without a DOM where possible.

---

## ADR-CAP-008 — Scrolling capture is an early parity requirement (Rung 2)

### Context

Scrolling capture (full webpages, wide schedules/tables) is core to a
general-purpose capture tool's parity with Snagit-class tools. Leaving it late
would ship a utility that fails the most common long-document workflow.

### Decision

Scrolling capture moves from Rung 4 to **Rung 2 as a required capability**, with two
evaluated paths:

1. **Browser-assisted capture** — page/DOM awareness for supported websites
   (programmatic scroll, viewport frames, deterministic stitching offsets,
   fixed/sticky element handling via DOM inspection).
2. **Image-based controlled scrolling and stitching** — for desktop applications or
   unsupported pages (drive scroll input, capture frames, align by image overlap).

Required behaviors: vertical + horizontal scrolling; automatic stitching;
fixed-header/sticky handling; duplicate/missing region detection; manual
alignment/correction fallback; pixel/memory/page-length safeguards; infinite-scroll
and dynamic-content handling; explicit incomplete-capture reporting; immediate
opening in the Rung 1 editor; export without FORGE storage or authentication.

### Consequences

- Rung 2 is larger than originally scoped; its risk rises to medium-high and its PR
  may split into 2a (core native capture) and 2b (scrolling capture) at architecture
  review.
- **Limitation honesty is a requirement:** no claim of universal desktop scrolling
  support. Supported surfaces and limitations are documented explicitly; where the
  target app lacks reliable scrolling or stable content, the tool reports
  incompleteness instead of silently shipping a broken stitch.
