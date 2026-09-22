import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const createSignedUrl = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const { guardCaptureRequest } = vi.hoisted(() => ({ guardCaptureRequest: vi.fn() }));
vi.mock("../_lib/auth.js", () => ({ guardCaptureRequest }));

import { POST } from "./route.js";

const CAPTURE_ID = "123e4567-e89b-42d3-a456-426614174000";
const OWNER_ID = "owner_1";

// Minimal supabase-js query-chain mock. Terminal results are configured per
// test; every intermediate method returns the chain itself.
function makeQuery({ single = { data: null, error: null }, insertError = null } = {}) {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    maybeSingle: vi.fn(async () => single),
    insert: vi.fn(async () => ({ error: insertError })),
  };
  return q;
}

function authenticatedWith(queries) {
  from.mockImplementation((table) => {
    if (!queries[table]) throw new Error(`unexpected table: ${table}`);
    return queries[table];
  });
  return {
    user: { id: OWNER_ID },
    supabaseClient: { from, storage: { from: vi.fn(() => ({ createSignedUrl, upload, remove })) } },
  };
}

function uploadRequest({ captureId = CAPTURE_ID, file, fields = {} } = {}) {
  const form = new FormData();
  form.set("captureId", captureId);
  form.set("file", file || new File(["fake-bytes"], "capture.png", { type: "image/png" }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request("https://example.test/api/capture/upload", { method: "POST", body: form });
}

function pngFile(size) {
  return new File([new Uint8Array(size)], "capture.png", { type: "image/png" });
}

describe("capture upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.test/cap" }, error: null });
  });

  it("rejects unauthenticated callers before touching storage", async () => {
    const response = new Response(JSON.stringify({ error: "nope" }), { status: 401 });
    guardCaptureRequest.mockResolvedValue({ response });

    const result = await POST(uploadRequest());

    expect(result).toBe(response);
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads a new capture to the server-derived path and returns a signed URL", async () => {
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: makeQuery(),
      capture_library_audit_log: makeQuery(),
    }));
    upload.mockResolvedValue({ data: { path: "x" }, error: null });

    const result = await POST(uploadRequest({ fields: { title: "My capture", kind: "screenshot", width: "800", height: "600" } }));
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toMatchObject({ success: true, id: CAPTURE_ID, signedUrl: "https://signed.test/cap" });
    expect(body.duplicate).toBeUndefined();
    // Server-derived path: owner id + client UUID + validated extension. Never
    // anything the client supplied.
    expect(upload).toHaveBeenCalledWith(
      `${OWNER_ID}/capture/${CAPTURE_ID}.png`,
      expect.any(Uint8Array),
      { contentType: "image/png", upsert: false },
    );
    const insertArg = from.mock.results.find((r) => r.value?.insert).value.insert.mock.calls[0][0];
    expect(insertArg).toMatchObject({
      id: CAPTURE_ID, owner_id: OWNER_ID, title: "My capture", kind: "screenshot",
      mime_type: "image/png", width: 800, height: 600,
      storage_path: `${OWNER_ID}/capture/${CAPTURE_ID}.png`,
    });
  });

  it("records a metadata-only upload audit event", async () => {
    const auditQuery = makeQuery();
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: makeQuery(),
      capture_library_audit_log: auditQuery,
    }));
    upload.mockResolvedValue({ data: {}, error: null });

    await POST(uploadRequest());

    expect(auditQuery.insert).toHaveBeenCalledTimes(1);
    const audit = auditQuery.insert.mock.calls[0][0];
    expect(audit).toMatchObject({ owner_id: OWNER_ID, capture_id: CAPTURE_ID, action: "uploaded", actor_id: OWNER_ID });
    // Metadata only: no captured content, pixels, OCR, or filenames.
    expect(audit.detail).toEqual({ kind: "screenshot", mime_type: "image/png", byte_size: 10 });
    expect(JSON.stringify(audit)).not.toContain("capture.png");
  });

  it("returns the existing artifact with a fresh signed URL on idempotent retry", async () => {
    const existing = {
      id: CAPTURE_ID, title: "Old", kind: "screenshot", mime_type: "image/png",
      byte_size: 10, width: 100, height: 100, storage_path: `${OWNER_ID}/capture/${CAPTURE_ID}.png`,
      captured_at: null, created_at: "2026-09-22T00:00:00.000Z",
    };
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: makeQuery({ single: { data: existing, error: null } }),
      capture_library_audit_log: makeQuery(),
    }));

    const result = await POST(uploadRequest());
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toMatchObject({ success: true, id: CAPTURE_ID, signedUrl: "https://signed.test/cap", duplicate: true });
    expect(upload).not.toHaveBeenCalled();
    // Owner scoping: the lookup is always qualified by the actor's id.
    const lookup = from.mock.results[0].value;
    expect(lookup.eq).toHaveBeenCalledWith("owner_id", OWNER_ID);
    expect(lookup.eq).toHaveBeenCalledWith("id", CAPTURE_ID);
  });

  it("rejects a non-UUID captureId", async () => {
    guardCaptureRequest.mockResolvedValue(authenticatedWith({ capture_library: makeQuery() }));
    const result = await POST(uploadRequest({ captureId: "not-a-uuid" }));
    expect(result.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects a missing or empty file", async () => {
    guardCaptureRequest.mockResolvedValue(authenticatedWith({ capture_library: makeQuery() }));
    const form = new FormData();
    form.set("captureId", CAPTURE_ID);
    const result = await POST(new Request("https://example.test/api/capture/upload", { method: "POST", body: form }));
    expect(result.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects MIME types outside the allowlist", async () => {
    guardCaptureRequest.mockResolvedValue(authenticatedWith({ capture_library: makeQuery() }));
    const bad = new File(["x"], "cap.gif", { type: "image/gif" });
    const result = await POST(uploadRequest({ file: bad }));
    expect(result.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("enforces the 25 MB cap on both sides of the boundary", async () => {
    const atCap = makeQuery();
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: atCap,
      capture_library_audit_log: makeQuery(),
    }));
    upload.mockResolvedValue({ data: {}, error: null });

    const okResult = await POST(uploadRequest({ file: pngFile(25 * 1024 * 1024) }));
    expect(okResult.status).toBe(200);
    expect(upload).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: makeQuery(),
      capture_library_audit_log: makeQuery(),
    }));
    const overResult = await POST(uploadRequest({ file: pngFile(25 * 1024 * 1024 + 1) }));
    expect(overResult.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
    // No row and no audit event for the rejected upload.
    expect(from).not.toHaveBeenCalled();
  });

  it("accepts WebM recordings under the same cap", async () => {
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: makeQuery(),
      capture_library_audit_log: makeQuery(),
    }));
    upload.mockResolvedValue({ data: {}, error: null });
    const webm = new File(["x"], "rec.webm", { type: "video/webm" });

    const result = await POST(uploadRequest({ file: webm, fields: { kind: "recording" } }));
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(upload).toHaveBeenCalledWith(
      `${OWNER_ID}/capture/${CAPTURE_ID}.webm`, expect.any(Uint8Array),
      { contentType: "video/webm", upsert: false },
    );
    expect(body.success).toBe(true);
  });

  it("removes the storage object when the row insert fails and leaves no audit event", async () => {
    const auditQuery = makeQuery();
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: makeQuery({ insertError: new Error("db down") }),
      capture_library_audit_log: auditQuery,
    }));
    upload.mockResolvedValue({ data: {}, error: null });

    const result = await POST(uploadRequest());

    expect(result.status).toBe(500);
    expect(remove).toHaveBeenCalledWith([`${OWNER_ID}/capture/${CAPTURE_ID}.png`]);
    expect(auditQuery.insert).not.toHaveBeenCalled();
  });

  it("returns 500 when the storage upload itself fails, with no row written", async () => {
    const libraryQuery = makeQuery();
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: libraryQuery,
      capture_library_audit_log: makeQuery(),
    }));
    upload.mockResolvedValue({ data: null, error: new Error("bucket missing") });

    const result = await POST(uploadRequest());

    expect(result.status).toBe(500);
    expect(libraryQuery.insert).not.toHaveBeenCalled();
  });
});
