# Capture PPTX-to-video — Slice 1: import, preview, project

**Status:** implemented, in review (PR #814). Fix round 1 (Nov 16, after a
NEEDS CHANGES verdict at head `9376a325`) and fix round 2 (Nov 16, after a
NEEDS CHANGES re-review at head `7e9d8b9d` — the two original findings are
closed) are in this branch. Slice 1 only:
import a `.pptx`, preview its slides, pick which slides go in, save that
as a project. No narration, no voice, no video assembly, no MP4 export —
those are slices 2–5.

## What was built

- **Video entry point + import** — a "Create video" tab in the Capture app
  (`ui/index.html`, `ui/main.js`, `ui/pptx-create-video.js`). Drop a file
  or browse; progress bar + plain-words status throughout; Back navigation
  to the project list from the project page.
- **Safe local copy + SHA-256 + bounded ZIP/OOXML parser** —
  `ui/pptx-import-core.js`. Caps: 100 MB input, 100 slides, 512 MB
  expanded, 64 MB per entry, 40 MP per image, 500 MP aggregate,
  10,000 entries, 16 MB XML part, 60 s budget. Central-directory
  validation from declared sizes (a ZIP bomb is rejected without
  expanding it); streaming bounded inflate with length + CRC-32
  verification; `<!DOCTYPE`/`<!ENTITY` rejected before parsing; external
  relationships never dereferenced; local-header name must match the
  central directory. Rejections carry stable codes + plain-words
  messages (`PptxReject`).
- **Renderer: Pagus (qualified per §9)** — `@pagus-kit/core` 0.1.1 +
  `@pagus-kit/renderer` 0.1.1 (both MIT), vendored as
  `ui/vendor/pptx.bundle.mjs` (esbuild one-time bundle exporting `parse`,
  `renderSlide`, `XMLParser`; the Google Fonts URL builder is tree-shaken
  out — the bundle contains zero `fetch(` calls and zero `googleapis`
  references). `parse(ArrayBuffer)` → IR; `renderSlide(slide, slideSizePt,
  { scale, fontSubstitutes })` → SVG. DOM-free. Scale is set so the long
  edge renders at 1920 px. Fonts: local fallback only (Segoe UI → Arial →
  sans-serif); a missing font is substituted and warned, never fetched.
  - **Why Pagus, not the alternative:** the brief's §9 spike asked for
    the renderer to be qualified by fixture results. Pagus parsed and
    rendered every fixture deck (synthetic 4-slide, 4:3, tables/charts,
    mixed placeholders/fonts, the real 33-slide P6 deck) with correct
    order, aspect and text. No alternative was needed; none was built.
  - **IR gap found by the fixtures:** the Pagus IR does not carry
    placeholder type on shapes, so slide-text extraction reads raw slide
    XML (placeholder-aware) instead of the IR
    (`ui/pptx-extract-core.js`).
- **Speaker-notes and slide-text extraction** — `ui/pptx-extract-core.js`.
  Notes resolve through each slide's own rels → notesSlide → body
  placeholder only. Footer/date/slide-number placeholders and
  `slidenum`/`datetime` fields are never read as narration. Tables are
  read cell-by-cell; chart titles via chart rels; fonts collected from
  runs. Paragraph text preserves document order (runs, breaks, fields).
- **Thumbnails/preview, select all/clear, order preservation, warnings**
  — the panel shows one card per slide (thumbnail SVG, title, notes
  preview, per-slide warnings), in deck order. Select all / Clear
  (clear keeps the first slide selected — a project with no slides
  selected cannot make a video). Selection saves on every change with a
  visible plain-words confirmation.
- **Rights acknowledgement (brief §7, fix round 1)** — before any import
  starts, the user ticks "I own this presentation or have permission to
  process it." The box gates both the file picker and drag/drop (and
  `importFile()` itself); it unticks as the import begins, so every file
  needs a fresh, deliberate tick. It is never pre-ticked.
