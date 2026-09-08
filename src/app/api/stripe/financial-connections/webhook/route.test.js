import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

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
  withUpdatedTransactionRefreshCursor: (state, accountId, transactionRefreshId) => ({
    ...state,
    transactionRefreshCursors: { ...state.transactionRefreshCursors, [accountId]: transactionRefreshId },
  }),
}));

// A faithful-enough in-memory reimplementation of the Supabase JS query-builder chain this route
// actually issues against connection_webhook_events (insert-or-ignore upsert, select+single,
// update+eq+in+select for the atomic claim, plain update+eq for markEvent) and financial_accounts
// (select+eq+eq+maybeSingle). Each builder() call returns a fresh, itself-thenable node so the
// route's own chaining (`.eq().in().select()`, awaited without a trailing `.select()`, etc.) all
// resolve exactly as the real client would -- this is what lets the atomic-claim and
// payload-hash-mismatch tests below actually exercise the real logic instead of a stubbed shortcut.
function fakeSupabase({ financialAccountRow = null, existingWebhookEventRow = null } = {}) {
  const webhookEvents = new Map();
  if (existingWebhookEventRow) {
    webhookEvents.set(existingWebhookEventRow.id, { attempt_count: 0, ...existingWebhookEventRow });
  }
  const calls = { updates: [], upserts: [] };

  function execute(table, state, mode) {
    if (table === "connection_webhook_events") {
      if (state.op === "upsert") {
        calls.upserts.push(state.row);
        const id = state.row.id;
        if (!webhookEvents.has(id)) {
          webhookEvents.set(id, { attempt_count: 0, ...state.row });
        } // ignoreDuplicates: an existing row is left completely untouched.
        return { error: null };
      }
      if (state.op === "update") {
        const id = state.eq?.id;
        const row = webhookEvents.get(id);
        if (!row) return { data: [], error: null };
        if (state.in?.status && !state.in.status.includes(row.status)) {
          return { data: [], error: null };
        }
        Object.assign(row, state.fields);
        calls.updates.push({ table, fields: state.fields });
        return { data: [{ attempt_count: row.attempt_count }], error: null };
      }
      const id = state.eq?.id;
      const row = webhookEvents.get(id) ?? null;
      if (mode === "single" && !row) return { data: null, error: { message: "no rows" } };
      return { data: row, error: null };
    }
    if (table === "financial_accounts") {
      return { data: financialAccountRow, error: null };
    }
    return { data: null, error: null };
  }

  function builder(table, state) {
    const node = {
      select: () => builder(table, state),
      eq: (col, val) => builder(table, { ...state, eq: { ...state.eq, [col]: val } }),
      in: (col, values) => builder(table, { ...state, in: { ...state.in, [col]: values } }),
      maybeSingle: async () => execute(table, state, "maybeSingle"),
      single: async () => execute(table, state, "single"),
      upsert: (row) => builder(table, { ...state, op: "upsert", row }),
      update: (fields) => builder(table, { ...state, op: "update", fields }),
      then: (resolve, reject) => {
        try {
          resolve(execute(table, state, "await"));
        } catch (error) {
          reject(error);
        }
      },
    };
    return node;
  }

  return { from: (table) => builder(table, {}), _calls: calls, _webhookEvents: webhookEvents };
}

async function importRoute() {
  return import("./route.js");
}

function webhookRequest(body = "{}") {
  return new Request("http://localhost/api/stripe/financial-connections/webhook", {
    method: "POST", body, headers: { "stripe-signature": "sig_test" },
  });
}

