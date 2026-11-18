// Unit tests for the External Accounts Register API routes. The RPCs
// enforce authority/idempotency/auditing; these tests prove the thin
// route layer gates to the household, validates the shape, maps the
// register failure codes to plain words, and (for seed/report) uses
// the server-side seed set and never leaks emails or locators.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
vi.mock("@/domains/externalAccounts/externalAccountHouseholdGate", () => ({
  isRegisterHouseholdActor: vi.fn(),
}));

import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { isRegisterHouseholdActor } from "@/domains/externalAccounts/externalAccountHouseholdGate";
import { GET as listAccounts, POST as createAccount } from "./route";
import { GET as getAccount, PATCH as updateAccount, DELETE as deleteAccount } from "./[id]/route";
import { POST as restoreAccount } from "./[id]/restore/route";
import { POST as addThread } from "./[id]/threads/route";
import { PATCH as setThreadState } from "./threads/[threadId]/route";
import { POST as seed } from "./seed/route";
import { POST as reconcile } from "./reconcile/route";
import { GET as report } from "./report/route";

// Chainable query stub: every builder method returns the chain; the
// chain is awaitable (list queries) and has maybeSingle (detail).
function chainStub(result) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => result,
    then: (resolve) => {
      resolve(result);
      return undefined;
    },
  };
  return chain;
}

function mockSupabase({ rpcImpl, tables = {} }) {
  return {
    rpc: vi.fn(rpcImpl),
    from: (table) => chainStub(tables[table] ?? { data: [], error: null }),
  };
}

function allowHousehold(supabaseClient) {
  isRegisterHouseholdActor.mockResolvedValue(true);
  createAuthenticatedForgeApplication.mockResolvedValue({
    supabaseClient,
    user: { id: "owner-1" },
    effectiveOwnerId: "owner-1",
  });
}

function denyHousehold(supabaseClient) {
  isRegisterHouseholdActor.mockResolvedValue(false);
  createAuthenticatedForgeApplication.mockResolvedValue({
    supabaseClient,
    user: { id: "member-1" },
    effectiveOwnerId: "member-1",
  });
}

