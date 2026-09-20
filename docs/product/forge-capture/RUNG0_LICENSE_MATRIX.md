# FORGE Capture — Rung 0 Dependency & License Matrix

**Date:** 2026-09-20 · Audit only; no code incorporated in this rung.

Conventions: **copied** = verbatim code in our tree · **adapted** = derived from
their code · **wrapped** = upstream package used as a dependency behind a narrow
adapter · **concept-only** = ideas inform our own implementation, no code or
dependency taken. `THIRD_PARTY_NOTICES.md` does not exist in the repo yet; it must
be created the first time anything is copied/adapted/wrapped.

## Part A — OpenAdapt repositories (audited 2026-09-20)

| Repo | Commit reviewed | License (as stated by repo) | Verdict | Top risk |
|---|---|---|---|---|
| openadapt-capture | `986ebaeae6700c58b0e523b54471ce8d3ef01925` (2026-09-14, verified via GitHub API) | MIT (spdx_id MIT; README badge) — permissive | **adapted** — only if a Python sidecar is chosen (not recommended); closest functional match for OS-level screen+input capture with frame-accurate timestamps | pynput is **LGPL-3.0** (fine as dynamic pip import; note before any frozen/static packaging). No GPL/AGPL in the package |
| openadapt-privacy | `a7cdcbd872e6263305f53b6ea1b778d76718c1cc` (2026-09-01, verified) | MIT (spdx_id MIT; README "License / MIT") — permissive | **wrapped** — PII/PHI redaction step (`scrub_text`/`scrub_dict`/`scrub_image`) before capture leaves the machine | Post-processing only ("anything OCR misses is not redacted"); OCR backend for `scrub_image` not named in README — verify before use |
| openadapt-flow | `cfea6ecd9540b78bafcdf6bb72887d61c2a59fc0` (2026-09-14, verified) | MIT for package code — permissive **with checkout caveat** | **concept-only** — deterministic-compile + independent-effect-verification is design inspiration for Rung 7; full RPA replay is out of scope | ⚠️ **AGPL-3.0-only** openIMIS reference env inside the git checkout. Never copy from a clone; install the PyPI wheel only (wheels exclude it) |
| openadapt-desktop | exact HEAD SHA not verified (fetch failed mid-audit); `pushed_at` 2026-09-19; nearest tag v0.16.0 at `7c59750d37be09a2871cd1bada8cb0bce946d363` | MIT (spdx_id MIT; README badge + "License / MIT") — permissive | **concept-only (reference architecture)** — the single most valuable repo strategically: working MIT example of the Tauri-shell + frozen-Python-sidecar + JSON-lines IPC + tray pattern, incl. sidecar lifecycle, loopback auth, and a `third_party/README.md` license-manifest practice | Their own README: **no trusted signed builds** — native releases blocked on macOS Developer ID/notarization, Windows Authenticode, Linux attestation. Confirms Rung 2 needs a signing decision first |
| OpenAdapt (monorepo) | exact HEAD SHA not verified; `pushed_at` 2026-09-14; launcher v1.16.0 at `089c27c046f5cd972d299361f9d68285c1896c71` | MIT (spdx_id MIT; release notes) — permissive | **not-recommended** — installer/CLI launcher with no capture or markup functionality of its own | Inherits Flow's AGPL-checkout caveat only if cloned |

All five are actively maintained (pushes in Sep 2026; none archived). None are Electron;
openadapt-desktop is the only Tauri/Rust code; the other four are Python-only.

### Transitive dependency inventory (for the two non-concept verdicts)

**openadapt-capture** (adapted-if-sidecar): pynput **LGPL-3.0** · mss (zlib) · av/PyAV
(BSD-3) · Pillow (HPND) · sounddevice (MIT) / soundfile (BSD-3) · SQLAlchemy (MIT) ·
loguru (MIT) · psutil (BSD-3). Optional: `openai-whisper` (MIT), `faster-whisper`
(MIT) — transcription packages; the OpenAI Whisper **API** mode is a network call and
is incompatible with local-first (flagged, not usable).

**openadapt-privacy** (wrapped): presidio-analyzer, presidio-anonymizer,
presidio-image-redactor (all **Apache-2.0**) · spaCy (MIT) · Pillow (HPND) ·
pydantic (MIT).

### FFmpeg (treated separately, per spec)

openadapt-capture's README is explicit: the wheel ships **no FFmpeg bytes**;
`capture install-ffmpeg` downloads a pinned **LGPL-2.1-or-later** build
(`--disable-gpl --disable-nonfree --disable-version3`), SHA-256-verified, invoked as
an external executable across a process boundary. License-safe as long as it is never
bundled or relicensed. FORGE Capture's position: **do not bundle FFmpeg** until
licensing and packaging are explicitly approved (Rung 4 gate); prefer
`MediaRecorder`/WebM in the browser and evaluate pure-Rust or MIT/Apache muxers first.

### Red-flag summary

- **AGPL-3.0-only:** openadapt-flow git checkout (openIMIS reference env). Rule: never
  copy from a clone; PyPI wheel only.
- **LGPL-3.0:** pynput (openadapt-capture). Acceptable as a dynamic import; reassess
  before any frozen/static sidecar packaging.
- **LGPL-2.1+:** external FFmpeg builds (opt-in download, not bundled — keep it so).
- **No GPL, no SSPL, no noncommercial, no source-available** found in any of the five
  repos' packages. License bytes for desktop/monorepo LICENSE files could not be
  re-fetched this turn — re-verify before copying any code from them.

## Part B — FORGE Capture's own planned dependencies

| Rung | Candidate dependency | License | Why needed | Status |
|---|---|---|---|---|
| 1 | none | — | Editor is Canvas 2D + platform APIs | ✅ no new deps |
| 3 | PDF-generation lib (shortlist: pdf-lib) | MIT | Guide export to PDF | evaluate at Rung 3 |
| 4 | WebM/MP4 muxer (shortlist: webm-muxer, mp4-muxer) | check at Rung 4 | Video export without FFmpeg | fresh audit required (spec) |
| 4 | GIF encoder (shortlist: gifenc) | MIT | GIF export | fresh audit required (spec) |
| 2+ | Tauri | MIT/Apache-2.0 | Standalone utility shell (primary product) | separate artifact, not app deps |
| 2 | (scrolling capture) none planned | — | Browser-assisted path uses DOM/platform APIs; image-based path uses Canvas 2D | evaluate at Rung 2; limitation doc is a deliverable |

**Not introduced:** FFmpeg, transcription packages, tldraw/fabric/konva, any LLM SDK.
The Rung 1 editor intentionally adds zero dependencies.

## License obligations if reuse happens

1. Create `THIRD_PARTY_NOTICES.md` at repo root; record exact upstream commit, license
   text, and which files were copied/adapted.
2. Copy the repo's `third_party/README.md` manifest practice (seen in
   openadapt-desktop): pinned sources + hashes.
3. Never rename-and-disguise copied code; keep provenance visible.