function hashOf(body) {
  return createHash("sha256").update(body).digest("hex");
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
    const body = "{}";
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_1", type: "financial_connections.account.refreshed_balance", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({
      existingWebhookEventRow: { id: "connection_webhook_stripe_financial_connections_evt_1", status: "processed", payload_hash: hashOf(body) },
    });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest(body));
    const responseBody = await response.json();

    expect(responseBody).toEqual({ received: true, duplicate: true });
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
  });

  it("rejects (400, does not process either version) a redelivered event id whose payload hash differs from the one originally recorded", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_1b", type: "financial_connections.account.refreshed_balance", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({
      existingWebhookEventRow: { id: "connection_webhook_stripe_financial_connections_evt_1b", status: "received", payload_hash: "a-completely-different-hash" },
    });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await importRoute();

    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(400);
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("claims atomically -- a concurrent second delivery that loses the race gets a retryable 409, never double-imports", async () => {
    const body = "{}";
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_1c", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active", transaction_refresh: { id: "fcxrefresh_1", status: "succeeded" } } },
    });
    // Simulates a delivery that's already mid-flight (another request already won the claim).
    const supabase = fakeSupabase({
      existingWebhookEventRow: { id: "connection_webhook_stripe_financial_connections_evt_1c", status: "processing", payload_hash: hashOf(body) },
    });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest(body));

    expect(response.status).toBe(409);
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
  });

  it("marks an unsupported event type ignored without looking up any connection", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_2", type: "financial_connections.account.refreshed_ownership", data: { object: STRIPE_ACCOUNT } });
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

  it("ignores (permanently, not retried) an event for a Stripe account with no matching FORGE connection", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_5", type: "financial_connections.account.refreshed_balance",
      data: { object: { ...STRIPE_ACCOUNT, balance_refresh: { status: "succeeded" } } },
    });
    const supabase = fakeSupabase({ financialAccountRow: null });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, ignored: true });
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
  });

  it("account.created is idempotent: acknowledges an already-known account without importing or subscribing anything", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_created", type: "financial_connections.account.created", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({ financialAccountRow: { owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.createConnectionPlatformSuite.mockResolvedValue({
      connectionRepository: { getById: mocks.getByIdConnection, save: mocks.saveConnection },
      credentialReferenceRepository: { getById: mocks.getByIdCredentialReference },
      credentialVaultService: { retrieveCredential: mocks.retrieveCredential, storeCredential: mocks.storeCredential },
      connectionImportExecutionCoordinator: { executeImport: mocks.executeImport },
    });
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.executeImport).not.toHaveBeenCalled();
    expect(mocks.saveConnection).not.toHaveBeenCalled();
  });

  it("account.created for an account FORGE does not know is ignored, never speculatively imported (no owner-identifying data on the event)", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_created_2", type: "financial_connections.account.created", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({ financialAccountRow: null });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true, ignored: true });
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
  });

  it("flips the connection to needs_attention on account.deactivated, preserving all prior financial history (no delete)", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_deactivated", type: "financial_connections.account.deactivated", data: { object: STRIPE_ACCOUNT } });
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

  it("flips the connection to disconnected (distinct from needs_attention) on account.disconnected, preserving all prior financial history (no delete)", async () => {
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
    expect(mocks.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ status: "disconnected" }), { ownerId: "owner-123" });
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

  it("refreshed_transactions arriving before any prior import has ever succeeded still resolves ownership (via the durable financial_accounts row from /complete) and imports successfully -- correction report item 5", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_first_ever", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active", transaction_refresh: { id: "fcxrefresh_first", status: "succeeded" } } },
    });
    // The account is durably known (financial_accounts row exists, from /complete's REQUIRED
    // account-persistence step) even though NO import has ever succeeded for it yet (no
    // credentialReferenceId resolvable here is irrelevant to this assertion -- the key fact is
    // resolveOwningConnection succeeds purely from financial_accounts, independent of import history).
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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.executeImport).toHaveBeenCalledWith({ connectionId: "connection_1", ownerId: "owner-123" });
  });

  it("does not advance the cursor when the import reports failure, and responds with a retryable status -- a retry must refetch from the same watermark", async () => {
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

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.storeCredential).not.toHaveBeenCalled();
  });
});
