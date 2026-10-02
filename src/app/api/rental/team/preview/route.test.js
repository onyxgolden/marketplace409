import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/rental/teamAuthorization", () => ({
  PREVIEW_COOKIE_MAX_AGE_SECONDS: 4 * 60 * 60,
  PREVIEW_COOKIE_NAME: "forge_rental_preview_as",
  getActorRentalAuthorization: vi.fn(),
  requireTeamManager: vi.fn(),
}));

import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import {
  getActorRentalAuthorization,
  requireTeamManager,
} from "@/lib/rental/teamAuthorization";
import { DELETE, GET, POST } from "./route.js";

const TARGET = {
  id: "member_staff",
  role: "bookkeeper",
  status: "active",
  invited_email: "bookkeeper@example.com",
  member_user_id: "staff_user_1",
};

function targetQuery(row) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return query;
}

function authed({ target = TARGET, rpcImpl = async () => ({ data: null, error: null }) } = {}) {
  const rpc = vi.fn(rpcImpl);
  const from = vi.fn(() => targetQuery(target));
  const supabaseClient = { rpc, from };
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    response: null,
    user: { id: "owner_1" },
    effectiveOwnerId: "owner_1",
    supabaseClient,
  });
  return { rpc, from, supabaseClient };
}

function allowTeamManager() {
  requireTeamManager.mockResolvedValue({ response: null, authorization: { permissions: ["team.manage"] } });
}

function denyTeamManager() {
  requireTeamManager.mockResolvedValue({
    response: new Response(JSON.stringify({ error: "denied" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
    authorization: null,
  });
}

const jsonRequest = (method, body, cookie = "") =>
  new Request("https://t/api/rental/team/preview", {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/team/preview", () => {
  it("returns the active preview session", async () => {
    authed();
    getActorRentalAuthorization.mockResolvedValue({
      forbidden: null,
      preview: { memberId: "member_staff", role: "bookkeeper", email: "bookkeeper@example.com" },
    });
    const response = await GET(jsonRequest("GET", undefined, "forge_rental_preview_as=member_staff"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.preview).toMatchObject({ memberId: "member_staff", role: "bookkeeper", roleLabel: "Bookkeeper" });
  });

  it("returns null preview when no session is active", async () => {
    authed();
    getActorRentalAuthorization.mockResolvedValue({ forbidden: null, preview: null });
    const body = await (await GET(jsonRequest("GET"))).json();
    expect(body.preview).toBeNull();
  });

  it("flags an invalid preview cookie so the UI can offer to end it", async () => {
    authed();
    const { NextResponse } = await import("next/server");
    getActorRentalAuthorization.mockResolvedValue({
      forbidden: NextResponse.json({ error: "invalid" }, { status: 403 }),
      preview: null,
    });
    const body = await (await GET(jsonRequest("GET", undefined, "forge_rental_preview_as=member_gone"))).json();
    expect(body.preview).toBeNull();
    expect(body.previewInvalid).toBe(true);
  });
});

describe("POST /api/rental/team/preview (start)", () => {
  it("403s without team.manage", async () => {
    authed();
    denyTeamManager();
    const response = await POST(jsonRequest("POST", { memberId: "member_staff" }));
    expect(response.status).toBe(403);
  });

  it("requires a member id", async () => {
    authed();
    allowTeamManager();
    expect((await POST(jsonRequest("POST", {}))).status).toBe(400);
  });

  it("400s when the target is not active", async () => {
    authed({ target: { ...TARGET, status: "suspended" } });
    allowTeamManager();
    const response = await POST(jsonRequest("POST", { memberId: "member_staff" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/not active/i);
  });

  it("400s when the target is a co-owner or the actor themselves", async () => {
    authed({ target: { ...TARGET, role: "co_owner", member_user_id: "co_user" } });
    allowTeamManager();
    expect((await POST(jsonRequest("POST", { memberId: "member_staff" }))).status).toBe(400);

    authed({ target: { ...TARGET, member_user_id: "owner_1" } });
    allowTeamManager();
    expect((await POST(jsonRequest("POST", { memberId: "member_staff" }))).status).toBe(400);
  });

  it("starts the session: audits the start and sets the httpOnly cookie", async () => {
    const { rpc } = authed();
    allowTeamManager();
    const response = await POST(jsonRequest("POST", { memberId: "member_staff" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.preview).toMatchObject({ memberId: "member_staff", role: "bookkeeper" });
    expect(rpc).toHaveBeenCalledWith("log_team_audit", {
      p_action: "preview.start",
      p_target_member_id: "member_staff",
      p_detail: { role: "bookkeeper", email: "bookkeeper@example.com" },
    });
    const setCookie = response.headers.get("set-cookie") || "";
    expect(setCookie).toMatch(/forge_rental_preview_as=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Max-Age=14400/);
  });
});

describe("DELETE /api/rental/team/preview (end)", () => {
  it("ends the session, audits it, and clears the cookie", async () => {
    const { rpc } = authed();
    getActorRentalAuthorization.mockResolvedValue({
      forbidden: null,
      preview: { memberId: "member_staff", role: "bookkeeper" },
    });
    const response = await DELETE(jsonRequest("DELETE", undefined, "forge_rental_preview_as=member_staff"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.endedPreview).toBe(true);
    expect(rpc).toHaveBeenCalledWith("log_team_audit", {
      p_action: "preview.end",
      p_target_member_id: "member_staff",
      p_detail: { role: "bookkeeper" },
    });
    const setCookie = response.headers.get("set-cookie") || "";
    expect(setCookie).toMatch(/forge_rental_preview_as=/);
  });

  it("clears the cookie even when no session was active", async () => {
    const { rpc } = authed();
    getActorRentalAuthorization.mockResolvedValue({ forbidden: null, preview: null });
    const response = await DELETE(jsonRequest("DELETE"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.endedPreview).toBe(false);
    expect(rpc).not.toHaveBeenCalledWith("log_team_audit", expect.objectContaining({ p_action: "preview.end" }));
  });
});
