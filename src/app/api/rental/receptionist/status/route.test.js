// Tests for GET /api/rental/receptionist/status.
// Fix round 1 (P1-2): the route proxies the worker's /operator/status
// with the server-side operator token, so it gets the same
// owner/co-owner gate as the kill route — staff and cross-workspace
// owners get 403 and the worker is never called. The owner/co-owner
// positives cover both the worker-reachable path and the DB-derived
// fallback.
// NOTE: isOwnerOrActiveCoOwner and resolveOperationOwner are
// intentionally NOT mocked — the stub supabase client answers the
// workspace_members query and the env mapping is set per test.
// Synthetic fixtures only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_OWNER_ID = "22222222-2222-2222-2222-222222222222";
const OP_ID = "brandy-rental-office";

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init) {
      return new Response(JSON.stringify(body), {
        ...init,
        headers: { "content-type": "application/json" },
      });
    },
  },
}));

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));

import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

const { GET } = await import("./route.js");

// Chainable supabase stub. memberRole: null = primary owner (no
// workspace_members row), otherwise the active membership role.
// listRows answers the DB-fallback queries (alerts / outbox / calls).
function makeDb({ memberRole = null, listRows = [] } = {}) {
  const memberTable = {
    select() { return memberTable; },
    eq() { return memberTable; },
    async maybeSingle() {
      return { data: memberRole === null ? null : { role: memberRole }, error: null };
    },
  };
  const table = {
    select() { return table; },
    eq() { return table; },
    order() { return table; },
    limit() { return table; },
    then(resolve) { resolve({ data: listRows, error: null }); },
  };
  return { from: vi.fn((name) => (name === "workspace_members" ? memberTable : table)) };
}

function authAs(db, { userId = "user_1", effectiveOwnerId = OWNER_ID } = {}) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: userId }, effectiveOwnerId, supabaseClient: db,
  });
}

let savedWorkerUrl;
let savedOperatorToken;
let savedOperationOwners;
beforeEach(() => {
  vi.clearAllMocks();
  savedWorkerUrl = process.env.RECEPTIONIST_WORKER_URL;
  savedOperatorToken = process.env.RECEPTIONIST_OPERATOR_TOKEN;
  savedOperationOwners = process.env.RECEPTIONIST_OPERATION_OWNERS;
  process.env.RECEPTIONIST_WORKER_URL = "http://worker.test";
  process.env.RECEPTIONIST_OPERATOR_TOKEN = "op-token";
  delete process.env.RECEPTIONIST_OPERATION_OWNERS;
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ activation_mode: "TEST_ONLY", kill_switch: { killed: false } }),
  }));
});

afterEach(() => {
  if (savedWorkerUrl === undefined) delete process.env.RECEPTIONIST_WORKER_URL;
  else process.env.RECEPTIONIST_WORKER_URL = savedWorkerUrl;
  if (savedOperatorToken === undefined) delete process.env.RECEPTIONIST_OPERATOR_TOKEN;
  else process.env.RECEPTIONIST_OPERATOR_TOKEN = savedOperatorToken;
  if (savedOperationOwners === undefined) delete process.env.RECEPTIONIST_OPERATION_OWNERS;
  else process.env.RECEPTIONIST_OPERATION_OWNERS = savedOperationOwners;
  delete globalThis.fetch;
});

describe("receptionist status route authorization (fix round 1, P1-2)", () => {
  it("primary owner sees the worker status", async () => {
    authAs(makeDb({ memberRole: null }));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worker_reachable).toBe(true);
    expect(body.activation_mode).toBe("TEST_ONLY");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("http://worker.test/operator/status");
    expect(init.headers.Authorization).toBe("Bearer op-token");
  });

  it("co-owner sees the worker status", async () => {
    authAs(makeDb({ memberRole: "co_owner" }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).worker_reachable).toBe(true);
  });

  it.each(["manager", "bookkeeper", "read_only"])(
    "%s gets 403 and the worker is never called", async (role) => {
      authAs(makeDb({ memberRole: role }));
      const res = await GET();
      expect(res.status).toBe(403);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  it("cross-workspace owner is blocked when the operation-owner mapping is configured", async () => {
    process.env.RECEPTIONIST_OPERATION_OWNERS = JSON.stringify({ [OP_ID]: OTHER_OWNER_ID });
    authAs(makeDb({ memberRole: null }), { effectiveOwnerId: OWNER_ID });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("unreachable worker falls back to the DB view for the owner", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("down"); });
    authAs(makeDb({ memberRole: null, listRows: [{ source: "TEST" }, { source: "TEST" }] }));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worker_reachable).toBe(false);
    expect(body.activation_mode).toBe("OFF");
    expect(body.recent_calls_by_source).toEqual({ TEST: 2 });
  });

  it("unauthenticated requests pass through the auth response", async () => {
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
