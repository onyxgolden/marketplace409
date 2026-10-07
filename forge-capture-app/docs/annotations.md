# Annotations — sidecar contract, Slice 1 of 4

FORGE Capture's annotation layer lets a captured image be marked up —
arrows, boxes, highlights, text, blur regions, and numbered callouts —
without ever touching the original PNG. This is Slice 1 of a four-slice
program (annotations → blur/redaction → numbered callouts → durable tags and
a local library search). Plan and review trail: forge-ai-drop's
`commands/chatgpt/forge-capture-annotation-plan-rereview.md` and
`results/chatgpt/forge-capture-annotation-plan-rereview.md` (GO).

## One authoritative contract

The annotation sidecar's schema, geometry rules, and validation live in
exactly one place: `core/src/annotations.rs`. Nothing else — not the Tauri
shell, not the JS/webview renderer — independently parses or validates a
sidecar from raw bytes. The boundary is the two Tauri commands below:

- `load_annotations` always returns an **already-parsed, already-validated**
  sidecar object (via `annotations::parse_sidecar`). The JS side never sees
  raw sidecar JSON on the read path.
- `save_annotations` takes a JSON string from JS and re-parses/re-validates
  it through `annotations::parse_sidecar` **before anything touches disk**.
  A structurally invalid sidecar, or one whose source hash does not match
  the current PNG, is rejected at this one point — not a formality, the
  actual enforcement.

`ui/annotations-render.js` (the renderer) only ever consumes the validated
object `load_annotations` hands it. It has no sidecar-parsing logic of its
own, and it is not a second definition of what a valid annotation looks
like — if it were, the two could drift, and that drift is exactly what this
boundary exists to prevent.

## Storage

A sidecar lives next to its PNG: `<stem>.png` → `<stem>.annotations.json`.
The original PNG is never modified by anything in this program.

```json
{
  "schemaVersion": 1,
  "kind": "annotations",
  "sourceSha256": "<64 lowercase hex chars>",
  "canvas": { "w": 1920, "h": 1080 },
  "items": [
    { "id": "a1", "kind": "rect", "geometry": { "x": 10, "y": 10, "w": 100, "h": 50 }, "color": { "r": 255, "g": 0, "b": 0, "a": 255 }, "strokeWidth": 2 }
  ]
}
```

Annotation kinds: `rect`, `arrow`, `line`, `highlight` (a filled region, no
stroke), `text`, `blur` (a declared region; Slice 2 adds irreversible
redaction — see its own section in a future revision of this doc), and
`callout`.

## Geometry: source-image pixel coordinates, always

Every `geometry`/`anchor`/`from`/`to` field is in the source PNG's own
integer pixel grid — origin top-left, the same space
`core/src/coords.rs::RectI` calls `PhysicalRaster`. **Never** display, CSS,
or zoom-dependent coordinates. The webview converts at the view boundary
(screen px ↔ source px) when the user draws or edits; nothing persisted here
can drift when the window is resized or the view is zoomed.

Each kind's geometry shape is validated on load: rectangles must have
positive area and fall within the canvas; points must fall within
`[0, w] × [0, h]`; stroke widths must be positive; text must be non-empty
and under the length cap. An unsupported `schemaVersion`, or a shape that
fails validation, fails closed — the sidecar is treated as unreadable, never
silently coerced into something it isn't.

## SHA-256 source binding

A sidecar records the SHA-256 of the exact source bytes it was drawn
against. `load_annotations` reports `binding: "fresh" | "stale" | "none"`:

- **fresh** — the hash matches; safe to render/edit/export.
- **stale** — a sidecar exists but was drawn against different bytes (the
  source changed since). The UI may show it for inspection/recovery, but
  must refuse to render/export it against the new pixels until the mismatch
  is explicitly accepted.
- **none** — no sidecar exists yet; a fresh, empty one is returned, already
  correctly bound to the current PNG.

