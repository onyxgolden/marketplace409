// SaaS 30-day trial — unit tests for the /api/forge/platform/trials/*
// routes. The RPCs enforce authority/idempotency/auditing; these
// tests prove the thin route layer authenticates, validates the shape,
// maps the trial failure codes to plain words, and (for the expiry
// worker) requires the cron secret and calls the worker RPC with the
// service-role client.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: vi.fn(),
}));

import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { GET as listTrials } from "./route";
import { POST as grantTrial } from "./grant/route";
import { POST as renewTrial } from "./renew/route";
import { POST as convertTrial } from "./convert/route";
import { GET as expireTrials } from "./expire/route";

function authenticatedClient(rpcImpl) {
  return {
    supabaseClient: { rpc: vi.fn(rpcImpl) },
    user: { id: "operator-1" },
    effectiveOwnerId: "owner-1",
  };
}

function postRequest(body) {
  return new Request("https://example.test/api/forge/platform/trials/grant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(path) {
  return new Request(`https://example.test${path}`, { method: "GET" });
}

describe("trial mutation routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grant: passes owner/app/reason/request_id to forge_app_trial_grant", async () => {
    const client = authenticatedClient(async () => ({ data: { status: "active", source: "owner_trial" }, error: null }));
    createAuthenticatedForgeApplication.mockResolvedValue(client);
    const result = await grantTrial(postRequest({ request_id: "r1", owner_id: "owner-9", app_key: "planner", reason: "pilot" }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, status: "active", source: "owner_trial" });
    expect(client.supabaseClient.rpc).toHaveBeenCalledWith("forge_app_trial_grant", {
      p_owner_id: "owner-9",
      p_app_key: "planner",
      p_reason: "pilot",
      p_request_id: "r1",
    });
  });

  it("renew: passes through to forge_app_trial_renew", async () => {
    const client = authenticatedClient(async () => ({ data: { status: "active", renewal_of: "g1" }, error: null }));
    createAuthenticatedForgeApplication.mockResolvedValue(client);
    const result = await renewTrial(postRequest({ request_id: "r2", owner_id: "owner-9", app_key: "planner", reason: "another month" }));
    expect(result.status).toBe(200);
    expect(client.supabaseClient.rpc).toHaveBeenCalledWith("forge_app_trial_renew", {
      p_owner_id: "owner-9",
      p_app_key: "planner",
      p_reason: "another month",
      p_request_id: "r2",
    });
  });

  it("convert: passes through to forge_app_trial_convert_to_paid", async () => {
    const client = authenticatedClient(async () => ({ data: { status: "active", source: "owner_manual" }, error: null }));
    createAuthenticatedForgeApplication.mockResolvedValue(client);
    const result = await convertTrial(postRequest({ request_id: "r3", owner_id: "owner-9", app_key: "planner", reason: "paying now" }));
    expect(result.status).toBe(200);
    expect(client.supabaseClient.rpc).toHaveBeenCalledWith("forge_app_trial_convert_to_paid", {
      p_owner_id: "owner-9",
      p_app_key: "planner",
      p_reason: "paying now",
      p_request_id: "r3",
    });
  });

  it("maps each trial failure code to plain words with the right status, never the code", async () => {
    const cases = [
      ["FORGE_AUTH_TRIAL_UNAVAILABLE", 400, /isn't available for that app/],
      ["FORGE_AUTH_TRIAL_ALREADY_GRANTED", 409, /already had a trial/],
      ["FORGE_AUTH_TRIAL_NOT_ACTIVE", 403, /no active trial/],
      ["FORGE_AUTH_TRIAL_NOT_EXPIRED", 409, /hasn't ended yet/],
      ["FORGE_AUTH_TRIAL_NOT_PENDING", 409, /already enabled/],
      ["FORGE_AUTH_TRIAL_ALREADY_RENEWED", 409, /already renewed/],
      ["FORGE_AUTH_TRIAL_MUST_CONVERT", 409, /only be converted through the trial conversion/],
      ["FORGE_TRIAL_ENTITLEMENT_REQUIRED", 403, /isn't enabled for the workspace/],
    ];
    for (const [code, status, pattern] of cases) {
      const client = authenticatedClient(async () => ({ data: null, error: { message: code, code: "42501" } }));
      createAuthenticatedForgeApplication.mockResolvedValue(client);
      const result = await grantTrial(postRequest({ request_id: "rx", owner_id: "owner-9", app_key: "planner", reason: "x" }));
      expect(result.status, code).toBe(status);
      const body = await result.json();
      expect(body.error, code).toMatch(pattern);
      expect(body.error, code).not.toContain("FORGE_");
    }
  });

  it("rejects a missing reason with 400 before calling the RPC", async () => {
    const client = authenticatedClient(async () => ({ data: {}, error: null }));
    createAuthenticatedForgeApplication.mockResolvedValue(client);
    const result = await grantTrial(postRequest({ request_id: "r4", owner_id: "owner-9", app_key: "planner" }));
    expect(result.status).toBe(400);
    expect(client.supabaseClient.rpc).not.toHaveBeenCalled();
  });

  it("propagates the helper's 401 when signed out", async () => {
    const response = new Response(JSON.stringify({ error: "nope" }), { status: 401 });
    createAuthenticatedForgeApplication.mockResolvedValue({ response });
    const result = await grantTrial(postRequest({ request_id: "r5", owner_id: "owner-9", app_key: "planner", reason: "x" }));
    expect(result).toBe(response);
  });
});

describe("trial list/overview route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET with ?workspace= calls the overview RPC", async () => {
    const overview = { owner_id: "owner-9", display_name: "Trial Workspace", status: "active", entitlements: [], trials: [], availability: [], audit: [] };
    const client = authenticatedClient(async () => ({ data: overview, error: null }));
    createAuthenticatedForgeApplication.mockResolvedValue(client);
    const result = await listTrials(getRequest("/api/forge/platform/trials?workspace=owner-9"));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, ...overview });
    expect(client.supabaseClient.rpc).toHaveBeenCalledWith("forge_platform_trial_overview", { p_owner_id: "owner-9" });
  });

  it("GET without workspace calls the workspace-list RPC with the search term", async () => {
    const client = authenticatedClient(async () => ({ data: [{ owner_id: "owner-9", display_name: "Trial Workspace", status: "active" }], error: null }));
    createAuthenticatedForgeApplication.mockResolvedValue(client);
    const result = await listTrials(getRequest("/api/forge/platform/trials?search=Trial"));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, workspaces: [{ owner_id: "owner-9", display_name: "Trial Workspace", status: "active" }] });
    expect(client.supabaseClient.rpc).toHaveBeenCalledWith("forge_platform_trial_workspace_list", { p_search: "Trial" });
  });

  it("maps a platform-owner-only denial to 403 plain words", async () => {
    const client = authenticatedClient(async () => ({ data: null, error: { message: "FORGE_AUTH_PLATFORM_OWNER_ONLY", code: "42501" } }));
    createAuthenticatedForgeApplication.mockResolvedValue(client);
    const result = await listTrials(getRequest("/api/forge/platform/trials?workspace=owner-9"));
    expect(result.status).toBe(403);
    expect((await result.json()).error).toMatch(/Only a platform owner/);
  });
});

