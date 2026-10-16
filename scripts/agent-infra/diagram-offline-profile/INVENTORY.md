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

## Builder evidence — full file hashes (sha256)

Recorded 2026-10-16 from the installed skill at
`~/workspace/custom-skills/diagram-design/` (not a git checkout, so no
revision is obtainable; hashes are the installation identity):

| File | sha256 |
|---|---|
| SKILL.md | `ec62ac28761324d58fab182c6eeaa58557c34db66b2ac76771ffc824517a30c4` |
| scripts/self_check.py | `4da309dc768c921153872715666859f4d2c3af384ec804b3d4159b549b7697ea` |
| scripts/export_svg.py | `f61fb56777067365f17dac7857609ca7a46b6dd794ec176c1a716adbcb971081` |
| scripts/export_png.py | `430ddcc2d39441808bd4217fbdeb944dbb6de0be281782705a81748986d7d348` |
| scripts/drawio_extract.py | `72098800fb5893ba620a432275b332901cfdbfa45bcd608c15d055466b25abe6` |
| scripts/mermaid_extract.py | `751d5eb38476e3b1f6176524a57cc4f30f9f8e55d0e05220921f4b7802d41cb4` |
| scripts/excalidraw_extract.py | `10f6a6b999b3b2e8a626774515ba6817df331a6d39d671a4876541262b63697c` |

## License attribution

The skill declares MIT in its SKILL.md frontmatter. This slice only
references its public CLI behavior (font-source setting, export flags) and
ships original FORGE-authored tooling; no skill files are copied into this
repo.
