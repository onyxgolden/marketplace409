import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildDeliveryEvidence,
  buildSignalEvidence,
  cleanLogLine,
  extractErrorLines,
  extractMentionedPaths,
  fetchFailedJobLog,
  runIdFromUrl,
  summarizeCiEvidence,
} from "../collectEvidence.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, "..", "..", "..", "..");
const CLI = join(TEST_DIR, "..", "collectEvidenceCli.mjs");

// Fixture modeled on the real 2026-09-27 "Build FORGE Capture (Windows)"
// failure: the upload step's glob matched nothing.
const FIXTURE_LOG = [
  "2026-09-28T04:19:01.9159183Z \u001b[36;1m##[group]Run actions/upload-artifact@v4\u001b[0m",
  "2026-09-28T04:19:01.9159184Z with:",
  "2026-09-28T04:19:01.9159185Z   path: forge-capture-app/app/target/release/bundle/nsis/*.exe",
  "2026-09-28T04:19:01.9159186Z ##[warning]No files were found with the provided path: forge-capture-app/app/target/release/bundle/nsis/*.exe.",
  "2026-09-28T04:19:01.9159187Z ##[error]No files were found with the provided path: forge-capture-app/app/target/release/bundle/nsis/*.exe. No artifacts will be uploaded.",
  "2026-09-28T04:19:01.9159188Z ##[endgroup]",
].join("\n");

function runCli(args, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout };
  } catch (error) {
    return { exitCode: error.status, stdout: error.stdout, stderr: error.stderr };
  }
}

function writeSignals(signals) {
  const dir = mkdtempSync(join(tmpdir(), "evidence-"));
  const path = join(dir, "signals.json");
  writeFileSync(path, JSON.stringify({ signals }));
  return { dir, path, out: join(dir, "evidence.json") };
}

describe("cleanLogLine", () => {
  it("strips ANSI escapes and timestamp prefixes", () => {
    expect(cleanLogLine("2026-09-28T04:19:01.9159183Z \u001b[36;1m##[group]Run x\u001b[0m")).toBe(
      "##[group]Run x",
    );
    expect(cleanLogLine("plain line")).toBe("plain line");
  });
});

describe("extractErrorLines", () => {
  it("finds ##[error] lines attributed to their step", () => {
    const errors = extractErrorLines(FIXTURE_LOG);
    expect(errors).toHaveLength(1);
    expect(errors[0].step).toBe("actions/upload-artifact@v4");
    expect(errors[0].line).toContain("No files were found with the provided path");
    expect(errors[0].context.length).toBeGreaterThan(0);
  });

  it("returns an empty list when the log has no errors", () => {
    expect(extractErrorLines("2026-09-28T04:19:01Z just a boring line")).toEqual([]);
  });

  it("caps the number of extracted errors", () => {
    const many = Array.from({ length: 30 }, (_, i) => `2026-09-28T04:19:01Z ##[error]boom ${i}`).join("\n");
    expect(extractErrorLines(many)).toHaveLength(10);
  });
});

describe("extractMentionedPaths", () => {
  it("pulls unix-style globs out of error text", () => {
    const paths = extractMentionedPaths(
      "No files were found with the provided path: forge-capture-app/app/target/release/bundle/nsis/*.exe.",
    );
    expect(paths).toContain("forge-capture-app/app/target/release/bundle/nsis/*.exe");
  });

  it("pulls Windows absolute paths out of build output", () => {
    const paths = extractMentionedPaths(
      "Running makensis to produce D:\\a\\marketplace409\\marketplace409\\forge-capture-app\\target\\release\\bundle\\nsis\\FORGE Capture_0.3.1_x64-setup.exe",
    );
    expect(paths.some((p) => p.includes("nsis"))).toBe(true);
  });

  it("ignores prose without path-like tokens", () => {
    expect(extractMentionedPaths("something went wrong, please try again")).toEqual([]);
  });

  it("de-duplicates repeated paths", () => {
    const paths = extractMentionedPaths("src/a.js failed; see src/a.js for details");
    expect(paths.filter((p) => p === "src/a.js")).toHaveLength(1);
  });
});

