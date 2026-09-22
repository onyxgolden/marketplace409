import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const createSignedUrl = vi.fn();
const { guardCaptureRequest } = vi.hoisted(() => ({ guardCaptureRequest: vi.fn() }));
vi.mock("../_lib/auth.js", () => ({ guardCaptureRequest }));

import { GET } from "./route.js";

const OWNER_ID = "owner_1";

function makeListQuery(rows) {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    order: vi.fn(() => q),
    limit: vi.fn(async () => ({ data: rows, error: null })),
  };
  return q;
}

describe("capture library route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const response = new Response(JSON.stringify({ error: "nope" }), { status: 401 });
    guardCaptureRequest.mockResolvedValue({ response });
    const result = await GET(new Request("https://example.test/api/capture/library"));
    expect(result).toBe(response);
  });

  it("returns the owner's rows newest-first with signed URLs", async () => {
    const rows = [
      { id: "id-2", title: "B", kind: "screenshot", mime_type: "image/png", byte_size: 20, width: 2, height: 2, storage_path: `${OWNER_ID}/capture/id-2.png`, captured_at: null, created_at: "2026-09-22T02:00:00Z" },
      { id: "id-1", title: "A", kind: "recording", mime_type: "video/webm", byte_size: 30, width: 3, height: 3, storage_path: `${OWNER_ID}/capture/id-1.webm`, captured_at: null, created_at: "2026-09-22T01:00:00Z" },
    ];
    const query = makeListQuery(rows);
    from.mockReturnValue(query);
    guardCaptureRequest.mockResolvedValue({
      user: { id: OWNER_ID },
      supabaseClient: { from, storage: { from: vi.fn(() => ({ createSignedUrl })) } },
    });
    createSignedUrl.mockImplementation(async (path) => ({ data: { signedUrl: `https://signed.test/${path}` }, error: null }));

    const result = await GET(new Request("https://example.test/api/capture/library"));
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].id).toBe("id-2");
    expect(body.items[0].signedUrl).toBe(`https://signed.test/${OWNER_ID}/capture/id-2.png`);
    expect(body.items[1].signedUrl).toBe(`https://signed.test/${OWNER_ID}/capture/id-1.webm`);
    // Never leaks the storage path to the client payload.
    expect(body.items[0].storage_path).toBeUndefined();
    expect(query.eq).toHaveBeenCalledWith("owner_id", OWNER_ID);
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(100);
  });

  it("returns an empty list when the owner has no captures", async () => {
    from.mockReturnValue(makeListQuery([]));
    guardCaptureRequest.mockResolvedValue({
      user: { id: OWNER_ID },
      supabaseClient: { from, storage: { from: vi.fn(() => ({ createSignedUrl })) } },
    });

    const result = await GET(new Request("https://example.test/api/capture/library"));
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body.items).toEqual([]);
  });
});
