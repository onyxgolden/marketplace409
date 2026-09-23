import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const remove = vi.fn();
const { guardCaptureRequest } = vi.hoisted(() => ({ guardCaptureRequest: vi.fn() }));
vi.mock("../../_lib/auth.js", () => ({ guardCaptureRequest }));

import { DELETE, PATCH } from "./route.js";

const CAPTURE_ID = "123e4567-e89b-42d3-a456-426614174000";
const OWNER_ID = "owner_1";
const STORAGE_PATH = `${OWNER_ID}/capture/${CAPTURE_ID}.png`;

function authenticatedWith(queries) {
  from.mockImplementation((table) => {
    if (!queries[table]) throw new Error(`unexpected table: ${table}`);
    return queries[table];
  });
  return {
    user: { id: OWNER_ID },
    supabaseClient: { from, storage: { from: vi.fn(() => ({ remove })) } },
  };
}

// Awaitable chain: .delete().eq().eq() resolves to the configured result.
function makeDeleteQuery({ lookup = { data: null, error: null }, deleteError = null } = {}) {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    maybeSingle: vi.fn(async () => lookup),
    insert: vi.fn(async () => ({ error: null })),
    delete: vi.fn(() => q),
    then: null,
  };
  q.then = (resolve) => resolve({ error: deleteError });
  return q;
}

const deleteRequest = () =>
  new Request(`https://example.test/api/capture/library/${CAPTURE_ID}`, { method: "DELETE" });

describe("capture library delete route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    remove.mockResolvedValue({ data: {}, error: null });
  });

  it("rejects unauthenticated callers", async () => {
    const response = new Response(JSON.stringify({ error: "nope" }), { status: 401 });
    guardCaptureRequest.mockResolvedValue({ response });
    const result = await DELETE(deleteRequest(), { params: { id: CAPTURE_ID } });
    expect(result).toBe(response);
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes the row and the storage object, then records a delete audit event", async () => {
    const row = { id: CAPTURE_ID, storage_path: STORAGE_PATH, byte_size: 42, mime_type: "image/png" };
    const libraryQuery = makeDeleteQuery({ lookup: { data: row, error: null } });
    const auditQuery = makeDeleteQuery();
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: libraryQuery,
      capture_library_audit_log: auditQuery,
    }));

    const result = await DELETE(deleteRequest(), { params: { id: CAPTURE_ID } });
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toEqual({ success: true });
    // Owner scoping on both the lookup and the delete.
    expect(libraryQuery.eq).toHaveBeenCalledWith("owner_id", OWNER_ID);
    expect(libraryQuery.eq).toHaveBeenCalledWith("id", CAPTURE_ID);
    expect(libraryQuery.delete).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(auditQuery.insert).toHaveBeenCalledTimes(1);
    const audit = auditQuery.insert.mock.calls[0][0];
    expect(audit).toMatchObject({
      owner_id: OWNER_ID, capture_id: CAPTURE_ID, action: "deleted", actor_id: OWNER_ID,
    });
    expect(audit.detail).toEqual({ mime_type: "image/png", byte_size: 42 });
  });

  it("succeeds idempotently when the capture is already gone", async () => {
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: makeDeleteQuery(),
      capture_library_audit_log: makeDeleteQuery(),
    }));

    const result = await DELETE(deleteRequest(), { params: { id: CAPTURE_ID } });
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(remove).not.toHaveBeenCalled();
  });

  it("cannot see or delete another owner's capture id", async () => {
    const libraryQuery = makeDeleteQuery(); // lookup returns null → not visible
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: libraryQuery,
      capture_library_audit_log: makeDeleteQuery(),
    }));

    const result = await DELETE(deleteRequest(), { params: { id: CAPTURE_ID } });
    const body = await result.json();

    expect(body).toEqual({ success: true });
    expect(libraryQuery.eq).toHaveBeenCalledWith("owner_id", OWNER_ID);
    expect(libraryQuery.delete).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID id without touching storage", async () => {
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: makeDeleteQuery(),
      capture_library_audit_log: makeDeleteQuery(),
    }));

    const result = await DELETE(deleteRequest(), { params: { id: "nope" } });

    expect(result.status).toBe(400);
    expect(remove).not.toHaveBeenCalled();
  });

  it("still reports success if the storage object is already gone", async () => {
    const row = { id: CAPTURE_ID, storage_path: STORAGE_PATH, byte_size: 1, mime_type: "image/png" };
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: makeDeleteQuery({ lookup: { data: row, error: null } }),
      capture_library_audit_log: makeDeleteQuery(),
    }));
    remove.mockResolvedValue({ data: null, error: new Error("not found") });

    const result = await DELETE(deleteRequest(), { params: { id: CAPTURE_ID } });
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toEqual({ success: true });
  });
});

// Awaitable chain: .update().eq().eq().select().maybeSingle() resolves to
// the configured result.
function makePatchQuery({ row = null, updateError = null } = {}) {
  const q = {
    update: vi.fn(() => q),
    eq: vi.fn(() => q),
    select: vi.fn(() => q),
    maybeSingle: vi.fn(async () => ({ data: row, error: updateError })),
  };
  return q;
}

