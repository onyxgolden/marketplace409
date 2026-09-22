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
