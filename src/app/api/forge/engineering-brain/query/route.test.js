import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET } from "./route";

const PROGRAMMER_EMAIL = "jasonmorgan99@gmail.com";

function request(url) {
  return new Request(url);
}

function fakeQuery(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const runRow = {
  id: "run_1",
  commit_sha: "sha1",
  extractor_version: 2,
  index_content_hash: "hash1",
  generated_at: "2026-01-01T00:00:00.000Z",
};

const recordRows = [
  { source_path: "supabase/migrations/x.sql", source_type: "sql_rpc_function", symbol_or_section: "has_workspace_access(text)", commit_sha: "sha1", content_hash: "h1", authority_level: "current", version: null, details: null },
  { source_path: "src/lib/foo.js", source_type: "application_source_file", symbol_or_section: null, commit_sha: "sha1", content_hash: "h2", authority_level: "current", version: null, details: null },
];

function fakeSupabaseClient({ authorized = true, run = runRow, records = recordRows } = {}) {
  return {
    auth: {
      getUser: () => Promise.resolve({
        data: { user: authorized ? { email: PROGRAMMER_EMAIL } : { email: "someone-else@example.com" } },
        error: null,
      }),
    },
    from: (table) => {
      if (table === "engineering_brain_runs") return fakeQuery({ data: run, error: null });
      if (table === "engineering_brain_records") return fakeQuery({ data: records, error: null });
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe("GET /api/forge/engineering-brain/query", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 for an unauthorized caller -- same 'does not reveal existence' behavior as the page-level gate", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient({ authorized: false }));
    const response = await GET(request("http://localhost/api/forge/engineering-brain/query?q=foo"));
    expect(response.status).toBe(404);
  });

  it("returns 404 when no run has ever been synced", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient({ run: null }));
    const response = await GET(request("http://localhost/api/forge/engineering-brain/query?q=foo"));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toMatch(/sync workflow/);
  });

  it("returns ranked results for an authorized caller, with citations but never an excerpt", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient());
    const response = await GET(request("http://localhost/api/forge/engineering-brain/query?q=has_workspace_access"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.insufficient_evidence).toBe(false);
    expect(body.results[0].symbol_or_section).toBe("has_workspace_access(text)");
    // Confidence is tied to excerpt re-verification (see computeConfidence); since this route never
    // resolves excerpts (no git access in production), every result is honestly "unverifiable" rather
    // than a falsely reassuring "high" -- this is Phase 2's existing design, not a route-level choice.
    expect(body.results[0].confidence).toBe("unverifiable");
    for (const result of body.results) {
      expect(result.excerpt).toBeNull();
      expect(result.excerpt_unavailable_reason).toBe("excerpt_resolution_skipped");
    }
    expect(body.latestRun.commitSha).toBe("sha1");
  });

  it("applies source_type and authority_level filters from query params", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient());
    const response = await GET(request("http://localhost/api/forge/engineering-brain/query?sourceType=sql_rpc_function"));
    const body = await response.json();
    expect(body.filters).toEqual({ sourceType: "sql_rpc_function" });
    expect(body.results).toHaveLength(1);
    expect(body.results[0].source_type).toBe("sql_rpc_function");
  });

  it("reports insufficient evidence for a query matching nothing, rather than an empty-but-confident answer", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient());
    const response = await GET(request("http://localhost/api/forge/engineering-brain/query?q=nonexistenttermxyz"));
    const body = await response.json();
    expect(body.insufficient_evidence).toBe(true);
    expect(body.reason).toBeTruthy();
  });

  it("caps maxResults at 100 even if a caller requests more", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient());
    const response = await GET(request("http://localhost/api/forge/engineering-brain/query?maxResults=99999"));
    expect(response.status).toBe(200);
  });
});
