import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PREVIEW_SESSION_ENV_VAR, PREVIEW_SESSION_MAX_AGE_MS, PreviewAuthenticationUnavailableError,
  loadPreviewSession, resolveAuthModeForRoute,
} from "../previewSession.mjs";

let tempDir;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

function writeStorageState(contents) {
  tempDir = mkdtempSync(path.join(tmpdir(), "fb-ui-preview-session-"));
  const filePath = path.join(tempDir, "storageState.json");
  writeFileSync(filePath, JSON.stringify(contents));
  return filePath;
}

describe("loadPreviewSession", () => {
  it("fails closed when the env var is not set", () => {
    expect(() => loadPreviewSession({ env: {} })).toThrow(PreviewAuthenticationUnavailableError);
    try {
      loadPreviewSession({ env: {} });
    } catch (error) {
      expect(error.reasonCode).toBe("not_configured");
    }
  });

  it("fails closed when the configured file does not exist", () => {
    expect(() => loadPreviewSession({ env: { [PREVIEW_SESSION_ENV_VAR]: "/nonexistent/storageState.json" } }))
      .toThrow(/no storage-state file/);
  });

  it("fails closed when the file is present but too old (not short-lived)", () => {
    const filePath = writeStorageState({ cookies: [{ name: "sb-session", value: "x" }] });
    const now = Date.now() + PREVIEW_SESSION_MAX_AGE_MS + 60_000; // simulate the file being stale
    expect(() => loadPreviewSession({ env: { [PREVIEW_SESSION_ENV_VAR]: filePath }, now })).toThrow(/exceeds the/);
  });

  it("fails closed when the file is not valid JSON", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "fb-ui-preview-session-"));
    const filePath = path.join(tempDir, "storageState.json");
    writeFileSync(filePath, "{not valid json");
    expect(() => loadPreviewSession({ env: { [PREVIEW_SESSION_ENV_VAR]: filePath } })).toThrow(/not valid JSON/);
  });

  it("fails closed when the file is valid JSON but not storageState-shaped", () => {
    const filePath = writeStorageState({ some: "unrelated shape" });
    expect(() => loadPreviewSession({ env: { [PREVIEW_SESSION_ENV_VAR]: filePath } })).toThrow(/not a Playwright storageState/);
  });

  it("succeeds for a fresh, well-formed storageState file", () => {
    const filePath = writeStorageState({ cookies: [{ name: "sb-session", value: "x" }], origins: [] });
    const session = loadPreviewSession({ env: { [PREVIEW_SESSION_ENV_VAR]: filePath } });
    expect(session.validated).toBe(true);
    expect(session.storageStatePath).toBe(filePath);
  });

  it("never returns the actual cookie/session contents, only metadata", () => {
    const filePath = writeStorageState({ cookies: [{ name: "sb-session", value: "super-secret-session-token" }] });
    const session = loadPreviewSession({ env: { [PREVIEW_SESSION_ENV_VAR]: filePath } });
    expect(JSON.stringify(session)).not.toContain("super-secret-session-token");
  });
});

describe("resolveAuthModeForRoute", () => {
  it("returns authMode none for a route that does not require auth, without touching the filesystem", () => {
    const result = resolveAuthModeForRoute({ requiresAuth: false }, { env: {} });
    expect(result.authMode).toBe("none");
    expect(result.storageStatePath).toBeNull();
  });

  it("fails closed for a route that requires auth when no session is configured", () => {
    expect(() => resolveAuthModeForRoute({ requiresAuth: true }, { env: {} })).toThrow(PreviewAuthenticationUnavailableError);
  });

  it("returns authMode synthetic-session for an auth-required route with a valid session", () => {
    const filePath = writeStorageState({ cookies: [], origins: [] });
    const result = resolveAuthModeForRoute({ requiresAuth: true }, { env: { [PREVIEW_SESSION_ENV_VAR]: filePath } });
    expect(result.authMode).toBe("synthetic-session");
    expect(result.storageStatePath).toBe(filePath);
  });
});
