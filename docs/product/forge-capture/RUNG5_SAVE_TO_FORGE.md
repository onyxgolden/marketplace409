# FORGE Capture — Rung 5: "Save to FORGE" (opt-in capture library upload)

**Date:** 2026-09-22
**Status:** Implemented; PR against `main`. Migration approved by Jason 2026-09-22 ("Do it.").

Rung 5 adds the **optional FORGE destination** to the standalone capture
utility. Local-first behavior is unchanged: captures stay on disk, and
nothing uploads unless the user explicitly presses **Save to FORGE** on a
capture. There are no background uploads, no auto-sync, and no silent
retries.

## What was built

- **Migration** `supabase/migrations/20260922040007_capture_library.sql`
  - `capture_library` — one row per saved capture (`id`, `owner_id`, title,
    kind `screenshot|recording`, MIME, byte size, dimensions, storage path,
    timestamps). Owner-scoped RLS (`auth.uid()::text`), SELECT/INSERT/UPDATE/DELETE.
  - Private `capture-library` bucket — 25 MB cap, PNG/JPEG/WebM only, never
    public, owner-folder storage policies.
  - `capture_library_audit_log` — metadata-only events (`uploaded`, `deleted`).
    Deliberately no FK to `capture_library` so delete events survive row
    deletion. **No share links and no share audit events in this rung.**
- **API** (`src/app/api/capture/`)
  - `POST /api/capture/upload` — Bearer-token guard (desktop client) with
    cookie-auth fallback (browser callers). Validates UUID, file, MIME, size;
    server-derived storage path; idempotent retry by capture UUID; storage
    cleanup on DB failure; metadata-only upload audit.
  - `GET /api/capture/library` — owner-scoped, newest first, 100-row limit,
    1-hour signed URLs (storage paths never leak).
  - `DELETE /api/capture/library/[id]` — idempotent, DB row then storage
    object, metadata-only delete audit.
  - `GET /api/capture/config` — public Supabase URL + anon key for the
    desktop sign-in dialog (public browser-bundle values, not secrets).
- **Desktop** (`forge-capture-app/`)
  - `ui/forge-upload.js` — framework-neutral upload client + connect dialog +
    per-item save flow. Unit-tested (`ui/__tests__/forge-upload.test.js`).
  - `app/src/session_store.rs` — OS credential storage (Windows Credential
    Manager via Cred*W; see below). Tauri commands
    `forge_session_get/set/clear`.
  - `app/src/main.rs` — `get_capture_upload_payload` (base64 raster + MIME,
    25 MB pre-check before IPC) and `copy_text_to_clipboard` (Windows).
  - **Save to FORGE** button on every screenshot and recording, next to
    Export.

## Sign-in path

1. The button label is honest up front: **"Sign in to FORGE"** when no
   session is stored, **"Save to FORGE"** when one is.
2. Sign-in is email/password, performed **directly against Supabase Auth
   REST** by the app — the password never touches FORGE servers. The public
   Supabase URL + anon key come from `GET /api/capture/config`.
3. On success the session JSON (`access_token`, `refresh_token`,
   `expires_at`) is stored in the **OS credential store** via
   `forge_session_set`. The email and password are never persisted.
4. Expired sessions refresh once via the refresh token; a dead session is
   cleared and the UI falls back to the sign-in dialog.

## Credential storage

- **Windows:** Windows Credential Manager, target name
  `FORGE Capture / FORGE session` (stable — renaming it orphans the stored
  session). 8 KiB blob cap; empty/oversized values rejected before touching
  the OS.
- **macOS / Linux:** not implemented — the app has no portable keystore
  dependency and the product is Windows-first. These hosts **fail closed**:
  `forge_session_get` errors, the button shows "Sign in to FORGE", and no
  upload is attempted. No plaintext fallback file is ever written.
- Session tokens are never stored in plaintext files.

## Upload flow

1. User presses **Save to FORGE** → session checked (fail closed).
2. A client-generated capture UUID is created once and reused for the
   item's lifetime.
3. One multipart POST to `/api/capture/upload` (Bearer token, `captureId`,
   kind, dimensions, file). Progress shows **Uploading…**; the button
   becomes **Cancel** (AbortController).
4. **Success:** "Saved ✓" + confirmation with the library entry id + a
   **Copy link** button. The link is
   `https://409marketplace.online/forge/capture?capture=<id>` — a deep link;
   the web library view ships in a later rung, so the app copies the link
   rather than navigating to a page that does not exist yet.
5. **Failure:** error shown, button returns to Save to FORGE. Retry is
   **manual only** and reuses the same capture UUID, so the server returns
   the existing artifact instead of duplicating it.

## Explicit non-goals (this rung)

- No share links, no share audit events, no public URLs.
- No web library UI (API only).
- No automatic uploads, no background sync, no silent retries.
- No WebP (server allowlist is PNG/JPEG/WebM; the client reports the real
  MIME and the server rejects anything else with a clear 400).
- No macOS Keychain / Linux Secret Service yet (fail closed, documented).
