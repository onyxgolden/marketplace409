import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { POST } from "./route";

const PROGRAMMER_EMAIL = "jasonmorgan99@gmail.com";

function fakeQuery(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    range: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const runRow = { id: "run_1", commit_sha: "sha1", generated_at: new Date().toISOString() };
const bugRows = [
  { sha: "aaa111", date: "2026-10-01", subject: "Fix login", pr: 1, class: "auth", files: ["src/auth.js"] },
];

function fakeSupabaseClient({ authorized = true, run = runRow, bugs = bugRows } = {}) {
  return {
    auth: {
      getUser: () => Promise.resolve({
        data: { user: authorized ? { email: PROGRAMMER_EMAIL } : { email: "intruder@example.com" } },
        error: null,
      }),
    },
    from: (table) => {
      if (table === "engineering_brain_runs") return fakeQuery({ data: run, error: null });
      if (table === "engineering_brain_bug_fixes") return fakeQuery({ data: bugs, error: null });
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function postRequest(body) {
  return new Request("http://localhost/api/forge/engineering-brain/regression-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/forge/engineering-brain/regression-check", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 for an unauthorized caller", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient({ authorized: false }));
    const response = await POST(postRequest({ paths: ["src/auth.js"] }));
    expect(response.status).toBe(404);
  });

  it("returns 400 for missing paths", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient());
    const response = await POST(postRequest({}));
    expect(response.status).toBe(400);
  });

  it("returns 400 for too many paths", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient());
    const response = await POST(postRequest({ paths: Array(501).fill("a.js") }));
    expect(response.status).toBe(400);
  });

  it("surfaces exposures as advisory, never blocking", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient());
    const response = await POST(postRequest({ paths: ["src/auth.js"], revision: "abc123" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.advisory).toBe(true);
    expect(body.exposures.length).toBe(1);
    expect(body.exposures[0].priorFix.sha).toBe("aaa111");
  });

  it("returns empty exposures when nothing overlaps", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient());
    const response = await POST(postRequest({ paths: ["src/unrelated.js"] }));
    const body = await response.json();
    expect(body.exposures).toEqual([]);
  });
});
