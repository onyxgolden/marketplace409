import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { POST } from "./route";

function mockClient({ recipient = { id: "r1", kind: "vendor" }, state = null, onUpsert = null } = {}) {
  const builder = {
    _inserted: null,
    _patched: null,
    from() { return builder; },
    select() { return builder; },
    eq() { return builder; },
    insert(row) { builder._inserted = row; if (onUpsert) onUpsert({ insert: row }); return builder; },
    update(patch) { builder._patched = patch; if (onUpsert) onUpsert({ update: patch }); return builder; },
    maybeSingle() {
      // First maybeSingle call is the recipient lookup, second is the state lookup.
      builder._calls = (builder._calls || 0) + 1;
      const data = builder._calls === 1 ? recipient : state;
      return Promise.resolve({ data, error: null });
    },
    single() { return Promise.resolve({ data: { ...(builder._inserted || state || {}), ...(builder._patched || {}) }, error: null }); },
  };
  return builder;
}

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/rental/1099/filing-status", () => {
  it("403s for read-only members", async () => {
    authAs(mockClient(), "read_only");
    const response = await post({ recipientId: "r1", taxYear: 2026, toStatus: "ready" });
    expect(response.status).toBe(403);
  });

  it("404s for an unknown recipient", async () => {
    authAs(mockClient({ recipient: null }), "owner");
    const response = await post({ recipientId: "nope", taxYear: 2026, toStatus: "ready" });
    expect(response.status).toBe(404);
  });

  it("moves not_started -> ready and stamps decided_at", async () => {
    let upsert = null;
    authAs(mockClient({ state: null, onUpsert: (value) => { upsert = value; } }), "owner");
    const response = await post({ recipientId: "r1", taxYear: 2026, toStatus: "ready" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(upsert.insert.status).toBe("ready");
    expect(upsert.insert.decided_at).toBeTruthy();
    expect(upsert.insert.form_type).toBe("1099-NEC");
  });

  it("400s when the transition is illegal (not_started -> exported skips ready)", async () => {
    authAs(mockClient({ state: null }), "owner");
    const response = await post({ recipientId: "r1", taxYear: 2026, toStatus: "exported" });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("Cannot move filing status");
  });

  it("400s when leaving the terminal filed_manually state", async () => {
    authAs(mockClient({ state: { recipient_id: "r1", tax_year: 2026, status: "filed_manually" } }), "owner");
    const response = await post({ recipientId: "r1", taxYear: 2026, toStatus: "ready" });
    expect(response.status).toBe(400);
  });

  it("400s on an unknown target status", async () => {
    authAs(mockClient(), "owner");
    const response = await post({ recipientId: "r1", taxYear: 2026, toStatus: "mailed" });
    expect(response.status).toBe(400);
  });
});
