// Tests for POST /api/rental/receptionist/operator/kill.
// Fix round 1 (P1-2): the route forwards a privileged server-side
// operator token to the voice worker, so it must enforce the real
// owner/co-owner role — not just a valid session — before EITHER
// action (kill or unkill), plus the operation-owner match when the
// operation -> owner mapping is configured. Staff (manager,
// bookkeeper, read-only) and cross-workspace owners get 403 and the
// worker is never called.
// NOTE: isOwnerOrActiveCoOwner and resolveOperationOwner are
// intentionally NOT mocked — the stub supabase client answers the
// workspace_members query and the env mapping is set per test, so
// these tests prove the real role matrix end to end through the route.
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

const { POST } = await import("./route.js");

// Chainable supabase stub. memberRole: null = primary owner (no
// workspace_members row), otherwise the active membership role.
function makeDb({ memberRole = null } = {}) {
  const memberTable = {
    select() { return memberTable; },
    eq() { return memberTable; },
    async maybeSingle() {
      return { data: memberRole === null ? null : { role: memberRole }, error: null };
    },
  };
  return { from: vi.fn((name) => (name === "workspace_members" ? memberTable : memberTable)) };
}

function authAs(db, { userId = "user_1", effectiveOwnerId = OWNER_ID } = {}) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: userId }, effectiveOwnerId, supabaseClient: db,
  });
}

const post = (body) => POST(new Request("https://t/", {
  method: "POST", body: JSON.stringify(body),
}));

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
    json: async () => ({ killed: true, sessions_ended: [] }),
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

describe("receptionist operator kill route authorization (fix round 1, P1-2)", () => {
  it("primary owner may kill: the worker is called with the operator token", async () => {
    authAs(makeDb({ memberRole: null }));
    const res = await post({ action: "kill", reason: "drill" });
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("http://worker.test/operator/kill");
    expect(init.headers.Authorization).toBe("Bearer op-token");
    expect(JSON.parse(init.body).reason).toBe("drill");
  });

  it("co-owner may unkill", async () => {
    authAs(makeDb({ memberRole: "co_owner" }));
    const res = await post({ action: "unkill", reason: "drill done" });
    expect(res.status).toBe(200);
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("http://worker.test/operator/unkill");
  });

  it.each(["manager", "bookkeeper", "read_only"])(
    "%s may NOT kill: 403 and the worker is never called", async (role) => {
      authAs(makeDb({ memberRole: role }));
      const res = await post({ action: "kill" });
      expect(res.status).toBe(403);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["manager", "bookkeeper", "read_only"])(
    "%s may NOT unkill: 403 and the worker is never called", async (role) => {
      authAs(makeDb({ memberRole: role }));
      const res = await post({ action: "unkill" });
      expect(res.status).toBe(403);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  it("cross-workspace owner is blocked when the operation-owner mapping is configured", async () => {
    process.env.RECEPTIONIST_OPERATION_OWNERS = JSON.stringify({ [OP_ID]: OTHER_OWNER_ID });
    authAs(makeDb({ memberRole: null }), { effectiveOwnerId: OWNER_ID });
    const res = await post({ action: "kill" });
    expect(res.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("the operation owner passes the cross-owner check", async () => {
    process.env.RECEPTIONIST_OPERATION_OWNERS = JSON.stringify({ [OP_ID]: OWNER_ID });
    authAs(makeDb({ memberRole: null }), { effectiveOwnerId: OWNER_ID });
    const res = await post({ action: "kill" });
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("a co-owner acting in the operation owner's workspace passes the cross-owner check", async () => {
    process.env.RECEPTIONIST_OPERATION_OWNERS = JSON.stringify({ [OP_ID]: OWNER_ID });
    authAs(makeDb({ memberRole: "co_owner" }), { effectiveOwnerId: OWNER_ID });
    const res = await post({ action: "unkill" });
    expect(res.status).toBe(200);
  });

  it("unauthenticated requests pass through the auth response and never reach the worker", async () => {
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }),
    });
    const res = await post({ action: "kill" });
    expect(res.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("invalid action 400s for the owner before any worker call", async () => {
    authAs(makeDb({ memberRole: null }));
    const res = await post({ action: "explode" });
    expect(res.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("missing worker URL 503s for the owner instead of pretending the kill happened", async () => {
    delete process.env.RECEPTIONIST_WORKER_URL;
    authAs(makeDb({ memberRole: null }));
    const res = await post({ action: "kill" });
    expect(res.status).toBe(503);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("worker refusal surfaces the worker status, not success", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 403, json: async () => ({ error: "bad operator token" }),
    }));
    authAs(makeDb({ memberRole: null }));
    const res = await post({ action: "kill" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("bad operator token");
  });
});
