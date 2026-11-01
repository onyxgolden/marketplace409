import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRole = vi.hoisted(() => ({ value: null }));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => mockRole.value),
}));
vi.mock("@/lib/supabase/isOwnerOrActiveCoOwner", () => ({
  isOwnerOrActiveCoOwner: vi.fn(async () => true),
}));

// Chainable supabase mock: every builder method returns the query; terminal
// methods resolve to empty results. Good enough to prove an operation
// dispatched (it reaches validation or a mocked DB call) instead of falling
// through to the unknown-operation error.
function chainable() {
  const terminal = {
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
  };
  const query = new Proxy({}, {
    get(target, prop) {
      if (prop === "then") return undefined;
      if (prop in terminal) return terminal[prop];
      return (..._args) => query;
    },
  });
  return query;
}

const application = {
  units: { findById: vi.fn(async () => null) },
  findUnitsByProperty: vi.fn(async () => []),
  saveUnit: vi.fn(async (value) => value),
  saveTenant: vi.fn(async (value) => value),
  saveLease: vi.fn(async (value) => value),
  saveSchedule: vi.fn(async (value) => value),
  generateMonthlyCharge: vi.fn(async () => null),
};

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(async () => ({
    application,
    user: { id: "owner_1" },
    effectiveOwnerId: "owner_1",
    supabaseClient: {
      from: vi.fn(() => chainable()),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    },
  })),
}));

import { POST } from "./route.js";

function request(body) {
  return new Request("http://localhost/api/rental", { method: "POST", body: JSON.stringify(body) });
}

const UNKNOWN_OP_MESSAGE = "A supported Rental Manager operation is required.";

// Every operation the dispatch table advertises must route to its handler.
// The assertion is deliberately narrow: the response must NOT be the
// unknown-operation error. Validation 400s, 404s, and 409s prove dispatch
// happened; only the unknown-operation message proves it did not.
const ALL_OPERATIONS = [
  "save-unit", "archive-unit", "delete-archived-unit", "review-animal",
  "save-tenant", "delete-unused-tenant", "update-tenant-email", "send-tenant-invite",
  "update-tenant-profile", "set-primary-tenant",
  "save-lease", "save-schedule", "cancel-lease", "end-lease", "update-lease-terms",
  "generate-charge", "void-charge", "activate-forge-billing", "set-billing-enabled",
  "save-convenience-fee", "activate-lease-schedule",
  "record-offline-payment", "set-payment-deposit-state", "apply-tenant-credit", "void-tenant-credit", "void-payment", "refund-payment",
  "pause-autopay", "resume-autopay", "cancel-autopay", "update-autopay",
  "create-tenant-credit",
  "save-payment-policy", "save-payment-policy-tenant-override",
  "queue-rent-reminder", "cancel-rent-notification", "queue-insurance-renewals",
  "update-maintenance-request", "create-maintenance-work-order", "update-maintenance-work-order",
  "save-contractor", "record-contractor-payment", "update-support-case",
  "save-security-deposit", "record-security-deposit-transaction",
  "save-inspection", "finalize-inspection",
  "save-lease-change", "approve-lease-change",
  "save-late-fee-rule", "assess-late-fee", "save-late-fee-auto-settings", "save-late-fee-tenant-override",
  "save-lease-preparation-version", "approve-lease-preparation-version",
];

describe("Rental Manager operation dispatch table", () => {
  beforeEach(() => { vi.clearAllMocks(); mockRole.value = null; });

  it.each(ALL_OPERATIONS)("dispatches %s (never the unknown-operation error)", async (operation) => {
    const response = await POST(request({ operation }));
    const json = await response.json();
    expect(json.error).not.toBe(UNKNOWN_OP_MESSAGE);
  });

  it("rejects an unknown operation with the exact contract message", async () => {
    const response = await POST(request({ operation: "definitely-not-real" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: UNKNOWN_OP_MESSAGE });
  });

  it("rejects a missing operation with the exact contract message", async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: UNKNOWN_OP_MESSAGE });
  });
});

describe("operation dispatch is prototype-safe", () => {
  beforeEach(() => { vi.clearAllMocks(); mockRole.value = null; });

  // RD-001: inherited Object.prototype names must not dispatch — they must hit
  // the unknown-operation 400 exactly as the pre-split switch did, never a
  // non-Response return or a 500.
  it.each(["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"])(
    "rejects inherited operation %s with the exact contract message",
    async (operation) => {
      const response = await POST(request({ operation }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: UNKNOWN_OP_MESSAGE });
    },
  );

  it.each([123, null, true, ["save-unit"], { name: "save-unit" }])(
    "rejects non-string operation %j with the exact contract message",
    async (operation) => {
      const response = await POST(request({ operation }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: UNKNOWN_OP_MESSAGE });
    },
  );
});

describe("save-late-fee-auto-settings contract", () => {
  beforeEach(() => { vi.clearAllMocks(); mockRole.value = null; });

  it("blocks read-only members with 403", async () => {
    mockRole.value = "read_only";
    const response = await POST(request({ operation: "save-late-fee-auto-settings", settings: { enabled: false } }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Read-only members cannot change late-fee settings." });
  });

  it("requires enabled to be boolean", async () => {
    const response = await POST(request({ operation: "save-late-fee-auto-settings", settings: { enabled: "yes" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "enabled must be boolean." });
  });

  it("requires explicit confirmation before enabling auto-post", async () => {
    const response = await POST(request({
      operation: "save-late-fee-auto-settings",
      settings: { enabled: true, graceDays: 5, calculationType: "fixed", fixedAmountCents: 5000 },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Confirm automatic posting before enabling." });
  });
});

describe("save-late-fee-tenant-override contract", () => {
  beforeEach(() => { vi.clearAllMocks(); mockRole.value = null; });

  it("blocks read-only members with 403", async () => {
    mockRole.value = "read_only";
    const response = await POST(request({ operation: "save-late-fee-tenant-override", override: { tenantId: "t1" } }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Read-only members cannot change late-fee overrides." });
  });

  it("requires tenantId", async () => {
    const response = await POST(request({ operation: "save-late-fee-tenant-override", override: {} }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "tenantId is required." });
  });

  it("rejects an unknown tenant", async () => {
    const response = await POST(request({ operation: "save-late-fee-tenant-override", override: { tenantId: "ghost" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Tenant was not found." });
  });
});
