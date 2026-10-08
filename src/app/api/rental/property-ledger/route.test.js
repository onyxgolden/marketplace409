import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents", () => ({
  fetchAllOwnerFinancialEvents: vi.fn(),
}));

import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";
import { fetchAllPages, GET } from "./route";

// Fake PostgREST chain: every filter method returns the chain, range() resolves
// the requested slice of the canned rows. Range calls are recorded so page
// boundaries can be asserted.
function fakeClient(allRows, { failOnPage = -1 } = {}) {
  const rangeCalls = [];
  const makeChain = (pageIndex) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      order: () => chain,
      range: (start, end) => {
        rangeCalls.push([start, end]);
        if (pageIndex === failOnPage) {
          return Promise.resolve({ data: null, error: new Error("boom") });
        }
        return Promise.resolve({ data: allRows.slice(start, end + 1), error: null });
      },
    };
    return chain;
  };
  let pageIndex = 0;
  return {
    rangeCalls,
    from: () => makeChain(pageIndex++),
  };
}

describe("fetchAllPages", () => {
  it("pages through more than one PostgREST page and returns every row", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `row_${i}` }));
    const client = fakeClient(rows);
    const result = await fetchAllPages(() =>
      client.from("rental_payments").select("id").eq("owner_id", "o1").order("id", { ascending: true }),
    );
    expect(result).toHaveLength(2500);
    expect(result[0]).toEqual({ id: "row_0" });
    expect(result[2499]).toEqual({ id: "row_2499" });
    // Page boundaries: 0-999, 1000-1999, 2000-2999 (short page ends the loop).
    expect(client.rangeCalls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("returns a single short page without extra requests", async () => {
    const rows = Array.from({ length: 42 }, (_, i) => ({ id: `row_${i}` }));
    const client = fakeClient(rows);
    const result = await fetchAllPages(() => client.from("rental_leases").select("id"));
    expect(result).toHaveLength(42);
    expect(client.rangeCalls).toEqual([[0, 999]]);
  });

  it("throws when a page errors", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: `row_${i}` }));
    const client = fakeClient(rows, { failOnPage: 1 });
    await expect(fetchAllPages(() => client.from("rental_tenants").select("id"))).rejects.toThrow("boom");
  });
});

// ---------------------------------------------------------------------------
// GET /api/rental/property-ledger — canonical property identity at the route.
//
// The builder canonicalizes slugs in memory, but contractor payments are
// fetched with a DB-side equality filter, so a fake that RETURNS EVERY ROW
// would prove nothing: the bug this suite pins is the filter discarding
// alias-tagged rows before the builder runs. This fake therefore APPLIES the
// route's .eq/.or filters to canned rows (parsing the real filter string the
// route builds, quotes included), so a row the filter excludes never reaches
// buildPropertyLedger — the same end-to-end behavior as production.
// ---------------------------------------------------------------------------

function splitOrClauses(filter) {
  const clauses = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < filter.length; i++) {
    const ch = filter[i];
    if (ch === "\\" && i + 1 < filter.length) {
      current += ch + filter[i + 1];
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      clauses.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) clauses.push(current);
  return clauses;
}

