import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({ createStripeBillingProvider: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { POST, RESUMABLE_STATUSES } from "./route.js";

function chain(result) {
  const value = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  value.select.mockReturnValue(value);
  value.eq.mockReturnValue(value);
  value.maybeSingle.mockResolvedValue(result);
  return value;
}

function request(body) {
  const req = new Request("http://localhost/api/private-financing/portal/payment-session/resume", { method: "POST", body: JSON.stringify(body) });
  req.nextUrl = new URL("http://localhost/api/private-financing/portal/payment-session/resume");
  return req;
}

const BORROWER = { owner_id: "owner_1", id: "borrower_1" };
const ACCOUNT = { provider_account_id: "acct_1", status: "enabled", charges_enabled: true, payouts_enabled: true };

function setup({ borrowerRow = BORROWER, paymentRow, accountRow = ACCOUNT, retrievePaymentIntent } = {}) {
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_fixture";
  const tables = {
    private_financing_borrowers: chain({ data: borrowerRow, error: null }),
    private_financing_online_payments: chain({ data: paymentRow, error: null }),
    landlord_payment_accounts: chain({ data: accountRow, error: null }),
  };
  createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "auth_user_1" } } }) } });
  createRentalWebhookClient.mockReturnValue({ from: (table) => tables[table] });
  const retrieve = retrievePaymentIntent || vi.fn(async () => ({ id: "pi_existing", status: "requires_payment_method", clientSecret: "pi_existing_secret" }));
  createStripeBillingProvider.mockReturnValue({ mode: "test", retrievePaymentIntent: retrieve });
  return { tables, retrieve };
}

describe("Private financing payment resume route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resumes an existing requires_payment_method payment by retrieving the existing PaymentIntent", async () => {
    const paymentRow = { id: "pf_payment_1", owner_id: "owner_1", borrower_id: "borrower_1", account_id: "account_1",
      status: "requires_payment_method", provider_payment_id: "pi_existing", amount_cents: 51785 };
    const { retrieve } = setup({ paymentRow });
    const response = await POST(request({ paymentId: "pf_payment_1" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, clientSecret: "pi_existing_secret", connectedAccountId: "acct_1",
      paymentId: "pf_payment_1", amountCents: 51785 });
    expect(retrieve).toHaveBeenCalledWith({ connectedAccountId: "acct_1" }, "pi_existing");
  });

  it.each(RESUMABLE_STATUSES)("allows resuming a %s payment", async (status) => {
    const paymentRow = { id: "pf_payment_1", owner_id: "owner_1", borrower_id: "borrower_1", account_id: "account_1",
      status, provider_payment_id: "pi_existing", amount_cents: 51785 };
    setup({ paymentRow });
    const response = await POST(request({ paymentId: "pf_payment_1" }));
    expect(response.status).toBe(200);
  });

  it.each(["succeeded", "failed", "cancelled", "processing"])("refuses to resume a %s payment", async (status) => {
    const paymentRow = { id: "pf_payment_1", owner_id: "owner_1", borrower_id: "borrower_1", account_id: "account_1",
      status, provider_payment_id: "pi_existing", amount_cents: 51785 };
    const { retrieve } = setup({ paymentRow });
    const response = await POST(request({ paymentId: "pf_payment_1" }));
    expect(response.status).toBe(409);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("refuses to resume another borrower's payment even if the id is known", async () => {
    const paymentRow = { id: "pf_payment_1", owner_id: "owner_1", borrower_id: "borrower_OTHER", account_id: "account_1",
      status: "requires_payment_method", provider_payment_id: "pi_existing", amount_cents: 51785 };
    const { retrieve } = setup({ paymentRow });
    const response = await POST(request({ paymentId: "pf_payment_1" }));
    expect(response.status).toBe(404);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("returns 403 when no borrower access is linked to the authenticated account", async () => {
    setup({ borrowerRow: null, paymentRow: null });
    const response = await POST(request({ paymentId: "pf_payment_1" }));
    expect(response.status).toBe(403);
  });

  it("requires a paymentId", async () => {
    setup({ paymentRow: null });
    const response = await POST(request({}));
    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown payment id", async () => {
    const { retrieve } = setup({ paymentRow: null });
    const response = await POST(request({ paymentId: "pf_payment_missing" }));
    expect(response.status).toBe(404);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } });
    const response = await POST(request({ paymentId: "pf_payment_1" }));
    expect(response.status).toBe(401);
  });
});