describe("trial expiry worker route", () => {
  const OLD_SECRET = process.env.CRON_SECRET;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
  });
  afterEach(() => {
    process.env.CRON_SECRET = OLD_SECRET;
  });

  it("rejects a missing or wrong cron secret with 401 without calling the RPC", async () => {
    const db = { rpc: vi.fn(async () => ({ data: {}, error: null })) };
    createRentalWebhookClient.mockReturnValue(db);
    const noHeader = await expireTrials(getRequest("/api/forge/platform/trials/expire"));
    expect(noHeader.status).toBe(401);
    const wrongHeader = await expireTrials(new Request("https://example.test/api/forge/platform/trials/expire", {
      method: "GET",
      headers: { authorization: "Bearer wrong" },
    }));
    expect(wrongHeader.status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("calls forge_app_trial_expire_due with the service-role client and returns the count", async () => {
    const db = { rpc: vi.fn(async () => ({ data: { expired_count: 2, expired: [] }, error: null })) };
    createRentalWebhookClient.mockReturnValue(db);
    const result = await expireTrials(new Request("https://example.test/api/forge/platform/trials/expire", {
      method: "GET",
      headers: { authorization: "Bearer test-cron-secret" },
    }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, expired_count: 2, expired: [] });
    expect(db.rpc).toHaveBeenCalledWith("forge_app_trial_expire_due");
  });
});
