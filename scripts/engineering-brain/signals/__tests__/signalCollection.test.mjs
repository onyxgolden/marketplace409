import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadSignals } from "../runUndiscoveredErrorsCli.mjs";
import { buildStuckFilter } from "../fetchSupabaseSignals.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
// scripts/engineering-brain/signals/__tests__ -> repo root
const REPO_ROOT = join(TEST_DIR, "..", "..", "..", "..");
const CLI = join(TEST_DIR, "..", "runUndiscoveredErrorsCli.mjs");
const GITHUB_FETCHER = join(TEST_DIR, "..", "fetchGithubSignals.py");

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout };
  } catch (error) {
    return { exitCode: error.status, stdout: error.stdout, stderr: error.stderr };
  }
}

describe("loadSignals — missing/malformed input must fail, never fake an all-clear", () => {
  it("throws on a missing file", () => {
    expect(() => loadSignals("/nonexistent/signals.json")).toThrow(/cannot read signals file/);
  });

  it("throws on malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-"));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    expect(() => loadSignals(bad)).toThrow(/malformed signals JSON/);
  });

  it("throws on well-formed JSON with the wrong shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-"));
    const bad = join(dir, "shape.json");
    writeFileSync(bad, JSON.stringify({ foo: 1 }));
    expect(() => loadSignals(bad)).toThrow(/malformed signals file/);
  });

  it("throws a controlled error on a JSON null signal file (no uncaught exception)", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-"));
    const nul = join(dir, "null.json");
    writeFileSync(nul, "null");
    expect(() => loadSignals(nul)).toThrow(/malformed signals file/);
  });

  it("CLI exits 2 on a JSON null signal file", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-"));
    const nul = join(dir, "null.json");
    writeFileSync(nul, "null");
    const result = runCli(["--signals", nul]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/malformed signals file/);
  });

  it("accepts an explicit valid empty signals file", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-"));
    const empty = join(dir, "empty.json");
    writeFileSync(empty, JSON.stringify({ signals: [] }));
    expect(loadSignals(empty)).toEqual([]);
  });

  it("CLI exits 2 on a missing signals file", () => {
    const result = runCli(["--signals", "/nonexistent/signals.json"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/cannot read signals file/);
  });

  it("CLI exits 2 on malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-"));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    const result = runCli(["--signals", bad]);
    expect(result.exitCode).toBe(2);
  });

  it("CLI exits 0 with a genuine empty report for valid empty signals", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-"));
    const empty = join(dir, "empty.json");
    writeFileSync(empty, JSON.stringify({ signals: [] }));
    const result = runCli(["--signals", empty]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/signals scanned: 0/);
  });
});

describe("buildStuckFilter — never-attempted rows must not escape", () => {
  const watched = { attemptedAtColumn: "last_attempted_at", createdAtColumn: "created_at" };
  const cutoff = "2026-09-29T00:00:00.000Z";

  it("matches attempted-long-ago OR never-attempted-but-queued-long-ago", () => {
    expect(buildStuckFilter(watched, cutoff)).toBe(
      "last_attempted_at.lt.2026-09-29T00:00:00.000Z," +
        "and(last_attempted_at.is.null,created_at.lt.2026-09-29T00:00:00.000Z)",
    );
  });

  it("classifies rows the way the filter intends", () => {
    // Mirror of the PostgREST semantics: NULL attempted_at never satisfies .lt(),
    // so the fallback branch is the only thing that catches never-attempted rows.
    const isStuck = (row) =>
      (row.last_attempted_at !== null && row.last_attempted_at < cutoff) ||
      (row.last_attempted_at === null && row.created_at < cutoff);
    expect(isStuck({ last_attempted_at: null, created_at: "2026-08-20T00:00:00.000Z" })).toBe(true);
    expect(isStuck({ last_attempted_at: null, created_at: "2026-09-29T12:00:00.000Z" })).toBe(false);
    expect(isStuck({ last_attempted_at: "2026-08-20T00:00:00.000Z", created_at: "2026-08-20T00:00:00.000Z" })).toBe(true);
    expect(isStuck({ last_attempted_at: "2026-09-29T12:00:00.000Z", created_at: "2026-08-20T00:00:00.000Z" })).toBe(false);
  });
});

