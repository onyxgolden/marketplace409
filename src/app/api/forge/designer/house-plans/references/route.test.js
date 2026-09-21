import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { HOUSE_PLANS_FLAG_KEY } from "@/lib/housePlans/housePlansFlags";
import { GET } from "./route";

function listQuery(rows) {
  const order = vi.fn(async () => ({ data: rows, error: null }));
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order };
  return { client: { from: vi.fn(() => query) }, query };
}

function authed(client) {
  return { user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: client };
}

describe("GET /api/forge/designer/house-plans/references (HP-L2)", () => {
  const ORIGINAL_FLAG = process.env[HOUSE_PLANS_FLAG_KEY];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env[HOUSE_PLANS_FLAG_KEY] = "true";
  });

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env[HOUSE_PLANS_FLAG_KEY];
    else process.env[HOUSE_PLANS_FLAG_KEY] = ORIGINAL_FLAG;
  });

  it("lists the caller's references newest-first with factual metadata only", async () => {
    const rows = [
      {
        id: "r1",
        title: "Sample Building Reference",
        section_identifier: "SEC-101.4",
        issuing_authority: "Sample Building Authority",
        jurisdiction: "Texas",
        edition: "2024",
        effective_date: "2024-01-01",
        official_url: "https://example.gov/sample-101",
        topic_tags: ["stairs"],
        provenance: "curated",
        retrieval_date: "2026-09-21",
        verification_date: "2026-09-21",
        jurisdiction_state: "VERIFIED_SOURCE",
      },
      {
        id: "r2",
        title: "Minimal Reference",
        section_identifier: null,
        issuing_authority: "Another Authority",
        jurisdiction: null,
        edition: null,
        effective_date: null,
        official_url: "https://example.gov/minimal",
        topic_tags: [],
        provenance: null,
        retrieval_date: null,
        verification_date: null,
        jurisdiction_state: "UNRESOLVED",
      },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      references: [
        {
          id: "r1",
          title: "Sample Building Reference",
          sectionIdentifier: "SEC-101.4",
          issuingAuthority: "Sample Building Authority",
          jurisdiction: "Texas",
          edition: "2024",
          effectiveDate: "2024-01-01",
          officialUrl: "https://example.gov/sample-101",
          topicTags: ["stairs"],
          provenance: "curated",
          retrievalDate: "2026-09-21",
          verificationDate: "2026-09-21",
          jurisdictionState: "VERIFIED_SOURCE",
        },
        {
          id: "r2",
          title: "Minimal Reference",
          sectionIdentifier: null,
          issuingAuthority: "Another Authority",
          jurisdiction: null,
          edition: null,
          effectiveDate: null,
          officialUrl: "https://example.gov/minimal",
          topicTags: [],
          provenance: null,
          retrievalDate: null,
          verificationDate: null,
          jurisdictionState: "UNRESOLVED",
        },
      ],
    });

    // Scoped to the caller's workspace owner and newest-first.
    expect(db.client.from).toHaveBeenCalledWith("house_plans_regulatory_sources");
    expect(db.query.eq).toHaveBeenCalledWith("owner_id", "user_1");
    expect(db.query.order).toHaveBeenCalledWith("created_at", { ascending: false });

    // The link-only boundary: no explanatory-text fields ever leave this route.
    for (const reference of body.references) {
      for (const forbidden of [
        "summary",
        "content",
        "description",
        "explanation",
        "paraphrase",
        "interpretation",
      ]) {
        expect(reference).not.toHaveProperty(forbidden);
      }
    }
  });

  it("returns 404 when the House Plans flag is off and never touches auth or the database", async () => {
    delete process.env[HOUSE_PLANS_FLAG_KEY];
    const response = await GET();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "House Plans is not enabled.",
    });
    expect(createAuthenticatedForgeApplication).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: new Response(null, { status: 401 }),
    });
    expect((await GET()).status).toBe(401);
  });

  it("returns 500 when the database fails", async () => {
    const order = vi.fn(async () => ({ data: null, error: new Error("db down") }));
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order,
    };
    const client = { from: vi.fn(() => query) };
    createAuthenticatedForgeApplication.mockResolvedValue(authed(client));
    const response = await GET();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Unable to load the reference library.",
    });
  });
});
