import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET } from "./route";
import { getRegistry } from "../../../../../../scripts/engineering-brain/runtimeCoverageRegistry.mjs";

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

  it("marks regressionExposureEvaluated false when no changedPaths given", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabaseClient());
    const response = await GET();
    const body = await response.json();
    expect(body.regressionExposureEvaluated).toBe(false);
  });

  it("flows exposures end-to-end: endpoint → severity boost → evidence packet", async () => {
    // Use a real registry capability so the subsystem matching is genuine.
    const cap = getRegistry().find((c) => c.monitoring_status !== "covered" && c.execution_path);
    expect(cap).toBeDefined();
    const fragment = String(cap.execution_path).split(",").map((s) => s.trim()).filter(Boolean)[0];
    expect(fragment).toBeTruthy();

    const bugWithOverlap = [
      { sha: "bbb222", date: "2026-10-02", subject: "Fix overlap", pr: 2, class: "c", files: [fragment] },
    ];
    mocks.createClient.mockResolvedValue(fakeSupabaseClient({ bugs: bugWithOverlap, bugCount: 1 }));
    const req = new Request(
      `http://localhost/api/forge/engineering-brain/health?changedPaths=${encodeURIComponent(fragment)}`,
    );
    const response = await GET(req);
    const body = await response.json();
    expect(body.regressionExposureEvaluated).toBe(true);

    // Severity boost: the matching coverage finding gains the exposure boost.
    const item = body.triage.find((t) => t.id === `coverage:${cap.id}`);
    expect(item).toBeDefined();
    expect(item.severityReason).toMatch(/regression-exposure/);

    // Evidence packet: the exposure section is populated, not silently empty.
    const packet = body.packets[`coverage:${cap.id}`];
    expect(packet).toBeDefined();
    expect(packet.historical.regressionExposures.length).toBeGreaterThan(0);
    expect(packet.historical.regressionNote).toMatch(/advisory/i);
  });
});
