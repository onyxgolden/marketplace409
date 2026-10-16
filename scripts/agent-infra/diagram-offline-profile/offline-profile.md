# FORGE offline diagram export profile

Explicit offline export profile for diagrams produced with the installed
`diagram-design` skill (v2.6, MIT; see INVENTORY.md). The skill itself is
**not modified**; this profile is a repo-side contract plus tooling.

## Closed policy

The checker and sanitizer enforce a small permitted markup/CSS/resource
subset and fail closed outside it (no blacklist). Admitted: HTML shell
elements (`html/head/title/body/style/link/meta`, basic text containers),
SVG diagram elements (`svg/g/defs/rect/circle/ellipse/line/polyline/
polygon/path/text/tspan/title/desc/use/style/image`), presentation
attributes, `data:image/` embeds, and same-document `#fragment` links.
Everything else -- `object`/`iframe`/`embed`, `script`, event-handler
attributes, `meta http-equiv`, remote URLs in any attribute or CSS
(including CSS-escaped spellings), non-`px` sizing -- is refused.

## Profile settings

1. **Font source: `system`.** No Google Fonts `<link>` in HTML, no
   `@import` in exported SVG. Use the skill's `export_svg.py --system-fonts`.
2. **Zero network requests.** No CDN scripts, remote images, analytics,
   brand-website fetches, or remote rendering endpoints.
3. **No active content.** No `<script>` elements, no `on*` event-handler
   attributes, no executable URLs (`javascript:`, `data:text/html`).
4. **Untrusted imports.** Imported SVG/XML is parsed strictly: reject
   `<!ENTITY>`/internal DTD subsets, any `<!DOCTYPE` in SVG, external
   references, and malformed XML.
5. **Bounds.** File ≤ 2 MB (enforced before reading), ≤ 2,000 elements,
   nesting ≤ 64 (strict stack validation; SVG parsed as XML), any
   rendered width/height/viewBox dimension ≤ 8,000 px covering raw
   attributes AND CSS declarations (escaped CSS is unescaped before
   inspection). Non-finite/non-positive dimensions and unsupported units
   (%, em, …) are rejected, not ignored.
6. **No private architecture in requests or logs.** The pipeline is fully
   local; tooling reports finding counts and fixed reason codes only --
   never file content, URLs, CSS text, attribute values, parser excerpts,
   or filenames/paths.

## Pipeline

```
generate (skill, font source = system)
  -> sanitize_offline.py            # strips any remote/font constructs
  -> export_svg.py --system-fonts   # skill tool, system fonts
  -> check_offline.py               # static conformance gate (exit 0/1)
  -> run_tests.py --network         # fixture suite + network-denied trace
```

`export_png.py` (skill, Playwright) may rasterize only after
`check_offline.py` passes; run with network denied and record the request
trace — acceptance requires zero attempted requests including export.

> Evidence note (2026-10-16): `run_tests.py --network` exercises
> Playwright SVG-element rasterization under a route-abort network deny,
> with rendered-label equality and non-zero `getBBox()` geometry checks
> after system-font substitution. It does NOT invoke the installed skill's
> `export_png.py`; that path is explicitly out of the tested claim.

## Backup / change documentation

No pre-existing repo profile existed, so there was nothing to back up.
The installed skill is untouched (hashes in INVENTORY.md). All changes in
this slice are new files under
`scripts/agent-infra/diagram-offline-profile/`; nothing else in the repo
is touched.

## Limitations

- The checker is a narrow diagram-output conformance check, not a
  replacement security scanner (per scope).
- Motion/animation markup is out of scope: the offline profile rejects
  `<script>` outright, so animated diagram templates are not offline-clean.
- PNG export needs a local Chromium; the network-denied trace is
  environment-dependent and must be re-run on any new machine.
