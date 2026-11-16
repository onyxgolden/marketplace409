# Third-Party Notices

This file records every third-party code artifact copied or vendored into
this repository, per the FORGE Capture Rung 0 license matrix
(`docs/product/forge-capture/RUNG0_LICENSE_MATRIX.md`). Dependencies
declared in `package.json` / `Cargo.toml` / `Cargo.lock` are not listed
here — their licenses are tracked by the package managers.

## gifenc — vendored ESM build

- **Vendored file:** `forge-capture-app/ui/vendor/gifenc.js`
- **Upstream:** https://github.com/mattdesl/gifenc
- **Version vendored:** 1.0.3 (byte-identical to the `dist/gifenc.esm.js`
  shipped in the npm package, minus the `sourceMappingURL` comment)
- **License:** MIT (as stated in the package's `package.json`;
  re-verified via the npm registry 2026-09-22)
- **Use:** `wrapped` — GIF frame encoding for Rung 4 recording GIF export,
  behind the narrow `encodeGifFrames` adapter in
  `forge-capture-app/ui/record-core.js`. The Tauri webview has no bundler,
  so the ESM build is vendored as a plain module script.
- **Patent note:** GIF's LZW patents expired in 2003–2004; no remaining
  patent exposure. See
  `docs/product/forge-capture/RUNG4_ENCODER_LICENSE_AUDIT.md`.

## Pagus + fast-xml-parser — vendored esbuild bundle (Capture Phase 3 Slice 1)

- **Vendored file:** `forge-capture-app/ui/vendor/pptx.bundle.mjs`
- **Upstream:** https://github.com/pagus-kit/Pagus
  (`@pagus-kit/core` 0.1.1, `@pagus-kit/renderer` 0.1.1) and
  https://github.com/NaturalIntelligence/fast-xml-parser
  (`fast-xml-parser` 5.12.1, re-exported as `XMLParser` only)
- **Version vendored:** Pagus 0.1.1, fast-xml-parser 5.12.1, JSZip 3.10.2,
  fast-xml-parser's own transitive code — all resolved from the npm
  registry 2026-11-15
- **License:** MIT for Pagus core/renderer and fast-xml-parser (as stated
  in each package's `package.json`); JSZip is dual-licensed
  "MIT OR GPL-3.0-or-later" and is used under its MIT choice only.
  No copyleft code is exercised: the bundle contains no GPL-licensed
  path. Re-verify via the npm registry when re-vendoring.
- **Build (reproducible, one-time):** from an empty directory,
  `npm install @pagus-kit/core@0.1.1 @pagus-kit/renderer@0.1.1
  fast-xml-parser@5.12.1`, then esbuild 0.28.2
  `entry.js --bundle --format=esm --outfile=pptx.bundle.mjs` where
  `entry.js` re-exports exactly `parse` (core), `renderSlide`
  (renderer), and `XMLParser` (fast-xml-parser). Output is readable,
  not minified. SHA-256 of the vendored file:
  `0741b3d1c5167c0ab68f83381e32cad34db49c3397e0749fcb3c9c20ec5ef955`.
- **Use:** PPTX parsing and per-slide SVG rendering for the Create-video
  workflow (`forge-capture-app/ui/pptx-render-core.js`), behind the
  narrow `renderPresentation` adapter. The Tauri webview has no
  bundler, so the bundle is vendored as a plain module script.
- **Network note (verified at vendoring time):** the bundle contains no
  `fetch(` call and no `googleapis` reference — Pagus's Google Fonts
  URL builder (`getFontUrl`/`generateFontCss`) is tree-shaken out
  because Capture never imports it. Fonts resolve to local installed
  fonts only, with a documented Segoe UI/Arial fallback
  (`pptx-render-core.js`); no font is ever fetched.
- **Scope note:** Pagus is a renderer candidate qualified by fixture
  in Slice 1, not an assumed-perfect renderer. Known fidelity gaps
  are recorded in `forge-capture-app/docs/pptx-video-slice1.md`.

## fflate — vendored ESM build (Capture Phase 3 Slice 1)

- **Vendored file:** `forge-capture-app/ui/vendor/fflate.mjs`
- **Upstream:** https://github.com/101arrowz/fflate
- **Version vendored:** 0.8.3 (byte-identical to the `esm/browser.js`
  shipped in the npm package; same version already declared in the
  repo root `package.json`)
- **License:** MIT (as stated in the package's `package.json`)
- **SHA-256 of the vendored file:**
  `b7ca4450b19559a1d50eb381adcee94b82449674be4cd17789d9beba7e6122a1`
- **Use:** streaming DEFLATE for the bounded PPTX/ZIP reader
  (`forge-capture-app/ui/pptx-import-core.js`). The file is a
  self-contained ESM module with no imports, so it is vendored
  verbatim as a plain module script.