const patchRequest = (body) =>
  new Request(`https://example.test/api/capture/library/${CAPTURE_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("capture library rename route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("rejects unauthenticated callers", async () => {
    const response = new Response(JSON.stringify({ error: "nope" }), { status: 401 });
    guardCaptureRequest.mockResolvedValue({ response });
    const result = await PATCH(patchRequest({ title: "New" }), { params: { id: CAPTURE_ID } });
    expect(result).toBe(response);
  });

  it("renames with a title-only body, owner-scoped", async () => {
    const patchQuery = makePatchQuery({ row: { id: CAPTURE_ID, title: "Renamed" } });
    guardCaptureRequest.mockResolvedValue(authenticatedWith({ capture_library: patchQuery }));

    const result = await PATCH(patchRequest({ title: "  Renamed  " }), { params: { id: CAPTURE_ID } });
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toEqual({ success: true, id: CAPTURE_ID, title: "Renamed" });
    // Title is trimmed server-side; only `title` is written.
    expect(patchQuery.update).toHaveBeenCalledWith({ title: "Renamed" });
    expect(patchQuery.eq).toHaveBeenCalledWith("owner_id", OWNER_ID);
    expect(patchQuery.eq).toHaveBeenCalledWith("id", CAPTURE_ID);
  });

  it("accepts params as a promise (Next 15+ runtime shape)", async () => {
    const patchQuery = makePatchQuery({ row: { id: CAPTURE_ID, title: "P" } });
    guardCaptureRequest.mockResolvedValue(authenticatedWith({ capture_library: patchQuery }));

    const result = await PATCH(patchRequest({ title: "P" }), { params: Promise.resolve({ id: CAPTURE_ID }) });

    expect(result.status).toBe(200);
  });

  it("rejects attempts to change owner_id, storage_path, mime_type, kind, byte_size, or captured_at", async () => {
    const patchQuery = makePatchQuery({ row: { id: CAPTURE_ID, title: "x" } });
    guardCaptureRequest.mockResolvedValue(authenticatedWith({ capture_library: patchQuery }));

    for (const forbidden of ["owner_id", "storage_path", "mime_type", "kind", "byte_size", "captured_at"]) {
      const result = await PATCH(patchRequest({ title: "x", [forbidden]: "evil" }), {
        params: { id: CAPTURE_ID },
      });
      expect(result.status).toBe(400);
      const body = await result.json();
      expect(body.error).toMatch(/only the title/i);
    }
    expect(patchQuery.update).not.toHaveBeenCalled();
  });

  it("rejects an empty or missing title", async () => {
    const patchQuery = makePatchQuery({ row: { id: CAPTURE_ID, title: "x" } });
    guardCaptureRequest.mockResolvedValue(authenticatedWith({ capture_library: patchQuery }));

    for (const body of [{ title: "" }, { title: "   " }, {}]) {
      const result = await PATCH(patchRequest(body), { params: { id: CAPTURE_ID } });
      expect(result.status).toBe(400);
    }
    expect(patchQuery.update).not.toHaveBeenCalled();
  });

  it("rejects a title longer than 200 characters", async () => {
    const patchQuery = makePatchQuery({ row: { id: CAPTURE_ID, title: "x" } });
    guardCaptureRequest.mockResolvedValue(authenticatedWith({ capture_library: patchQuery }));

    const result = await PATCH(patchRequest({ title: "t".repeat(201) }), { params: { id: CAPTURE_ID } });

    expect(result.status).toBe(400);
    const body = await result.json();
    expect(body.error).toMatch(/200/);
    expect(patchQuery.update).not.toHaveBeenCalled();
  });

  it("returns 404 for another owner's capture id without updating anything", async () => {
    const patchQuery = makePatchQuery({ row: null }); // RLS + owner eq → not visible
    guardCaptureRequest.mockResolvedValue(authenticatedWith({ capture_library: patchQuery }));

    const result = await PATCH(patchRequest({ title: "Mine now" }), { params: { id: CAPTURE_ID } });
    const body = await result.json();

    expect(result.status).toBe(404);
    expect(body.error).toMatch(/not found/i);
    expect(patchQuery.eq).toHaveBeenCalledWith("owner_id", OWNER_ID);
  });

  it("rejects a non-UUID id without touching the database", async () => {
    const patchQuery = makePatchQuery({ row: { id: CAPTURE_ID, title: "x" } });
    guardCaptureRequest.mockResolvedValue(authenticatedWith({ capture_library: patchQuery }));

    const result = await PATCH(patchRequest({ title: "x" }), { params: { id: "nope" } });

    expect(result.status).toBe(400);
    expect(patchQuery.update).not.toHaveBeenCalled();
  });
});

describe("capture library route params shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    remove.mockResolvedValue({ data: {}, error: null });
  });

  it("DELETE accepts params as a promise (Next 15+ runtime shape)", async () => {
    guardCaptureRequest.mockResolvedValue(authenticatedWith({
      capture_library: makeDeleteQuery(),
      capture_library_audit_log: makeDeleteQuery(),
    }));

    const result = await DELETE(deleteRequest(), { params: Promise.resolve({ id: CAPTURE_ID }) });
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toEqual({ success: true });
  });
});
