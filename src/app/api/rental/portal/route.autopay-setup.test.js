import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = { id: "tenant_1", owner_id: "owner_1", auth_user_id: "auth_tenant_1",
  email: "tyler@example.com", display_name: "Tyler Welch" };
const ENROLLMENT = { id: "auto_1", owner_id: "owner_1", tenant_id: "tenant_1", lease_id: "lease_1",
  status: "setup_required", payment_method_type: "us_bank_account", charge_day: 1 };
const ACCOUNT = { owner_id: "owner_1", provider: "stripe", provider_mode: "test",
  provider_account_id: "acct_kent", status: "enabled", charges_enabled: true, payouts_enabled: true };
const CUSTOMER = { owner_id: "owner_1", tenant_id: "tenant_1", provider: "stripe", provider_mode: "test",
  connected_account_id: "acct_kent", customer_id: "cus_tenant" };

let dbState;
let updateCalls;
let database;

function resolve(call) {
  if (call.table === "rental_tenants") return { data: dbState.tenant, error: null };
  if (call.table === "rental_autopay_enrollments") {
    if (call.op === "update") {
      updateCalls.push(call.values);
      return { data: { ...dbState.enrollment, ...call.values }, error: null };
    }
    return { data: dbState.enrollment, error: null };
  }
  if (call.table === "landlord_payment_accounts") return { data: dbState.account, error: null };
  if (call.table === "billing_customer_references") {
    if (call.op === "upsert") {
      dbState.customer = { ...CUSTOMER, ...call.values };
      return { data: dbState.customer, error: null };
    }
    return { data: dbState.customer, error: null };
  }
  return { data: null, error: null };
}

function makeDatabase() {
  return {
    from(table) {
      const call = { table, op: "select", values: null };
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        upsert(values) { call.op = "upsert"; call.values = values; return chain; },
        update(values) { call.op = "update"; call.values = values; return chain; },
        maybeSingle: async () => resolve(call),
        single: async () => resolve(call),
      };
      return chain;
    },
  };
}

const createAutopaySetupIntent = vi.fn();
const retrieveAutopaySetupIntent = vi.fn();
const createCustomer = vi.fn();

vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: vi.fn(() => ({
    mode: "test", createAutopaySetupIntent, retrieveAutopaySetupIntent, createCustomer,
  })),
}));
vi.mock("@/infrastructure/billing/stripeMode", () => ({ validatePublishableKeyMode: vi.fn() }));
vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: vi.fn(() => database),
}));
vi.mock("@/lib/supabase/createAuthenticatedTenantPortalApplication", () => ({
  createAuthenticatedTenantPortalApplication: vi.fn(async () => ({
    user: { id: "auth_tenant_1" }, supabaseClient: { rpc: vi.fn() }, application: {},
  })),
}));

import { POST } from "./route.js";

