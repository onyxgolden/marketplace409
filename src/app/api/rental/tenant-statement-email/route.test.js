import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(),
}));
vi.mock("@/application/rental/loadTenantLedgerData", () => ({
  loadTenantLedgerData: vi.fn(),
}));
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: vi.fn(),
}));

import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { loadTenantLedgerData } from "@/application/rental/loadTenantLedgerData";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { POST } from "./route";

const LEDGER_DATA = {
  tenant: { id: "t1", display_name: "Eric Carrillo", email: "eric@example.com", status: "active" },
  charges: [{ id: "c1", lease_id: "l1", schedule_id: "s1", period: "2026-10", due_date: "2026-10-01",
    amount_cents: 160000, paid_amount_cents: 0, currency_code: "USD", status: "due", charge_type: "rent" }],
  payments: [],
  settlements: [],
  leases: [{ id: "l1", unit_id: "u1", property_id: "p1", status: "active", start_date: "2026-09-01", end_date: "2027-08-31" }],
  leaseMemberships: [{ lease_id: "l1", tenant_id: "t1", occupancy_role: "primary" }],
  units: [{ id: "u1", property_id: "p1", label: "Unit A", status: "occupied" }],
  rentecImports: [],
  credits: [],
  creditApplications: [],
};

// Chainable supabase mock: every query method returns the chain; awaiting the
// chain resolves with the result configured for that table+operation.
// Captures update payloads + eq predicates on db.__updates for assertions.
function makeDb({ insertResult, existingRow = null, claimCount = 1 } = {}) {
  const updates = [];
  const db = {
    __updates: updates,
    from: (table) => {
      const state = { table, op: null, payload: null, eqs: [] };
      const chain = {
        select: () => { state.op = state.op || "select"; return chain; },
        insert: () => { state.op = "insert"; return chain; },
        update: (payload) => { state.op = "update"; state.payload = payload; return chain; },
        eq: (col, val) => { state.eqs.push([col, val]); return chain; },
        lt: (col, val) => { state.eqs.push(["lt:" + col, val]); return chain; },
        maybeSingle: () => chain,
        order: () => chain,
        then: (resolve) => {
          let result = { data: [], error: null };
          if (table === "rental_notification_outbox" && state.op === "insert") {
            result = insertResult !== undefined ? insertResult : { data: [{ id: "n1" }], error: null };
          } else if (table === "rental_notification_outbox" && state.op === "select") {
            result = { data: existingRow, error: null };
          } else if (table === "rental_notification_outbox" && state.op === "update") {
            updates.push({ table, payload: state.payload, eqs: state.eqs });
            result = claimCount > 0 ? { data: [{ id: "n1" }], error: null } : { data: [], error: null };
          }
          return Promise.resolve(result).then(resolve);
        },
      };
      return chain;
    },
  };
  return db;
}

function post(body) {
  return new Request("https://test/api/rental/tenant-statement-email", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("POST /api/rental/tenant-statement-email", () => {
  let db;
  let send;
  beforeEach(() => {
    vi.clearAllMocks();
    db = makeDb();
    send = vi.fn(async () => ({ messageId: "email_1" }));
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      supabaseClient: db, effectiveOwnerId: "owner1", user: { id: "user1" }, response: null,
    });
    getActiveWorkspaceRole.mockResolvedValue("owner");
    loadTenantLedgerData.mockResolvedValue(LEDGER_DATA);
    createResendRentalEmailProvider.mockReturnValue({ send });
  });

  it("blocks read-only workspace members", async () => {
    getActiveWorkspaceRole.mockResolvedValue("read_only");
    const response = await POST(post({ tenantId: "t1", kind: "statement" }));
    expect(response.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a tenant with no email on file without sending", async () => {
    loadTenantLedgerData.mockResolvedValue({ ...LEDGER_DATA, tenant: { ...LEDGER_DATA.tenant, email: null } });
    const response = await POST(post({ tenantId: "t1", kind: "statement" }));
    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("404s for a tenant outside the workspace", async () => {
    const notFound = new Error("Tenant was not found.");
    notFound.code = "TENANT_NOT_FOUND";
    loadTenantLedgerData.mockRejectedValue(notFound);
    const response = await POST(post({ tenantId: "nope", kind: "statement" }));
    expect(response.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the statement email and logs it as sent", async () => {
    const response = await POST(post({ tenantId: "t1", kind: "statement" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.notificationId).toBe("n1");
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message.recipient).toBe("eric@example.com");
    expect(message.subject).toContain("statement");
    expect(message.bodyText).toContain("Balance due: $1600.00");
    // Provider idempotency key is the stable event key.
    expect(message.id).toContain("statement:t1:");
  });

  it("does not double-send on a repeated press for the same payload", async () => {
    db = makeDb({
      insertResult: { data: [], error: { code: "23505" } },
      existingRow: { id: "n1", status: "sent", attempt_count: 1, max_attempts: 3 },
    });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      supabaseClient: db, effectiveOwnerId: "owner1", user: { id: "user1" }, response: null,
    });
    const response = await POST(post({ tenantId: "t1", kind: "statement" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.alreadySent).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("marks the row failed and returns 502 when the provider fails", async () => {
    send.mockRejectedValue(new Error("provider down"));
    const response = await POST(post({ tenantId: "t1", kind: "statement" }));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.notificationId).toBe("n1");
  });

  it("sends a single invoice email for a charge on the tenant's lease", async () => {
    const response = await POST(post({ tenantId: "t1", kind: "invoice", chargeId: "c1" }));
    expect(response.status).toBe(200);
    const message = send.mock.calls[0][0];
    expect(message.recipient).toBe("eric@example.com");
    expect(message.subject).toContain("Invoice");
    expect(message.bodyText).toContain("Balance due: $1600.00");
    expect(message.id).toContain("invoice:c1:");
  });

  it("404s for an invoice charge that is not on the tenant's leases", async () => {
    const response = await POST(post({ tenantId: "t1", kind: "invoice", chargeId: "other" }));
    expect(response.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("requires chargeId for invoice kind", async () => {
    const response = await POST(post({ tenantId: "t1", kind: "invoice" }));
    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("increments attempt_count (never resets) when reclaiming a failed row", async () => {
    db = makeDb({
      insertResult: { data: [], error: { code: "23505" } },
      existingRow: { id: "n1", status: "failed", attempt_count: 2, max_attempts: 3 },
    });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      supabaseClient: db, effectiveOwnerId: "owner1", user: { id: "user1" }, response: null,
    });
    const response = await POST(post({ tenantId: "t1", kind: "statement" }));
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const claim = db.__updates.find((u) => u.payload?.status === "sending");
    expect(claim).toBeDefined();
    // Attempt 2 failed before; the retry is attempt 3, not attempt 1.
    expect(claim.payload.attempt_count).toBe(3);
    expect(claim.eqs).toContainEqual(["attempt_count", 2]);
    expect(claim.eqs).toContainEqual(["lt:attempt_count", 3]);
  });

  it("refuses to reclaim a failed row that reached max_attempts", async () => {
    db = makeDb({
      insertResult: { data: [], error: { code: "23505" } },
      existingRow: { id: "n1", status: "failed", attempt_count: 3, max_attempts: 3 },
    });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      supabaseClient: db, effectiveOwnerId: "owner1", user: { id: "user1" }, response: null,
    });
    const response = await POST(post({ tenantId: "t1", kind: "statement" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.alreadySent).toBe(true);
    expect(send).not.toHaveBeenCalled();
    // No reclaim update and no sending claim were issued.
    expect(db.__updates.some((u) => u.payload?.status === "sending")).toBe(false);
  });
});
