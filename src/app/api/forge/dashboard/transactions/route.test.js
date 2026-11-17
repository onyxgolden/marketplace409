import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateAuthenticatedForgeApplication = vi.fn();

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: (...args) =>
    mockCreateAuthenticatedForgeApplication(...args),
}));

const { GET } = await import("./route.js");

const OWNER_ID = "e1b22131-9100-4a79-bbe2-b82d43af922e";
const OTHER_OWNER_ID = "00000000-0000-0000-0000-000000000001";
const KINDS = ["income", "expense", "asset_purchase", "transfer"];
const CATEGORIES = [
  "rental_income",
  "repairs_maintenance",
  "utilities",
  "insurance",
  "management_fees",
];

function buildRow(index, { ownerId, scope, status, kind }) {
  const year = 2019 + (index % 8);
  const month = String(1 + (index % 12)).padStart(2, "0");
  const day = String(1 + (index % 28)).padStart(2, "0");
  return Object.freeze({
    id: `event-${String(index).padStart(6, "0")}`,
    owner_id: ownerId,
    status,
    is_deleted: status === "deleted",
    property_id: index % 5 === 0 ? null : `prop-${index % 23}`,
    financial_account_id: null,
    business_scope: scope,
    event_date: `${year}-${month}-${day}`,
    description: `Event ${index}`,
    amount: index % 3 === 0 ? -(100 + (index % 900)) : 100 + (index % 900),
    transaction_kind: kind,
    normalized_category: CATEGORIES[index % CATEGORIES.length],
    affects_noi: index % 4 !== 0,
    capitalized: index % 9 === 0,
    source_system: index % 3 === 0 ? "stripe" : "rentec",
    source_record_id: `rec-${index}`,
  });
}

function buildProductionRows() {
  const rows = [];
  let index = 0;
  // 8,280 eligible business-scope active events (the live count).
  for (let i = 0; i < 8280; i += 1) {
    rows.push(
      buildRow(index, {
        ownerId: OWNER_ID,
        scope: "business",
        status: "active",
        kind: KINDS[i % KINDS.length],
      }),
    );
    index += 1;
  }
  // 2,000 personal-scope active events (same owner, filtered by scope).
  for (let i = 0; i < 2000; i += 1) {
    rows.push(
      buildRow(index, {
        ownerId: OWNER_ID,
        scope: "personal",
        status: "active",
        kind: KINDS[i % KINDS.length],
      }),
    );
    index += 1;
  }
  // 1,000 inactive/deleted business events (filtered by the RPC).
  for (let i = 0; i < 1000; i += 1) {
    rows.push(
      buildRow(index, {
        ownerId: OWNER_ID,
        scope: "business",
        status: i % 2 === 0 ? "inactive" : "deleted",
        kind: KINDS[i % KINDS.length],
      }),
    );
    index += 1;
  }
  // 496 other-owner events (filtered by owner).
  for (let i = 0; i < 496; i += 1) {
    rows.push(
      buildRow(index, {
        ownerId: OTHER_OWNER_ID,
        scope: "business",
        status: "active",
        kind: KINDS[i % KINDS.length],
      }),
    );
    index += 1;
  }
  return Object.freeze(rows);
}

// Fake Supabase client whose rpc() implements the transactions RPC
// contract over in-memory rows (eligible-set filter, stable
// event_date,id order, one page + exact counts). The SQL itself is
// proven against the JS oracle in DashboardFinancialTransactions
// .migration.test.js; this fake proves the ROUTE no longer rebuilds the
// workspace: it must make exactly one rpc call and never touch the
// legacy table scan (from() records every call and would throw the
// route off the old path if it still used it).
function buildFakeSupabaseClient(rows) {
  const fromCalls = [];
  const rpcCalls = [];
  const client = {
    fromCalls,
    rpcCalls,
    from(table) {
      fromCalls.push(table);
      throw new Error(
        `route must not scan table ${table} (use the transactions RPC)`,
      );
    },
    async rpc(functionName, params) {
      rpcCalls.push({ functionName, params });
      if (
        functionName !== "forge_dashboard_financial_transactions_v1"
      ) {
        return {
          data: null,
          error: new Error(`unexpected rpc ${functionName}`),
        };
      }
      const eligible = rows
        .filter(
          (row) =>
            row.owner_id === params.p_owner_id &&
            row.status === "active" &&
            row.is_deleted !== true &&
            (params.p_scope === null ||
              row.business_scope === params.p_scope),
        )
        .sort((left, right) => {
          const dateComparison = String(left.event_date).localeCompare(
            String(right.event_date),
          );
          if (dateComparison !== 0) return dateComparison;
          return String(left.id).localeCompare(String(right.id));
        });
      const totalCount = eligible.length;
      const totalPages = Math.max(
        1,
        Math.ceil(totalCount / params.p_page_size),
      );
      const start = (params.p_page - 1) * params.p_page_size;
      const pageRows = eligible.slice(start, start + params.p_page_size);
      return {
        data: {
          version: "forge_dashboard_financial_transactions_v1",
          status: "ok",
          ownerId: params.p_owner_id,
          scope: params.p_scope,
          page: params.p_page,
          pageSize: params.p_page_size,
          totalCount,
          totalPages,
          complete: params.p_page >= totalPages,
          transactions: pageRows.map((row) => ({
            id: row.id,
            propertyId: row.property_id ?? "unassigned",
            eventDate: row.event_date,
            description: row.description,
            amount: Math.abs(row.amount),
            transactionKind: row.transaction_kind,
            category: row.normalized_category || "uncategorized",
            affectsNOI: row.affects_noi === true,
            capitalized: row.capitalized === true,
            sourceSystem: row.source_system,
            sourceRecordId: row.source_record_id ?? null,
            businessScope: row.business_scope ?? null,
            financialAccountId: row.financial_account_id ?? null,
          })),
          transactionsStatus: "loaded",
        },
        error: null,
      };
    },
  };
  return client;
}

