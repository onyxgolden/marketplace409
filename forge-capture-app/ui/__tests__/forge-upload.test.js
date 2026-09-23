// Tests for forge-capture-app/ui/forge-upload.js — Rung 5 "Save to FORGE".
// DOM-free pure logic only: session handling, fail-closed behavior, upload
// payload building, and the single-shot upload contract. fetch/invoke are
// mocked; no network, no Tauri.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ForgeUploadError,
  buildUploadForm,
  getUsableSession,
  isCaptureId,
  isSessionExpired,
  libraryLink,
  libraryPageUrl,
  newCaptureId,
  parseSession,
  refreshSession,
  resolveBaseUrl,
  signInWithPassword,
  uploadCapture,
} from "../forge-upload.js";

const CAPTURE_ID = "123e4567-e89b-42d3-a456-426614174000";
const BASE_URL = "https://forge.test";

function okJson(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe("resolveBaseUrl", () => {
  it("defaults to the FORGE production origin", () => {
    expect(resolveBaseUrl()).toBe("https://409marketplace.online");
  });
});

describe("capture ids", () => {
  it("generates UUIDs the server accepts", () => {
    expect(isCaptureId(newCaptureId())).toBe(true);
  });
  it("rejects non-UUIDs", () => {
    expect(isCaptureId("nope")).toBe(false);
    expect(isCaptureId("")).toBe(false);
    expect(isCaptureId(null)).toBe(false);
  });
});

describe("parseSession", () => {
  const fresh = () =>
    JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600 });

  it("parses a stored session", () => {
    const s = parseSession(fresh());
    expect(s.accessToken).toBe("a");
    expect(s.refreshToken).toBe("r");
  });
  it("fails closed on missing, garbage, or token-less input", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession("")).toBeNull();
    expect(parseSession("{oops")).toBeNull();
    expect(parseSession(JSON.stringify({ refresh_token: "r" }))).toBeNull();
  });
});

