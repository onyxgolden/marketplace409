# FORGE Capture — Proposed Versioned Capture-Document Schema

**Date:** 2026-09-20 · Rung 0 (proposal; no code)

## Design principles

1. **Source image and annotation objects are distinct.** Redactions are annotation
   objects; flattening happens only at export, where they become unrecoverable pixels.
2. **Deterministic serialization.** Canonical field order, stable IDs — same document
   in, same bytes out — so round-trip tests are meaningful and version control of
   projects is sane.
3. **Versioned envelope.** Every document carries `schemaVersion`. Unknown or newer
   versions are **rejected safely** (never partially applied).
4. **No secrets by construction.** The schema has no field for credentials, tokens, or
   PII beyond what the user deliberately types into a text annotation (which the
   privacy review gate covers).
5. **Local-first.** The document is fully self-contained (embedded source image or a
   content-hash reference to a local blob) — no server required to open it.

## Envelope

```jsonc
{
  "schemaVersion": 1,            // integer; bump on any breaking change
  "kind": "forge-capture-project", // or "forge-capture-guide" (Rung 3)
  "id": "uuid-v4",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "canvas": { "width": 1920, "height": 1080 },  // source-image pixel space
  "source": {
    "kind": "embedded",          // "embedded" | "local-ref"
    "mime": "image/png",
    "bytes": "<base64>",         // embedded; size-capped (see limits)
    // or: { "kind": "local-ref", "sha256": "…", "mime": "image/png" }
    "captureMeta": {
      "origin": "browser-display-media | clipboard | file | native-companion",
      "capturedAt": "ISO-8601",
      "displayLabel": "user-supplied name (never auto device metadata)"
    }
  },
  "annotations": [ /* AnnotationObject, z-ordered */ ],
  "history": { "undoDepth": 50 }, // not persisted; session-only (documented here)
  "limits": { "maxDimension": 16384, "maxBytes": 134217728 }
}
```

## AnnotationObject

```jsonc
{
  "id": "uuid-v4",
  "type": "arrow | line | rectangle | ellipse | freehand | highlight | text | callout | step-marker | blur | blackout",
  "z": 3,                        // layer order
  "geometry": {                  // in source-image pixel coordinates (floats)
    // rectangle/ellipse/blur/blackout: { "x": 0, "y": 0, "w": 100, "h": 50 }
    // line/arrow: { "points": [[x1,y1],[x2,y2]] }
    // freehand/highlight: { "points": [[x,y], …] }
    // text/callout/step-marker: { "x": 0, "y": 0, "w": 200, "h": 60 }
  },
  "style": {
    "stroke": "#ff0000", "strokeWidth": 3,
    "fill": "transparent", "opacity": 1.0,
    "fontSize": 16, "fontFamily": "system-ui"
  },
  "text": "optional user text (text/callout/step-marker)",
  "stepNumber": 4,               // step-marker only; auto-assigned, renumbered on reorder
  "redaction": true,             // blur/blackout only: marks permanent-redaction intent
  "locked": false
}
```

Callouts carry an anchor: `"anchor": { "x": 10, "y": 20 }` (the arrow tip in image
space) plus the label box geometry.

## Guide document (Rung 3 extension, same envelope)

```jsonc
{
  "kind": "forge-capture-guide",
  "steps": [
    {
      "id": "uuid-v4",
      "order": 1,
      "title": "Open the invoice list",
      "description": "user-editable",
      "projectRef": "<capture-project id>",  // before/after images
      "action": {
        "type": "click | scroll | drag",
        "at": [512, 300],                    // image-space coordinates
        "timestamp": "ISO-8601",
        "role": "button", "accessibleName": "Invoices",  // where available
        "windowLabel": "user-supplied label only"
      },
      "note": "optional user-written step note",
      "sensitivity": { "status": "clear | flagged | unresolved", "findings": [] }
    }
  ]
}
```

Privacy fields: `sensitivity.status = "unresolved"` **blocks sharing/export** until a
human clears or redacts it (threat model T1).

## Migration policy

- Readers accept `schemaVersion <= CURRENT`. Writers always emit `CURRENT`.
- `schemaVersion` bumps are additive-friendly: unknown annotation `type` values render
  as skipped-with-warning rather than failing the whole document — except major
  version bumps, which reject.
- A `migrations/` note per version documents field renames; no silent coercion of
  redaction objects (a `blackout` must never migrate into a reversible type).

## Limits (Rung 1 enforcement)

- Max source dimension: 16,384 px per side; max decoded bytes: 128 MB.
- Import strips EXIF/metadata; SVG and animated inputs rejected at import.
- Undo depth 50, session-only (not serialized).
