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
  number at all). Reordering the `items` array (see `move_item` below)
  renumbers every callout at the next render with no gaps.
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
mock `ctx` cannot meaningfully verify a real blur result.

## Redact: irreversible, not the same thing as blur (Slice 2)

`redact` is its own annotation kind (`AnnotationBody::Redact`, geometry only
— no color: a fixed, non-caller-chosen sanitizing color is what makes "no
recoverable pixels" tractable to reason about). Positioning a redact region
is as reversible as any other sidecar item — move it, delete it, undo — but
nothing is actually destroyed by saving the sidecar. The sidecar's redact
items are a **draft**.

**The destructive overwrite happens entirely in Rust, at the trusted export
boundary — never in JS.** An earlier version of this slice had the webview
composite an already-redacted buffer and had `export_redacted` trust that
claim; review correctly rejected that (a caller could send any
correctly-sized buffer, including one containing the untouched original
pixels, and it would still be written out as `-redacted.png`). The
corrected design:

- `ui/annotations-render.js` performs **no destructive pixel work at all**.
  `resolveDrawOps`'s `"redact"` case only ever produces the non-destructive
  `redactPlaceholder` op, for live-editing preview. A caller preparing a
  redaction export calls the same `flattenAnnotations` used for an ordinary
  export (source image plus ordinary annotations; any `redact` items render
  only as the preview placeholder) and sends its pixel data to Rust. There
  is no separate "export a redacted image" function in this module.
- The Tauri command `export_redacted` is the entire trust boundary. In
  order: it **re-reads `pngPath` from disk itself** (never a caller's
  claim); decodes its **actual** dimensions (`png_dimensions`) and checks
  the sidecar's `canvas` against them (there is no width/height parameter a
  caller could use to override this); checks the sidecar's source SHA
  against those same real bytes and refuses a stale sidecar, the same as
  `load_annotations`/`save_annotations`; confirms the sidecar actually
  declares at least one `Redact` item (`annotations::has_redaction`);
  decodes and length-checks the incoming buffer against the real
  dimensions; then **overwrites every validated `Redact` rectangle in that
  buffer itself**, with the fixed sanitizing pixel
  (`annotations::apply_redactions` / `paint_redaction_rect`) —
  unconditionally, regardless of what the incoming buffer already
  contained there. Only then does it encode (`encode_rgba`, which never
  writes metadata chunks at all — only signature/IHDR/IDAT/IEND, so "does
  not copy source metadata by default" is satisfied by construction) and
  write to a brand-new, versioned `<stem>-redacted.png`
  (`annotations::versioned_redacted_stem`, mirroring
  `ai_edit::versioned_stem`'s convention) via the same `atomic_write` as
  every other write in this program. The source PNG and its editable
  sidecar are never opened for writing.

**"No recoverable pixels" is proven, not just argued**, because the
destructive step is now plain Rust pixel arithmetic on an in-memory buffer:
`core/src/annotations.rs`'s tests feed `paint_redaction_rect`/
`apply_redactions` a buffer filled with a hostile, non-black value
everywhere and assert the declared region becomes exactly the fixed
sanitizing pixel while everything outside it is untouched.
`app/src/main.rs`'s `export_redacted` tests go further: they send an
**unredacted** buffer (every pixel a hostile, non-black value) through the
real command, then **decode the file the command actually wrote**
(`decode_own`, since it was produced by this crate's own encoder) and
assert the redact region's pixels in that output file are the fixed
sanitizing value — proving the guarantee for what lands on disk, not for an
in-memory buffer this module happens to construct. Also covered: a stale
sidecar/source is rejected, and a false `canvas` is rejected even with a
correct source hash.

Upload semantics (never send the editable sidecar or an unredacted buffer
once a redact region exists) remain a constraint on *future* upload
integration, not something this slice wires up — no upload path for
annotated/redacted captures exists yet.

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
