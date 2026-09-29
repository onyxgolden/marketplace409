# FORGE Import Test Library

Real, redistributable files for the formats FORGE Designer **can import today**, each with a
detailed, a difficult and a malformed case. Test-only: this folder sits outside `public/` and is
never shipped to users.

Tests: `src/domains/roomDesigner/importers/importLibrary.test.js` (manifest, DXF, PDF) and
`importLibrary.vsdx.test.js` (VSDX, jsdom).

## What FORGE imports (verified against the code, 2026-09-28)

| Format | Path in FORGE | In this library |
| --- | --- | --- |
| DXF (ASCII) | Full importer: layer roles, units, walls/doors/windows/rooms/annotations | yes |
| VSDX (Visio 2013+) | Full importer: masters → walls/openings/rooms/furniture, page scale | yes |
| PDF | Vector importer (paths → walls/annotations) + scanned page as background image | yes |
| PNG / JPEG | Background underlay only (no geometry) | no, nothing to measure |
| DWG | Refused on purpose, tells the user to export ASCII DXF | malformed-fake.dwg |
| GLB | Internal furniture models only, not a user import | no |
| SVG, VSSX, IFC, RVT, OBJ, SH3D, SKP | Not supported | future collection (below) |

## Files

| File | Role | Source / license |
| --- | --- | --- |
| `dxf/forge-test-house.dxf` | detailed | Original, `generators/make_forge_test_house.py` |
| `dxf/nortier-blocks1.dxf` | difficult | skymakerolof/dxf test fixture, MIT (Ben Nortier) |
| `dxf/malformed-truncated.dxf` | malformed | Original, `generators/make_malformed.py` |
| `dxf/malformed-fake.dwg` | malformed | Original, `generators/make_malformed.py` |
| `vsdx/forge-test-house.vsdx` | detailed | Original, `generators/make_forge_test_house_vsdx.py` |
| `vsdx/generic-diagram.vsdx` | difficult | Original, `generators/make_generic_diagram_vsdx.py` |
| `vsdx/malformed-not-a-zip.vsdx` | malformed | Original |
| `vsdx/malformed-missing-pages.vsdx` | malformed | Original |
| `pdf/forge-test-house-vector.pdf` | detailed (vector, true 1/4" = 1'-0") | Original |
| `pdf/habs-davenport-house-sheet1-scanned.pdf` | detailed (scanned) | HABS GA,26-SAV,6-, 1934, public domain (U.S. Government work) |
| `pdf/malformed-truncated.pdf` | malformed | Original |

Full provenance (URL at a pinned revision, author, license, license evidence, attribution,
sha256, size, reason) is in `manifest.json`. License texts are in `licenses/`.

## Rules for adding a file

1. **Provenance or it doesn't go in.** Pin the source URL to a revision, name the creator, and
   record the license **and the evidence** (license file, rights statement). "Found it online"
   is not evidence. Unknown origin → list it under External references instead.
2. Acceptable licenses: CC0 / public domain / U.S. Government work, MIT, BSD, Apache-2.0 (keep
   NOTICE), CC-BY (with attribution). No share-alike, non-commercial or "free for personal use".
3. Add the file to `manifest.json` with its sha256 and byte count; the manifest test fails on
   any unlisted file or checksum mismatch.
4. Original fixtures are generated, not hand-edited: change the generator and regenerate
   (`python generators/<script>.py`, needs ezdxf, matplotlib, img2pdf), then refresh the manifest.
5. Add expectations to the tests: counts, units/scale, the diagnostics shown, and
   save → reopen → validate for anything that imports.
6. Malformed files must fail **safely**: a clear refusal (error code + message), or an import
   that keeps the design valid. Never a crash, never a corrupted design.

## Baseline and known gaps (2026-09-28)

Known gaps are `it.fails` tests, written as the correct behaviour. They don't block anything; when
a fix makes one pass, vitest flags it and the fix flips it to `it`. Fixes are deliberately
**not** in this PR: the baseline across all three formats comes first.

