import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET } from "./route";

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

const runRow = {
  id: "run_1",
  commit_sha: "sha1",
  extractor_version: 2,
  generated_at: new Date().toISOString(),
};

const bugRows = [
  { sha: "aaa111", date: "2026-10-01", subject: "Fix x", pr: 1, class: "c", files: ["src/a.js"] },
];

function fakeSupabaseClient({ authorized = true, run = runRow, bugs = bugRows, bugCount = 1 } = {}) {
  return {
    auth: {
      getUser: () => Promise.resolve({
        data: { user: authorized ? { email: PROGRAMMER_EMAIL } : { email: "intruder@example.com" } },
        error: null,
      }),
    },
    from: (table) => {
      if (table === "engineering_brain_runs") return fakeQuery({ data: run, error: null });
      if (table === "engineering_brain_bug_fixes") {
        // count query uses { count: "exact", head: true }
        return {
          select: (cols, opts) => {
            if (opts && opts.count === "exact") {
              return { eq: () => Promise.resolve({ count: bugCount, error: null }) };
            }
            return fakeQuery({ data: bugs, error: null });
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe("GET /api/forge/engineering-brain/health", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 for an unauthorized caller", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient({ authorized: false }));
    const response = await GET();
    expect(response.status).toBe(404);
  });

  it("returns a health snapshot with all four sections", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient());
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.health.runtimeCoverage).toBeDefined();
    expect(body.health.index).toBeDefined();
    expect(body.health.bugCatalog).toBeDefined();
    expect(body.health.watchdog).toBeDefined();
    expect(Array.isArray(body.findings)).toBe(true);
  });

  it("never reports the watchdog as actively monitoring", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient());
    const response = await GET();
    const body = await response.json();
    expect(body.health.watchdog.state).toBe("not-enabled");
    expect(body.health.watchdog.enabled).toBe(false);
  });

  it("fails closed to unavailable when no run exists", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient({ run: null }));
    const response = await GET();
    const body = await response.json();
    expect(body.health.index.state).toBe("unavailable");
  });
});
