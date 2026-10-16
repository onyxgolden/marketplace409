# Installed diagram-design skill — inventory

Inventoried 2026-10-16 for the FORGE offline export profile. The skill is
**not reinstalled, replaced, or modified** by this slice.

| Field | Value |
|---|---|
| Installed path | `~/workspace/custom-skills/diagram-design/` |
| Declared name | `diagram-design` |
| Declared version | `2.6` (SKILL.md frontmatter) |
| Declared license | MIT |
| File count | 287 |
| Disk size | 5.7 MB |
| Key script hashes (sha256, first 16 hex) | `SKILL.md ec62ac28761324d5` · `scripts/self_check.py 4da309dc768c9211` · `scripts/export_svg.py f61fb56777067365` · `scripts/export_png.py 430ddcc2d3944180` · `scripts/drawio_extract.py 72098800fb5893ba` · `scripts/mermaid_extract.py 751d5eb38476e3b1` · `scripts/excalidraw_extract.py 10f6a6b999b3b2e8` |

## What the installed skill already provides (offline-relevant)

- **Font source `system`** (references/style-guide.md § Font source): omits the
  Google Fonts `<link>` entirely; font stacks end in generic families so
  viewers fall back to system faces. Zero network requests in this mode.
- **`export_svg.py --system-fonts`**: skips the Google Fonts `@import` in
  exported SVG.
- **`self_check.py --offline`**: fails if the Google Fonts link is still present.
- **`lint-render.py` with network blocked** (per style guide): every shipped
  template/example is already checked in system-font fallback rendering.

## What the installed skill does NOT provide (this slice's gap)

- No explicit named offline export profile (the flags above are opt-in and
  scattered across references).
- No static checker that rejects CDN scripts, remote images, analytics,
  event handlers, inline scripts, entity expansion, executable URLs, or
  enforces dimension/node/byte/nesting bounds.
- `self_check.py`'s default mode **explicitly permits the approved Google
  Fonts stylesheet** ("single-file safety rules"), and upstream PRIVACY.md
  explicitly allows external font loading in generated exports — so the
  upstream privacy statement cannot substitute for the offline acceptance
  check.

## License attribution

The skill declares MIT in its SKILL.md frontmatter. This slice only
references its public CLI behavior (font-source setting, export flags) and
ships original FORGE-authored tooling; no skill files are copied into this
repo.
