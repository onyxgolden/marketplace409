import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, PATCH } from "./route";

const depositRow = {
  id: "rental_bank_deposit_1", deposit_date: "2026-09-30", bank_account_id: "bank_1", memo: "",
  total_amount_cents: 160000, item_count: 1, deposit_event_id: "event_d", status: "active",
  void_reason: null, voided_at: null, created_at: "2026-09-30T00:00:00Z", updated_at: null,
};

const itemRow = {
  deposit_id: "rental_bank_deposit_1", financial_event_id: "event_1", seq: 0,
  tender: "check", check_number: "4412", received_from: "Eric Carrillo", amount_cents: 160000,
};

function singleBuilder(row) {
  const b = {
    select() { return b; }, eq() { return b; },
    maybeSingle() { return Promise.resolve({ data: row, error: null }); },
  };
  return b;
}

function listBuilder(rows) {
  const b = {
    select() { return b; }, eq() { return b; }, order() { return b; },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return b;
}

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const params = { id: "rental_bank_deposit_1" };
const getRoute = () => GET(new Request("https://t/"), { params });
const patchRoute = (body) => PATCH(new Request("https://t/", { method: "PATCH", body: JSON.stringify(body) }), { params });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/bank-deposits/[id]", () => {
  it("returns the deposit with its items for the slip print view", async () => {
    const client = {
      from: vi.fn((table) => (table === "rental_bank_deposits" ? singleBuilder(depositRow) : listBuilder([itemRow]))),
    };
    authAs(client);
    const response = await getRoute();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.deposit).toMatchObject({ id: "rental_bank_deposit_1", totalAmountCents: 160000 });
    expect(body.deposit.items).toHaveLength(1);
  });

  it("404s for an unknown deposit", async () => {
    const client = { from: vi.fn(() => singleBuilder(null)) };
    authAs(client);
    const response = await getRoute();
    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/rental/bank-deposits/[id]", () => {
  function voidClient({ deposit = depositRow, reconciliations = [], rpcError = null } = {}) {
    return {
      from: vi.fn((table) => {
        if (table === "rental_bank_deposits") return singleBuilder(deposit);
        if (table === "bank_reconciliations") return listBuilder(reconciliations);
        return listBuilder([itemRow]);
      }),
      rpc: vi.fn().mockResolvedValue({ data: { depositId: deposit?.id || "unknown", releasedItems: 1 }, error: rpcError }),
    };
  }

  it("voids an active deposit with a reason", async () => {
    const client = voidClient();
    authAs(client);
    const response = await patchRoute({ action: "void", reason: "Deposited to the wrong account" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      "void_bank_deposit",
      expect.objectContaining({ p_deposit_id: "rental_bank_deposit_1", p_reason: "Deposited to the wrong account" })
    );
  });

  it("403s for read-only members", async () => {
    authAs(voidClient(), "read_only");
    const response = await patchRoute({ action: "void", reason: "x" });
    expect(response.status).toBe(403);
  });

  it("400s without a reason and 404s for unknown deposits", async () => {
    authAs(voidClient());
    const noReason = await patchRoute({ action: "void", reason: "" });
    expect(noReason.status).toBe(400);

    authAs(voidClient({ deposit: null }));
    const missing = await patchRoute({ action: "void", reason: "x" });
    expect(missing.status).toBe(404);
  });

  it("400s for a non-void action", async () => {
    authAs(voidClient());
    const response = await patchRoute({ action: "edit" });
    expect(response.status).toBe(400);
  });

  it("409s when the deposit is already reconciled", async () => {
    const client = voidClient({
      reconciliations: [{ status: "active", cleared_event_ids: ["event_d"] }],
    });
    authAs(client);
    const response = await patchRoute({ action: "void", reason: "x" });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toContain("already reconciled");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("maps the RPC reconciliation guard to 409", async () => {
    const client = voidClient({
      rpcError: { code: "P0001", message: "This deposit is already reconciled and cannot be voided." },
    });
    authAs(client);
    const response = await patchRoute({ action: "void", reason: "x" });
    expect(response.status).toBe(409);
  });
});