function applyOrFilter(rows, filter) {
  const predicates = splitOrClauses(filter).map((clause) => {
    const match = /^([A-Za-z0-9_]+)\.eq\.(.*)$/.exec(clause.trim());
    if (!match) throw new Error(`fake client cannot parse or-clause: ${clause}`);
    const raw = match[2];
    const value = raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1).replace(/\\(["\\])/g, "$1")
      : raw;
    return (row) => row[match[1]] === value;
  });
  return rows.filter((row) => predicates.some((matches) => matches(row)));
}

function fakeDatabase(tables) {
  const calls = [];
  const makeChain = (table) => {
    let rows = [...(tables[table] || [])];
    const chain = {
      select: () => chain,
      eq: (column, value) => {
        calls.push({ table, op: "eq", column, value });
        rows = rows.filter((row) => row[column] === value);
        return chain;
      },
      or: (filter) => {
        calls.push({ table, op: "or", filter });
        rows = applyOrFilter(rows, filter);
        return chain;
      },
      order: () => chain,
      range: (start, end) => Promise.resolve({ data: rows.slice(start, end + 1), error: null }),
      // The units lookup is awaited directly (no .range), so the chain is a thenable.
      then: (resolve) => resolve({ data: rows, error: null }),
    };
    return chain;
  };
  return { calls, from: (table) => makeChain(table) };
}

const CANON = "1900-w-decker"; // rental_units identity (canonical slug)
const ALIAS = "1900-west-decker"; // the other import pipeline's slug for the same house
const UNIT_ID = "unit-decker-1";

const unitRow = { id: UNIT_ID, property_id: CANON, label: "1900 W Decker", status: "active", owner_id: "owner_1" };
const contractorRow = { id: "c1", business_name: "BC Roofing", trade: "Roofing" };
const paymentRow = (overrides = {}) => ({
  id: "cp1",
  contractor_id: "c1",
  work_order_id: null,
  property_id: ALIAS,
  paid_at: "2026-09-03",
  amount_cents: 45000,
  payment_method: "check",
  reference: null,
  invoice_reference: "INV-1",
  notes: null,
  owner_id: "owner_1",
  ...overrides,
});

function setupGet({ tables, events = [], ownerId = "owner_1" }) {
  const db = fakeDatabase(tables);
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user-1" },
    effectiveOwnerId: ownerId,
    supabaseClient: db,
  });
  fetchAllOwnerFinancialEvents.mockResolvedValue(events);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/property-ledger — canonical property identity", () => {
  it("includes an alias-tagged contractor payment end-to-end (the DB filter no longer discards it)", async () => {
    const db = setupGet({
      tables: {
        rental_units: [unitRow],
        rental_contractor_payments: [
          paymentRow(), // tagged with the ALIAS slug
          paymentRow({ id: "cp-unit", property_id: UNIT_ID, paid_at: "2026-09-04", amount_cents: 12300 }), // exact unit id
          paymentRow({ id: "cp-other-house", property_id: "4800-kent", amount_cents: 99900 }), // unrelated house
        ],
        rental_contractors: [contractorRow],
      },
    });

    const response = await GET(new Request(`https://test/api/rental/property-ledger?propertyId=${CANON}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ledger.entries.map((e) => e.id).sort()).toEqual(["contractor:cp-unit", "contractor:cp1"]);
    expect(body.ledger.totalDebitCents).toBe(45000 + 12300);
    expect(body.ledger.entries.find((e) => e.id === "contractor:cp-other-house")).toBeUndefined();

    // The expanded DB-side filter itself: canonical slug + every explicit
    // alias key resolving to it + exact unit ids, values double-quoted, and
    // owner scoping intact. No other house's slugs are pulled in.
    const contractorOr = db.calls.find((c) => c.table === "rental_contractor_payments" && c.op === "or");
    expect(contractorOr.filter).toContain(`property_id.eq."${CANON}"`);
    expect(contractorOr.filter).toContain(`property_id.eq."${ALIAS}"`);
    expect(contractorOr.filter).toContain(`property_id.eq."${UNIT_ID}"`);
    expect(contractorOr.filter).not.toContain("4800-kent");
    expect(contractorOr.filter).not.toContain("185-laxon");
    expect(db.calls).toContainEqual({
      table: "rental_contractor_payments", op: "eq", column: "owner_id", value: "owner_1",
    });
  });

  it("suppresses a linked expense event across the alias boundary end-to-end", async () => {
    setupGet({
      tables: {
        rental_units: [unitRow],
        // Contractor payment under the CANONICAL slug…
        rental_contractor_payments: [paymentRow({ property_id: CANON })],
        rental_contractors: [contractorRow],
      },
      // …expense event under the ALIAS slug, explicitly linked to it.
      events: [{
        id: "e1",
        property_id: ALIAS,
        event_date: "2026-09-03",
        description: "Roof",
        amount: "450.00",
        transaction_kind: "expense",
        normalized_category: "property_repairs",
        source_system: "manual",
        source_record_id: "rental_contractor_payment_cp1",
        status: "active",
        is_deleted: false,
        metadata: {},
      }],
    });

    const response = await GET(new Request(`https://test/api/rental/property-ledger?propertyId=${CANON}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ledger.entries).toHaveLength(1);
    expect(body.ledger.entries[0].id).toBe("contractor:cp1");
    expect(body.ledger.suppressedDuplicateCount).toBe(1);
  });

  it("never leaks another owner's alias-tagged contractor payment", async () => {
    setupGet({
      tables: {
        rental_units: [unitRow],
        rental_contractor_payments: [
          paymentRow({ id: "cp-mine" }),
          paymentRow({ id: "cp-theirs", owner_id: "owner_2" }),
        ],
        rental_contractors: [contractorRow],
      },
    });

    const response = await GET(new Request(`https://test/api/rental/property-ledger?propertyId=${CANON}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ledger.entries.map((e) => e.id)).toEqual(["contractor:cp-mine"]);
  });

  it("still 404s when the property is addressed by a variant (alias) slug — deferred limitation", async () => {
    // The units lookup resolves ?propertyId= exactly (documented in route.js);
    // canonicalizing how the property is ADDRESSED is deferred. Pinning the
    // current behavior so a future fix changes it deliberately, not by drift.
    setupGet({ tables: { rental_units: [unitRow] } });
    const response = await GET(new Request(`https://test/api/rental/property-ledger?propertyId=${ALIAS}`));
    expect(response.status).toBe(404);
  });

  it("rejects a missing propertyId", async () => {
    setupGet({ tables: {} });
    const response = await GET(new Request("https://test/api/rental/property-ledger"));
    expect(response.status).toBe(400);
  });
});
