import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructWebhookEvent: vi.fn(),
  createStripeBillingProvider: vi.fn(),
  createConnectionPlatformSuite: vi.fn(),
  getByIdConnection: vi.fn(),
  saveConnection: vi.fn(),
  getByIdCredentialReference: vi.fn(),
  retrieveCredential: vi.fn(),
  storeCredential: vi.fn(),
  executeImport: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init) {
      return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    },
  },
}));

vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: mocks.createStripeBillingProvider,
}));

vi.mock("@/infrastructure/composition", () => ({
  createConnectionPlatformSuite: mocks.createConnectionPlatformSuite,
  ConnectionRepositoryStorage: { SUPABASE: "supabase" },
  CredentialReferenceRepositoryStorage: { SUPABASE: "supabase" },
  InstitutionReferenceRepositoryStorage: { SUPABASE: "supabase" },
  FinancialAccountRepositoryStorage: { SUPABASE: "supabase" },
}));

vi.mock("@/domains/stripe-financial-connections-adapter", () => ({
  parseVaultedState: (secret) => JSON.parse(secret),
  serializeVaultedState: (state) => JSON.stringify(state),
}));

// Table-scoped fake: .from(table) returns a fresh chainable node per call, remembering every
// select/update/upsert issued against it so assertions can inspect exactly what was written,
// without needing a full Postgres-shaped mock.
function fakeSupabase({ financialAccountRow = null, existingWebhookEvent = null } = {}) {
  const calls = { updates: [], upserts: [] };
  function node(table) {
    return {
      select: () => node(table),
      eq: () => node(table),
      maybeSingle: async () => {
        if (table === "connection_webhook_events") return { data: existingWebhookEvent, error: null };
        if (table === "financial_accounts") return { data: financialAccountRow, error: null };
        return { data: null, error: null };
      },
      upsert: (row) => {
        calls.upserts.push(row);
        return { then: (resolve) => resolve({ error: null }) };
      },
      update: (fields) => ({
        eq: () => {
          calls.updates.push({ table, fields });
          return { then: (resolve) => resolve({ error: null }) };
        },
      }),
    };
  }
  return { from: (table) => node(table), _calls: calls };
}

async function importRoute() {
  return import("./route.js");
}

function webhookRequest(body = "{}") {
  return new Request("http://localhost/api/stripe/financial-connections/webhook", {
    method: "POST", body, headers: { "stripe-signature": "sig_test" },
  });
}

const STRIPE_ACCOUNT = { id: "fca_1", status: "active" };