describe("fetchGithubSignals — must run with GITHUB_TOKEN and no Hatch module", () => {
  // Blocks the `dynamic_credentials` import entirely, simulating a plain CI runner /
  // developer machine, then drives the module's real main() with a token. Any attempt
  // to touch the Hatch adapter raises with a distinctive message.
  const harness = `
import sys, types, urllib.error

BLOCKED_MSG = "hatch-adapter-blocked-for-test"

class _Blocker:
    def find_module(self, name, path=None):
        if name == "dynamic_credentials":
            return self
        return None
    def load_module(self, name):
        raise ModuleNotFoundError(BLOCKED_MSG)

sys.meta_path.insert(0, _Blocker())

import os
os.environ["GITHUB_TOKEN"] = "dummy-token-for-import-test"

ns = {"__name__": "harness"}
with open(${JSON.stringify(GITHUB_FETCHER)}) as fh:
    exec(compile(fh.read(), "fetchGithubSignals.py", "exec"), ns)

# No real network: fail fast with a fake 401, and capture the auth header used.
seen = {}
class FakeResp:
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return b"{}"

def fake_urlopen(req, timeout=None):
    seen["auth"] = req.get_header("Authorization")
    raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)

ns["urllib"].request.urlopen = fake_urlopen
ns["time"].sleep = lambda s: None

sys.argv = ["fetchGithubSignals.py", "--out", ${JSON.stringify(join(tmpdir(), "gh-signals-test.json"))}, "--days", "0"]
# main() returns its exit code (sys.exit wrapping only happens under __main__).
rc = ns["main"]()
print(f"RETURN:{rc}")
print(f"AUTH:{seen.get('auth')}")
`;

  it("never imports the Hatch adapter on the token path and sends the token", () => {
    const out = execFileSync("python3", ["-c", harness], { encoding: "utf8" });
    expect(out).not.toContain("hatch-adapter-blocked-for-test");
    expect(out).toContain("RETURN:1"); // 401 -> error return, not an import crash
    expect(out).toMatch(/AUTH:Bearer \S+/); // token actually sent as Bearer auth
  });

  it("--help works without the Hatch module present", () => {
    const helpHarness = `
import sys
class _Blocker:
    def find_module(self, name, path=None):
        if name == "dynamic_credentials":
            return self
        return None
    def load_module(self, name):
        raise ModuleNotFoundError("hatch-adapter-blocked-for-test")
sys.meta_path.insert(0, _Blocker())
ns = {"__name__": "harness"}
with open(${JSON.stringify(GITHUB_FETCHER)}) as fh:
    exec(compile(fh.read(), "fetchGithubSignals.py", "exec"), ns)
sys.argv = ["fetchGithubSignals.py", "--help"]
try:
    ns["main"]()
except SystemExit as e:
    print(f"EXIT:{e.code}")
`;
    const out = execFileSync("python3", ["-c", helpHarness], { encoding: "utf8" });
    expect(out).toContain("EXIT:0");
    expect(out).not.toContain("hatch-adapter-blocked-for-test");
  });
});

