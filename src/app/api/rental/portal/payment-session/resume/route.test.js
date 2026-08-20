import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: vi.fn(),
}));
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: vi.fn(),
}));

import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { POST } from "./route.js";

function chain(result) {
  const value = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn(), update: vi.fn() };
  value.select.mockReturnValue(value);
  value.eq.mockReturnValue(value);
  value.insert.mockReturnValue(value);
  value.update.mockReturnValue(value);
  value.maybeSingle.mockResolvedValue(result);
  return value;
}

function request(body) {
  const req = new Request("http://localhost/api/rental/portal/payment-session/resume", { method: "POST", body: JSON.stringify(body) });
  req.nextUrl = new URL("http://localhost/api/rental/portal/payment-session/resume");
  return req;
}

const TENANT = { id: "tenant_1", owner_id: "owner_1", email: "tenant@example.com", display_name: "Test Tenant" };
const CHARGE = { id: "charge_1", owner_id: "owner_1", lease_id: "lease_1", due_date: "2026-09-01", period: "2026-09", charge_type: "rent", currency_code: "USD" };
const ACCOUNT = { provider_account_id: "acct_1", status: "enabled", charges_enabled: true, payouts_enabled: true };

function setup({ paymentRow, tenantRow = TENANT, accountRow = ACCOUNT, chargeRow = CHARGE, retrievePaymentIntent } = {}) {
  const tables = {
    rental_tenants: chain({ data: tenantRow, error: null }),
    rental_payments: chain({ data: paymentRow, error: null }),
    rent_charges: chain({ data: chargeRow, error: null }),
    landlord_payment_accounts: chain({ data: accountRow, error: null }),
  };
  createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "auth_user_1" } });
  createRentalWebhookClient.mockReturnValue({ from: (table) => tables[table] });
  const retrieve = retrievePaymentIntent || vi.fn(async () => ({ id: "pi_existing", status: "requires_payment_method", clientSecret: "pi_existing_secret" }));
  const createPaymentSession = vi.fn();
  createStripeBillingProvider.mockReturnValue({ retrievePaymentIntent: retrieve, createPaymentSession });
  return { tables, retrieve, createPaymentSession };
}

describe("Tenant payment resume route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resumes an existing requires_payment_method payment by retrieving the existing PaymentIntent", async () => {
    const paymentRow = { id: "rental_payment_1", owner_id: "owner_1", tenant_id: "tenant_1", charge_id: "charge_1",
      status: "requires_payment_method", provider_payment_id: "pi_existing", amount_cents: 2000, currency_code: "USD" };
    const { retrieve } = setup({ paymentRow });
    const response = await POST(request({ paymentId: "rental_payment_1" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, clientSecret: "pi_existing_secret", connectedAccountId: "acct_1",
      paymentId: "rental_payment_1", amountCents: 2000, dueDate: "2026-09-01", period: "2026-09" });
    expect(retrieve).toHaveBeenCalledWith({ connectedAccountId: "acct_1" }, "pi_existing");
  });

  it("never creates a second PaymentIntent during resume", async () => {
    const paymentRow = { id: "rental_payment_1", owner_id: "owner_1", tenant_id: "tenant_1", charge_id: "charge_1",
      status: "created", provider_payment_id: "pi_existing", amount_cents: 2000, currency_code: "USD" };
    const { createPaymentSession } = setup({ paymentRow });
    const response = await POST(request({ paymentId: "rental_payment_1" }));
    expect(response.status).toBe(200);
    expect(createPaymentSession).not.toHaveBeenCalled();
  });

  it("never inserts a second rental_payments row during resume", async () => {
    const paymentRow = { id: "rental_payment_1", owner_id: "owner_1", tenant_id: "tenant_1", charge_id: "charge_1",
      status: "requires_action", provider_payment_id: "pi_existing", amount_cents: 2000, currency_code: "USD" };
    const { tables } = setup({ paymentRow });
    const response = await POST(request({ paymentId: "rental_payment_1" }));
    expect(response.status).toBe(200);
    expect(tables.rental_payments.insert).not.toHaveBeenCalled();
    expect(tables.rental_payments.update).not.toHaveBeenCalled();
  });

  it.each(["created", "requires_payment_method", "requires_action"])("allows resuming a %s payment", async (status) => {
    const paymentRow = { id: "rental_payment_1", owner_id: "owner_1", tenant_id: "tenant_1", charge_id: "charge_1",
      status, provider_payment_id: "pi_existing", amount_cents: 2000, currency_code: "USD" };
    setup({ paymentRow });
    const response = await POST(request({ paymentId: "rental_payment_1" }));
    expect(response.status).toBe(200);
  });

  it.each(["succeeded", "failed", "cancelled", "processing"])("refuses to resume a %s payment", async (status) => {
    const paymentRow = { id: "rental_payment_1", owner_id: "owner_1", tenant_id: "tenant_1", charge_id: "charge_1",
      status, provider_payment_id: "pi_existing", amount_cents: 2000, currency_code: "USD" };
    const { retrieve } = setup({ paymentRow });
    const response = await POST(request({ paymentId: "rental_payment_1" }));
    expect(response.status).toBe(409);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("refuses to resume another tenant's payment even if the id is known", async () => {
    const paymentRow = { id: "rental_payment_1", owner_id: "owner_1", tenant_id: "tenant_OTHER", charge_id: "charge_1",
      status: "requires_payment_method", provider_payment_id: "pi_existing", amount_cents: 2000, currency_code: "USD" };
    const { retrieve } = setup({ paymentRow });
    const response = await POST(request({ paymentId: "rental_payment_1" }));
    expect(response.status).toBe(404);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("returns 403 when no tenant portal access is linked to the authenticated account", async () => {
    setup({ tenantRow: null, paymentRow: null });
    const response = await POST(request({ paymentId: "rental_payment_1" }));
    expect(response.status).toBe(403);
  });

  it("requires a paymentId", async () => {
    setup({ paymentRow: null });
    const response = await POST(request({}));
    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown payment id", async () => {
    const { retrieve } = setup({ paymentRow: null });
    const response = await POST(request({ paymentId: "rental_payment_missing" }));
    expect(response.status).toBe(404);
    expect(retrieve).not.toHaveBeenCalled();
  });
});