Race safety: the hash a caller computes must come from the exact byte slice
it is about to use for the operation that follows it, never from a second,
separately-timed read of the file. `save_annotations` reads the PNG once and
checks the binding against that same read, immediately before persisting.

## Atomic persistence

`save_annotations` writes via `atomic_write` (`app/src/main.rs`): a temp
file in the same directory, flushed, then renamed over the target. A crash
or a concurrent read mid-write can never observe a partial sidecar — the
rename is the only moment the new content becomes visible under the real
name. Same pattern already used for capture-upload finalize, scoped to one
file since a sidecar has no paired file that must land with it atomically.

## Renderer and flatten/export

`core/src/png.rs`'s decoder only round-trips this crate's own encoder
output (see its doc comment — "foreign PNGs continue to flow through the
Rung 1 editor's decoder"), so general image compositing already belongs in
the webview, which has a real image decoder and a 2D canvas. Rust does not
draw pixels for this feature.

`ui/annotations-render.js`:

- `resolveDrawOps(sidecar)` — pure, DOM-free. Turns a validated sidecar into
  an ordered list of draw operations (plain data, no canvas calls).
  Callout numbers are computed here, 1..N in array order among
  callout-kind items — never read from a stored field, because none exists
  (see `AnnotationBody::Callout`'s doc comment in `annotations.rs`: the
  original plan stored a step number and separately claimed numbering was
  derived, a contradiction the approved revision fixed by not persisting a
  number at all).
- `drawOpsToCanvas(ctx, ops)` — a thin adapter from draw ops to real
  `CanvasRenderingContext2D` calls. `ctx` only needs to implement the
  handful of methods used, so tests pass a recording mock instead of a real
  canvas.
- `flattenAnnotations({ sidecar, sourceImage }, { createCanvas, getContext2d })`
  — the flatten/export primitive: composites the source image plus every
  annotation onto a freshly created canvas, sized to the sidecar's own
  `canvas.w`/`canvas.h`. Never mutates `sourceImage`. `createCanvas`/
  `getContext2d` are injected so this can be unit-tested with fakes;
  production code passes real `document.createElement("canvas")` /
  `canvas.getContext("2d")`.

Blur is drawn as a declared region (`blurRect`) only; the actual pixel blur
is applied by the caller's own compositing pass (e.g. `ctx.filter`), since a
mock `ctx` cannot meaningfully verify a real blur result. Slice 2 is where
blur becomes interactive and redaction (an irreversible sanitized
derivative) is added.

## What is not yet wired

- The interactive drawing UI (mouse-driven creation/editing of annotations)
  is not part of Slice 1. This slice is the contract — schema, validation,
  persistence, and the renderer's draw-op resolution/application — not the
  toolbar and pointer-event handling that would call into it.
- `load_annotations`/`save_annotations` are called directly in tests
  (neither takes `State`/`AppHandle`, so they're plain functions) against
  real files and real encoded PNGs — including the canvas-mismatch rejection
  (a sidecar with a correct source hash but a false `canvas`, review finding
  below) and schema-version rejection. What is still untested is the actual
  IPC round trip from JS through Tauri's `invoke` — that needs the real
  webview. Smoke-test that path before relying on it end to end.

## Review findings fixed after the first Slice 1 pass

- **Canvas not bound to the actual source.** The SHA binding alone proves a
  sidecar was drawn against these exact bytes; it says nothing about whether
  `canvas` honestly describes their decoded dimensions. A sidecar with a
  correct hash but a false `canvas` was accepted as "fresh", and the
  renderer then stretched the real image into the wrong coordinate space.
  Fixed with `annotations::check_canvas_matches_source`, called by both
  `load_annotations` and `save_annotations` using the dimensions they decode
  from the PNG itself — never the sidecar's own claim.
- **`schemaVersion: 0` was accepted.** The version check only rejected
  versions *greater than* `ANNOTATIONS_SCHEMA_VERSION`, not versions below
  it. Since 1 is the only schema that has ever existed, `parse_sidecar` now
  rejects anything other than exactly 1.
