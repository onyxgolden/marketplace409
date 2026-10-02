import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/rental/teamAuthorization", () => ({
  requireRentalPermission: vi.fn(),
}));
vi.mock("@/application/rental/chartOfAccounts", () => ({
  resolvePostingCategories: vi.fn(),
  ChartUnavailableError: class ChartUnavailableError extends Error {},
}));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { NextResponse } from "next/server";
import { requireRentalPermission } from "@/lib/rental/teamAuthorization";
import { ChartUnavailableError, resolvePostingCategories } from "@/application/rental/chartOfAccounts";
import { POST } from "./route";

const row = (overrides = {}) => ({
  eventDate: "2026-09-20",
  description: "Plumber",
  payee: "Acme Plumbing",
  normalizedCategory: "property_repairs",
  amount: 250,
  memo: "Kitchen sink",
  ...overrides,
});

// The batch posts through one RPC in a single database transaction — the
// insert AND the active-category checks happen inside it, coordinated with
// concurrent deactivation via the chart row locks.
function authed(rpcCapture, { role = "owner", rpcResult = null } = {}) {
  const rpc = vi.fn(async (name, args) => {
    rpcCapture.calls.push({ name, args });
    if (rpcResult) return rpcResult;
    return { data: { created: args.p_events.length, ids: args.p_events.map((_, i) => `evt-${i}`) }, error: null };
  });
  const client = { from: vi.fn(), rpc };
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user-1" },
    effectiveOwnerId: "owner_1",
    supabaseClient: client,
  });
  if (role === "read_only") {
    requireRentalPermission.mockResolvedValue({
      response: NextResponse.json({ error: "Your team role does not allow this." }, { status: 403 }),
      authorization: null,
    });
  } else {
    requireRentalPermission.mockResolvedValue({ response: null, authorization: { permissions: [] } });
  }
  return client;
}

function postRequest(rows) {
  return new Request("https://test/api/rental/transactions/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolvePostingCategories.mockResolvedValue(["property_repairs", "utilities", "supplies"]);
});

describe("POST /api/rental/transactions/batch", () => {
  it("posts all valid rows in one RPC call", async () => {
    const rpcCapture = { calls: [] };
    authed(rpcCapture);

    const response = await POST(postRequest([row(), row({ description: "Electrician", amount: 120, normalizedCategory: "utilities" })]));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, created: 2, errors: [] });
    expect(rpcCapture.calls).toHaveLength(1);
    expect(rpcCapture.calls[0].name).toBe("create_ledger_transactions");
    expect(rpcCapture.calls[0].args.p_owner_id).toBe("owner_1");
    const events = rpcCapture.calls[0].args.p_events;
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      transactionKind: "expense",
      normalizedCategory: "property_repairs",
      payee: "Acme Plumbing",
    });
    // Batch rows never create tenant charges.
    expect(events[0].chargeTenant).toBeUndefined();
  });

  it("reports per-row errors while posting the valid rows", async () => {
    const rpcCapture = { calls: [] };
    authed(rpcCapture);

    const response = await POST(postRequest([row(), row({ amount: -5 })]));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.created).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].index).toBe(1);
    expect(rpcCapture.calls[0].args.p_events).toHaveLength(1);
  });

  it("rejects an unknown category", async () => {
    const rpcCapture = { calls: [] };
    authed(rpcCapture);

    const response = await POST(postRequest([row({ normalizedCategory: "made_up" })]));
    const body = await response.json();
    expect(body.created).toBe(0);
    expect(body.errors).toHaveLength(1);
    expect(rpcCapture.calls).toHaveLength(0);
  });

  it("accepts a custom chart-of-accounts code", async () => {
    resolvePostingCategories.mockResolvedValue(["property_repairs", "landscaping"]);
    const rpcCapture = { calls: [] };
    authed(rpcCapture);

    const response = await POST(postRequest([row({ normalizedCategory: "landscaping" })]));
    const body = await response.json();
    expect(body).toMatchObject({ created: 1, errors: [] });
    expect(rpcCapture.calls[0].args.p_events[0].normalizedCategory).toBe("landscaping");
  });

  it("rejects a built-in category the owner deactivated", async () => {
    // The owner's active chart no longer includes property_repairs.
    resolvePostingCategories.mockResolvedValue(["utilities"]);
    const rpcCapture = { calls: [] };
    authed(rpcCapture);

    const response = await POST(postRequest([row()]));
    const body = await response.json();
    expect(body.created).toBe(0);
    expect(body.errors).toHaveLength(1);
    expect(rpcCapture.calls).toHaveLength(0);
  });

  it("400s when the RPC rejects a deactivated account", async () => {
    // A deactivation landed between the route's category read and the RPC:
    // the RPC is the enforcement boundary and the route surfaces its 400.
    const rpcCapture = { calls: [] };
    authed(rpcCapture, {
      rpcResult: { data: null, error: { code: "22000", message: "This account has been deactivated. Choose an active account." } },
    });

    const response = await POST(postRequest([row()]));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/deactivated/i);
    expect(rpcCapture.calls).toHaveLength(1);
  });

  it("400s with no rows and caps at 50", async () => {
    const rpcCapture = { calls: [] };
    authed(rpcCapture);

    const empty = await POST(postRequest([]));
    expect(empty.status).toBe(400);

    const tooMany = await POST(postRequest(Array.from({ length: 51 }, () => row())));
    expect(tooMany.status).toBe(400);
  });

  it("403s for read-only members", async () => {
    const rpcCapture = { calls: [] };
    authed(rpcCapture, { role: "read_only" });

    const response = await POST(postRequest([row()]));
    expect(response.status).toBe(403);
    expect(rpcCapture.calls).toHaveLength(0);
  });

  it("503s and writes nothing when the chart read fails", async () => {
    resolvePostingCategories.mockRejectedValue(new ChartUnavailableError(new Error("connection reset")));
    const rpcCapture = { calls: [] };
    authed(rpcCapture);

    const response = await POST(postRequest([row()]));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/chart of accounts/i);
    expect(rpcCapture.calls).toHaveLength(0);
  });

  it("uses the built-in list in legacy mode when the chart table is missing", async () => {
    // resolvePostingCategories returns null only when the chart table does
    // not exist yet (migration not applied).
    resolvePostingCategories.mockResolvedValue(null);
    const rpcCapture = { calls: [] };
    authed(rpcCapture);

    const response = await POST(postRequest([row()]));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body).toMatchObject({ created: 1, errors: [] });
    expect(rpcCapture.calls[0].args.p_events[0].normalizedCategory).toBe("property_repairs");
  });
});

describe("R17 permission gating", () => {
  it("POST requires the payments.record permission", async () => {
    const rpcCapture = { calls: [] };
    authed(rpcCapture);
    await POST(postRequest([row()]));
    expect(requireRentalPermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "payments.record" })
    );
  });
});
