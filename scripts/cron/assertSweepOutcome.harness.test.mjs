import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Workflow-equivalent harness: executes the actual assertSweepOutcome.mjs
 * CLI exactly as the GitHub Actions step does (node + --endpoint +
 * --response-file + --http-status) and asserts on process exit codes and
 * the allowlisted stdout. No network, no sends — fixtures only.
 */

const CLI = join(dirname(fileURLToPath(import.meta.url)), "assertSweepOutcome.mjs");
const ENDPOINT = "/api/rental/cron/tenant-payment-receipts";

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sweep-assert-harness-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runCli({ endpoint = ENDPOINT, httpStatus = "200", body, rawBody, missingFile = false }) {
  const file = join(dir, `resp-${Math.random().toString(36).slice(2)}.json`);
  if (!missingFile) {
    writeFileSync(file, rawBody !== undefined ? rawBody : JSON.stringify(body));
  }
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, "--endpoint", endpoint, "--response-file", missingFile ? file + ".nope" : file, "--http-status", String(httpStatus)],
      { timeout: 15000 },
      (error, stdout, stderr) => {
        resolve({ code: error ? (error.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function okBody(overrides = {}) {
  return {
    success: true, dryRun: false, sendingEnabled: true,
    reconciled: 0, skippedAtDetection: 0, reconcileSkipped: false,
    sent: 0, failed: 0, skippedDisabled: 0, skippedNotAllowlisted: 0,
    ledgerErrors: 0, deferredQuietHours: 0, wouldSend: [],
    ...overrides,
  };
}

describe("assertSweepOutcome CLI (workflow-equivalent harness)", () => {
  it("exit 0 on a clean delivery", async () => {
    const r = await runCli({ body: okBody({ sent: 2 }) });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("outcome=delivered");
    expect(r.stdout).toContain("result=PASS");
  });
  it("exit 0 on a legitimate idle no-op", async () => {
    const r = await runCli({ body: okBody() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("outcome=no_op");
  });
  it("exit non-zero on partial failure (some sent, some errored)", async () => {
    const r = await runCli({ body: okBody({ sent: 3, failed: 2 }) });
    expect(r.code).not.toBe(0);
    expect(r.stdout).toContain("outcome=delivery_failed");
    expect(r.stdout).toContain("result=FAIL");
  });
  it("exit non-zero on ledgerErrors with delivery otherwise ok (evidence failure)", async () => {
    const r = await runCli({ body: okBody({ sent: 1, ledgerErrors: 1 }) });
    expect(r.code).not.toBe(0);
    expect(r.stdout).toContain("outcome=evidence_failed");
  });
  it("exit non-zero on a scheduled dryRun", async () => {
    const r = await runCli({ body: okBody({ dryRun: true }) });
    expect(r.code).not.toBe(0);
    expect(r.stdout).toContain("outcome=dry_run_not_a_sweep");
  });
  it("exit non-zero on HTTP 500", async () => {
    const r = await runCli({ httpStatus: "500", body: { error: "boom" } });
    expect(r.code).not.toBe(0);
    expect(r.stdout).toContain("outcome=transport_error");
  });
  it("exit non-zero on curl-timeout style HTTP 000", async () => {
    const r = await runCli({ httpStatus: "000", body: {} });
    expect(r.code).not.toBe(0);
    expect(r.stdout).toContain("outcome=transport_error");
  });
  it("exit non-zero on non-JSON body", async () => {
    const r = await runCli({ rawBody: "<html>not json</html>" });
    expect(r.code).not.toBe(0);
    expect(r.stdout).toContain("schema_error");
  });
  it("exit non-zero on a missing response file (curl wrote nothing)", async () => {
    const r = await runCli({ missingFile: true });
    expect(r.code).not.toBe(0);
    expect(r.stdout).toContain("transport_error");
  });
  it("exit 3 (distinct, for workflow fallback) on an unknown endpoint", async () => {
    const r = await runCli({ endpoint: "/api/rental/cron/mystery", body: { success: true } });
    expect(r.code).toBe(3);
    expect(r.stdout).toContain("outcome=unknown_endpoint");
  });
  it("exit non-zero on schema violation (string count)", async () => {
    const r = await runCli({ body: okBody({ sent: "2" }) });
    expect(r.code).not.toBe(0);
    expect(r.stdout).toContain("outcome=schema_error");
  });
  it("exit 2 on missing CLI args", async () => {
    const r = await new Promise((resolve) => {
      execFile(process.execPath, [CLI, "--endpoint", ENDPOINT], { timeout: 15000 }, (error, stdout, stderr) => {
        resolve({ code: error ? (error.code ?? 1) : 0, stderr: String(stderr) });
      });
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Usage:");
  });
  it("strips ?trigger=manual from manual-dispatch endpoints", async () => {
    const r = await runCli({
      endpoint: "/api/rental/cron/tenant-payment-receipts?trigger=manual",
      body: okBody({ sent: 1 }),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("endpoint=/api/rental/cron/tenant-payment-receipts");
  });
  it("never leaks recipient identifiers from wouldSend", async () => {
    const r = await runCli({
      body: okBody({ sent: 1, wouldSend: [{ to: "someone-private@example.com", subject: "Receipt" }] }),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("someone-private@example.com");
    expect(r.stdout).not.toContain("Receipt");
  });
});
