import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { GET } from "./route";

function makeDb({ batchRow = null, letterRows = [] } = {}) {
  const table = {
    select() { return table; },
    eq() { return table; },
    order() { return table; },
    async maybeSingle() { return { data: batchRow, error: null }; },
    then(resolve) { resolve({ data: letterRows, error: null }); },
  };
  return { db: { from: vi.fn(() => table) } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

function authAs(db) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: db,
  });
}

const get = (id) => GET(new Request("https://t/"), { params: { id } });

describe("mailing batch detail route", () => {
  it("404s an unknown batch", async () => {
    const { db } = makeDb({ batchRow: null });
    authAs(db);
    expect((await get("nope")).status).toBe(404);
  });

  it("returns the batch with its letters and per-status summary", async () => {
    const letters = [
      { id: "l1", status: "queued", tenant_name: "Eric Carrillo" },
      { id: "l2", status: "mailed", tenant_name: "Nicole Smith" },
      { id: "l3", status: "delivered", tenant_name: "Aaron Valentine" },
    ];
    const { db } = makeDb({
      batchRow: { id: "b1", name: "October", created_at: "2026-10-01T00:00:00Z" },
      letterRows: letters,
    });
    authAs(db);
    const res = await get("b1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batch.name).toBe("October");
    expect(body.batch.letters).toHaveLength(3);
    expect(body.batch.summary).toEqual({ total: 3, queued: 1, mailed: 1, delivered: 1 });
  });
});
