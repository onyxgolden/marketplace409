# ADR 0001 — Designer sample projects are reusable seed definitions

Date: 2026-09-22
Status: Accepted

## Context

FORGE Home Designer needed a browsable example — a finished two-story
house customers can open to see what the tool can do, and marketing can
screenshot for advertising. Options were: import a found plan (DXF/PDF —
neither importer exists), trace an image underlay, or author a project
natively with the domain functions.

## Decision

- Sample projects are **seed definitions**: pure client-side generator
  functions (`src/domains/roomDesigner/sampleProjects.js`) that build a
  complete, valid HomeProject envelope from the real domain functions
  (`addWall`, `addOpening`, `placeFurniture`, ...).
- The generated document carries **no identity**: no projectId, no
  owner/user fields, no `createdAt`/`updatedAt`, no draft metadata. The
  "Use this sample" button POSTs a fresh project, then PUTs the seed
  document; the server assigns `projectId`, `owner_id`, and row
  timestamps. The local draft key `forge-designer-draft:<projectId>` is
  therefore collision-safe — the seed identifier is a catalog key only
  and is never stored as an id.
- Fork-only, no read-only mode: every customer gets a live editable copy
  they can orbit in 3D, section, estimate, and DXF-export. The sample
  itself is never edited.
- Stairs have no native symbol yet: the stairwell is an annotation group
  (closed outline + tread lines + UP/DOWN label) tagged with
  `STAIR_ANNOTATION_SOURCE`, so future native stair support can find and
  replace it. Nothing depends on furniture semantics for stairs.
- No API, auth, DB, or schema changes. No `sample_project` flags.

## Public showcase

A public, no-sign-in showcase page for advertising is **explicitly out of
scope** for this slice. The designer is auth-gated; exposing
`DesignerScreen` directly as a public surface would need its own
read-only rendering path. Sample projects are reusable seed definitions —
public showcase rendering is a future separate read-only surface.
