// FB-UI-1 requirement 12: "Do not use or store personal passwords. Any preview authentication must
// be short-lived and narrowly scoped." This module never sees, accepts, or persists a password or a
// raw credential of any kind. It only *consumes* a Playwright storageState.json the owner already
// produced out-of-band (e.g. by signing in once, locally, as a seeded synthetic test user, then
// exporting the resulting browser storage state) -- see FB-UI-0's finding that no in-app preview-auth
// bypass exists and none should be built. If that file is missing, stale, or malformed, this fails
// closed (requirement 8) rather than falling back to any other credential source.
//
// "Short-lived" is enforced structurally, not just by convention: a storage-state file older than
// PREVIEW_SESSION_MAX_AGE_MS is rejected regardless of whether the session it contains would still
// technically be valid server-side. "Narrowly scoped" is the owner's responsibility when producing the
// file (sign in as a seeded synthetic test user, never a real borrower/tenant account, never the
// owner's own primary credential) -- this module has no way to inspect *whose* session a storageState
// file represents, only how old it is and whether it's shaped like one at all.

import { existsSync, readFileSync, statSync } from "node:fs";

export const PREVIEW_SESSION_ENV_VAR = "FB_UI_PREVIEW_STORAGE_STATE_PATH";
export const PREVIEW_SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export class PreviewAuthenticationUnavailableError extends Error {
  constructor(reasonCode, detail) {
    super(`Preview authentication is unavailable: ${detail}`);
    this.name = "PreviewAuthenticationUnavailableError";
    this.reasonCode = reasonCode;
  }
}

function fail(reasonCode, detail) {
  throw new PreviewAuthenticationUnavailableError(reasonCode, detail);
}

// `env` and `now` are injectable purely so tests can exercise every branch deterministically without
// mutating real process.env or waiting on a real clock; production callers omit both.
export function loadPreviewSession({ env = process.env, now = Date.now() } = {}) {
  const path = env[PREVIEW_SESSION_ENV_VAR];
  if (!path) fail("not_configured", `${PREVIEW_SESSION_ENV_VAR} is not set`);
  if (!existsSync(path)) fail("file_not_found", `no storage-state file at "${path}"`);

  const ageMs = now - statSync(path).mtimeMs;
  if (ageMs > PREVIEW_SESSION_MAX_AGE_MS) {
    fail("expired", `storage-state file is ${Math.round(ageMs / 1000)}s old, exceeds the ${PREVIEW_SESSION_MAX_AGE_MS / 1000}s short-lived limit`);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    fail("malformed", `storage-state file is not valid JSON (${cause.message})`);
  }
  if (!Array.isArray(parsed.cookies) && !Array.isArray(parsed.origins)) {
    fail("malformed", "storage-state file does not contain cookies or origins -- not a Playwright storageState");
  }

  // Deliberately does not return `parsed` or any cookie/session value -- only the path (already known
  // to the caller via the env var) and non-sensitive metadata, so nothing that calls this and logs its
  // result can accidentally leak session material.
  return Object.freeze({ storageStatePath: path, ageMs, validated: true });
}

// Resolves what a route needs and throws early (before any browser launch) if a route requires auth
// but no valid session is available -- the "authentication ... cannot be established" fail-closed gate
// from requirement 8, applied per-route rather than once globally, since not every approved route
// requires authentication (see routeAllowlist.mjs's public "home" route).
export function resolveAuthModeForRoute(route, { env = process.env, now = Date.now() } = {}) {
  if (!route.requiresAuth) return Object.freeze({ authMode: "none", storageStatePath: null });
  const session = loadPreviewSession({ env, now });
  return Object.freeze({ authMode: "synthetic-session", storageStatePath: session.storageStatePath });
}