- **Warnings reach their slide and survive reopen (fix round 1)** —
  package warnings (e.g. the P6 deck's unsupported WMF picture) are
  mapped to the slide whose relationships reference the media part
  (`mapPackageWarnings` in `pptx-import-core.js`); warnings no slide
  owns go to a project-level `warnings` array on the manifest. Renderer
  warnings (font substitution) are merged into the slide records before
  the manifest is saved. The warnings box shows project + slide
  warnings, deduplicated, on fresh import and on reopen.
  - **Font probe fix (found by fix round 1):** the webview probe was
    `document.fonts.check()`, which returns true for any family name in
    Chromium — so a missing font could never be reported in the real
    app. The probe now measures a test string on a canvas in the
    candidate font vs the bare fallback; identical widths mean the font
    is not installed. Local-only, no network.
- **Slide warnings are validated (fix round 2)** — `validateProjectManifest`
  now checks each slide's `warnings` field too: when present it must be an
  array and every member must satisfy `isWarning()` (project-level
  `warnings` were already checked in fix round 1). A malformed record
  such as `warnings: [null]` can no longer pass validation and throw in
  `renderWarnings()` on reopen. Older manifests with no `warnings` field
  on slides are still accepted.
- **PptxVideoProjectV1 persistence** — `ui/pptx-project-core.js` (pure
  logic) + `app/src/pptx_video.rs` (backend storage). Manifest:
  `schemaVersion`, `id`, `title`, `createdAt`/`updatedAt`, `revision`,
  `source` (file name, SHA-256, size, slide size, slide count),
  `slides` (id, index, part path, title, text, speaker notes, selected,
  render fingerprints, warnings), project-level `warnings` for package
  warnings no slide owns, later-slice fields (`steps`,
  `narration`, `voice`, `audio`, `output`) as `not_started`
  placeholders so Slice 2 needs no migration, and an `events` log.
  Layout: `<data-root>/PptxVideos/<project-id>/source.pptx`,
  `project.json`, `thumbs/slide-NNNN.svg`. Thumbnails are the rendered
  SVGs themselves, not PNG rasters: Pagus draws all slide text inside
  `<foreignObject>`, and Chromium taints any canvas an
  SVG-with-foreignObject is drawn onto, so `canvas.toBlob()` throws for
  every real slide (found in E2E). The SVG displays directly in an
  `<img>` (no script execution there) and is the faithful thumbnail.
  PNG rasterization (`rasterizeSvgToPng` in `pptx-render-core.js`) is
  retained for Slice 4 but must be re-qualified there by another path.
  Manifests and thumbnails are written temp-then-rename; a failed finish
  removes the project folder, and a failure after the upload finishes
  (e.g. during thumbnail saving) deletes the project folder instead of
  only cancelling the upload — so no partial project survives.
- **Rename/delete + save confirmation** — rename validates the title
  (non-empty, ≤200 chars, no path characters) and confirms in plain
  words. Delete asks for confirmation in a native dialog, removes only
  the project's own folder (canonicalized + containment-checked), and
  confirms the original deck was not touched.
- **Chunked deck upload** — `pptx_video_begin/append/finish/cancel_upload`
  (1 MiB chunks, in-order, no gaps), mirroring the Rung 4 media upload.
  Finish verifies the byte count, rejects legacy `.ppt` (OLE magic) and
  non-ZIP bytes, and records the SHA-256.

## What was verified, and where

- **Vitest (focused battery, 62 tests, all passing)** —
  `ui/__tests__/pptx-import-core.test.js` (22),
  `pptx-extract-core.test.js` (9), `pptx-render-core.test.js` (12),
  `pptx-project-core.test.js` (18), `pptx-golden.test.js` (1, compares
  9 goldens). Run: `vitest run forge-capture-app/ui/__tests__/pptx-`
  from the worktree root (node_modules symlinked from
  `~/workspace/marketplace409-fix/node_modules`). Fix round 1 added 7
  tests: `mapPackageWarnings` (P6 WMF → slide 13, clean deck, orphan /
  part-less warnings → project collection) and manifest warning
  persistence (WMF and missing-font warnings survive a JSON round-trip
  = reopen; project-level warnings field; dedupe). Fix round 2 added 1
  test: slide-level warning validation (malformed record, non-array
  field, legacy manifest with no slide warnings, well-formed warning
  still passes). One run showed the golden test timing out at 5000 ms
  under parallel load; it passes standalone (1.6 s) and on re-run — a
  load flake, not a regression (the golden test stubs its font probe,
  so the probe change cannot affect it). The same 5000 ms flake also
  caught the 33-slide P6 render test once under parallel load; both
  pass standalone, and the full battery is 62/62 with
  `--testTimeout=15000`.
- **Acceptance decks** — fixed synthetic 4-slide 16:9 deck + 3
  real-world-varied decks (4:3 with images, 16:9 with table/chart,
  mixed placeholders/fonts) + the real P6 training deck
  (`Report_Wizard_and_Editor_Training-2.pptx`, 33 slides, 4:3, 31 of 33
  with speaker notes; slides 1–2 have empty note bodies in the file
  itself). All slides render in order, correct aspect, within viewport.
- **Negative cases** — ZIP bomb (rejected from the central directory),
  path traversal (`../evil.txt`), malformed OOXML, oversized image
  (48 MP), 101-slide deck, legacy `.ppt` (synthetic + the real P6
  `resource_leveling_P6_1.ppt`, OLE magic `d0cf11e0`), tampered bytes
  (CRC-32), external-relationship/macro/OLE deck (no network, no
  execution). All leave no partial project.
- **Golden renders (reviewed)** — 9 SVGs under
  `ui/__tests__/fixtures/golden/` with `golden-manifest.json` (SHA-256
  per slide). Renders are deterministic (byte-identical re-renders are
  asserted). Five goldens were screenshot-reviewed in headless Chromium:
  synthetic slide 1 and 4, chart slide 2, P6 slides 1 and 3 — all
  correct. The golden test fails on any drift until a human re-reviews.
- **No network** — the Pagus bundle contains zero `fetch(` calls and
  zero `googleapis` references; the import/render cores call no network
  APIs (grep-verified). Import + render were exercised in headless
  Chromium with the page's network killed (route-abort + `fetch`
  stubbed to throw): 0 network calls, 4 slides rendered, notes and
  titles correct.
