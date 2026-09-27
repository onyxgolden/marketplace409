import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(),
}));
vi.mock("@/application/rental/chartOfAccounts", () => ({
  resolvePostingCategories: vi.fn(),
  ChartUnavailableError: class ChartUnavailableError extends Error {},
}));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { ChartUnavailableError, resolvePostingCategories } from "@/application/rental/chartOfAccounts";
import { POST } from "./route";

const row = (overrides = {}) => ({
  eventDate: "2026-09-20",
  description: "Plumber",
  payee: "Acme Plumbing",
  normalizedCategory: "property_repairs",
  amount: 250,
  memo: "Kitchen sink",
  ...overrides,
});

function authed(insertCapture, role = "owner") {
  const insert = vi.fn(async () => {
    insertCapture.calls.push(insert.mock.calls[0][0]);
    return { error: null };
  });
  const client = { from: vi.fn(() => ({ insert })) };
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user-1" },
    effectiveOwnerId: "owner_1",
    supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
  return client;
}

function postRequest(rows) {
  return new Request("https://test/api/rental/transactions/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolvePostingCategories.mockResolvedValue(["property_repairs", "utilities", "supplies"]);
});

describe("POST /api/rental/transactions/batch", () => {
  it("posts all valid rows in a single insert", async () => {
    const insertCapture = { calls: [] };
    authed(insertCapture);

    const response = await POST(postRequest([row(), row({ description: "Electrician", amount: 120, normalizedCategory: "utilities" })]));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, created: 2, errors: [] });
    expect(insertCapture.calls).toHaveLength(1);
    expect(insertCapture.calls[0]).toHaveLength(2);
    expect(insertCapture.calls[0][0]).toMatchObject({
      owner_id: "owner_1",
      transaction_kind: "expense",
      normalized_category: "property_repairs",
      payee: "Acme Plumbing",
    });
    // Batch rows never create tenant charges.
    expect(insertCapture.calls[0][0].metadata).not.toMatchObject({ charged_to_tenant: true });
  });

  it("reports per-row errors while posting the valid rows", async () => {
    const insertCapture = { calls: [] };
    authed(insertCapture);

    const response = await POST(postRequest([row(), row({ amount: -5 })]));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.created).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].index).toBe(1);
    expect(insertCapture.calls[0]).toHaveLength(1);
  });

  it("rejects an unknown category", async () => {
    const insertCapture = { calls: [] };
    authed(insertCapture);

    const response = await POST(postRequest([row({ normalizedCategory: "made_up" })]));
    const body = await response.json();
    expect(body.created).toBe(0);
    expect(body.errors).toHaveLength(1);
    expect(insertCapture.calls).toHaveLength(0);
  });

  it("accepts a custom chart-of-accounts code", async () => {
    resolvePostingCategories.mockResolvedValue(["property_repairs", "landscaping"]);
    const insertCapture = { calls: [] };
    authed(insertCapture);

    const response = await POST(postRequest([row({ normalizedCategory: "landscaping" })]));
    const body = await response.json();
    expect(body).toMatchObject({ created: 1, errors: [] });
    expect(insertCapture.calls[0][0].normalized_category).toBe("landscaping");
  });

  it("rejects a built-in category the owner deactivated", async () => {
    // The owner's active chart no longer includes property_repairs.
    resolvePostingCategories.mockResolvedValue(["utilities"]);
    const insertCapture = { calls: [] };
    authed(insertCapture);

    const response = await POST(postRequest([row()]));
    const body = await response.json();
    expect(body.created).toBe(0);
    expect(body.errors).toHaveLength(1);
    expect(insertCapture.calls).toHaveLength(0);
  });

  it("400s with no rows and caps at 50", async () => {
    const insertCapture = { calls: [] };
    authed(insertCapture);

    const empty = await POST(postRequest([]));
    expect(empty.status).toBe(400);

    const tooMany = await POST(postRequest(Array.from({ length: 51 }, () => row())));
    expect(tooMany.status).toBe(400);
  });

  it("403s for read-only members", async () => {
    const insertCapture = { calls: [] };
    authed(insertCapture, "read_only");

    const response = await POST(postRequest([row()]));
    expect(response.status).toBe(403);
    expect(insertCapture.calls).toHaveLength(0);
  });

  it("503s and writes nothing when the chart read fails", async () => {
    resolvePostingCategories.mockRejectedValue(new ChartUnavailableError(new Error("connection reset")));
    const insertCapture = { calls: [] };
    authed(insertCapture);

    const response = await POST(postRequest([row()]));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/chart of accounts/i);
    expect(insertCapture.calls).toHaveLength(0);
  });

  it("uses the built-in list in legacy mode when the chart table is missing", async () => {
    // resolvePostingCategories returns null only when the chart table does
    // not exist yet (migration not applied).
    resolvePostingCategories.mockResolvedValue(null);
    const insertCapture = { calls: [] };
    authed(insertCapture);

    const response = await POST(postRequest([row()]));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body).toMatchObject({ created: 1, errors: [] });
    expect(insertCapture.calls[0][0].normalized_category).toBe("property_repairs");
  });
});