describe("fetchGithubSignals — scanner never reports on itself (self-flagging loop fix)", () => {
  // A loud scan failure is visible by design; if the next night's scan
  // re-reports it as an undiscovered error, the scan fails forever.
  const pureHarness = `
ns = {"__name__": "harness"}
with open(${JSON.stringify(GITHUB_FETCHER)}) as fh:
    exec(compile(fh.read(), "fetchGithubSignals.py", "exec"), ns)
is_self = ns["is_self_scan_run"]

SELF_NAME = "FORGE Engineering Brain \\u2014 Undiscovered Errors"
SELF_PATH = ".github/workflows/engineering-brain-undiscovered-errors.yml"
cases = [
    # (run dict, expected) -- path match is the primary rule
    ({"path": SELF_PATH, "name": "whatever"}, True),
    # no path -> fall back to the workflow name
    ({"name": SELF_NAME}, True),
    # path wins over name: same name, different workflow file -> kept
    ({"path": ".github/workflows/other.yml", "name": SELF_NAME}, False),
    # other workflows are kept (the brain sync going red IS a wanted signal)
    ({"path": ".github/workflows/engineering-brain-sync.yml", "name": "FORGE Engineering Brain Sync"}, False),
    # unknown runs are never silently dropped
    ({"path": "", "name": ""}, False),
    ({}, False),
    (None, False),
]
failed = 0
for run, expected in cases:
    got = is_self(run)
    if got != expected:
        failed += 1
        print(f"MISMATCH: run={run!r} expected={expected} got={got}")
print("PURE_ALL_OK" if failed == 0 else f"PURE_FAILURES:{failed}")
`;

  it("is_self_scan_run matches the scanner workflow and keeps everything else", () => {
    const out = execFileSync("python3", ["-c", pureHarness], { encoding: "utf8" });
    expect(out).not.toContain("MISMATCH");
    expect(out).toContain("PURE_ALL_OK");
  });

  it("main() drops self-scan failed runs but keeps other failed runs", () => {
    const e2eHarness = `
import sys, json, urllib.error

class _Blocker:
    def find_module(self, name, path=None):
        if name == "dynamic_credentials":
            return self
        return None
    def load_module(self, name):
        raise ModuleNotFoundError("hatch-adapter-blocked-for-test")
sys.meta_path.insert(0, _Blocker())

import os
os.environ["GITHUB_TOKEN"] = "dummy-token-for-e2e-test"

ns = {"__name__": "harness"}
with open(${JSON.stringify(GITHUB_FETCHER)}) as fh:
    exec(compile(fh.read(), "fetchGithubSignals.py", "exec"), ns)

SELF_NAME = "FORGE Engineering Brain \\u2014 Undiscovered Errors"
payload = {"workflow_runs": [
    {"id": 111, "name": SELF_NAME,
     "path": ".github/workflows/engineering-brain-undiscovered-errors.yml",
     "conclusion": "failure", "html_url": "https://github.com/o/r/actions/runs/111",
     "head_sha": "abc123def456", "head_branch": "main", "created_at": "2026-09-30T10:00:00Z"},
    {"id": 222, "name": "Vercel",
     "path": ".github/workflows/vercel.yml",
     "conclusion": "failure", "html_url": "https://github.com/o/r/actions/runs/222",
     "head_sha": "abc123def456", "head_branch": "main", "created_at": "2026-09-30T10:05:00Z"},
    {"id": 333, "name": "CI",
     "path": ".github/workflows/ci.yml",
     "conclusion": "success", "html_url": "https://github.com/o/r/actions/runs/333",
     "head_sha": "abc123def456", "head_branch": "main", "created_at": "2026-09-30T10:10:00Z"},
]}

class FakeResp:
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return json.dumps(payload).encode("utf8")

def fake_urlopen(req, timeout=None):
    class Ctx(FakeResp): pass
    return Ctx()

ns["urllib"].request.urlopen = fake_urlopen
ns["time"].sleep = lambda s: None

out_path = ${JSON.stringify(join(tmpdir(), "gh-signals-selfscan-test.json"))}
sys.argv = ["fetchGithubSignals.py", "--out", out_path, "--days", "7"]
rc = ns["main"]()
print(f"RETURN:{rc}")
with open(out_path, encoding="utf8") as fh:
    written = json.load(fh)
print(f"SIGNALS:{json.dumps([s['signal_id'] for s in written['signals']])}")
`;
    const out = execFileSync("python3", ["-c", e2eHarness], { encoding: "utf8" });
    expect(out).toContain("RETURN:0");
    expect(out).toContain('SIGNALS:["github:actions:ci_failed:222"]');
    expect(out).toContain("skipped 1 self-scan run");
  });
});
