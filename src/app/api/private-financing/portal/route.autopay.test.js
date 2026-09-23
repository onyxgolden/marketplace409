import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createRentalWebhookClient: vi.fn(),
  createStripeBillingProvider: vi.fn(),
  validatePublishableKeyMode: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: mocks.createRentalWebhookClient }));
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({ createStripeBillingProvider: mocks.createStripeBillingProvider }));
vi.mock("@/infrastructure/billing/stripeMode", () => ({ validatePublishableKeyMode: mocks.validatePublishableKeyMode }));

import { POST } from "./route.js";

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node),
    insert: vi.fn(() => node), update: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const BORROWER = { owner_id: "owner_1", id: "brw_1", email: "ethan@example.com", full_name: "Ethan" };
const ENROLLMENT_SETUP = { id: "pf_autopay_1", owner_id: "owner_1", account_id: "acct_1", borrower_id: "brw_1",
  status: "setup_required", payment_method_type: "us_bank_account", setup_intent_id: "seti_1" };

// Builds a service-role db double keyed by table name; each entry is { result } or a custom chain.
function svcDb({ borrowers = BORROWER, membership = { status: "active" }, settings = { enabled: true },
  enrollment = ENROLLMENT_SETUP, landlord = { provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true },
  customer = { customer_id: "cus_1" }, insertEnrollment = null, updateEnrollment = null } = {}) {
  return {
    from: vi.fn((table) => {
      if (table === "private_financing_borrowers") return chain({ data: borrowers, error: null });
      if (table === "private_financing_account_borrowers") return chain({ data: membership, error: null });
      if (table === "private_financing_online_payment_settings") return chain({ data: settings, error: null });
      if (table === "landlord_payment_accounts") return chain({ data: landlord, error: null });
      if (table === "private_financing_billing_customers") return chain({ data: customer, error: null });
      if (table === "private_financing_autopay_enrollments") {
        const node = chain({ data: enrollment, error: null });
        if (insertEnrollment) node.insert.mockReturnValue(chain(insertEnrollment));
        if (updateEnrollment) node.update.mockReturnValue(chain(updateEnrollment));
        return node;
      }
      return chain({ data: null, error: null });
    }),
  };
}

function authDb(user) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) } };
}

const USER = { id: "user-1", email: "ethan@example.com" };
const PROVIDER = {
  mode: "test",
  createAutopaySetupIntent: vi.fn(async () => ({ setupIntentId: "seti_1", clientSecret: "seti_secret" })),
  retrieveSetupIntent: vi.fn(async () => ({ setupIntentId: "seti_1", status: "succeeded", paymentMethodId: "pm_bank_1", mandateId: "mandate_1" })),
  createPrivateFinancingCustomer: vi.fn(async () => ({ customerId: "cus_1" })),
};

function post(body) {
  return new Request("https://test/api/private-financing/portal", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createStripeBillingProvider.mockReturnValue(PROVIDER);
});

describe("POST request-autopay", () => {
  it("requires authentication", async () => {
    mocks.createClient.mockResolvedValue(authDb(null));
    const response = await POST(post({ operation: "request-autopay" }));
    expect(response.status).toBe(401);
  });

  it("rejects a borrower with no linked identity", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    mocks.createRentalWebhookClient.mockReturnValue(svcDb({ borrowers: null }));
    const response = await POST(post({ operation: "request-autopay", accountId: "acct_1", chargeDay: 1, reminderDaysBefore: 3, consentConfirmed: true }));
    expect(response.status).toBe(403);
  });

  it("rejects a non-bank payment method type", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    mocks.createRentalWebhookClient.mockReturnValue(svcDb());
    const response = await POST(post({ operation: "request-autopay", accountId: "acct_1", paymentMethodType: "card", chargeDay: 1, reminderDaysBefore: 3, consentConfirmed: true }));
    expect(response.status).toBe(400);
  });

  it("rejects an invalid charge day and missing consent", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    mocks.createRentalWebhookClient.mockReturnValue(svcDb());
    const badDay = await POST(post({ operation: "request-autopay", accountId: "acct_1", chargeDay: 31, reminderDaysBefore: 3, consentConfirmed: true }));
    expect(badDay.status).toBe(400);
    const noConsent = await POST(post({ operation: "request-autopay", accountId: "acct_1", chargeDay: 1, reminderDaysBefore: 3 }));
    expect(noConsent.status).toBe(400);
  });

  it("enforces the 1-28 charge-day range at both boundaries", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    mocks.createRentalWebhookClient.mockReturnValue(svcDb());
    for (const chargeDay of [0, 29, 31, 2.5]) {
      const response = await POST(post({ operation: "request-autopay", accountId: "acct_1",
        chargeDay, reminderDaysBefore: 3, consentConfirmed: true }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("1 and 28");
    }
  });

  it("accepts the maximum charge day of 28", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    const created = { ...ENROLLMENT_SETUP, id: "pf_autopay_28", charge_day: 28, reminder_days_before: 3 };
    mocks.createRentalWebhookClient.mockReturnValue(svcDb({ insertEnrollment: { data: created, error: null } }));
    const response = await POST(post({ operation: "request-autopay", accountId: "acct_1",
      chargeDay: 28, reminderDaysBefore: 3, consentConfirmed: true }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.enrollment).toEqual(expect.objectContaining({ chargeDay: 28 }));
  });

  it("rejects when online payments are disabled for the account", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    mocks.createRentalWebhookClient.mockReturnValue(svcDb({ settings: { enabled: false } }));
    const response = await POST(post({ operation: "request-autopay", accountId: "acct_1", chargeDay: 1, reminderDaysBefore: 3, consentConfirmed: true }));
    expect(response.status).toBe(409);
  });

  it("creates a setup_required enrollment defaulting to us_bank_account", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    const created = { ...ENROLLMENT_SETUP, id: "pf_autopay_new", charge_day: 5, reminder_days_before: 2 };
    mocks.createRentalWebhookClient.mockReturnValue(svcDb({ insertEnrollment: { data: created, error: null } }));
    const response = await POST(post({ operation: "request-autopay", accountId: "acct_1", chargeDay: 5, reminderDaysBefore: 2, consentConfirmed: true }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.enrollment).toEqual(expect.objectContaining({ id: "pf_autopay_new", status: "setup_required", paymentMethodType: "us_bank_account", chargeDay: 5 }));
  });

  it("returns 409 when an enrollment already exists for the account", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    mocks.createRentalWebhookClient.mockReturnValue(svcDb({ insertEnrollment: { data: null, error: { code: "23505" } } }));
    const response = await POST(post({ operation: "request-autopay", accountId: "acct_1", chargeDay: 1, reminderDaysBefore: 3, consentConfirmed: true }));
    expect(response.status).toBe(409);
  });
});

