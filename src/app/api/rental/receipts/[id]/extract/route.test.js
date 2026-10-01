import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { POST } from "./route";

const receipt = { id: "rental_receipt_abc123", document_id: null, status: "inbox" };

function queryBuilder(rows) {
  const b = {
    select() { return b; },
    eq() { return b; },
    update() { return b; },
    maybeSingle() { return Promise.resolve({ data: rows && rows.length > 0 ? rows[0] : null, error: null }); },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return b;
}

beforeEach(() => {
  vi.clearAllMocks();
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" },
    effectiveOwnerId: "owner_1",
    supabaseClient: { from: vi.fn(() => queryBuilder([receipt])) },
  });
});

const extract = (receiptId) =>
  POST(new Request(`https://t/${receiptId}`, { method: "POST" }), {
    params: Promise.resolve({ id: receiptId }),
  });

describe("POST /api/rental/receipts/[id]/extract", () => {
  it("always reports not_connected — the gate is honest", async () => {
    const response = await extract(receipt.id);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.extraction.status).toBe("not_connected");
    expect(body.extraction.message).toMatch(/not connected/i);
  });

  it("404s for an unknown receipt", async () => {
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user_1" },
      effectiveOwnerId: "owner_1",
      supabaseClient: { from: vi.fn(() => queryBuilder([])) },
    });
    expect((await extract(receipt.id)).status).toBe(404);
  });
});
