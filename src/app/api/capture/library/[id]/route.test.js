import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const remove = vi.fn();
const { guardCaptureRequest } = vi.hoisted(() => ({ guardCaptureRequest: vi.fn() }));
vi.mock("../../_lib/auth.js", () => ({ guardCaptureRequest }));

import { DELETE } from "./route.js";

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
