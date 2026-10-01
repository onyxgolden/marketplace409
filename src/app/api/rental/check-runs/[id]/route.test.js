import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { GET } from "./route";

const runRow = {
  id: "rental_check_run_1", run_date: "2026-09-30", bank_account_id: "bank_1",
  check_count: 1, total_amount_cents: 25000, created_at: "2026-09-30T00:00:00Z",
};

const runItemRow = {
  run_id: "rental_check_run_1", vendor_payment_id: "rental_vendor_payment_1", seq: 0,
  payee_name: "Acme Plumbing", amount_cents: 25000, check_number: "1042",
  payment_date: "2026-09-28", memo: "", bank_account_id: "bank_1",
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
    select() { return b; }, eq() { return b; }, order() { return b; }, in() { return b; },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return b;
}

function authAs(client) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
}

const params = { id: "rental_check_run_1" };
const getRoute = () => GET(new Request("https://t/"), { params });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/check-runs/[id]", () => {
  function client(payments) {
    return {
      from: vi.fn((table) => {
        if (table === "rental_check_print_runs") return singleBuilder(runRow);
        if (table === "rental_check_print_items") return listBuilder([runItemRow]);
        return listBuilder(payments);
      }),
    };
  }

  it("returns the run with amount words for the print view", async () => {
    authAs(client([{ id: "rental_vendor_payment_1", payment_method: "check", status: "active" }]));
    const response = await getRoute();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.run.checks[0]).toMatchObject({
      amountWords: "Two hundred fifty and 00/100",
      payeeName: "Acme Plumbing",
    });
  });

  it("409s when a payment was voided after the run was created — voided never prints", async () => {
    authAs(client([{ id: "rental_vendor_payment_1", payment_method: "check", status: "voided" }]));
    const response = await getRoute();
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toContain("voided payment cannot be printed");
  });

  it("404s for an unknown run", async () => {
    authAs({ from: vi.fn(() => singleBuilder(null)) });
    const response = await getRoute();
    expect(response.status).toBe(404);
  });
});