describe("POST create-autopay-setup", () => {
  it("returns 404 for another borrower's enrollment", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    mocks.createRentalWebhookClient.mockReturnValue(svcDb({ enrollment: null }));
    const response = await POST(post({ operation: "create-autopay-setup", enrollmentId: "pf_autopay_other" }));
    expect(response.status).toBe(404);
  });

  it("rejects an enrollment that is not awaiting bank setup", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    mocks.createRentalWebhookClient.mockReturnValue(svcDb({ enrollment: { ...ENROLLMENT_SETUP, status: "active" } }));
    const response = await POST(post({ operation: "create-autopay-setup", enrollmentId: "pf_autopay_1" }));
    expect(response.status).toBe(409);
  });

  it("returns a SetupIntent client secret and stores the setup intent id", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    const db = svcDb({ updateEnrollment: { data: { id: "pf_autopay_1" }, error: null } });
    mocks.createRentalWebhookClient.mockReturnValue(db);
    const response = await POST(post({ operation: "create-autopay-setup", enrollmentId: "pf_autopay_1" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ enrollmentId: "pf_autopay_1", setupIntentId: "seti_1", clientSecret: "seti_secret", connectedAccountId: "acct_kent" }));
    expect(PROVIDER.createAutopaySetupIntent).toHaveBeenCalled();
    const stored = db.from.mock.results
      .map((r) => r.value?.update?.mock?.calls?.[0]?.[0])
      .find((payload) => payload && payload.setup_intent_id === "seti_1");
    expect(stored).toBeDefined();
  });
});

describe("POST complete-autopay-setup", () => {
  it("rejects a setup intent that does not match the enrollment", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    mocks.createRentalWebhookClient.mockReturnValue(svcDb());
    const response = await POST(post({ operation: "complete-autopay-setup", enrollmentId: "pf_autopay_1", setupIntentId: "seti_other" }));
    expect(response.status).toBe(409);
  });

  it("rejects when the bank verification did not succeed", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    mocks.createRentalWebhookClient.mockReturnValue(svcDb());
    PROVIDER.retrieveSetupIntent.mockResolvedValueOnce({ setupIntentId: "seti_1", status: "requires_payment_method", paymentMethodId: null, mandateId: null });
    const response = await POST(post({ operation: "complete-autopay-setup", enrollmentId: "pf_autopay_1", setupIntentId: "seti_1" }));
    expect(response.status).toBe(409);
  });

  it("activates the enrollment with the verified bank payment method and mandate", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    const activated = { ...ENROLLMENT_SETUP, status: "active", charge_day: 1, retry_limit: 0, reminder_days_before: 3, consented_at: "2026-09-23T00:00:00Z", cancelled_at: null };
    const db = svcDb({ updateEnrollment: { data: activated, error: null } });
    mocks.createRentalWebhookClient.mockReturnValue(db);
    const response = await POST(post({ operation: "complete-autopay-setup", enrollmentId: "pf_autopay_1", setupIntentId: "seti_1" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.enrollment).toEqual(expect.objectContaining({ id: "pf_autopay_1", status: "active" }));
    const updateCall = db.from.mock.results.flatMap((r) => (r.value?.update?.mock?.calls?.length ? [r.value] : []));
    const stored = updateCall[0].update.mock.calls[0][0];
    expect(stored).toEqual(expect.objectContaining({ provider_payment_method_id: "pm_bank_1", provider_mandate_id: "mandate_1", provider_customer_id: "cus_1", status: "active" }));
    expect(stored.activated_at).toBeTruthy();
  });
});

describe("POST cancel-autopay", () => {
  it("returns 404 when the enrollment is not owned by the borrower", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    mocks.createRentalWebhookClient.mockReturnValue(svcDb({ updateEnrollment: { data: null, error: null } }));
    const response = await POST(post({ operation: "cancel-autopay", enrollmentId: "pf_autopay_other" }));
    expect(response.status).toBe(404);
  });

  it("cancels an active enrollment", async () => {
    mocks.createClient.mockResolvedValue(authDb(USER));
    const cancelled = { ...ENROLLMENT_SETUP, status: "cancelled", charge_day: 1, retry_limit: 0, reminder_days_before: 3, consented_at: "2026-09-23T00:00:00Z", cancelled_at: "2026-09-23T11:00:00Z" };
    mocks.createRentalWebhookClient.mockReturnValue(svcDb({ updateEnrollment: { data: cancelled, error: null } }));
    const response = await POST(post({ operation: "cancel-autopay", enrollmentId: "pf_autopay_1", reason: "switching banks" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.enrollment.status).toBe("cancelled");
  });
});
