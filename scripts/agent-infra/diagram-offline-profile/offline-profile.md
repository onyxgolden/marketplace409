# FORGE offline diagram export profile

Explicit offline export profile for diagrams produced with the installed
`diagram-design` skill (v2.6, MIT; see INVENTORY.md). The skill itself is
**not modified**; this profile is a repo-side contract plus tooling.

## Profile settings

1. **Font source: `system`.** No Google Fonts `<link>` in HTML, no
   `@import` in exported SVG. Use the skill's `export_svg.py --system-fonts`.
2. **Zero network requests.** No CDN scripts, remote images, analytics,
   brand-website fetches, or remote rendering endpoints.
3. **No active content.** No `<script>` elements, no `on*` event-handler
   attributes, no executable URLs (`javascript:`, `data:text/html`).
4. **Untrusted imports.** Imported SVG/XML is parsed strictly: reject
   `<!ENTITY>`/internal DTD subsets, external references, and malformed XML.
5. **Bounds.** File ≤ 2 MB, ≤ 2,000 elements, nesting ≤ 64, any
   viewBox/width/height dimension ≤ 8,000 px.
6. **No private architecture in requests or logs.** The pipeline is fully
   local; tooling reports finding counts only, never file content.

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
