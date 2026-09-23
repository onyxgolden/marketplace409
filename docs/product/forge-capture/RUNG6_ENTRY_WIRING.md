# FORGE Capture — Rung 6: "Entry Wiring" (web library + desktop deep link)

**Date:** 2026-09-22
**Status:** Implemented; PR against `main`.

Rung 6 wires the entry points around the Rung 5 capture library. The
library backend (table, bucket, upload/list/delete API, desktop upload
client) is unchanged. **No new tables, no new bucket, no migration.**

## What was built

- **Web library page** `src/app/forge/capture/library/page.js`
  - Behind the existing /auth gate (server component checks
    `createAuthenticatedForgeApplication`; unauthenticated → /auth).
  - `/forge/capture` stays the Rung 1 capture **editor** — the library
    lives at `/forge/capture/library` so the editor is untouched.
  - Honors `?capture=<id>` (the desktop app's deep link): scrolls to and
    highlights that item.
- **Grid** `src/components/forge/capture/CaptureLibraryGrid.jsx`
  - Thumbnail grid: screenshots via the API's 1-hour signed URLs
    (`loading="lazy"`); recordings show a kind badge — the grid never
    loads WebM bytes, no transcoding, no pipelines.
  - Per item: rename (inline edit → PATCH), download, delete.
  - Download re-reads the library to mint a **fresh** signed URL at read
    time, then opens it. Signed URLs are never persisted anywhere.
  - Empty state explains the library is opt-in: "How captures get here —
    nothing uploads automatically; captures are stored only when you press
    Save to FORGE in the desktop app."
  - Loads once on page visit. No polling, no background refresh.
- **PATCH /api/capture/library/[id]** — title-only rename.
  - Body allowlisted: only `title` accepted. Attempts to change
    `owner_id`, `storage_path`, `mime_type`, `kind`, `byte_size`, or
    `captured_at` → 400. Empty title → 400. Over 200 chars → 400
    (matches the column's `TITLE_MAX`).
  - Owner-scoped via the existing guard + `owner_id` equality; another
    owner's row is invisible → 404. No rename audit event (the audit
    table's action check constraint only permits `uploaded`/`deleted`,
    and a rename changes no stored bytes).
- **Desktop** (`forge-capture-app/`)
  - `libraryLink()` now deep-links to
    `/forge/capture/library?capture=<id>` (new `libraryPageUrl()` helper).
  - After "Save to FORGE" succeeds, the confirmation offers **View in
    FORGE** next to **Copy link**: opens the deep link in the OS default
    browser via the new `open_external_url` Tauri command. The editor
    stays open — no automatic navigation.
  - `open_external_url` allowlists the library page (with optional
    `?capture=` highlight); anything else is refused. Windows-only;
    other hosts fail closed, matching the Rung 5 pattern.
- **Incidental fix:** the `[id]` route handlers now `await params`
  (Next 15+ passes route params as a promise). The Rung 5 DELETE worked
  in tests but would have 400'd every id at runtime.

## Explicit non-goals (this rung)

- No share links, no share audit events, no public URLs.
- No automatic uploads, no background sync, no silent retries.
- No WebM playback in the grid (badge only); download plays/opens the
  original file in a new tab.
- No macOS/Linux browser-open (fail closed, documented).

## Verification

- Vitest: PATCH allowlist/owner-scope/401 tests, DELETE promise-params
  test, libraryClient data-layer tests, forge-upload deep-link tests.
- Rust unit tests incl. the URL allowlist; `cargo check` for the
  Windows target; clippy/fmt clean; ESLint clean on changed files.
