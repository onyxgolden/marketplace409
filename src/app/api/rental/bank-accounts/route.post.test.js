import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { POST } from "./route";

// Controls-sweep follow-up G14 (M-20): POST /api/rental/bank-accounts.
function authed({ insertError = null } = {}) {
  const inserts = [];
  const client = {
    from: vi.fn((table) => ({
      insert: vi.fn(async (row) => {
        inserts.push({ table, row });
        return { error: insertError };
      }),
    })),
  };
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user-1" },
    effectiveOwnerId: "owner_1",
    supabaseClient: client,
  });
  return { client, inserts };
}

function postRequest(body) {
  return new Request("https://test/api/rental/bank-accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe("POST /api/rental/bank-accounts", () => {
  it("creates a manual account plus its opening balance row under the workspace owner", async () => {
    const { inserts } = authed();
    const response = await POST(postRequest({ name: "Business Checking", type: "depository", currentBalanceCents: 100000, asOf: "2026-10-01" }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.account).toMatchObject({ name: "Business Checking", type: "depository" });
    expect(body.account.id).toMatch(/^financial_account_manual_/);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toMatchObject({ table: "financial_accounts" });
    expect(inserts[0].row).toMatchObject({ owner_id: "owner_1", provider: "manual_account", institution_id: "manual", type: "depository", active: true });
    expect(inserts[1]).toMatchObject({ table: "account_balances" });
    expect(inserts[1].row).toMatchObject({ owner_id: "owner_1", current_balance_cents: 100000, as_of: "2026-10-01" });
    expect(inserts[1].row.financial_account_id).toBe(body.account.id);
  });

  it("400s on a missing name, an uncreatable type, and a negative balance", async () => {
    authed();
    expect((await POST(postRequest({ name: "", type: "depository", currentBalanceCents: 0 }))).status).toBe(400);
    expect((await POST(postRequest({ name: "X", type: "investment", currentBalanceCents: 0 }))).status).toBe(400);
    expect((await POST(postRequest({ name: "X", type: "depository", currentBalanceCents: -5 }))).status).toBe(400);
  });
});
