import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAuthenticatedFinancialApplication } = vi.hoisted(() => ({
  createAuthenticatedFinancialApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication,
}));

import {
  DELETE,
  POST,
  normalizeIdList,
  selectConfirmedEntries,
  selectMarkedRows,
} from "./route";

const OWNER = "owner-1";

function moneyRow(id, eventDate, amount, description, sourceSystem) {
  return { id, event_date: eventDate, amount, description, source_system: sourceSystem };
}

function makeClient({ transactionRows = [], rentecRows = [], markedRows = [] } = {}) {
  const from = vi.fn(() => {
    const filters = {};
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((col, val) => {
        filters[col] = val;
        return chain;
      }),
      in: vi.fn((col, vals) => {
        filters[col] = vals;
        return chain;
      }),
      not: vi.fn(() => chain),
      order: vi.fn(() => chain),
      range: vi.fn(() => {
        const src = filters.source_system;
        let rows = [];
        if (src === "transaction" && filters.is_deleted === false) rows = transactionRows;
        else if (Array.isArray(src)) rows = rentecRows;
        else if (src === "transaction" && filters.is_deleted === true) rows = markedRows;
        return Promise.resolve({ data: rows, error: null });
      }),
    };
    return chain;
  });
  const rpc = vi.fn(async (name, params) => ({
    data: { id: params.p_event_id, duplicate_of_event_id: params.p_duplicate_of_event_id ?? null },
    error: null,
  }));
  return { from, rpc };
}

function authFor(client) {
  createAuthenticatedFinancialApplication.mockResolvedValue({
    response: null,
    supabaseClient: client,
    effectiveOwnerId: OWNER,
  });
}

// t1 <-> r1 and t2 <-> r2 are exact amount+date matches: both confirmed.
const transactionRows = [
  moneyRow("t1", "2026-01-05", -100, "BANK TRANSFER", "transaction"),
  moneyRow("t2", "2026-02-01", -50, "BANK FEE", "transaction"),
];
const rentecRows = [
  moneyRow("r1", "2026-01-06", 100, "Rent received", "rentec"),
  moneyRow("r2", "2026-02-02", 50, "Fee income", "rentec_api"),
];

function postRequest(body) {
  return new NextRequest("https://test/api/financial/reconcile-duplicates", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function deleteRequest(body) {
  return new NextRequest("https://test/api/financial/reconcile-duplicates", {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

describe("reconcile-duplicates route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST with no body applies the whole confirmed set (one-click bulk)", async () => {
    const client = makeClient({ transactionRows, rentecRows });
    authFor(client);
    const response = await POST(postRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.appliedCount).toBe(2);
    expect(body.failedCount).toBe(0);
    expect(client.rpc).toHaveBeenCalledTimes(2);
    expect(client.rpc).toHaveBeenCalledWith(
      "mark_financial_event_as_duplicate",
      expect.objectContaining({ p_owner_id: OWNER, p_event_id: "t1", p_duplicate_of_event_id: "r1" }),
    );
  });

  it("POST with transactionIds scopes the apply to one row", async () => {
    const client = makeClient({ transactionRows, rentecRows });
    authFor(client);
    const response = await POST(postRequest({ transactionIds: ["t2"] }));
    const body = await response.json();
    expect(body.appliedCount).toBe(1);
    expect(body.applied[0].transactionId).toBe("t2");
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("POST never applies a client-invented id (anti-drift)", async () => {
    const client = makeClient({ transactionRows, rentecRows });
    authFor(client);
    const response = await POST(postRequest({ transactionIds: ["t1", "bogus-id"] }));
    const body = await response.json();
    expect(body.appliedCount).toBe(1);
    expect(body.failedCount).toBe(1);
    expect(body.failed[0].transactionId).toBe("bogus-id");
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith(
      "mark_financial_event_as_duplicate",
      expect.objectContaining({ p_event_id: "t1" }),
    );
  });

  it("DELETE restores only rows currently marked as duplicates", async () => {
    const client = makeClient({ markedRows: [{ id: "t1" }] });
    authFor(client);
    const response = await DELETE(deleteRequest({ transactionIds: ["t1", "never-marked"] }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.restoredCount).toBe(1);
    expect(body.failedCount).toBe(1);
    expect(body.failed[0].transactionId).toBe("never-marked");
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith(
      "unmark_financial_event_as_duplicate",
      expect.objectContaining({ p_owner_id: OWNER, p_event_id: "t1" }),
    );
  });

  it("DELETE requires a non-empty transactionIds array", async () => {
    const client = makeClient();
    authFor(client);
    for (const bad of [{}, { transactionIds: [] }, { transactionIds: "t1" }]) {
      const response = await DELETE(deleteRequest(bad));
      expect(response.status).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("duplicate selection helpers", () => {
  const preview = { confirmedDuplicates: [{ transactionId: "t1" }, { transactionId: "t2" }] };

  it("normalizeIdList drops blanks, non-strings, and duplicates", () => {
    expect(normalizeIdList(["t1", " ", null, "t1", 42])).toEqual(["t1", "42"]);
    expect(normalizeIdList("t1")).toEqual([]);
    expect(normalizeIdList(null)).toEqual([]);
  });

  it("selectConfirmedEntries returns the whole set when nothing is requested", () => {
    expect(selectConfirmedEntries(preview, null).selected).toHaveLength(2);
    expect(selectConfirmedEntries(preview, []).unknown).toEqual([]);
  });

  it("selectConfirmedEntries splits selected from unknown", () => {
    const { selected, unknown } = selectConfirmedEntries(preview, ["t2", "nope"]);
    expect(selected.map((entry) => entry.transactionId)).toEqual(["t2"]);
    expect(unknown).toEqual(["nope"]);
  });

  it("selectMarkedRows only selects currently-marked rows", () => {
    const { selected, unknown } = selectMarkedRows([{ id: "t1" }], ["t1", "t2"]);
    expect(selected.map((row) => row.id)).toEqual(["t1"]);
    expect(unknown).toEqual(["t2"]);
  });
});
