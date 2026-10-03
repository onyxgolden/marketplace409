import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../work-packages/_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/workLinks", () => ({
  createLink: vi.fn(),
  listLinks: vi.fn(),
  getLinkDetail: vi.fn(),
  unlinkWorkLink: vi.fn(),
  confirmLink: vi.fn(),
  recheckLink: vi.fn(),
  flagLinkStale: vi.fn(),
}));

import { workAuth } from "../work-packages/_lib/auth.js";
import {
  createLink, listLinks, getLinkDetail, unlinkWorkLink,
  confirmLink, recheckLink, flagLinkStale,
} from "@/application/work-management/workLinks";
import { GET, POST } from "./route.js";
import { GET as GET_ONE, DELETE as DELETE_ONE } from "./[linkId]/route.js";
import { POST as POST_CONFIRM } from "./[linkId]/confirm/route.js";
import { POST as POST_RECHECK } from "./[linkId]/recheck/route.js";
import { POST as POST_STALE } from "./[linkId]/flag-stale/route.js";

const AUTH = { db: {}, ownerId: "owner_1", actor: "user_9" };
const PARAMS = { linkId: "forge_wlink_1" };

function request(body, method = "GET", query = "") {
  return new Request(`https://test/api/work-links${query}`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-links", () => {
  it("returns 401 when unauthenticated", async () => {
    workAuth.mockResolvedValueOnce({ error: Response.json({ error: "no" }, { status: 401 }) });
    const response = await GET(request(null));
    expect(response.status).toBe(401);
  });
  it("lists links scoped to a package", async () => {
    listLinks.mockResolvedValue({ ok: true, links: [{ id: "forge_wlink_1" }] });
    const response = await GET(request(null, "GET", "?packageId=forge_wp_1&status=active"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.links).toHaveLength(1);
    expect(listLinks).toHaveBeenCalledWith({}, {
      ownerId: "owner_1", packageId: "forge_wp_1", status: "active",
      relationshipType: undefined, provenance: undefined,
    });
  });
});

describe("POST /api/work-links", () => {
  it("creates a link and returns 201", async () => {
    createLink.mockResolvedValue({ ok: true, link: { id: "forge_wlink_1", status: "active" } });
    const input = { relationship_type: "on_asset",
      source_domain: "workmgmt", source_type: "work_package", source_id: "forge_wp_1",
      target_domain: "workmgmt", target_type: "forge_work_asset", target_id: "forge_wasset_1" };
    const response = await POST(request(input, "POST"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.link.id).toBe("forge_wlink_1");
    expect(createLink).toHaveBeenCalledWith({}, { ownerId: "owner_1", actor: "user_9", input });
  });
  it("maps a cross-workspace rejection to 400", async () => {
    createLink.mockResolvedValue({ ok: false, httpStatus: 400, error: "not found in this workspace" });
    const response = await POST(request({ relationship_type: "on_asset" }, "POST"));
    expect(response.status).toBe(400);
  });
});

describe("GET /api/work-links/[linkId]", () => {
  it("returns the link with confirmation history", async () => {
    getLinkDetail.mockResolvedValue({ ok: true, link: { id: "forge_wlink_1" }, confirmations: [] });
    const response = await GET_ONE(request(null), { params: PARAMS });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.link.id).toBe("forge_wlink_1");
  });
  it("maps a missing link to 404", async () => {
    getLinkDetail.mockResolvedValue({ ok: false, httpStatus: 404, error: "Link not found." });
    const response = await GET_ONE(request(null), { params: PARAMS });
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/work-links/[linkId]", () => {
  it("unlinks and returns the id", async () => {
    unlinkWorkLink.mockResolvedValue({ ok: true, unlinked: "forge_wlink_1" });
    const response = await DELETE_ONE(request(null, "DELETE"), { params: PARAMS });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.unlinked).toBe("forge_wlink_1");
  });
});

describe("POST /api/work-links/[linkId]/confirm", () => {
  it("confirms a proposed link", async () => {
    confirmLink.mockResolvedValue({ ok: true,
      link: { id: "forge_wlink_1", provenance: "user_confirmed" },
      confirmation: { id: "forge_wlconf_1" } });
    const response = await POST_CONFIRM(request({ note: "Checked." }, "POST"), { params: PARAMS });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.confirmation.id).toBe("forge_wlconf_1");
    expect(confirmLink).toHaveBeenCalledWith({}, {
      ownerId: "owner_1", actor: "user_9", linkId: "forge_wlink_1", note: "Checked.",
    });
  });
});

describe("POST /api/work-links/[linkId]/recheck", () => {
  it("re-resolves the link", async () => {
    recheckLink.mockResolvedValue({ ok: true, link: { id: "forge_wlink_1", status: "active" } });
    const response = await POST_RECHECK(request(null, "POST"), { params: PARAMS });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.link.status).toBe("active");
  });
});

describe("POST /api/work-links/[linkId]/flag-stale", () => {
  it("flags the link stale", async () => {
    flagLinkStale.mockResolvedValue({ ok: true, link: { id: "forge_wlink_1", status: "stale" } });
    const response = await POST_STALE(request({ reason: "Rev superseded." }, "POST"), { params: PARAMS });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.link.status).toBe("stale");
  });
});