function mockAuthenticated(fakeClient) {
  mockCreateAuthenticatedForgeApplication.mockResolvedValue({
    supabaseClient: fakeClient,
    user: { id: OWNER_ID },
    effectiveOwnerId: OWNER_ID,
    // Negative control: the old route called this suite's workspace
    // build on every page. The new route must never touch it -- a
    // throwing buildWorkspace here proves the rebuild is gone.
    getForgeApplicationSuite: async () => ({
      financialWorkspaceQueryService: {
        buildWorkspace: async () => {
          throw new Error(
            "workspace rebuild must not run for a diagnostic page",
          );
        },
      },
    }),
  });
}

describe("GET /api/forge/dashboard/transactions", () => {
  beforeEach(() => {
    mockCreateAuthenticatedForgeApplication.mockReset();
  });

  it("returns the first page of the full business-scope history", async () => {
    const fakeClient = buildFakeSupabaseClient(buildProductionRows());
    mockAuthenticated(fakeClient);

    const response = await GET(
      new Request(
        "http://localhost/api/forge/dashboard/transactions?page=1&pageSize=2",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    expect(payload.transactions).toHaveLength(2);
    expect(payload.totalCount).toBe(8280);
    expect(payload.totalPages).toBe(4140);
    expect(payload.complete).toBe(false);
    expect(payload.transactionsStatus).toBe("loaded");
    // One RPC call, no legacy table scan, no workspace rebuild.
    expect(fakeClient.rpcCalls).toHaveLength(1);
    expect(fakeClient.fromCalls).toHaveLength(0);
  });

  it("returns the final page marked complete", async () => {
    const fakeClient = buildFakeSupabaseClient(buildProductionRows());
    mockAuthenticated(fakeClient);

    const response = await GET(
      new Request(
        "http://localhost/api/forge/dashboard/transactions?page=4140&pageSize=2",
      ),
    );
    const payload = await response.json();

    expect(payload.transactions).toHaveLength(2);
    expect(payload.complete).toBe(true);
    expect(fakeClient.rpcCalls).toHaveLength(1);
  });

  it("passes the factory's 401/403 response through untouched", async () => {
    const denied = new Response(
      JSON.stringify({ error: "Authenticated owner id is required." }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );

    mockCreateAuthenticatedForgeApplication.mockResolvedValue({
      response: denied,
    });

    const response = await GET(
      new Request("http://localhost/api/forge/dashboard/transactions"),
    );

    expect(response.status).toBe(401);
    expect(
      mockCreateAuthenticatedForgeApplication,
    ).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for an invalid page, not an empty history", async () => {
    const fakeClient = buildFakeSupabaseClient(buildProductionRows());
    mockAuthenticated(fakeClient);

    const response = await GET(
      new Request(
        "http://localhost/api/forge/dashboard/transactions?page=0",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/positive integer/);
    expect(fakeClient.rpcCalls).toHaveLength(0);
  });

  it("returns 500 -- never a fabricated empty history -- when the RPC fails", async () => {
    const fakeClient = buildFakeSupabaseClient(buildProductionRows());
    fakeClient.rpc = async () => ({
      data: null,
      error: new Error("database unavailable"),
    });
    mockAuthenticated(fakeClient);

    const response = await GET(
      new Request("http://localhost/api/forge/dashboard/transactions"),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).not.toHaveProperty("transactions");
    expect(payload.error).toBe("Unable to load transaction history.");
  });

  it("production scale: one RPC call serves page 1 of 8,280 without a workspace rebuild", async () => {
    const rows = buildProductionRows();
    expect(rows).toHaveLength(11776);
    const fakeClient = buildFakeSupabaseClient(rows);
    mockAuthenticated(fakeClient);

    const startedAt = Date.now();
    const response = await GET(
      new Request(
        "http://localhost/api/forge/dashboard/transactions?page=1&pageSize=1000",
      ),
    );
    const elapsedMs = Date.now() - startedAt;
    const payload = await response.json();

    console.log(
      `diagnostic page 1 at production scale: status=${response.status} elapsedMs=${elapsedMs} totalCount=${payload.totalCount} returned=${payload.transactions?.length} rpcCalls=${fakeClient.rpcCalls.length} tableScans=${fakeClient.fromCalls.length}`,
    );

    expect(response.status).toBe(200);
    expect(payload.totalCount).toBe(8280);
    expect(payload.totalPages).toBe(9);
    expect(payload.transactions).toHaveLength(1000);
    expect(payload.complete).toBe(false);
    // The regression itself: exactly one RPC call, zero legacy table
    // scans, and no workspace rebuild (the throwing buildWorkspace
    // above would have failed the request). The old route made twelve
    // sequential 1,000-row fetches + a full re-aggregation per page.
    expect(fakeClient.rpcCalls).toHaveLength(1);
    expect(fakeClient.fromCalls).toHaveLength(0);
    // The page must be the OLDEST transactions first (stable
    // event_date,id order), never a partial or reordered slice.
    expect(payload.transactions[0].eventDate).toBe("2019-01-01");
  }, 60000);

  it("production scale: the last page is complete with the 280 remaining rows", async () => {
    const fakeClient = buildFakeSupabaseClient(buildProductionRows());
    mockAuthenticated(fakeClient);

    const response = await GET(
      new Request(
        "http://localhost/api/forge/dashboard/transactions?page=9&pageSize=1000",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.transactions).toHaveLength(280);
    expect(payload.totalCount).toBe(8280);
    expect(payload.complete).toBe(true);
    expect(fakeClient.rpcCalls).toHaveLength(1);
  });
});