function jsonRequest(path, body) {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(path) {
  return new Request(`https://example.test${path}`, { method: "GET" });
}

const ACCOUNT_ROW = {
  id: "acc-1",
  provider_name: "GitHub",
  purpose: "Development",
  associated_app: "FORGE",
  record_status: "confirmed_account",
  setup_status: "ready",
  version: 1,
};

describe("external accounts routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET list: household sees accounts; non-household gets a bare 404", async () => {
    const client = mockSupabase({
      rpcImpl: async () => ({ data: null, error: null }),
      tables: { forge_external_accounts: { data: [ACCOUNT_ROW], error: null } },
    });
    allowHousehold(client);
    const result = await listAccounts(getRequest("/api/forge/platform/external-accounts"));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, accounts: [ACCOUNT_ROW] });

    denyHousehold(client);
    const denied = await listAccounts(getRequest("/api/forge/platform/external-accounts"));
    expect(denied.status).toBe(404);
    expect(await denied.json()).toEqual({ error: "Not found." });
  });

  it("POST create: validates, maps a duplicate to a plain-words 409, succeeds with a confirmation", async () => {
    const client = mockSupabase({
      rpcImpl: async () => ({ data: { conflict: false, id: "acc-2" }, error: null }),
    });
    allowHousehold(client);

    const bad = await createAccount(
      jsonRequest("/api/forge/platform/external-accounts", { payload: { purpose: "x" } }),
    );
    expect(bad.status).toBe(400);

    const secret = await createAccount(
      jsonRequest("/api/forge/platform/external-accounts", {
        payload: {
          provider_name: "X",
          purpose: "y",
          associated_app: "FORGE",
          credential_location: "sk-FAKE1234567890abcdefFAKE1234",
        },
      }),
    );
    expect(secret.status).toBe(400);

    const good = await createAccount(
      jsonRequest("/api/forge/platform/external-accounts", {
        payload: { provider_name: "GitHub", purpose: "Development", associated_app: "FORGE" },
      }),
    );
    expect(good.status).toBe(201);
    expect(await good.json()).toMatchObject({ ok: true, message: "Saved GitHub." });
    expect(client.rpc).toHaveBeenCalledWith("forge_external_account_create", {
      p_payload: { provider_name: "GitHub", purpose: "Development", associated_app: "FORGE" },
    });

    client.rpc.mockResolvedValueOnce({
      data: { conflict: true, existing_id: "acc-1" },
      error: null,
    });
    const dup = await createAccount(
      jsonRequest("/api/forge/platform/external-accounts", {
        payload: { provider_name: "GitHub", purpose: "Development", associated_app: "FORGE" },
      }),
    );
    expect(dup.status).toBe(409);
    expect((await dup.json()).existing_id).toBe("acc-1");
  });

  it("GET one: missing row is a bare 404; PATCH needs a version; stale version maps to 409", async () => {
    const client = mockSupabase({
      rpcImpl: async () => ({
        data: null,
        error: { message: "FORGE_EXTERNAL_ACCOUNT_VERSION_CONFLICT", code: "P0001" },
      }),
      tables: {
        forge_external_accounts: { data: null, error: null },
        forge_external_account_threads: { data: [], error: null },
        forge_external_account_audit: { data: [], error: null },
      },
    });
    allowHousehold(client);

    const missing = await getAccount(getRequest("/api/forge/platform/external-accounts/acc-9"), {
      params: Promise.resolve({ id: "acc-9" }),
    });
    expect(missing.status).toBe(404);

    const noVersion = await updateAccount(
      jsonRequest("/api/forge/platform/external-accounts/acc-1", {
        payload: { setup_status: "ready" },
      }),
      { params: Promise.resolve({ id: "acc-1" }) },
    );
    expect(noVersion.status).toBe(400);

    const stale = await updateAccount(
      jsonRequest("/api/forge/platform/external-accounts/acc-1", {
        payload: { setup_status: "ready" },
        expected_version: 1,
      }),
      { params: Promise.resolve({ id: "acc-1" }) },
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toContain("changed since you opened it");
  });

  it("DELETE: logical by default; restore and thread add confirm in plain words", async () => {
    const client = mockSupabase({
      rpcImpl: async (rpc) => {
        if (rpc === "forge_external_account_thread_add") {
          return { data: { id: "thread-1" }, error: null };
        }
        return { data: { id: "acc-1" }, error: null };
      },
    });
    allowHousehold(client);

    const deleted = await deleteAccount(
      getRequest("/api/forge/platform/external-accounts/acc-1"),
      { params: Promise.resolve({ id: "acc-1" }) },
    );
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).message).toContain("Deleted.");
    expect(client.rpc).toHaveBeenCalledWith("forge_external_account_delete", {
      p_account_id: "acc-1",
      p_permanent: false,
    });

    const restored = await restoreAccount(
      jsonRequest("/api/forge/platform/external-accounts/acc-1/restore", {}),
      { params: Promise.resolve({ id: "acc-1" }) },
    );
    expect(restored.status).toBe(200);
    expect((await restored.json()).message).toBe("Restored.");

    const threaded = await addThread(
      jsonRequest("/api/forge/platform/external-accounts/acc-1/threads", {
        payload: { title: "Finish setup", state: "open" },
      }),
      { params: Promise.resolve({ id: "acc-1" }) },
    );
    expect(threaded.status).toBe(201);
    expect((await threaded.json()).message).toContain("Finish setup");
  });

  it("thread state: an unrecognized state is a 400 before any RPC call", async () => {
    const client = mockSupabase({ rpcImpl: async () => ({ data: {}, error: null }) });
    allowHousehold(client);
    const result = await setThreadState(
      jsonRequest("/api/forge/platform/external-accounts/threads/t1", { state: "banana" }),
      { params: Promise.resolve({ threadId: "t1" }) },
    );
    expect(result.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("seed: preview uses the server-side set (139 candidates, v1); apply needs a request id and seeds threads idempotently", async () => {
    const client = mockSupabase({
      rpcImpl: async (rpc) => {
        if (rpc === "forge_external_accounts_seed_preview") {
          return { data: { creates: 139, matches: 0, conflicts: 0, items: [] }, error: null };
        }
        if (rpc === "forge_external_accounts_seed_apply") {
          return { data: { created: 139 }, error: null };
        }
        return { data: { id: "thread-1" }, error: null };
      },
      tables: {
        forge_external_accounts: {
          data: [{ id: "acc-windy", seed_key: "external_accounts_seed_v1:windy" }],
          error: null,
        },
        forge_external_account_threads: { data: [], error: null },
      },
    });
    allowHousehold(client);

    const preview = await seed(
      jsonRequest("/api/forge/platform/external-accounts/seed", { action: "preview" }),
    );
    expect(preview.status).toBe(200);
    const previewCall = client.rpc.mock.calls.find(
      ([rpc]) => rpc === "forge_external_accounts_seed_preview",
    );
    expect(previewCall[1].p_seed_version).toBe("external_accounts_seed_v1");
    expect(previewCall[1].p_candidates).toHaveLength(139);

    const noRequestId = await seed(
      jsonRequest("/api/forge/platform/external-accounts/seed", { action: "apply" }),
    );
    expect(noRequestId.status).toBe(400);

    const applied = await seed(
      jsonRequest("/api/forge/platform/external-accounts/seed", {
        action: "apply",
        request_id: "req-1",
      }),
    );
    expect(applied.status).toBe(200);
    const appliedBody = await applied.json();
    expect(appliedBody.created).toBe(139);
    // Only the Windy thread's account exists in the mock, so exactly
    // one seed thread is added (the Radar thread on Windy).
    expect(appliedBody.threads_added).toBe(1);
  });

  it("reconcile: a missing message ref is a 400 before any RPC call", async () => {
    const client = mockSupabase({ rpcImpl: async () => ({ data: {}, error: null }) });
    allowHousehold(client);
    const result = await reconcile(
      jsonRequest("/api/forge/platform/external-accounts/reconcile", {
        lead: { provider: "New Co" },
      }),
    );
    expect(result.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("report: builds the section and never emits an email or locator", async () => {
    const client = mockSupabase({
      rpcImpl: async () => ({ data: null, error: null }),
      tables: {
        forge_external_accounts: {
          data: [
            {
              id: "acc-1",
              seed_key: "external_accounts_seed_v1:windy",
              provider_name: "Windy",
              work_thread_label: "Property Risk Radar",
              record_status: "evaluating_service",
              setup_status: "not_started",
              api_integration_status: "not_integrated",
              still_needed: null,
              last_verified_at: null,
            },
          ],
          error: null,
        },
        forge_external_account_threads: {
          data: [
            {
              id: "th-1",
              account_id: "acc-1",
              title: "Property Risk Radar — scope GO Oct 16, build not started",
              state: "open",
              next_action: "Jason's word needed to start R0",
            },
          ],
          error: null,
        },
      },
    });
    allowHousehold(client);
    const result = await report();
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.section.radar.status).toBe("open_not_built");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("account_email");
    expect(serialized).not.toContain("credential_location");
  });
});
