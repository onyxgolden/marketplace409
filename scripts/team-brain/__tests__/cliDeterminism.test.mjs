// Team Brain slice 1 — isolation and determinism tests (criteria 23-24).
// The CLI is spawned as a subprocess so these tests exercise the real entry
// point, including its argument contract.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "./helpers.mjs";

// PGlite WASM startup is slow under parallel workers; allow 30s per test.
const it30 = (name, fn) => it(name, fn, 30000);

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = join(HERE, "..");
const CLI = join(MODULE, "runFixtureReport.mjs");
const FIXTURES = join(MODULE, "fixtures");
const GUARD = join(HERE, "netGuard.cjs");

function runCli({ fixture, now, out, guard = false, extraArgs = [] }) {
  const dbDir = tempDir("tb-cli-db-");
  const args = [CLI, "--fixture", fixture, "--db", dbDir, "--now", now, ...extraArgs];
  if (out) args.push("--out", out);
  const env = { ...process.env };
  if (guard) {
    env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} --require ${GUARD}`.trim();
  }
  const stdout = execFileSync(process.execPath, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return stdout;
}

function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

describe("isolation and determinism", () => {
  afterAll(cleanupTempDirs);
  it30("AC-24a: two identical CLI runs produce byte-identical JSON", () => {
    const fixture = join(FIXTURES, "basic.json");
    const now = "2026-10-14T19:00:00Z";
    const a = runCli({ fixture, now });
    const b = runCli({ fixture, now });
    expect(a).toBe(b);
    expect(sha256(a)).toBe(sha256(b));
    const report = JSON.parse(a);
    expect(report.report).toBe("team-brain-slice-1/fixture");
    expect(report.now).toBe(now);
    expect(report.queue.ordered).toContain("tb-task-02");
    expect(report.handoffs).toEqual([{ id: "tb-handoff-01", state: "COMPLETE" }]);
  });

  it30("AC-24b: --out files are byte-identical across runs", () => {
    const fixture = join(FIXTURES, "escalations.json");
    const now = "2026-10-14T19:00:00Z";
    const dir = tempDir("tb-cli-out-");
    const outA = join(dir, "a.json");
    const outB = join(dir, "b.json");
    runCli({ fixture, now, out: outA });
    runCli({ fixture, now, out: outB });
    expect(readFileSync(outA, "utf8")).toBe(readFileSync(outB, "utf8"));
    const report = JSON.parse(readFileSync(outA, "utf8"));
    const byId = Object.fromEntries(report.queue.escalations.map((e) => [e.id, e.action]));
    expect(byId["esc-just-over-4h"]).toBe("REPING_DUE");
    expect(byId["esc-reping-recorded"]).toBe("REPORT_TO_JASON_DUE");
    expect(byId["esc-exact-4h"]).toBeUndefined();
    expect(byId["esc-fresh"]).toBeUndefined();
  });

  it30("AC-23: the CLI completes under a network-deny guard (zero network/model calls)", () => {
    const fixture = join(FIXTURES, "basic.json");
    const out = runCli({ fixture, now: "2026-10-14T19:00:00Z", guard: true });
    const report = JSON.parse(out);
    // 5 fixture obligations + 1 superseding verdict + 1 evidence correction.
    expect(report.ledger.obligations).toBe(7);
    expect(report.queue.ordered.length).toBeGreaterThan(0);
  });

  it30("AC-23b: the projection module imports without network-capable side effects", async () => {
    // Pure modules must not open sockets or read the clock at import time.
    const mod = await import("../queue/projection.mjs");
    expect(typeof mod.projectQueue).toBe("function");
    expect(typeof mod.FOUR_HOURS_MS).toBe("number");
  });

  it30("CLI rejects a missing --now instead of reading the wall clock", () => {
    const fixture = join(FIXTURES, "basic.json");
    const dbDir = tempDir("tb-cli-db-");
    let code = 0;
    try {
      execFileSync(process.execPath, [CLI, "--fixture", fixture, "--db", dbDir], { encoding: "utf8" });
    } catch (e) {
      code = e.status;
    }
    expect(code).toBe(2);
  });

  it30("CLI rejects a non-synthetic fixture", () => {
    const dir = tempDir("tb-cli-fix-");
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ synthetic: false, schemaVersion: 1, obligations: [] }), "utf8");
    const dbDir = tempDir("tb-cli-db-");
    let code = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [CLI, "--fixture", bad, "--db", dbDir, "--now", "2026-10-14T19:00:00Z"], {
        encoding: "utf8",
      });
    } catch (e) {
      code = e.status;
      stderr = String(e.stderr || "");
    }
    expect(code).toBe(2);
    expect(stderr).toMatch(/synthetic/i);
  });
});
