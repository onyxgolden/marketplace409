import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { DELETE, GET, PUT } from "./route";

const authed = (client, effectiveOwnerId = "owner_1") => ({ user: { id: "user_1" }, effectiveOwnerId, supabaseClient: client });

function chain(result) {
  const q = {};
  for (const m of ["select", "eq", "order", "delete"]) q[m] = vi.fn(() => q);
  q.upsert = vi.fn(async () => result);
  q.then = (resolve) => resolve(result);
  return q;
}

const book = {
  id: "acme-oak-abc12",
  supplier: "Acme Supply",
  line: "Oak",
  asOf: "2025-01-31",
  items: [{ code: "b24", name: "B24", sku: "1", priceCents: 19900, kind: "cabinet" }],
};

describe("price books API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET lists the workspace owner's books, normalized", async () => {
    const q = chain({ data: [{ book_id: book.id, book, updated_at: "t" }], error: null });
    const client = { from: vi.fn(() => q) };
    createAuthenticatedForgeApplication.mockResolvedValue(authed(client));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(client.from).toHaveBeenCalledWith("designer_price_books");
    expect(q.eq).toHaveBeenCalledWith("owner_id", "owner_1");
    expect(body.books[0].items[0].code).toBe("B24");
  });

  it("PUT upserts one normalized book under the effective owner", async () => {
    const q = chain({ error: null });
    createAuthenticatedForgeApplication.mockResolvedValue(authed({ from: vi.fn(() => q) }));
    const res = await PUT(new Request("https://t/", { method: "PUT", body: JSON.stringify({ book }) }));
    expect(res.status).toBe(200);
    const [row, opts] = q.upsert.mock.calls[0];
    expect(row).toMatchObject({ owner_id: "owner_1", book_id: book.id });
    expect(row.book.items[0]).toMatchObject({ code: "B24", priceCents: 19900 });
    expect(opts).toEqual({ onConflict: "owner_id,book_id" });
  });

  it("PUT rejects bad input", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue(authed({ from: vi.fn() }));
    expect((await PUT(new Request("https://t/", { method: "PUT", body: "nope" }))).status).toBe(400);
    expect((await PUT(new Request("https://t/", { method: "PUT", body: JSON.stringify({ book: { items: [] } }) }))).status).toBe(400);
    expect((await PUT(new Request("https://t/", { method: "PUT", body: "x".repeat(1_000_001) }))).status).toBe(413);
  });

  it("DELETE removes one book of the caller's", async () => {
    const q = chain({ error: null });
    createAuthenticatedForgeApplication.mockResolvedValue(authed({ from: vi.fn(() => q) }));
    const res = await DELETE(new Request(`https://t/?id=${book.id}`, { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(q.eq).toHaveBeenCalledWith("owner_id", "owner_1");
    expect(q.eq).toHaveBeenCalledWith("book_id", book.id);
  });

  it("passes the auth response through when not signed in", async () => {
    const response = new Response(null, { status: 401 });
    createAuthenticatedForgeApplication.mockResolvedValue({ response });
    expect(await GET()).toBe(response);
  });

  it("surfaces a database error as 500", async () => {
    const q = chain({ data: null, error: new Error("relation does not exist") });
    createAuthenticatedForgeApplication.mockResolvedValue(authed({ from: vi.fn(() => q) }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await GET()).status).toBe(500);
  });
});