describe("isSessionExpired", () => {
  it("treats an expired session as expired", () => {
    expect(isSessionExpired({ accessToken: "a", expiresAt: 1 })).toBe(true);
  });
  it("treats a fresh session as usable", () => {
    expect(
      isSessionExpired({ accessToken: "a", expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
    ).toBe(false);
  });
  it("treats a missing session as expired", () => {
    expect(isSessionExpired(null)).toBe(true);
  });
});

describe("signInWithPassword", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("exchanges credentials directly with Supabase Auth and stores the session", async () => {
    const invoke = vi.fn(async () => null);
    global.fetch
      .mockResolvedValueOnce(okJson({ supabaseUrl: "https://sb.test", supabaseAnonKey: "anon" }))
      .mockResolvedValueOnce(
        okJson({ access_token: "tok", refresh_token: "ref", expires_in: 3600 }),
      );

    const session = await signInWithPassword({ invoke, baseUrl: BASE_URL, email: "j@x.test", password: "pw" });

    expect(session.accessToken).toBe("tok");
    // Public anon key as the apikey header; password only ever goes to
    // Supabase Auth, never to a FORGE endpoint.
    const tokenCall = global.fetch.mock.calls[1];
    expect(tokenCall[0]).toBe("https://sb.test/auth/v1/token?grant_type=password");
    expect(tokenCall[1].headers.apikey).toBe("anon");
    expect(JSON.parse(tokenCall[1].body).password).toBe("pw");
    // Tauri arg names match exactly: the Rust param is `sessionJson`.
    expect(invoke).toHaveBeenCalledWith("forge_session_set", { sessionJson: expect.any(String) });
    const stored = JSON.parse(invoke.mock.calls[0][1].sessionJson);
    expect(stored.access_token).toBe("tok");
  });

  it("rejects bad credentials without storing anything", async () => {
    const invoke = vi.fn();
    global.fetch
      .mockResolvedValueOnce(okJson({ supabaseUrl: "https://sb.test", supabaseAnonKey: "anon" }))
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });

    await expect(
      signInWithPassword({ invoke, baseUrl: BASE_URL, email: "j@x.test", password: "bad" }),
    ).rejects.toMatchObject({ code: "auth" });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("getUsableSession", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("fails closed: no stored session means no session and no network", async () => {
    const invoke = vi.fn(async () => null);
    const session = await getUsableSession({ invoke, baseUrl: BASE_URL });
    expect(session).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns a fresh stored session without refreshing", async () => {
    const json = JSON.stringify({
      access_token: "tok",
      refresh_token: "ref",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    const invoke = vi.fn(async () => json);
    const session = await getUsableSession({ invoke, baseUrl: BASE_URL });
    expect(session.accessToken).toBe("tok");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refreshes once when the stored session is expired", async () => {
    const stale = JSON.stringify({ access_token: "old", refresh_token: "ref", expires_at: 1 });
    const invoke = vi.fn(async () => stale);
    global.fetch
      .mockResolvedValueOnce(okJson({ supabaseUrl: "https://sb.test", supabaseAnonKey: "anon" }))
      .mockResolvedValueOnce(okJson({ access_token: "new", refresh_token: "ref2", expires_in: 3600 }));

    const session = await getUsableSession({ invoke, baseUrl: BASE_URL });

    expect(session.accessToken).toBe("new");
    expect(invoke).toHaveBeenCalledWith("forge_session_set", { sessionJson: expect.any(String) });
  });
});

describe("refreshSession", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("clears a dead session and reports expiry when refresh fails", async () => {
    const invoke = vi.fn(async () => null);
    global.fetch
      .mockResolvedValueOnce(okJson({ supabaseUrl: "https://sb.test", supabaseAnonKey: "anon" }))
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    await expect(
      refreshSession({ invoke, baseUrl: BASE_URL, session: { accessToken: "old", refreshToken: "ref", expiresAt: 1 } }),
    ).rejects.toMatchObject({ code: "expired" });
    expect(invoke).toHaveBeenCalledWith("forge_session_clear");
  });
});

describe("buildUploadForm", () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it("builds a valid multipart body with the client UUID", () => {
    const form = buildUploadForm({
      bytes, mime: "image/png", kind: "screenshot", title: "T",
      width: 800, height: 600, captureId: CAPTURE_ID,
    });
    expect(form.get("captureId")).toBe(CAPTURE_ID);
    expect(form.get("kind")).toBe("screenshot");
    expect(form.get("title")).toBe("T");
    expect(form.get("width")).toBe("800");
    const file = form.get("file");
    expect(file.size).toBe(3);
    expect(file.type).toBe("image/png");
  });

  it("rejects a missing capture id, bad MIME, empty bytes, and oversize payloads", () => {
    expect(() => buildUploadForm({ bytes, mime: "image/png", captureId: "nope" })).toThrowError(ForgeUploadError);
    expect(() => buildUploadForm({ bytes, mime: "image/gif", captureId: CAPTURE_ID })).toThrowError(/PNG, JPEG/);
    expect(() => buildUploadForm({ bytes: new Uint8Array(0), mime: "image/png", captureId: CAPTURE_ID })).toThrowError(/empty/);
    expect(() =>
      buildUploadForm({ bytes: new Uint8Array(25 * 1024 * 1024 + 1), mime: "image/png", captureId: CAPTURE_ID }),
    ).toThrowError(/25 MB/);
  });
});

describe("uploadCapture", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  function form() {
    return buildUploadForm({ bytes: new Uint8Array([1]), mime: "image/png", captureId: CAPTURE_ID });
  }

  it("sends exactly one POST with the Bearer token and never retries silently", async () => {
    global.fetch.mockResolvedValueOnce(okJson({ success: true, id: CAPTURE_ID, signedUrl: "https://s.test" }));
    const session = { accessToken: "tok", refreshToken: "r", expiresAt: 0 };

    const result = await uploadCapture({ baseUrl: BASE_URL, session, form: form() });

    expect(result).toMatchObject({ id: CAPTURE_ID, signedUrl: "https://s.test" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/capture/upload`);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("refuses to upload without a session", async () => {
    await expect(uploadCapture({ baseUrl: BASE_URL, session: null, form: form() })).rejects.toMatchObject({
      code: "signin",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("maps a 401 to session expiry so the UI can offer sign-in", async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "bad" }) });
    const session = { accessToken: "tok", refreshToken: "r", expiresAt: 0 };
    await expect(uploadCapture({ baseUrl: BASE_URL, session, form: form() })).rejects.toMatchObject({ code: "expired" });
  });

  it("reports cancellation distinctly from failure", async () => {
    const abort = new DOMException("aborted", "AbortError");
    global.fetch.mockRejectedValueOnce(abort);
    const session = { accessToken: "tok", refreshToken: "r", expiresAt: 0 };
    await expect(uploadCapture({ baseUrl: BASE_URL, session, form: form() })).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("libraryLink", () => {
  it("builds the deep link for a library entry id", () => {
    expect(libraryLink(BASE_URL, CAPTURE_ID)).toBe(`${BASE_URL}/forge/capture/library?capture=${CAPTURE_ID}`);
  });

  it("points at the Rung 6 library page, not the capture editor", () => {
    expect(libraryPageUrl(BASE_URL)).toBe(`${BASE_URL}/forge/capture/library`);
    expect(libraryLink(BASE_URL, CAPTURE_ID).startsWith(libraryPageUrl(BASE_URL))).toBe(true);
  });
});
