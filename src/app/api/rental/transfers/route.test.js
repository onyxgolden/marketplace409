import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), gate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: mocks.authenticate,
}));
vi.mock("@/lib/rental/teamAuthorization", () => ({
  requireRentalPermission: mocks.gate,
}));

import { NextResponse } from "next/server";
import { requireRentalPermission } from "@/lib/rental/teamAuthorization";
import { POST } from "./route";

function fakeClient({ rpcImpl } = {}) {
  return { rpc: rpcImpl ?? vi.fn(async () => ({ data: null, error: null })) };
}

function authed(client, role = "owner") {
  mocks.authenticate.mockResolvedValue({
    response: null,
    user: { id: "user-1" },
    supabaseClient: client,
    effectiveOwnerId: "owner-1",
  });
  // R17: writes gate through requireRentalPermission; "owner" allows, "read_only" denies.
  if (role === "read_only") {
    mocks.gate.mockResolvedValue({
      response: NextResponse.json({ error: "Your team role does not allow this." }, { status: 403 }),
      authorization: null,
    });
  } else {
    mocks.gate.mockResolvedValue({ response: null, authorization: { permissions: [] } });
  }
}

function postRequest(body) {
  return new Request("http://localhost/api/rental/transfers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  fromAccountId: "acct-1",
  toAccountId: "acct-2",
  eventDate: "2026-09-27",
  amount: 500,
  memo: "Owner draw",
  checkNumber: "1042",
};

describe("POST /api/rental/transfers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls the atomic RPC once and returns the linked legs", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        transfer_group_id: "transfer_abc",
        out_event_id: "event-out",
        in_event_id: "event-in",
        from_account_id: "acct-1",
        to_account_id: "acct-2",
        amount: 500,
        event_date: "2026-09-27",
      },
      error: null,
    }));
    authed(fakeClient({ rpcImpl: rpc }));

    const response = await POST(postRequest(validBody));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.transfer).toMatchObject({
      transferGroupId: "transfer_abc",
      outEventId: "event-out",
      inEventId: "event-in",
    });
    // Exactly one RPC call — the two legs are written in one database
    // transaction, never as two separate writes.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_fund_transfer", {
      p_from_account_id: "acct-1",
      p_to_account_id: "acct-2",
      p_event: { amount: 500, eventDate: "2026-09-27", memo: "Owner draw", checkNumber: "1042" },
    });
  });

  it("rejects the same account on both sides before touching the database", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    authed(fakeClient({ rpcImpl: rpc }));

    const response = await POST(postRequest({ ...validBody, toAccountId: "acct-1" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("two different accounts");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a zero amount before touching the database", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    authed(fakeClient({ rpcImpl: rpc }));

    const response = await POST(postRequest({ ...validBody, amount: 0 }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks read-only members", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    authed(fakeClient({ rpcImpl: rpc }), "read_only");

    const response = await POST(postRequest(validBody));
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's plain-English validation error as a 400", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "One of the selected accounts was not found." },
    }));
    authed(fakeClient({ rpcImpl: rpc }));

    const response = await POST(postRequest(validBody));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("was not found");
  });
});

describe("R17 permission gating", () => {
  it("POST requires the transfers.record permission", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    authed(fakeClient({ rpcImpl: rpc }));
    await POST(postRequest(validBody));
    expect(requireRentalPermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "transfers.record" })
    );
  });
});
