# FORGE Capture — Rung 1 Implementation Map

**Date:** 2026-09-20 · Branch `feat/forge-capture-rung1` from `2b77b0b`
**Status:** Inspection complete. No architectural conflicts with Rung 0 found.

## Inspection findings (what exists, what is reused)

- **No existing editor geometry/canvas/history core.** Grep across `src/` found no
  reusable 2D-geometry, annotation, or editor-history module. The only Canvas 2D user
  is `src/components/forge/rental/compressImageFile.js` — reused for its
  **host-boundary pattern** (injectable `{ createBitmap, createCanvas }` deps with
  lazy `globalThis`/`document` fallbacks so modules load without a DOM).
- **Undo pattern:** `schedulingBoardState.js` (`recordHistory`/`undoHistory`/
  `redoHistory`) — pure, immutable, frozen stacks, depth 50, session-only,
  redo cleared on divergent edit. The editor's `history.js` follows this shape.
- **Immutability convention:** domain objects are `Object.freeze`d
  (`FORGE_APPLICATIONS`, scheduling history). Editor documents follow suit.
- **Test conventions:** vitest, node env, explicit `vitest` imports, colocated
  `__tests__/` dirs; jsdom available per-file via `/** @vitest-environment jsdom */`.
- **IDs:** `crypto.randomUUID()` is the repo's ID generator (API routes); used with
  an injectable fallback for tests.
- **Rail:** `ForgeApplicationRail.jsx` exports frozen `FORGE_APPLICATIONS`
  (`{ href, label, shortLabel }`). `/forge/capture` is added as one entry.
- **ESLint:** `no-undef` is an error for JS/JSX; vitest globals are declared for
  test files. New code must not reference undeclared globals.

## New package: `src/domains/capture-editor/` (framework-neutral)

No file under this directory imports React, Next.js, or touches `document`/`window`
directly. Host capabilities arrive as injected dependencies.

| File | Responsibility |
|---|---|
| `limits.js` | Rung 0 caps: max dimension 16384, max decoded bytes 128 MB, undo depth 50, supported/rejected MIME sets, dimension + memory + MIME validators |
| `geometry.js` | Pure 2D geometry: rect normalize, bounds per annotation type, point-in-rect/ellipse, distance-to-segment, polyline hit-testing, immutable move/resize, viewport (zoom/pan) `imageToScreen`/`screenToImage` |
| `annotations.js` | `createAnnotation(type, geometry, opts)` with per-type defaults + geometry validation; immutable updaters; `renumberSteps` for step markers; `isRedaction` |
| `document.js` | Immutable `CaptureDocument`: create/add/update/remove, z-order ops, lock guard (locked targets return the identical frozen document — provable refusal), all frozen |
| `history.js` | Immutable undo/redo stacks, depth 50, redo invalidation on divergent edit, session-only (never serialized) |
| `schema.js` | `CURRENT_SCHEMA_VERSION = 1`; canonical deterministic serialization (recursive key sort); `deserializeProject` validates the whole envelope before hydrating — unsupported/newer versions and corrupt data throw, never partially applied |
| `renderer.js` | `renderDocument(ctx, doc, { sourceImage, viewport })`: Canvas 2D drawing of all 11 annotation types in z-order from source-image pixel space |
| `exporter.js` | `flattenDocument({ createCanvas, sourceImage, doc, format })`: single fresh canvas at source scale, redactions become pixels, returns `Blob`. No overlay representation in the artifact |
| `storage.js` | `createProjectStore(adapter)`: namespaced save/load/list/delete + recovery slot; adapter interface `{ getItem, setItem, removeItem, keys }` |
| `hosts.js` | Host boundary: `CaptureSource` interface (JSDoc), `fileSource`/`clipboardSource`/`displayMediaSource`; `decodeSourceImage` (MIME/dimension/memory validation, EXIF-stripping re-encode); `createCanvas2d`, `browserStorageAdapter`, clipboard helpers. Core never calls these directly — the host wires them |
| `index.js` | Public surface: the package's one interface per capability |

## UI (thin host only)

- `src/app/forge/capture/page.js` — server wrapper, metadata, renders the host.
- `src/components/forge/capture/CaptureEditorHost.jsx` — `"use client"`: toolbar
  (11 tools), canvas element, zoom controls, undo/redo, PNG export download,
  local save/recover via the storage abstraction, file/clipboard source loading.
  No editor logic inside; all state transitions call the core.
- `src/components/forge/ForgeApplicationRail.jsx` — one added entry
  (`/forge/capture`, "Capture"). No other navigation changes.

## Provisional schema clarifications (Rung 1, per Rung 0's provisional status)

1. `source.kind: "local-ref"` is **accepted by the reader but never written** in
   Rung 1 (needs an IndexedDB blob store — Rung 2). Rung 1 writes `embedded` only.
2. `history` stays session-only and is never serialized (schema doc already says so).
3. Unknown annotation `type` values inside the current schema version are
   **rejected with `CorruptProjectError`** — skipping them would be partial
   hydration (a different project), which the Rung 1 invariants forbid.
   (Corrected per ChatGPT architecture review 2026-09-20; the earlier
   skip-with-warning policy is removed.) Major version bumps reject as before.
4. `style.blurRadius` (default 12 px, image space) added for blur annotations.
5. Blur is implemented as a deterministic region downscale/upscale through a temp
   canvas (no `ctx.filter` dependency) — pixels are destroyed, never recoverable.
6. Metadata stripping = decode via `createImageBitmap`, then re-encode through a
   canvas to PNG bytes; the re-encoded bytes (never the original file bytes) are
   what the project embeds.

## Expected tests (`src/domains/capture-editor/__tests__/`)

`limits`, `geometry` (incl. viewport transforms), `annotations` (incl. step
renumbering), `document` (incl. z-order + locking refusal), `history` (invariants +
redo invalidation + depth cap), `schema` (round-trip, deterministic bytes,
unsupported-version rejection, corrupt rejection, no partial hydration),
`renderer` (per-type draw calls on a recording fake ctx, z-order),
`export.redaction` (software pixel-buffer canvas: blackout region uniformly black,
blur region ≠ source, artifact never references the source bitmap),
`storage` (save/load/list/delete/recovery on an in-memory adapter),
`hosts` (MIME/dimension/memory rejection, metadata-strip proof, CaptureSource shape),
plus one jsdom smoke test that the thin host renders all 11 tools + canvas.

## Validation plan

Focused Rung 1 tests → ESLint on touched files → `git diff --check` → `next build`
→ full vitest run compared against the Rung 0 baseline (1 timing flake in
`buildSessionCloseoutProposal.test.mjs`, 64 eslint errors / 34 warnings pre-existing).
No unrelated files touched; no migrations; no cloud persistence; no native work.
