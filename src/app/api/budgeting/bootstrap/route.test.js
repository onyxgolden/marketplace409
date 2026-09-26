import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedBudgetingApplication", () => ({
  createAuthenticatedBudgetingApplication: mocks.authenticate,
}));

import { GET, POST } from "./route";

// Minimal thenable query builder: every chain method returns the builder, and
// awaiting it resolves the canned result for the table.
function fakeQuery(result) {
  const builder = {};
  for (const method of ["select", "eq", "in", "gte", "order", "range"]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve) => resolve(result);
  return builder;
}

function fakeClient({ eventRows = [], categoryRows = [], rpcImpl = null } = {}) {
  const tables = { financial_events: eventRows, budget_categories: categoryRows };
  return {
    from: (table) => fakeQuery({ data: tables[table] ?? [], error: null }),
    rpc: rpcImpl ?? vi.fn(async (name) => ({ data: { id: `id-for-${name}` }, error: null })),
  };
}

function authed(client) {
  mocks.authenticate.mockResolvedValue({
    response: null,
    supabaseClient: client,
    effectiveOwnerId: "owner-1",
  });
}

// Four clean monthly occurrences of one payee -- the minimum the detector trusts.
function monthlySeries({ idPrefix, startMonth, amount, description, category }) {
  return [0, 1, 2, 3].map((offset) => {
    const month = String(startMonth + offset).padStart(2, "0");
    return {
      id: `${idPrefix}-${offset}`,
      event_date: `2026-${month}-05`,
      amount,
      transaction_kind: amount < 0 ? "income" : "expense",
      normalized_category: category,
      description,
    };
  });
}

function getRequest(scope = "personal") {
  return new Request(`http://localhost/api/budgeting/bootstrap?scope=${scope}`);
}

function postRequest(body) {
  return new Request("http://localhost/api/budgeting/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/budgeting/bootstrap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns recurring bills and income as candidates, excluding already-planned families", async () => {
    const client = fakeClient({
      eventRows: [
        ...monthlySeries({ idPrefix: "vid", startMonth: 6, amount: 15.99, description: "VIDEOSTREAM", category: "subscriptions" }),
        ...monthlySeries({ idPrefix: "pay", startMonth: 6, amount: -2500, description: "PAYROLL ACME", category: "paycheck" }),
        ...monthlySeries({ idPrefix: "myst", startMonth: 6, amount: 40, description: "MYSTERY BILL", category: "other" }),
        { id: "one-off", event_date: "2026-08-01", amount: 99, transaction_kind: "expense", normalized_category: "shopping", description: "ONE TIME" },
      ],
      categoryRows: [{ normalized_category: "subscriptions" }],
    });
    authed(client);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.eventsAnalyzed).toBe(13);
    // The subscriptions bill is already a budget category -- not a candidate.
    expect(body.bills).toEqual([]);
    // Income is informational and always surfaced.
    expect(body.income).toHaveLength(1);
    expect(body.income[0]).toMatchObject({ payeeLabel: "PAYROLL ACME", category: "paycheck", cadence: "monthly" });
  });

  it("surfaces a bill candidate when nothing is planned yet", async () => {
    const client = fakeClient({
      eventRows: monthlySeries({ idPrefix: "vid", startMonth: 6, amount: 15.99, description: "VIDEOSTREAM", category: "subscriptions" }),
      categoryRows: [],
    });
    authed(client);

    const body = await (await GET(getRequest())).json();

    expect(body.bills).toHaveLength(1);
    expect(body.bills[0]).toMatchObject({
      payeeLabel: "VIDEOSTREAM",
      category: "subscriptions",
      displayLabel: "Subscriptions",
      cadence: "monthly",
      occurrences: 4,
      medianAmountCents: 1599,
    });
    expect(body.bills[0].monthlyAmountCents).toBeGreaterThan(0);
  });

  it("surfaces uncategorized income without crashing", async () => {
    const client = fakeClient({
      eventRows: monthlySeries({ idPrefix: "dep", startMonth: 6, amount: -100, description: "MOBILE DEPOSIT", category: null }),
      categoryRows: [],
    });
    authed(client);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.income).toHaveLength(1);
    expect(body.income[0]).toMatchObject({ payeeLabel: "MOBILE DEPOSIT", category: null, displayLabel: "Uncategorized" });
  });

  it("reports zero analyzed events for the no-history empty state", async () => {
    authed(fakeClient({ eventRows: [], categoryRows: [] }));

    const body = await (await GET(getRequest())).json();

    expect(body.success).toBe(true);
    expect(body.eventsAnalyzed).toBe(0);
    expect(body.bills).toEqual([]);
    expect(body.income).toEqual([]);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response("unauthorized", { status: 401 }) });
    expect((await GET(getRequest())).status).toBe(401);
  });
});