| File | Today | Gap |
| --- | --- | --- |
| forge-test-house.dxf | inches detected; 16 walls; 5 named rooms; ~474×330 in; saves/reopens clean | **G1**: only 3 of 11 doors/windows land |
| nortier-blocks1.dxf | mm; 0 walls; annotations; "No layer is set to Walls" | none |
| malformed-truncated.dxf | imports what is there, design stays valid | **G2**: no "file is incomplete" warning |
| malformed-fake.dwg | refused: export as DXF | none |
| forge-test-house.vsdx | 19 walls; 5 named rooms; 4 furniture; 480×336 in | **G3**: 0 openings (doors/windows become annotations) |
| generic-diagram.vsdx | annotations only; skipped shapes reported | none |
| malformed-not-a-zip / missing-pages .vsdx | refused (`bad-zip` / `missing-part`) | none |
| forge-test-house-vector.pdf @ 1/4" | geometry imports at the right scale | **G4**: ~400 "walls", including the sheet border |
| habs-davenport scanned PDF | vector mode: 0 paths, points to the image path; image mode places a 3499×2676 px, 150 DPI underlay | none: **G5 fixed** (the decoders are served from `public/pdfjs/wasm/`; 5.4% ink, same as poppler) |
| malformed-truncated.pdf | refused (`unreadable`) | none |

### Bug briefs

- **G1: DXF openings drawn in wall gaps.** CAD plans draw doors and windows *in a gap* between
  wall segments (with jamb lines). FORGE only attaches an opening to a wall it lies on, so 8 of 11
  are dropped with "no wall close enough". Fix direction: bridge collinear wall segments across a
  gap that holds a door or window symbol, then cut the opening into the bridged wall.
- **G2: Truncated DXF isn't flagged.** A file cut mid-ENTITIES (no `EOF`) imports silently with part
  of the drawing missing. Fix direction: warn when the section/`EOF` structure is incomplete.
- **G3: VSDX openings.** Door/Window master shapes sitting in wall gaps become text annotations
  instead of openings. Same bridging fix as G1, fed by master names.
- **G4: PDF vector wall classification.** Every stroke of 6 in or longer at scale becomes a wall:
  furniture, dimensions, text strokes, hatch and the sheet border. Fix direction: detect
  paired parallel strokes (wall faces) and ignore the page-border rectangle; the rest become
  annotations.
- **G5 (FIXED): Scanned PDFs encoded as CCITT fax (and JBIG2 / JPEG 2000) rendered blank.** Fix: pdf.js's decoders are vendored to `public/pdfjs/wasm/` (with a sync test) and passed as `wasmUrl`, and a raster page that still renders pure white now raises a warning. pdf.js 5 decodes
  these with WebAssembly and needs `wasmUrl` in `getDocument`; `openDocument` in `pdfImporter.js`
  doesn't pass it, so pdf.js logs "JBig2 failed to initialize", skips the image, and FORGE places an
  all-white underlay with no warning. 1-bit CCITT is the usual encoding for scanned plan sheets. Verified:
  the same page with `wasmUrl` pointing at `pdfjs-dist/wasm/` renders 5.4% ink. Fix direction: pass a
  bundled `wasmUrl` (resolved like the worker, no CDN), and warn when a raster page comes back empty.
- **Units (external floorplan.dxf, below).** A DXF with a millimetre header drawn in inch-sized
  numbers imports 47"×34" instead of house-sized. The importer trusts `$INSUNITS`; a sanity check
  on the resulting extents (a "house" 4 ft wide) should prompt for the unit.

## External references (not bundled)

Useful files FORGE should handle, but which can't be redistributed here (unknown or incompatible
license). Download them locally for manual checks; never commit them.

- **floorplan.dxf** (circulating sample; third-party "Bishop-Overland" xref layers, origin unknown).
  Baseline: header says mm → plan lands 47"×34"; 6 walls; 1,255 annotations. Units brief above.
- **HABS TX sheet, 1992** (named contract delineator, rights unclear). Rejected in favour of the
  1934 Davenport sheet.
- **Apache POI VSDX test-data (bug/fuzz files in `apache/poi` `test-data/diagram/`).**
  Not usable, even the project's own license notwithstanding: these are files attached to bug
  reports, and neither the issue nor the commit that adds one to POI's test-data records who
  created the DIAGRAM'S CONTENT or whether they had the right to redistribute it — the reporter
  merely had a copy that reproduced a parser bug. `vsdx/generic-diagram.vsdx` (below) replaced
  the one fixture of this kind previously in this library (`poi-github260.vsdx`) for exactly this
  reason. Do not add another without source-specific content provenance, not just the hosting
  project's license.
- **Autodesk Revit sample projects** (RVT; Autodesk terms, not redistributable). Future: RVT/IFC.
- **SketchUp 3D Warehouse models** (SKP; per-model terms). Future: SKP.
- **Sweet Home 3D sample homes** (SH3D; check each file's license). Future: SH3D.
- **buildingSMART IFC sample files** (IFC; check per-repository license). Future: IFC.

## Future collection

When FORGE gains an importer for SVG, VSSX, IFC, SH3D, OBJ, RVT or SKP, give that format the same
three roles here (detailed, difficult, malformed), using the same provenance rules.
