import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { HOUSE_PLANS_FLAG_KEY } from "@/lib/housePlans/housePlansFlags";
import { createRegulatorySnapshot } from "@/lib/housePlans/regulatorySnapshot";
import { GET, POST } from "./route";

// Neutral fictitious fixtures only: the HP-L1 "zero ICC involvement"
// boundary applies to test data as well.
const sourceRowA = {
  id: "src_a",
  title: "Fictitious Building Code, Section 101 (TEST FIXTURE)",
  section_identifier: null,
  issuing_authority: "Fictitious Building Authority (TEST FIXTURE)",
  jurisdiction: null,
  edition: null,
  effective_date: null,
  official_url: "https://example.invalid/official-sources/fbc-101",
  topic_tags: [],
  provenance: null,
  retrieval_date: null,
  verification_date: null,
  jurisdiction_state: "UNRESOLVED",
};

// The camelCase record the route's toRecord() mapping produces from sourceRowA.
const recordA = {
  title: "Fictitious Building Code, Section 101 (TEST FIXTURE)",
  sectionIdentifier: null,
  issuingAuthority: "Fictitious Building Authority (TEST FIXTURE)",
  jurisdiction: null,
  edition: null,
  effectiveDate: null,
  officialUrl: "https://example.invalid/official-sources/fbc-101",
  topicTags: [],
  provenance: null,
  retrievalDate: null,
  verificationDate: null,
  jurisdictionState: "UNRESOLVED",
};

function authed(client) {
  return { user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: client };
}

function postRequest(body) {
  return new Request("http://localhost/api/forge/designer/house-plans/snapshots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function getDb(rows) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn(async () => ({ data: rows, error: null })),
  };
  return { client: { from: vi.fn(() => query) }, query };
}

function postDb({ sources, sourcesError = null, latestHash = null, insertError = null }) {
  const sourcesQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn(async () =>
      sourcesError ? { data: null, error: sourcesError } : { data: sources, error: null }
    ),
  };
  const latestQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => ({
      data: latestHash
        ? [
            {
              id: "snap_old",
              label: null,
              entries: [],
              content_hash: latestHash,
              captured_at: "2026-09-01T00:00:00.000Z",
            },
          ]
        : [],
      error: null,
    })),
  };
  let capturedInsert = null;
  const insertSelect = vi.fn(async () => {
    if (insertError) return { data: null, error: insertError };
    return {
      data: [
        {
          id: "snap_new",
          label: capturedInsert.label,
          entries: capturedInsert.entries,
          content_hash: capturedInsert.content_hash,
          captured_at: capturedInsert.captured_at,
        },
      ],
      error: null,
    };
  });
  const snapshotsQuery = {
    select: vi.fn(() => latestQuery),
    insert: vi.fn((payload) => {
      capturedInsert = payload;
      return { select: insertSelect };
    }),
  };
  const client = {
    from: vi.fn((table) =>
      table === "house_plans_regulatory_sources" ? sourcesQuery : snapshotsQuery
    ),
  };
  return {
    client,
    sourcesQuery,
    latestQuery,
    snapshotsQuery,
    get capturedInsert() {
      return capturedInsert;
    },
  };
}

const FORBIDDEN = ["summary", "content", "description", "explanation", "paraphrase", "interpretation"];

