import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";

const runRow = {
  id: "rental_check_run_1", run_date: "2026-09-30", bank_account_id: "bank_1",
  check_count: 1, total_amount_cents: 25000, created_at: "2026-09-30T00:00:00Z",
};

const runItemRow = {
  run_id: "rental_check_run_1", vendor_payment_id: "rental_vendor_payment_1", seq: 0,
  payee_name: "Acme Plumbing", amount_cents: 25000, check_number: "1042",
  payment_date: "2026-09-28", memo: "", bank_account_id: "bank_1",
};

const paymentRow = {
  id: "rental_vendor_payment_1", payment_method: "check", status: "active",
  amount_cents: 25000, bank_account_id: "bank_1", check_number: "1042",
};

function listBuilder(rows) {
  const b = {
    select() { return b; }, eq() { return b; }, order() { return b; }, in() { return b; },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return b;
}

function singleBuilder(row) {
  const b = {
    select() { return b; }, eq() { return b; },
    maybeSingle: vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValue({ data: runRow, error: null }),
  };
  return b;
}

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const get = () => GET(new Request("https://t/"));
const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));

const goodBody = {
  id: "rental_check_run_1",
  runDate: "2026-09-30",
  bankAccountId: "bank_1",
  paymentIds: ["rental_vendor_payment_1"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/check-runs", () => {
  it("lists runs with their check snapshots", async () => {
    const client = {
      from: vi.fn((table) => (table === "rental_check_print_runs" ? listBuilder([runRow]) : listBuilder([runItemRow]))),
    };
    authAs(client);
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({ checkCount: 1, totalAmountCents: 25000 });
    expect(body.runs[0].checks[0]).toMatchObject({ payeeName: "Acme Plumbing", checkNumber: "1042" });
  });
});

describe("POST /api/rental/check-runs", () => {
  function createClient({ rpcError = null } = {}) {
    const runLookup = singleBuilder(runRow);
    return {
      from: vi.fn((table) => {
        if (table === "rental_vendor_payments") return listBuilder([paymentRow]);
        if (table === "rental_check_print_items") return listBuilder([runItemRow]);
        return runLookup;
      }),
      rpc: vi.fn().mockResolvedValue({ data: { runId: "rental_check_run_1" }, error: rpcError }),
    };
  }

  it("creates a check run and returns 201", async () => {
    const client = createClient();
    authAs(client);
    const response = await post(goodBody);
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.run).toMatchObject({ id: "rental_check_run_1", checkCount: 1 });
    expect(client.rpc).toHaveBeenCalledWith(
      "create_check_print_run",
      expect.objectContaining({
        p_owner_id: "owner_1",
        p_run: expect.objectContaining({ paymentIds: ["rental_vendor_payment_1"] }),
      })
    );
  });

  it("403s for read-only members", async () => {
    authAs(createClient(), "read_only");
    const response = await post(goodBody);
    expect(response.status).toBe(403);
  });

  it("400s when a payment is voided — voided payments never print", async () => {
    const client = createClient();
    client.from = vi.fn((table) => {
      if (table === "rental_vendor_payments") return listBuilder([{ ...paymentRow, status: "voided" }]);
      return listBuilder([]);
    });
    authAs(client);
    const response = await post(goodBody);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("Voided payments cannot be printed.");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("400s when checks are drawn on different bank accounts", async () => {
    const client = createClient();
    client.from = vi.fn((table) => {
      if (table === "rental_vendor_payments") {
        return listBuilder([paymentRow, { ...paymentRow, id: "rental_vendor_payment_2", bank_account_id: "bank_2" }]);
      }
      return listBuilder([]);
    });
    authAs(client);
    const response = await post({ ...goodBody, paymentIds: ["rental_vendor_payment_1", "rental_vendor_payment_2"] });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("same bank account");
  });
});