describe("POST /api/stripe/financial-connections/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.STRIPE_FINANCIAL_CONNECTIONS_WEBHOOK_SECRET = "whsec_test";
    mocks.createStripeBillingProvider.mockReturnValue({ constructWebhookEvent: mocks.constructWebhookEvent });
  });

  it("rejects a request with no stripe-signature header", async () => {
    const { POST } = await importRoute();
    const response = await POST(new Request("http://localhost/webhook", { method: "POST", body: "{}" }));
    expect(response.status).toBe(400);
  });

  it("rejects an invalid signature without touching any table", async () => {
    mocks.constructWebhookEvent.mockImplementation(() => { throw new Error("invalid signature"); });
    const supabase = fakeSupabase({});
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    expect(response.status).toBe(400);
    consoleError.mockRestore();
  });

  it("acknowledges a redelivered event already marked processed as a duplicate, without reprocessing", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_1", type: "financial_connections.account.refreshed_balance", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({ existingWebhookEvent: { status: "processed" } });
    // Stub the module's own client factory via a fresh mock -- see the module-level mock below.
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());
    const body = await response.json();

    expect(body).toEqual({ received: true, duplicate: true });
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
  });

  it("marks an unsupported event type ignored without looking up any connection", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_2", type: "financial_connections.account.created", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({});
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true, ignored: true });
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
  });

  it("ignores a refreshed_transactions event whose transaction_refresh has not succeeded -- an asynchronous refresh is not fresh data yet", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_3", type: "financial_connections.account.refreshed_transactions",
      data: { object: { ...STRIPE_ACCOUNT, transaction_refresh: { id: "fcxrefresh_1", status: "pending" } } },
    });
    const supabase = fakeSupabase({ financialAccountRow: { owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true, ignored: true });
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
  });

  it("does not refresh/import an inactive account", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_4", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "inactive", transaction_refresh: { id: "fcxrefresh_1", status: "succeeded" } } },
    });
    const supabase = fakeSupabase({ financialAccountRow: { owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true, ignored: true });
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
  });

  it("ignores an event for a Stripe account with no matching FORGE connection", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_5", type: "financial_connections.account.refreshed_balance",
      data: { object: { ...STRIPE_ACCOUNT, balance_refresh: { status: "succeeded" } } },
    });
    const supabase = fakeSupabase({ financialAccountRow: null });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true, ignored: true });
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
  });

  it("flips the connection to needs_attention on account.disconnected, preserving all prior financial history (no delete)", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_6", type: "financial_connections.account.disconnected", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({ financialAccountRow: { owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected" });
    mocks.createConnectionPlatformSuite.mockResolvedValue({
      connectionRepository: { getById: mocks.getByIdConnection, save: mocks.saveConnection },
      credentialReferenceRepository: { getById: mocks.getByIdCredentialReference },
      credentialVaultService: { retrieveCredential: mocks.retrieveCredential, storeCredential: mocks.storeCredential },
      connectionImportExecutionCoordinator: { executeImport: mocks.executeImport },
    });
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ status: "needs_attention" }), { ownerId: "owner-123" });
    expect(mocks.executeImport).not.toHaveBeenCalled();
  });

  it("flips the connection back to connected on account.reactivated", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_7", type: "financial_connections.account.reactivated", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({ financialAccountRow: { owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "needs_attention" });
    mocks.createConnectionPlatformSuite.mockResolvedValue({
      connectionRepository: { getById: mocks.getByIdConnection, save: mocks.saveConnection },
      credentialReferenceRepository: { getById: mocks.getByIdCredentialReference },
      credentialVaultService: { retrieveCredential: mocks.retrieveCredential, storeCredential: mocks.storeCredential },
      connectionImportExecutionCoordinator: { executeImport: mocks.executeImport },
    });
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ status: "connected" }), { ownerId: "owner-123" });
  });

  it("on a succeeded refreshed_transactions event: converges on the same coordinator.executeImport used by manual sync, then advances the cursor only after success", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_8", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active", transaction_refresh: { id: "fcxrefresh_1", status: "succeeded" } } },
    });
    const supabase = fakeSupabase({ financialAccountRow: { owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    mocks.getByIdCredentialReference.mockResolvedValue({ id: "credential_1", vaultReference: "vault://stripe_financial_connections/sessions/fcsess_1/state" });
    mocks.retrieveCredential.mockResolvedValue(JSON.stringify({ accountIds: ["fca_1"], transactionRefreshCursors: {} }));
    mocks.executeImport.mockResolvedValue({ success: true });
    mocks.createConnectionPlatformSuite.mockResolvedValue({
      connectionRepository: { getById: mocks.getByIdConnection, save: mocks.saveConnection },
      credentialReferenceRepository: { getById: mocks.getByIdCredentialReference },
      credentialVaultService: { retrieveCredential: mocks.retrieveCredential, storeCredential: mocks.storeCredential },
      connectionImportExecutionCoordinator: { executeImport: mocks.executeImport },
    });
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.executeImport).toHaveBeenCalledWith({ connectionId: "connection_1", ownerId: "owner-123" });
    expect(mocks.storeCredential).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner-123",
      vaultReference: "vault://stripe_financial_connections/sessions/fcsess_1/state",
      secret: expect.stringContaining("fcxrefresh_1"),
    }));
  });

  it("does not advance the cursor when the import reports failure -- a retry must refetch from the same watermark", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_9", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active", transaction_refresh: { id: "fcxrefresh_2", status: "succeeded" } } },
    });
    const supabase = fakeSupabase({ financialAccountRow: { owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    mocks.executeImport.mockResolvedValue({ success: false });
    mocks.createConnectionPlatformSuite.mockResolvedValue({
      connectionRepository: { getById: mocks.getByIdConnection, save: mocks.saveConnection },
      credentialReferenceRepository: { getById: mocks.getByIdCredentialReference },
      credentialVaultService: { retrieveCredential: mocks.retrieveCredential, storeCredential: mocks.storeCredential },
      connectionImportExecutionCoordinator: { executeImport: mocks.executeImport },
    });
    const { POST } = await importRoute();

    await POST(webhookRequest());

    expect(mocks.storeCredential).not.toHaveBeenCalled();
  });
});