- **Panel E2E (headless Chromium, mocked Tauri invoke)** — the full
  flow runs: open the Create video tab → import the synthetic deck →
  "Saved — 'synthetic-4-slide-16x9' is ready. 4 slides, 4 with speaker
  notes." → 4 slide cards with thumbnails → deselect slide 2 saves
  `[true, false, true, true]` → rename confirms → delete confirms and
  the delete command fires. Screenshots reviewed
  (`/tmp/pptx-e2e-shots/02-project-view.png`). Fix round 1 added Leg 3
  (`/tmp/pptx-e2e.mjs`): with the rights box unticked, both the file
  picker and a drag/drop are refused with "Tick the box first…" and no
  upload starts; ticked, the mixed deck imports and its
  font-substitution warning shows in the warnings box, is in the saved
  manifest, and is still shown after going back and reopening the
  project (`/tmp/pptx-e2e-shots/03-warnings-reopen.png`).
- **Rust backend** — `app/src/pptx_video.rs` unit tests (7: SHA-256
  known vector, ZIP vs OLE magic, PNG + SVG magic, project-id/title
  validation, manifest shape checks, atomic-write round-trip), all
  passing. Verified in this VM via the standalone harness at
  `/tmp/pptx-video-stub` (stubbed `tauri` crate: identity `#[command]`,
  deref `State<T>`), which also caught a real typo (a missing `>` in
  `pptx_video_list_projects`' return type) that the uncompiled module
  had carried. The full app crate `cargo test` is still owed on a
  machine with the Tauri system libs (an install is in progress in
  this VM; see "Not verified here").

## Fidelity gaps (recorded, not hidden)

- **Pagus 0.1.1 does not draw chart titles.** The chart itself renders
  (bars, axes, series values) but its title ("Sales by category") is
  absent from the SVG. The title is still captured by text extraction,
  so narration (Slice 2) has it. If a later slice needs titles drawn,
  the fix belongs in the renderer choice, not in Slice 1 scope.
- **Canvas rasterization of Pagus SVGs is blocked in Chromium.**
  Pagus draws all slide text inside `<foreignObject>`, and Chromium
  taints any canvas an SVG-with-foreignObject is drawn onto, so
  `canvas.toBlob()` throws SecurityError for every real slide (found
  in E2E). Slice 1 stores the SVG itself as the thumbnail. Slice 4
  (timed assembly) needs PNG frames and must rasterize by another path
  — a renderer emitting plain `<text>`, or a native SVG→PNG step.
  Do not wire `rasterizeSvgToPng` into Slice 4 assuming it works on
  Pagus output.
- **python-pptx fixture geometry:** the synthetic deck's slide size is
  959.976 × 540 pt (13.333 in truncates to 12191695 EMU), so rendered
  height is 1080.03 px, not exactly 1080. Harmless; the tests use a
  tolerance for that dimension.
- **P6 slide 1 master logo** runs to the slide's right edge and its
  "LLC" is clipped in the render — that is the deck's authored master
  geometry (the image extends past the slide edge); PowerPoint clips it
  the same way. Faithful rendering, not a defect.
- **WMF image:** the P6 deck contains 1 WMF picture (`ppt/media/image18.wmf`,
  shown on slide 13). It is recorded as an `unsupported-image-format`
  warning attached to slide 13 (and persisted on the manifest), so the
  user sees it on import and on reopen; the slide still renders (the
  picture is skipped by the renderer).

## License inventory (Slice 1 additions)

| Dependency | Version | License | Use |
| --- | --- | --- | --- |
| @pagus-kit/core | 0.1.1 | MIT | PPTX parse → IR |
| @pagus-kit/renderer | 0.1.1 | MIT | IR → SVG |
| fast-xml-parser (via Pagus) | 5.12.1 | MIT | XML parsing |
| jszip (via Pagus, under MIT) | 3.10.2 | MIT OR GPL-3.0-or-later | ZIP reading |
| fflate | 0.8.3 | MIT | bounded inflate (vendored `ui/vendor/fflate.mjs`) |

No copyleft code is incorporated; no FFmpeg anywhere. Third-party
notices recorded in the repo-root `THIRD_PARTY_NOTICES.md` (mirrors the
existing gifenc vendoring pattern).

## Not verified here (owed on Windows)

- **Rust: full app crate `cargo test`.** This Linux VM lacks the Tauri
  system libs (`gdk-3.0` etc.); an install is in progress (libsoup
  installed; gtk/webkit still installing when the PR was filed). The
  module compiles and its 7 unit tests pass in the standalone harness
  (`/tmp/pptx-video-stub`), but the `mod pptx_video` wiring in
  `main.rs` (declaration, AppState field, invoke_handler registration)
  has not had a full-crate compile in this VM. A Windows
  `cargo test -p forge-capture-app` (or the equivalent on the
  iBUYPOWER) is owed before merge.
- **Live UI click-through in the real app.** The panel was exercised in
  headless Chromium with a mocked Tauri invoke (import → render →
  save flow against the real cores), but the Tauri app itself was not
  run end-to-end here (no Windows host in this VM). The live
  click-through on `409marketplace.online` / the installed Capture app
  is owed per the standing rule.
- **`npm run build` at base fails** on the pre-existing Call Shield
  page-data collection defect (unrelated to this slice); no new build
  failures were introduced (verified: the failure is identical with
  and without this branch — it fails at base before reaching any
  Slice 1 code).

## Files

- `forge-capture-app/ui/pptx-import-core.js` + `__tests__/pptx-import-core.test.js`
- `forge-capture-app/ui/pptx-extract-core.js` + `__tests__/pptx-extract-core.test.js`
- `forge-capture-app/ui/pptx-render-core.js` + `__tests__/pptx-render-core.test.js`
- `forge-capture-app/ui/pptx-project-core.js` + `__tests__/pptx-project-core.test.js`
- `forge-capture-app/ui/__tests__/pptx-golden.test.js` + `fixtures/golden/`
- `forge-capture-app/ui/__tests__/fixtures/pptx/` (synthetic decks,
  negative cases, P6 decks, fixture generator `generate-pptx-fixtures.py`)
- `forge-capture-app/ui/vendor/pptx.bundle.mjs`, `ui/vendor/fflate.mjs`
- `forge-capture-app/ui/pptx-create-video.js`, `ui/index.html`,
  `ui/main.js`, `ui/styles.css`
- `forge-capture-app/app/src/pptx_video.rs`, `app/src/main.rs` (wiring)
- `THIRD_PARTY_NOTICES.md` (root)