describe("runIdFromUrl", () => {
  it("extracts the run id from an Actions run URL", () => {
    expect(runIdFromUrl("https://github.com/onyxgolden/marketplace409/actions/runs/36377184943")).toBe(
      "36377184943",
    );
  });

  it("returns null when there is no run id", () => {
    expect(runIdFromUrl("https://github.com/onyxgolden/marketplace409/actions")).toBeNull();
    expect(runIdFromUrl(null)).toBeNull();
  });
});

describe("summarizeCiEvidence", () => {
  it("summarizes the Capture upload failure like the real one", () => {
    const summary = summarizeCiEvidence(FIXTURE_LOG);
    expect(summary.failed_step).toBe("actions/upload-artifact@v4");
    expect(summary.error_lines).toHaveLength(1);
    expect(summary.error_lines[0]).toContain("No files were found");
    expect(summary.mentioned_paths).toContain(
      "forge-capture-app/app/target/release/bundle/nsis/*.exe",
    );
  });
});

describe("buildDeliveryEvidence", () => {
  it("keeps the row's failure record without any network", () => {
    const ev = buildDeliveryEvidence({
      signal_id: "s1",
      kind: "delivery_failed",
      evidence: { status: "failed", failure_reason: "smtp 550", row_id: "abc" },
    });
    expect(ev).toMatchObject({ status: "failed", failure_reason: "smtp 550", row_id: "abc" });
  });
});

describe("buildSignalEvidence", () => {
  it("throws for ci_failed without a log instead of faking evidence", () => {
    expect(() => buildSignalEvidence({ signal_id: "s", kind: "ci_failed" }, null)).toThrow(/no CI log/);
  });
});

