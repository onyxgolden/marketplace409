import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  constructWebhookEvent: vi.fn(),
  createStripeBillingProvider: vi.fn(),
  createConnectionPlatformSuite: vi.fn(),
  getByIdConnection: vi.fn(),
  saveConnection: vi.fn(),
  getByIdCredentialReference: vi.fn(),
  getAllInstitutionReferences: vi.fn(),
  retrieveCredential: vi.fn(),
  createStripeFinancialConnectionsRefreshCoordinator: vi.fn(),
  processRefresh: vi.fn(),
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
  createStripeFinancialConnectionsRefreshCoordinator: mocks.createStripeFinancialConnectionsRefreshCoordinator,
}));

// SupabaseFinancialAccountRefreshRepository itself is never exercised here -- the coordinator it
// would be passed to is fully mocked (mocks.processRefresh) at the route-test level. Its own
// claim/commit atomicity is proven against a real database in
// SupabaseFinancialAccountRefreshRepository.integration.test.js instead.
vi.mock("@/domains/financial-account-refresh", () => ({
  SupabaseFinancialAccountRefreshRepository: function SupabaseFinancialAccountRefreshRepository() {},
}));

// A faithful-enough in-memory reimplementation of the Supabase JS query-builder chain this route
// actually issues against connection_webhook_events (insert-or-ignore upsert, select+single,
// update+eq+in+select for the atomic claim, plain update+eq for markEvent) and financial_accounts
// (select+eq+eq+maybeSingle). Each builder() call returns a fresh, itself-thenable node so the
// route's own chaining (`.eq().in().select()`, awaited without a trailing `.select()`, etc.) all
// resolve exactly as the real client would -- this is what lets the atomic-claim and
// payload-hash-mismatch tests below actually exercise the real logic instead of a stubbed shortcut.
function fakeSupabase({ financialAccountRow = null, existingWebhookEventRow = null } = {}) {
  // Mutable, not the original destructured const -- lets a test simulate ownership becoming
  // resolvable partway through (e.g. /complete finishing between two webhook deliveries) via
  // setFinancialAccountRow(...), without reconstructing the harness and losing webhookEvents state.
  let currentFinancialAccountRow = financialAccountRow;
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
        // A plain .eq("status", ...) alongside .eq("id", ...) -- used by the stale-reclaim
        // UPDATE -- is a SEPARATE column from the id filter above; state.eq merges all .eq()
        // calls into one object keyed by column, so check it distinctly from `id`.
        if (state.eq?.status !== undefined && row.status !== state.eq.status) {
          return { data: [], error: null };
        }
        // A minimal parser for the ONE .or() shape the stale-reclaim query actually issues:
        // "claimed_at.is.null,claimed_at.lt.<iso>" -- true if ANY comma-separated condition
        // matches, exactly like PostgREST's own `.or()` semantics.
        if (state.or) {
          const matchesAny = state.or.split(",").some((condition) => {
            const [col, op, ...valueParts] = condition.split(".");
            const value = valueParts.join(".");
            if (op === "is" && value === "null") return row[col] === null || row[col] === undefined;
            if (op === "lt") return row[col] != null && row[col] < value;
            return false;
          });
          if (!matchesAny) return { data: [], error: null };
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
      return { data: currentFinancialAccountRow, error: null };
    }
    return { data: null, error: null };
  }

  function builder(table, state) {
    const node = {
      select: () => builder(table, state),
      eq: (col, val) => builder(table, { ...state, eq: { ...state.eq, [col]: val } }),
      in: (col, values) => builder(table, { ...state, in: { ...state.in, [col]: values } }),
      or: (filterString) => builder(table, { ...state, or: filterString }),
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

  return {
    from: (table) => builder(table, {}),
    _calls: calls,
    _webhookEvents: webhookEvents,
    setFinancialAccountRow: (row) => { currentFinancialAccountRow = row; },
  };
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

// Every test that reaches past ownership resolution into the refreshed_balance/refreshed_
// transactions path needs this same shape -- centralizing it here keeps each test focused on
// what it's actually asserting instead of re-listing every repository the route now touches.
function connectionPlatformSuiteStub(overrides = {}) {
  return {
    connectionRepository: { getById: mocks.getByIdConnection, save: mocks.saveConnection },
    credentialReferenceRepository: { getById: mocks.getByIdCredentialReference },
    institutionReferenceRepository: { getAll: mocks.getAllInstitutionReferences },
    credentialVaultService: { retrieveCredential: mocks.retrieveCredential },
    accountBalanceRepository: {},
    financialEventImportService: {},
    ...overrides,
  };
}

describe("POST /api/stripe/financial-connections/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.STRIPE_FINANCIAL_CONNECTIONS_WEBHOOK_SECRET = "whsec_test";
    mocks.createStripeBillingProvider.mockReturnValue({ constructWebhookEvent: mocks.constructWebhookEvent, stripe: {} });
    mocks.getAllInstitutionReferences.mockResolvedValue([{ id: "institution_1", connectionId: "connection_1" }]);
    mocks.getByIdCredentialReference.mockResolvedValue({ id: "credential_1", vaultReference: "vault://stripe_financial_connections/sessions/fcsess_1/state" });
    mocks.retrieveCredential.mockResolvedValue(null);
    mocks.createStripeFinancialConnectionsRefreshCoordinator.mockReturnValue({ processRefresh: mocks.processRefresh });
    mocks.processRefresh.mockResolvedValue({ outcome: "committed", importedCount: 1 });
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

  it("claims atomically -- a concurrent second delivery that loses the race gets a retryable 409, never double-imports (fresh processing claim, well within the staleness timeout)", async () => {
    const body = "{}";
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_1c", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active" } },
    });
    // Simulates a delivery that's already mid-flight (another request already won the claim
    // seconds ago -- well within the staleness timeout, so this must NOT be treated as abandoned).
    const supabase = fakeSupabase({
      existingWebhookEventRow: {
        id: "connection_webhook_stripe_financial_connections_evt_1c", status: "processing", payload_hash: hashOf(body),
        claimed_at: new Date(Date.now() - 5_000).toISOString(),
      },
    });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest(body));

    expect(response.status).toBe(409);
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
  });

  // Mirrors the route's own STALE_PROCESSING_TIMEOUT_MS (5 minutes) -- not imported directly since
  // the route doesn't export it, but the value itself is exactly what makes a claimed_at "stale"
  // for these tests.
  const STALE_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

  it("reclaims a STALE 'processing' row (claimed_at older than the timeout -- confirmed live: a dev-server restart mid-request left a real row exactly like this) atomically: increments attempt_count, preserves received_at, and proceeds to import", async () => {
    const body = "{}";
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_stale", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active" } },
    });
    const originalReceivedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    const staleClaimedAt = new Date(Date.now() - STALE_PROCESSING_TIMEOUT_MS - 60_000).toISOString(); // stale by 1 extra minute
    const supabase = fakeSupabase({
      financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" },
      existingWebhookEventRow: {
        id: "connection_webhook_stripe_financial_connections_evt_stale", status: "processing", payload_hash: hashOf(body),
        attempt_count: 1, received_at: originalReceivedAt, claimed_at: staleClaimedAt,
      },
    });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST } = await importRoute();

    const response = await POST(webhookRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, refreshOutcome: "committed" });
    expect(mocks.processRefresh).toHaveBeenCalledTimes(1);
    const row = supabase._webhookEvents.get("connection_webhook_stripe_financial_connections_evt_stale");
    expect(row.status).toBe("processed");
    expect(row.attempt_count).toBe(2); // incremented, exactly like a normal claim
    expect(row.received_at).toBe(originalReceivedAt); // never touched, even by the stale-reclaim
  });

  it("reclaims a 'processing' row with a NULL claimed_at (a row that entered processing BEFORE this column/recovery mechanism existed) -- treated as stale/unknown, not as fresh, so it is never stuck forever. Confirmed live: exactly this shape was found in the real database from an earlier crashed request.", async () => {
    const body = "{}";
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_null_claimed_at", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active" } },
    });
    const originalReceivedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const supabase = fakeSupabase({
      financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" },
      existingWebhookEventRow: {
        id: "connection_webhook_stripe_financial_connections_evt_null_claimed_at", status: "processing", payload_hash: hashOf(body),
        attempt_count: 1, received_at: originalReceivedAt, claimed_at: null,
      },
    });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST } = await importRoute();

    const response = await POST(webhookRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, refreshOutcome: "committed" });
    const row = supabase._webhookEvents.get("connection_webhook_stripe_financial_connections_evt_null_claimed_at");
    expect(row.status).toBe("processed");
    expect(row.attempt_count).toBe(2);
    expect(row.received_at).toBe(originalReceivedAt);
  });

  it("refuses to reclaim a 'processing' row that is NOT yet stale (claimed_at within the timeout) -- must not preempt a request that is genuinely still in flight", async () => {
    const body = "{}";
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_not_stale_yet", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active" } },
    });
    const almostStaleClaimedAt = new Date(Date.now() - STALE_PROCESSING_TIMEOUT_MS + 30_000).toISOString(); // 30s short of stale
    const supabase = fakeSupabase({
      existingWebhookEventRow: {
        id: "connection_webhook_stripe_financial_connections_evt_not_stale_yet", status: "processing", payload_hash: hashOf(body),
        attempt_count: 1, claimed_at: almostStaleClaimedAt,
      },
    });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest(body));

    expect(response.status).toBe(409);
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
    const row = supabase._webhookEvents.get("connection_webhook_stripe_financial_connections_evt_not_stale_yet");
    expect(row.attempt_count).toBe(1); // never incremented -- this request never claimed anything
    expect(row.status).toBe("processing"); // left exactly as it was
  });

  it("two concurrent stale-reclaim attempts for the SAME stuck row: only one succeeds, the other still gets a retryable 409 -- no double-processing even during recovery", async () => {
    const body = "{}";
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_concurrent_stale", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active" } },
    });
    const staleClaimedAt = new Date(Date.now() - STALE_PROCESSING_TIMEOUT_MS - 60_000).toISOString();
    const supabase = fakeSupabase({
      financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" },
      existingWebhookEventRow: {
        id: "connection_webhook_stripe_financial_connections_evt_concurrent_stale", status: "processing", payload_hash: hashOf(body),
        attempt_count: 1, claimed_at: staleClaimedAt,
      },
    });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST: POST_1 } = await importRoute();
    // Same in-memory store, same event -- simulates two concurrent redeliveries both attempting
    // the stale reclaim. The fake store's synchronous execute() serializes these exactly the way
    // Postgres row-level locking would for two real concurrent UPDATEs.
    const [firstResponse, secondResponse] = await Promise.all([
      POST_1(webhookRequest(body)),
      POST_1(webhookRequest(body)),
    ]);

    const statuses = [firstResponse.status, secondResponse.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(mocks.processRefresh).toHaveBeenCalledTimes(1); // only the winner ever imported
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

  it("does not refresh/import an inactive account -- never even calls the refresh coordinator", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_4", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "inactive" } },
    });
    const supabase = fakeSupabase({ financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true, ignored: true });
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
    expect(mocks.processRefresh).not.toHaveBeenCalled();
  });

  it("marks unresolved ownership RETRYABLE (status 'failed', 409), not permanently ignored -- confirmed live: an event that legitimately can't resolve ownership yet (because /complete may still be persisting) must not be stuck forever the way 'ignored' used to leave it", async () => {
    const body = "{}";
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_5", type: "financial_connections.account.refreshed_balance",
      data: { object: STRIPE_ACCOUNT },
    });
    const supabase = fakeSupabase({ financialAccountRow: null });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest(body));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ received: true, retry: true });
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
    const row = supabase._webhookEvents.get("connection_webhook_stripe_financial_connections_evt_5");
    expect(row.status).toBe("failed");
    expect(row.failure_message).toMatch(/not yet resolvable/i);
  });

  it("an event that arrives before /complete finishes persisting later succeeds once ownership resolves -- attempt_count increments, received_at is preserved, no reclaim-window special-casing needed since 'failed' is already normally reclaimable", async () => {
    const body = "{}";
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_race_then_resolves", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active" } },
    });
    // First delivery: ownership genuinely not resolvable yet (no financial_accounts row).
    const supabase = fakeSupabase({ financialAccountRow: null });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const firstResponse = await POST(webhookRequest(body));
    expect(firstResponse.status).toBe(409);
    const rowId = "connection_webhook_stripe_financial_connections_evt_race_then_resolves";
    const afterFirst = supabase._webhookEvents.get(rowId);
    expect(afterFirst.status).toBe("failed");
    expect(afterFirst.attempt_count).toBe(1);
    const originalReceivedAt = afterFirst.received_at;

    // /complete has now finished persisting -- the SAME account is durably known. A redelivery
    // of the SAME event (e.g. Stripe's own retry) must now succeed.
    supabase.setFinancialAccountRow({ id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" });
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());

    const secondResponse = await POST(webhookRequest(body));

    expect(secondResponse.status).toBe(200);
    const afterSecond = supabase._webhookEvents.get(rowId);
    expect(afterSecond.status).toBe("processed");
    expect(afterSecond.attempt_count).toBe(2);
    expect(afterSecond.received_at).toBe(originalReceivedAt);
    expect(mocks.processRefresh).toHaveBeenCalledTimes(1);
  });

  it("a genuinely terminal ignored event (unsupported type) stays deduplicated forever, unlike the retryable ownership case -- proves the fix did not make every ignored event retryable", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_terminal", type: "financial_connections.account.refreshed_ownership", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({});
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const firstResponse = await POST(webhookRequest());
    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toEqual({ received: true, ignored: true });

    const secondResponse = await POST(webhookRequest());
    expect(secondResponse.status).toBe(200);
    await expect(secondResponse.json()).resolves.toEqual({ received: true, ignored: true });
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
  });

  it("two concurrent redeliveries of an ownership-not-yet-resolved event: only one claims and marks it failed, the other gets a retryable 409 -- no double-processing during the race either", async () => {
    const body = "{}";
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_concurrent_unresolved", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active" } },
    });
    const supabase = fakeSupabase({ financialAccountRow: null });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const [firstResponse, secondResponse] = await Promise.all([
      POST(webhookRequest(body)),
      POST(webhookRequest(body)),
    ]);

    const statuses = [firstResponse.status, secondResponse.status].sort();
    // One request wins the claim and marks the row 'failed' (retryable); the other, having lost
    // the claim, gets the generic claim-lost 409 -- both are non-2xx/retryable, and only one
    // actually ran resolveOwningConnection's logic and wrote failure_message.
    expect(statuses).toEqual([409, 409]);
    const row = supabase._webhookEvents.get("connection_webhook_stripe_financial_connections_evt_concurrent_unresolved");
    expect(row.attempt_count).toBe(1); // only the winner incremented it
    expect(row.status).toBe("failed");
  });

  it("account.created is idempotent: acknowledges an already-known account without importing or subscribing anything", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_created", type: "financial_connections.account.created", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({ financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.processRefresh).not.toHaveBeenCalled();
    expect(mocks.saveConnection).not.toHaveBeenCalled();
  });

  it("account.created for an account FORGE does not (yet) know is retryable, never speculatively imported (no owner-identifying data on the event) -- same reasoning as any other unresolved-ownership case: this account may simply not have finished persisting via /complete yet", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_created_2", type: "financial_connections.account.created", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({ financialAccountRow: null });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ received: true, retry: true });
    expect(mocks.createConnectionPlatformSuite).not.toHaveBeenCalled();
  });

  it("flips the connection to needs_attention on account.deactivated, preserving all prior financial history (no delete)", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_deactivated", type: "financial_connections.account.deactivated", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({ financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected" });
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ status: "needs_attention" }), { ownerId: "owner-123" });
    expect(mocks.processRefresh).not.toHaveBeenCalled();
  });

  it("flips the connection to disconnected (distinct from needs_attention) on account.disconnected, preserving all prior financial history (no delete)", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_6", type: "financial_connections.account.disconnected", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({ financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected" });
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ status: "disconnected" }), { ownerId: "owner-123" });
    expect(mocks.processRefresh).not.toHaveBeenCalled();
  });

  it("flips the connection back to connected on account.reactivated", async () => {
    mocks.constructWebhookEvent.mockReturnValue({ id: "evt_7", type: "financial_connections.account.reactivated", data: { object: STRIPE_ACCOUNT } });
    const supabase = fakeSupabase({ financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "needs_attention" });
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ status: "connected" }), { ownerId: "owner-123" });
  });

  it("on a succeeded refreshed_transactions event: resolves the account+credential+institution context and calls the refresh coordinator with it, then marks the webhook event processed", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_8", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active" } },
    });
    const supabase = fakeSupabase({ financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    mocks.retrieveCredential.mockResolvedValue(JSON.stringify({ accountIds: ["fca_1"], transactionRefreshCursors: {} }));
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    await expect(response.json()).resolves.toEqual({ received: true, refreshOutcome: "committed" });
    expect(mocks.processRefresh).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner-123",
      connectionId: "connection_1",
      financialAccountId: "financial_account_1",
      providerAccountId: "fca_1",
      feature: "transactions",
      triggeringEventId: "evt_8",
    }));
  });

  it("passes the resolved canonical workspace owner id into createConnectionPlatformSuite -- never a different value -- so webhook-triggered imports persist financial_events attributed to the correct owner", async () => {
    // financial_accounts.owner_id ("owner-123") is the ONLY source of truth for ownership on this
    // service-role webhook path -- there is no "acting user" here at all (no session exists during
    // a webhook call).
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_owner_check", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active" } },
    });
    const supabase = fakeSupabase({ financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST } = await importRoute();

    await POST(webhookRequest());

    expect(mocks.createConnectionPlatformSuite).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "owner-123" }),
    );
    // Never a different id -- there is no "acting user" concept on this path at all, so the ONLY
    // correct value is the resolved financial_accounts.owner_id itself.
    const passedDeps = mocks.createConnectionPlatformSuite.mock.calls[0][0];
    expect(passedDeps.ownerId).not.toBe("fca_1"); // never the Stripe account id
    expect(passedDeps.ownerId).not.toBeUndefined();
    expect(passedDeps.ownerId).not.toBeNull();
  });

  it("keeps received_at unchanged and increments attempt_count across a failed-then-retried delivery of the SAME event -- proven with the real atomic-claim/markEvent logic, not a mock", async () => {
    const body = "{}";
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_retry_check", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active" } },
    });
    const supabase = fakeSupabase({ financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    // First delivery: the coordinator throws (simulating a genuine import failure).
    mocks.processRefresh.mockRejectedValueOnce(new Error("Financial event owner_id is required"));
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST } = await importRoute();

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const firstResponse = await POST(webhookRequest(body));
    consoleError.mockRestore();

    expect(firstResponse.status).toBe(500);
    const rowId = "connection_webhook_stripe_financial_connections_evt_retry_check";
    const afterFirst = supabase._webhookEvents.get(rowId);
    expect(afterFirst.status).toBe("failed");
    expect(afterFirst.attempt_count).toBe(1);
    const originalReceivedAt = afterFirst.received_at;

    // Second delivery of the SAME event id (a real redelivery, e.g. via `stripe events resend`
    // after the underlying issue is fixed): this time the coordinator succeeds.
    mocks.processRefresh.mockResolvedValueOnce({ outcome: "committed", importedCount: 1 });
    const secondResponse = await POST(webhookRequest(body));

    expect(secondResponse.status).toBe(200);
    const afterSecond = supabase._webhookEvents.get(rowId);
    expect(afterSecond.status).toBe("processed");
    expect(afterSecond.attempt_count).toBe(2);
    // received_at is set once, by the very first insert, and never touched again -- not by the
    // failure, not by the retry's own claim, not by the eventual success.
    expect(afterSecond.received_at).toBe(originalReceivedAt);
    // Exactly one processRefresh call per delivery -- no duplicate/extra import calls from either
    // attempt, so no duplicate financial_events are ever produced for the same refresh.
    expect(mocks.processRefresh).toHaveBeenCalledTimes(2);
  });

  it("refreshed_transactions arriving before any prior import has ever succeeded still resolves ownership (via the durable financial_accounts row from /complete) and calls the coordinator -- correction report item 5", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_first_ever", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active" } },
    });
    const supabase = fakeSupabase({ financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, refreshOutcome: "committed" });
    expect(mocks.processRefresh).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "connection_1", ownerId: "owner-123" }));
  });

  it("responds with a retryable status when the refresh coordinator throws, and never marks the event processed", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_9", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active" } },
    });
    const supabase = fakeSupabase({ financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    mocks.processRefresh.mockRejectedValue(new Error("Import reported failed records."));
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());
    consoleError.mockRestore();

    expect(response.status).toBe(500);
    const row = supabase._webhookEvents.get("connection_webhook_stripe_financial_connections_evt_9");
    expect(row.status).toBe("failed");
  });

  it("responds 409/retryable, marks the webhook event failed (not processed), when the coordinator reports slot_busy -- a newer refresh arriving while another import is running must stay retryable, never falsely marked processed", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_slot_busy", type: "financial_connections.account.refreshed_balance",
      data: { object: { id: "fca_1", status: "active" } },
    });
    const supabase = fakeSupabase({ financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    mocks.processRefresh.mockResolvedValue({ outcome: "slot_busy" });
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ received: true, retry: true });
    const row = supabase._webhookEvents.get("connection_webhook_stripe_financial_connections_evt_slot_busy");
    expect(row.status).toBe("failed");
  });

  it("marks the webhook event processed (never as if imported) when the coordinator reports superseded -- the work item itself records the authoritative newer refresh, not this route", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_superseded", type: "financial_connections.account.refreshed_transactions",
      data: { object: { id: "fca_1", status: "active" } },
    });
    const supabase = fakeSupabase({ financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    mocks.processRefresh.mockResolvedValue({ outcome: "superseded", supersededByRefreshId: "fcxrefresh_newer" });
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, refreshOutcome: "superseded" });
    const row = supabase._webhookEvents.get("connection_webhook_stripe_financial_connections_evt_superseded");
    expect(row.status).toBe("processed");
  });

  it("marks the webhook event processed when the coordinator reports already_committed (a plain redelivery of already-imported data)", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      id: "evt_already_committed", type: "financial_connections.account.refreshed_balance",
      data: { object: { id: "fca_1", status: "active" } },
    });
    const supabase = fakeSupabase({ financialAccountRow: { id: "financial_account_1", owner_id: "owner-123", connection_id: "connection_1" } });
    vi.doMock("@/lib/supabase/createFinancialConnectionsWebhookClient", () => ({ createFinancialConnectionsWebhookClient: () => supabase }));
    mocks.getByIdConnection.mockResolvedValue({ id: "connection_1", status: "connected", credentialReferenceId: "credential_1" });
    mocks.processRefresh.mockResolvedValue({ outcome: "already_committed" });
    mocks.createConnectionPlatformSuite.mockResolvedValue(connectionPlatformSuiteStub());
    const { POST } = await importRoute();

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, refreshOutcome: "already_committed" });
  });
});