describe("snapshots API (HP-L4)", () => {
  const ORIGINAL_FLAG = process.env[HOUSE_PLANS_FLAG_KEY];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env[HOUSE_PLANS_FLAG_KEY] = "true";
  });

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env[HOUSE_PLANS_FLAG_KEY];
    else process.env[HOUSE_PLANS_FLAG_KEY] = ORIGINAL_FLAG;
  });

  describe("GET /api/forge/designer/house-plans/snapshots", () => {
    const snapshotRow = {
      id: "snap_1",
      label: "Pre-permit",
      entries: [
        {
          title: "Fictitious Building Code, Section 101 (TEST FIXTURE)",
          issuingAuthority: "Fictitious Building Authority (TEST FIXTURE)",
          officialUrl: "https://example.invalid/official-sources/fbc-101",
          topicTags: [],
          jurisdictionState: "UNRESOLVED",
        },
      ],
      content_hash: "abc123",
      captured_at: "2026-09-21T10:00:00.000Z",
    };

    it("lists the caller's snapshots newest-first", async () => {
      const db = getDb([snapshotRow]);
      createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));

      const response = await GET();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        success: true,
        snapshots: [
          {
            id: "snap_1",
            label: "Pre-permit",
            entries: snapshotRow.entries,
            sourceCount: 1,
            contentHash: "abc123",
            capturedAt: "2026-09-21T10:00:00.000Z",
          },
        ],
      });

      expect(db.client.from).toHaveBeenCalledWith("house_plans_regulatory_snapshots");
      expect(db.query.eq).toHaveBeenCalledWith("owner_id", "user_1");
      expect(db.query.order).toHaveBeenCalledWith("captured_at", { ascending: false });
    });

    it("never exposes explanatory-text fields in snapshot entries", async () => {
      const db = getDb([snapshotRow]);
      createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
      const body = await (await GET()).json();
      for (const snapshot of body.snapshots) {
        for (const entry of snapshot.entries) {
          for (const forbidden of FORBIDDEN) {
            expect(entry).not.toHaveProperty(forbidden);
          }
        }
      }
    });

    it("returns 404 when the House Plans flag is off and never touches auth", async () => {
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
      const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order };
      createAuthenticatedForgeApplication.mockResolvedValue(
        authed({ from: vi.fn(() => query) })
      );
      const response = await GET();
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Unable to load the regulatory snapshots.",
      });
    });
  });

  describe("POST /api/forge/designer/house-plans/snapshots", () => {
    it("returns 404 when the House Plans flag is off and never touches auth", async () => {
      delete process.env[HOUSE_PLANS_FLAG_KEY];
      const response = await POST(postRequest({}));
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "House Plans is not enabled.",
      });
      expect(createAuthenticatedForgeApplication).not.toHaveBeenCalled();
    });

    it("returns 400 when the reference library is empty", async () => {
      const db = postDb({ sources: [] });
      createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
      const response = await POST(postRequest({}));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "The reference library is empty — nothing to snapshot.",
      });
      expect(db.snapshotsQuery.insert).not.toHaveBeenCalled();
    });

    it("captures a new snapshot when the library changed", async () => {
      const db = postDb({ sources: [sourceRowA], latestHash: "stale-hash" });
      createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));

      const response = await POST(postRequest({ label: "  Pre-permit  " }));
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.created).toBe(true);

      const expected = createRegulatorySnapshot({ sources: [recordA] });
      expect(expected.ok).toBe(true);
      expect(body.snapshot.contentHash).toBe(expected.snapshot.contentHash);
      expect(body.snapshot.label).toBe("Pre-permit");
      expect(body.snapshot.sourceCount).toBe(1);
      expect(body.snapshot.entries).toHaveLength(1);

      // The insert carries the immutable payload under the caller's owner.
      const inserted = db.capturedInsert;
      expect(inserted.owner_id).toBe("user_1");
      expect(inserted.label).toBe("Pre-permit");
      expect(inserted.entries).toHaveLength(1);
      expect(inserted.content_hash).toBe(expected.snapshot.contentHash);
      expect(Number.isNaN(new Date(inserted.captured_at).getTime())).toBe(false);

      // Link-only boundary: entries are factual metadata only.
      for (const entry of body.snapshot.entries) {
        for (const forbidden of FORBIDDEN) {
          expect(entry).not.toHaveProperty(forbidden);
        }
      }
    });

    it("reuses the latest snapshot when the library is unchanged", async () => {
      const expected = createRegulatorySnapshot({ sources: [recordA] });
      expect(expected.ok).toBe(true);
      const db = postDb({ sources: [sourceRowA], latestHash: expected.snapshot.contentHash });
      createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));

      const response = await POST(postRequest({}));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        success: true,
        created: false,
        snapshot: {
          id: "snap_old",
          label: null,
          entries: [],
          sourceCount: 0,
          contentHash: expected.snapshot.contentHash,
          capturedAt: "2026-09-01T00:00:00.000Z",
        },
      });
      expect(db.snapshotsQuery.insert).not.toHaveBeenCalled();
    });

    it("returns 400 for an invalid label without touching the snapshots table", async () => {
      const db = postDb({ sources: [sourceRowA] });
      createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
      const response = await POST(postRequest({ label: "x".repeat(200) }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Invalid snapshot request.");
      expect(db.snapshotsQuery.insert).not.toHaveBeenCalled();
    });

    it("returns 500 when the database fails", async () => {
      const db = postDb({ sources: [], sourcesError: new Error("db down") });
      createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
      const response = await POST(postRequest({}));
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Unable to save the regulatory snapshot.",
      });
    });
  });
});