describe("POST /api/budgeting/bootstrap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes exactly the kept items as history_suggested categories plus monthly allocations", async () => {
    const rpc = vi.fn(async (name) => ({ data: { id: `cat-${name}` }, error: null }));
    const client = fakeClient({ categoryRows: [], rpcImpl: rpc });
    authed(client);

    const response = await POST(
      postRequest({
        scope: "personal",
        month: "2026-09",
        items: [
          { normalizedCategory: "subscriptions", displayLabel: "Subscriptions", plannedAmountCents: 1599 },
          { normalizedCategory: "utilities_electric", displayLabel: "Electric", plannedAmountCents: 12000 },
        ],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.created).toHaveLength(2);
    expect(rpc).toHaveBeenCalledWith(
      "upsert_budget_category",
      expect.objectContaining({ p_normalized_category: "subscriptions", p_source_type: "history_suggested", p_business_scope: "personal" }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "upsert_budget_monthly_allocation",
      expect.objectContaining({ p_period_month: "2026-09-01", p_planned_amount_cents: 1599 }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "upsert_budget_monthly_allocation",
      expect.objectContaining({ p_planned_amount_cents: 12000 }),
    );
    expect(body.skipped).toEqual([]);
  });

  it("merges kept payees in one family into a single line with summed amounts", async () => {
    const rpc = vi.fn(async (name) => ({ data: { id: `cat-${name}` }, error: null }));
    authed(fakeClient({ categoryRows: [], rpcImpl: rpc }));

    const body = await (
      await POST(
        postRequest({
          scope: "personal",
          month: "2026-09",
          items: [
            { normalizedCategory: "dining_drinks_restaurants", displayLabel: "Restaurants", plannedAmountCents: 4000 },
            { normalizedCategory: "dining_drinks", displayLabel: "Dining Drinks", plannedAmountCents: 2500 },
          ],
        }),
      )
    ).json();

    expect(body.created).toHaveLength(1);
    expect(body.created[0]).toMatchObject({ normalizedCategory: "dining_drinks", plannedAmountCents: 6500 });
  });

  it("skips families already in the budget instead of overwriting them", async () => {
    const rpc = vi.fn(async (name) => ({ data: { id: `cat-${name}` }, error: null }));
    authed(fakeClient({ categoryRows: [{ normalized_category: "subscriptions" }], rpcImpl: rpc }));

    const body = await (
      await POST(
        postRequest({
          scope: "personal",
          month: "2026-09",
          items: [{ normalizedCategory: "subscriptions", displayLabel: "Subscriptions", plannedAmountCents: 1599 }],
        }),
      )
    ).json();

    expect(body.created).toEqual([]);
    expect(body.skipped).toEqual(["subscriptions"]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads without writing anything", async () => {
    const rpc = vi.fn(async (name) => ({ data: { id: `cat-${name}` }, error: null }));
    authed(fakeClient({ categoryRows: [], rpcImpl: rpc }));

    const badMonth = await POST(postRequest({ scope: "personal", month: "september", items: [] }));
    expect(badMonth.status).toBe(400);

    const badItem = await POST(
      postRequest({ scope: "personal", month: "2026-09", items: [{ normalizedCategory: "", plannedAmountCents: -5 }] }),
    );
    expect(badItem.status).toBe(400);

    const notArray = await POST(postRequest({ scope: "personal", month: "2026-09", items: "nope" }));
    expect(notArray.status).toBe(400);

    expect(rpc).not.toHaveBeenCalled();
  });
});