describe("collectEvidenceCli — argument handling", () => {
  it("exits 2 on unknown arguments", () => {
    const res = runCli(["--bogus"]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain("Unknown argument");
  });

  it("exits 2 when --signals is missing", () => {
    const res = runCli(["--out", "/tmp/x.json"]);
    expect(res.exitCode).toBe(2);
  });

  it("exits 2 on malformed signals JSON, never an all-clear", () => {
    const dir = mkdtempSync(join(tmpdir(), "evidence-"));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    const res = runCli(["--signals", bad, "--out", join(dir, "out.json")]);
    expect(res.exitCode).toBe(2);
  });
});

describe("collectEvidenceCli — delivery signals need no credentials", () => {
  it("writes evidence for delivery signals with no GITHUB_TOKEN", () => {
    const { path, out } = writeSignals([
      {
        signal_id: "supabase:deliveries:failed:1",
        kind: "delivery_failed",
        evidence: { status: "failed", failure_reason: "smtp 550", row_id: "1" },
      },
    ]);
    const res = runCli(["--signals", path, "--out", out], { GITHUB_TOKEN: "" });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Wrote evidence for 1 signals");
  });

  it("fails loudly when a ci_failed signal has no token", () => {
    const { path, out } = writeSignals([
      {
        signal_id: "github:actions:ci_failed:1",
        kind: "ci_failed",
        evidence: { run_url: "https://github.com/o/r/actions/runs/123" },
      },
    ]);
    const res = runCli(["--signals", path, "--out", out], { GITHUB_TOKEN: "" });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("GITHUB_TOKEN is required");
  });

  it("fails loudly when a ci_failed signal has no parsable run_url", () => {
    const { path, out } = writeSignals([
      { signal_id: "github:actions:ci_failed:2", kind: "ci_failed", evidence: {} },
    ]);
    const res = runCli(["--signals", path, "--out", out], { GITHUB_TOKEN: "fake" });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("no parsable run_url");
  });
});

describe("fetchFailedJobLog — retry and auth fallback", () => {
  function startServer(handler) {
    const server = createServer(handler);
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
  }

  const JOBS_PAYLOAD = { jobs: [{ id: 7, name: "build", conclusion: "failure" }] };
  const LOG_TEXT = "##[group]Run build\n##[error]boom\n";

  async function quirkedServer() {
    // Models the live 2026-09-30 quirk: the installation token gets 404 on
    // the jobs endpoint while unauthenticated calls succeed (public repo).
    const seen = { authedJobs: 0, anonJobs: 0, logAuthHeader: null };
    const server = await startServer((req, res) => {
      const authed = Boolean(req.headers.authorization);
      if (req.url.includes("/actions/runs/123/jobs")) {
        if (authed) {
          seen.authedJobs += 1;
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Not Found" }));
          return;
        }
        seen.anonJobs += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(JOBS_PAYLOAD));
        return;
      }
      if (req.url.includes("/actions/jobs/7/logs")) {
        seen.logAuthHeader = req.headers.authorization || null;
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(LOG_TEXT);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    return { server, seen };
  }

  it("falls back to an unauthenticated jobs call when the token gets a quirked 404", async () => {
    const { server, seen } = await quirkedServer();
    try {
      const apiBase = `http://127.0.0.1:${server.address().port}`;
      const result = await fetchFailedJobLog({
        owner: "o",
        repo: "r",
        runId: "123",
        token: "t",
        apiBase,
        retryDelaysMs: [],
      });
      expect(result.jobName).toBe("build");
      expect(result.logText).toContain("##[error]boom");
      expect(seen.authedJobs).toBe(1);
      expect(seen.anonJobs).toBe(1);
      // The log download keeps working with the token (no quirk there).
      expect(seen.logAuthHeader).toBe("Bearer t");
    } finally {
      server.close();
    }
  });

  it("reports both attempts when the fallback also fails", async () => {
    let hits = 0;
    const server = await startServer((req, res) => {
      hits += 1;
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Not Found" }));
    });
    try {
      const apiBase = `http://127.0.0.1:${server.address().port}`;
      await expect(
        fetchFailedJobLog({
          owner: "o",
          repo: "r",
          runId: "123",
          token: "t",
          apiBase,
          retryDelaysMs: [],
        }),
      ).rejects.toThrow(/HTTP 404 with token, HTTP 404 without/);
      expect(hits).toBe(2);
    } finally {
      server.close();
    }
  });

  it("retries a transient 503 with the token then succeeds", async () => {
    let jobsHits = 0;
    const server = await startServer((req, res) => {
      if (req.url.includes("/actions/runs/123/jobs")) {
        jobsHits += 1;
        if (jobsHits === 1) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end("{}");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(JOBS_PAYLOAD));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(LOG_TEXT);
    });
    try {
      const apiBase = `http://127.0.0.1:${server.address().port}`;
      const result = await fetchFailedJobLog({
        owner: "o",
        repo: "r",
        runId: "123",
        token: "t",
        apiBase,
        retryDelaysMs: [0, 0],
      });
      expect(result.jobName).toBe("build");
      expect(jobsHits).toBe(2);
    } finally {
      server.close();
    }
  });

  it("does not retry a permanent client error", async () => {
    let jobsHits = 0;
    const server = await startServer((req, res) => {
      jobsHits += 1;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end("{}");
    });
    try {
      const apiBase = `http://127.0.0.1:${server.address().port}`;
      await expect(
        fetchFailedJobLog({
          owner: "o",
          repo: "r",
          runId: "123",
          token: "t",
          apiBase,
          retryDelaysMs: [0, 0],
        }),
      ).rejects.toThrow(/HTTP 400/);
      expect(jobsHits).toBe(1);
    } finally {
      server.close();
    }
  });
});

describe("collectEvidenceCli — partial evidence on per-signal failure", () => {
  it("writes partial evidence and still exits 1 when one signal fails", () => {
    const { path, out } = writeSignals([
      {
        signal_id: "supabase:deliveries:failed:9",
        kind: "delivery_failed",
        evidence: { status: "failed", failure_reason: "smtp 550", row_id: "9" },
      },
      {
        signal_id: "github:actions:ci_failed:9",
        kind: "ci_failed",
        evidence: { run_url: "https://github.com/o/r/actions/runs/999" },
      },
    ]);
    const res = runCli(["--signals", path, "--out", out], { GITHUB_TOKEN: "" });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("GITHUB_TOKEN is required");
    const payload = JSON.parse(readFileSync(out, "utf8"));
    expect(payload.evidence["supabase:deliveries:failed:9"].failure_reason).toBe("smtp 550");
    expect(payload.evidence["github:actions:ci_failed:9"].status).toBe("error");
    expect(payload.evidence["github:actions:ci_failed:9"].error).toContain("GITHUB_TOKEN is required");
  });
});