function post(body, headers = {}) {
  return POST(new Request("https://example.test/api/rental/portal", { method: "POST",
    headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
}

describe("autopay bank setup operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState = { tenant: TENANT, enrollment: ENROLLMENT, account: ACCOUNT, customer: null };
    updateCalls = [];
    database = makeDatabase();
  });

  describe("create-autopay-setup", () => {
    beforeEach(() => {
      createCustomer.mockResolvedValue({ customerId: "cus_new" });
      createAutopaySetupIntent.mockResolvedValue({ provider: "stripe", connectedAccountId: "acct_kent",
        setupIntentId: "seti_1", clientSecret: "seti_1_secret_test" });
    });
    it("creates a SetupIntent for the tenant's own pending bank enrollment, creating the customer first", async () => {
      const response = await post({ operation: "create-autopay-setup", enrollmentId: "auto_1" },
        { "x-forwarded-for": "203.0.113.5, 10.0.0.1", "user-agent": "test-agent/1.0" });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ success: true, enrollmentId: "auto_1", setupIntentId: "seti_1",
        clientSecret: "seti_1_secret_test", connectedAccountId: "acct_kent" });
      expect(createCustomer).toHaveBeenCalledWith(
        { ownerId: "owner_1", connectedAccountId: "acct_kent" },
        { tenantId: "tenant_1", email: "tyler@example.com", displayName: "Tyler Welch" },
        expect.stringContaining("billing-customer:test:owner_1:tenant_1:stripe"));
      expect(createAutopaySetupIntent).toHaveBeenCalledWith(
        { ownerId: "owner_1", connectedAccountId: "acct_kent" },
        expect.objectContaining({ customerId: "cus_new", enrollmentId: "auto_1", leaseId: "lease_1",
          tenantId: "tenant_1", ipAddress: "203.0.113.5", userAgent: "test-agent/1.0",
          idempotencyKey: expect.stringContaining("autopay-setup:auto_1:") }));
    });
    it("reuses an existing billing customer instead of creating a duplicate", async () => {
      dbState.customer = CUSTOMER;
      await post({ operation: "create-autopay-setup", enrollmentId: "auto_1" });
      expect(createCustomer).not.toHaveBeenCalled();
      expect(createAutopaySetupIntent).toHaveBeenCalledWith(expect.anything(),
        expect.objectContaining({ customerId: "cus_tenant" }));
    });
    it("rejects a missing enrollmentId before any database or Stripe work", async () => {
      const response = await post({ operation: "create-autopay-setup" });
      expect(response.status).toBe(400);
      expect(createAutopaySetupIntent).not.toHaveBeenCalled();
    });
    it("rejects when the tenant has no portal access", async () => {
      dbState.tenant = null;
      const response = await post({ operation: "create-autopay-setup", enrollmentId: "auto_1" });
      expect(response.status).toBe(403);
      expect(createAutopaySetupIntent).not.toHaveBeenCalled();
    });
    it("rejects an enrollment that is not the tenant's own pending enrollment", async () => {
      dbState.enrollment = null;
      const response = await post({ operation: "create-autopay-setup", enrollmentId: "auto_other" });
      expect(response.status).toBe(404);
      expect(createAutopaySetupIntent).not.toHaveBeenCalled();
    });
    it("rejects card enrollments — this slice is bank-only", async () => {
      dbState.enrollment = { ...ENROLLMENT, payment_method_type: "card" };
      const response = await post({ operation: "create-autopay-setup", enrollmentId: "auto_1" });
      expect(response.status).toBe(400);
      expect(createAutopaySetupIntent).not.toHaveBeenCalled();
    });
    it("rejects when the landlord payment account is not ready", async () => {
      dbState.account = null;
      const response = await post({ operation: "create-autopay-setup", enrollmentId: "auto_1" });
      expect(response.status).toBe(409);
      expect(createAutopaySetupIntent).not.toHaveBeenCalled();
    });
  });

  describe("complete-autopay-setup", () => {
    beforeEach(() => {
      dbState.customer = CUSTOMER;
      retrieveAutopaySetupIntent.mockResolvedValue({ id: "seti_1", status: "succeeded",
        customerId: "cus_tenant", paymentMethodId: "pm_bank_1", mandateId: "mandate_bank_1", enrollmentId: "auto_1" });
    });
    it("activates the enrollment with the verified bank payment method and mandate", async () => {
      const response = await post({ operation: "complete-autopay-setup",
        enrollmentId: "auto_1", setupIntentId: "seti_1" });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]).toEqual(expect.objectContaining({ status: "active",
        provider_customer_id: "cus_tenant", provider_payment_method_id: "pm_bank_1",
        provider_mandate_id: "mandate_bank_1", activated_at: expect.any(String) }));
      expect(retrieveAutopaySetupIntent).toHaveBeenCalledWith(
        expect.objectContaining({ connectedAccountId: "acct_kent" }), "seti_1");
    });
    it("rejects a setup intent that has not succeeded", async () => {
      retrieveAutopaySetupIntent.mockResolvedValueOnce({ id: "seti_1", status: "requires_payment_method",
        customerId: "cus_tenant", paymentMethodId: null, mandateId: null, enrollmentId: "auto_1" });
      const response = await post({ operation: "complete-autopay-setup",
        enrollmentId: "auto_1", setupIntentId: "seti_1" });
      expect(response.status).toBe(409);
      expect(updateCalls).toHaveLength(0);
    });
    it("rejects a setup intent bound to a different enrollment", async () => {
      retrieveAutopaySetupIntent.mockResolvedValueOnce({ id: "seti_1", status: "succeeded",
        customerId: "cus_tenant", paymentMethodId: "pm_bank_1", mandateId: "mandate_bank_1", enrollmentId: "auto_other" });
      const response = await post({ operation: "complete-autopay-setup",
        enrollmentId: "auto_1", setupIntentId: "seti_1" });
      expect(response.status).toBe(403);
      expect(updateCalls).toHaveLength(0);
    });
    it("rejects a setup intent belonging to a different customer", async () => {
      retrieveAutopaySetupIntent.mockResolvedValueOnce({ id: "seti_1", status: "succeeded",
        customerId: "cus_other", paymentMethodId: "pm_bank_1", mandateId: "mandate_bank_1", enrollmentId: "auto_1" });
      const response = await post({ operation: "complete-autopay-setup",
        enrollmentId: "auto_1", setupIntentId: "seti_1" });
      expect(response.status).toBe(403);
      expect(updateCalls).toHaveLength(0);
    });
    it("rejects a succeeded intent that produced no payment method", async () => {
      retrieveAutopaySetupIntent.mockResolvedValueOnce({ id: "seti_1", status: "succeeded",
        customerId: "cus_tenant", paymentMethodId: null, mandateId: null, enrollmentId: "auto_1" });
      const response = await post({ operation: "complete-autopay-setup",
        enrollmentId: "auto_1", setupIntentId: "seti_1" });
      expect(response.status).toBe(409);
      expect(updateCalls).toHaveLength(0);
    });
    it("rejects missing identifiers before any Stripe work", async () => {
      const response = await post({ operation: "complete-autopay-setup", enrollmentId: "auto_1" });
      expect(response.status).toBe(400);
      expect(retrieveAutopaySetupIntent).not.toHaveBeenCalled();
    });
    it("rejects an enrollment that is not the tenant's own pending enrollment", async () => {
      dbState.enrollment = null;
      const response = await post({ operation: "complete-autopay-setup",
        enrollmentId: "auto_other", setupIntentId: "seti_1" });
      expect(response.status).toBe(404);
      expect(retrieveAutopaySetupIntent).not.toHaveBeenCalled();
    });
  });
});
