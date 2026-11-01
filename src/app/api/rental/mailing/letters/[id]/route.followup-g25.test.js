import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PATCH } from "./route";

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/isOwnerOrActiveCoOwner", () => ({
  isOwnerOrActiveCoOwner: vi.fn(() => true),
}));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

let letterRow;
let rpcError;
let deleted;
function fakeClient() {
  const chain = () => ({
    select: () => chain(), eq: () => chain(), order: () => chain(),
    maybeSingle: async () => ({ data: letterRow, error: null }),
    delete: () => ({ eq: () => ({ eq: () => { deleted = true; return { error: null }; } }) }),
  });
  return { from: () => chain(), rpc: async (name, params) => ({ data: name === "correct_mailing_letter_recipient" ? { ...letterRow, recipient_address: params.p_next_recipient } : letterRow, error: rpcError || null }) };
}
function request(body) {
  return { json: async () => body };
}
beforeEach(() => {
  letterRow = { id: "letter_1", batch_id: "batch_1", tenant_name: "Tenant One", recipient_address: "100 Old St", status: "queued", document_subject: "Notice", tracking_number: null, created_at: "2026-10-31T00:00:00Z", updated_at: "2026-10-31T00:00:00Z" };
  rpcError = null; deleted = false;
  createAuthenticatedRentalManagerApplication.mockResolvedValue({ user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: fakeClient() });
});

describe("mailing letters route follow-up G25 (O-24)", () => {
  it("corrects a queued letter's address through the RPC", async () => {
    const response = await PATCH(request({ recipientAddress: "200 New Ave" }), { params: { id: "letter_1" } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.letter.recipientAddress).toBe("200 New Ave");
    expect(body.success).toBe(true);
  });

  it("rejects a combined address + status edit", async () => {
    const response = await PATCH(request({ recipientAddress: "200 New Ave", status: "mailed" }), { params: { id: "letter_1" } });
    expect(response.status).toBe(400);
  });

  it("rejects a blank address and maps a missing RPC to 503", async () => {
    expect((await PATCH(request({ recipientAddress: "   " }), { params: { id: "letter_1" } })).status).toBe(400);
    rpcError = { code: "PGRST202", message: "function not found" };
    const response = await PATCH(request({ recipientAddress: "200 New Ave" }), { params: { id: "letter_1" } });
    expect(response.status).toBe(503);
  });

  it("deletes a queued letter and refuses a mailed one", async () => {
    const ok = await DELETE(request(), { params: { id: "letter_1" } });
    expect(ok.status).toBe(200);
    expect(deleted).toBe(true);
    letterRow = { ...letterRow, status: "mailed" }; deleted = false;
    const refused = await DELETE(request(), { params: { id: "letter_1" } });
    expect(refused.status).toBe(409);
    expect(deleted).toBe(false);
  });

  it("returns 404 for a letter that does not belong to the owner", async () => {
    letterRow = null;
    expect((await DELETE(request(), { params: { id: "letter_1" } })).status).toBe(404);
  });
});
