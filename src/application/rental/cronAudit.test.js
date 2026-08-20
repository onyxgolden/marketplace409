import { describe, expect, it, vi } from "vitest";
import {
  classifyCronRunStatus, classifyCronTriggerSource,
  finalizeCronRun, sanitizeCronSummary, sanitizeCronText, startCronRun,
} from "./cronAudit.js";

function chain(result = { error: null }) {
  const node = { insert: vi.fn(async () => result), update: vi.fn(() => node), eq: vi.fn(async () => result) };
  return node;
}
function dbWith(node) { return { from: vi.fn(() => node) }; }
function request(headers = {}) { return new Request("https://test/api", { headers }); }

describe("classifyCronTriggerSource", () => {
  it("recognizes Vercel's cron user agent", () => {
    expect(classifyCronTriggerSource(request({ "user-agent": "vercel-cron/1.0" }))).toBe("vercel_cron");
  });
  it("falls back to unknown_authorized for any other caller", () => {
    expect(classifyCronTriggerSource(request({ "user-agent": "curl/8.0" }))).toBe("unknown_authorized");
    expect(classifyCronTriggerSource(request())).toBe("unknown_authorized");
  });
});

describe("classifyCronRunStatus", () => {
  it("classifies a clean run as succeeded", () => {
    expect(classifyCronRunStatus({ processedCount: 3, succeededCount: 3, failedCount: 0 })).toBe("succeeded");
    expect(classifyCronRunStatus()).toBe("succeeded");
  });
  it("classifies a mix of success and failure as partially_succeeded", () => {
    expect(classifyCronRunStatus({ processedCount: 3, succeededCount: 2, failedCount: 1 })).toBe("partially_succeeded");
  });
  it("classifies pending-with-failures as partially_succeeded too", () => {
    expect(classifyCronRunStatus({ processedCount: 3, succeededCount: 0, pendingCount: 1, failedCount: 1 })).toBe("partially_succeeded");
  });
  it("classifies total failure (nothing succeeded or pending) as failed", () => {
    expect(classifyCronRunStatus({ processedCount: 2, succeededCount: 0, pendingCount: 0, failedCount: 2 })).toBe("failed");
  });
});

describe("sanitizeCronText", () => {
  it("redacts a bearer token", () => {
    expect(sanitizeCronText("failed with Authorization: Bearer sk_live_abcDEF123 rejected"))
      .not.toContain("sk_live_abcDEF123");
  });
  it("redacts Stripe secret, publishable, restricted, and webhook-signing key shapes", () => {
    const text = sanitizeCronText("sk_live_ABC123 pk_test_XYZ789 rk_test_QQQ111 whsec_ZZZ999");
    expect(text).not.toMatch(/sk_live_|pk_test_|rk_test_|whsec_/);
    expect(text).toContain("[redacted]");
  });
  it("passes through ordinary error text unchanged", () => {
    expect(sanitizeCronText("Rent schedule was not found.")).toBe("Rent schedule was not found.");
  });
  it("returns non-string input unchanged", () => {
    expect(sanitizeCronText(42)).toBe(42);
    expect(sanitizeCronText(null)).toBeNull();
  });
});

describe("sanitizeCronSummary", () => {
  it("drops keys that look like credentials or headers even if present by mistake", () => {
    const summary = sanitizeCronSummary({
      success: true, candidates: 1, authorization: "Bearer sk_live_should_never_be_stored",
      headers: { cookie: "session=abc" }, apiKey: "sk_live_zzz", nested: { token: "should-drop", count: 2 },
    });
    expect(summary).not.toHaveProperty("authorization");
    expect(summary).not.toHaveProperty("headers");
    expect(summary).not.toHaveProperty("apiKey");
    expect(summary.nested).not.toHaveProperty("token");
    expect(summary).toMatchObject({ success: true, candidates: 1 });
    expect(summary.nested).toMatchObject({ count: 2 });
    expect(JSON.stringify(summary)).not.toContain("sk_live");
  });
  it("sanitizes secret-shaped substrings inside ordinary string values too", () => {
    const summary = sanitizeCronSummary({ error: "call failed: Bearer whsec_leaked123" });
    expect(summary.error).not.toContain("whsec_leaked123");
  });
  it("passes arrays and primitives through recursively", () => {
    expect(sanitizeCronSummary([1, "ok", { candidates: 2 }])).toEqual([1, "ok", { candidates: 2 }]);
  });
  it("returns null for null/undefined", () => {
    expect(sanitizeCronSummary(null)).toBeNull();
    expect(sanitizeCronSummary(undefined)).toBeNull();
  });
});

describe("startCronRun", () => {
  it("inserts one running row and returns its id", async () => {
    const node = chain();
    const db = dbWith(node);
    const run = await startCronRun(db, { jobName: "generate-charges", routePath: "/api/rental/cron/generate-charges", request: request({ "user-agent": "vercel-cron/1.0" }) });
    expect(run.id).toMatch(/^rental_cron_run_/);
    expect(node.insert).toHaveBeenCalledWith(expect.objectContaining({
      job_name: "generate-charges", route_path: "/api/rental/cron/generate-charges",
      trigger_source: "vercel_cron", status: "running",
    }));
  });

  it("never throws when the audit table/write is unavailable, and returns a null id", async () => {
    const db = { from: vi.fn(() => { throw new Error("relation \"rental_cron_runs\" does not exist"); }) };
    const run = await startCronRun(db, { jobName: "generate-charges", routePath: "/x", request: request() });
    expect(run.id).toBeNull();
  });

  it("never throws when the insert resolves with a Supabase error", async () => {
    const db = dbWith(chain({ error: { message: "boom" } }));
    const run = await startCronRun(db, { jobName: "generate-charges", routePath: "/x", request: request() });
    expect(run.id).toBeNull();
  });
});

describe("finalizeCronRun", () => {
  it("finalizes the same row by id with mapped counts and a sanitized summary", async () => {
    const node = chain();
    const db = dbWith(node);
    await finalizeCronRun(db, { id: "rental_cron_run_1", startedAt: new Date(Date.now() - 50).toISOString() },
      { processedCount: 2, succeededCount: 2, failedCount: 0, summary: { success: true, processed: 2 } });
    expect(node.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "succeeded", processed_count: 2, succeeded_count: 2, failed_count: 0,
      result_summary: { success: true, processed: 2 },
    }));
    expect(node.eq).toHaveBeenCalledWith("id", "rental_cron_run_1");
  });

  it("is a no-op when the run has no id (audit insert had already failed)", async () => {
    const node = chain();
    const db = dbWith(node);
    await finalizeCronRun(db, { id: null, startedAt: new Date().toISOString() }, { succeededCount: 1 });
    expect(node.update).not.toHaveBeenCalled();
  });

  it("never throws when the finalize write itself fails", async () => {
    const db = { from: vi.fn(() => { throw new Error("network error"); }) };
    await expect(finalizeCronRun(db, { id: "rental_cron_run_1", startedAt: new Date().toISOString() }, { succeededCount: 1 }))
      .resolves.toBeUndefined();
  });

  it("records an explicit failed status with a sanitized error message", async () => {
    const node = chain();
    const db = dbWith(node);
    await finalizeCronRun(db, { id: "rental_cron_run_1", startedAt: new Date().toISOString() },
      { status: "failed", failedCount: 1, errorCode: "P0001", errorMessage: "boom Bearer sk_live_leak" });
    expect(node.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed", error_code: "P0001",
    }));
    const call = node.update.mock.calls[0][0];
    expect(call.error_message).not.toContain("sk_live_leak");
  });
});
