import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const GITHUB_FETCHER = join(TEST_DIR, "..", "fetchGithubSignals.py");

const LOAD_MODULE = `
ns = {"__name__": "harness"}
with open(${JSON.stringify(GITHUB_FETCHER)}) as fh:
    exec(compile(fh.read(), "fetchGithubSignals.py", "exec"), ns)
`;

describe("is_still_red / workflow_key — pure unit tests", () => {
  const pureHarness = `
${LOAD_MODULE}
is_still_red = ns["is_still_red"]
workflow_key = ns["workflow_key"]

def run(workflow_id, name, path):
    return {"id": 1, "workflow_id": workflow_id, "name": name,
            "path": path, "conclusion": "failure"}

cases = [
    # (failed_run, latest_map, expected_still_red, label)
    (run(100, "Capture", ".github/workflows/capture.yml"),
     {"workflow_id:100": "success"}, False, "fixed-then-green -> no signal"),
    (run(200, "Sync", ".github/workflows/sync.yml"),
     {"workflow_id:200": "failure"}, True, "still-red -> signal"),
    (run(300, "Lonely", ".github/workflows/lonely.yml"),
     {}, True, "failed-once-never-reran -> signal"),
    (run(400, "Cancel", ".github/workflows/cancel.yml"),
     {"workflow_id:400": "cancelled"}, True, "later-cancelled -> signal"),
    (run(500, "Flaky", ".github/workflows/flaky.yml"),
     {"workflow_id:500": "failure"}, True, "flaky fail-pass-fail -> signal"),
    (run(600, "Running", ".github/workflows/running.yml"),
     {"workflow_id:600": None}, True, "latest still running -> signal"),
    (run(700, "Skipped", ".github/workflows/skipped.yml"),
     {"workflow_id:700": "skipped"}, True, "latest skipped -> signal"),
]
failed = 0
for r, m, expected, label in cases:
    got = is_still_red(r, m)
    if got != expected:
        failed += 1
        print(f"MISMATCH: {label} expected={expected} got={got}")
print("PURE_ALL_OK" if failed == 0 else f"PURE_FAILURES:{failed}")

key_cases = [
    ({"workflow_id": 42, "path": "p", "name": "n"}, "workflow_id:42", "id wins"),
    ({"path": ".github/workflows/x.yml", "name": "n"}, "path:.github/workflows/x.yml", "path fallback"),
    ({"name": "My Workflow"}, "name:My Workflow", "name fallback"),
    ({"path": "  ", "name": "Trimmed"}, "name:Trimmed", "blank path falls through"),
    ({}, "name:", "empty run"),
    (None, "name:", "none run"),
]
key_failed = 0
for r, expected, label in key_cases:
    got = workflow_key(r)
    if got != expected:
        key_failed += 1
        print(f"KEY_MISMATCH: {label} expected={expected!r} got={got!r}")
print("KEY_ALL_OK" if key_failed == 0 else f"KEY_FAILURES:{key_failed}")
`;

  it("is_still_red filters fixed workflows and keeps every still-red shape", () => {
    const out = execFileSync("python3", ["-c", pureHarness], { encoding: "utf8" });
    expect(out).not.toContain("MISMATCH");
    expect(out).toContain("PURE_ALL_OK");
  });

  it("workflow_key prefers workflow_id, then path, then name", () => {
    const out = execFileSync("python3", ["-c", pureHarness], { encoding: "utf8" });
    expect(out).not.toContain("KEY_MISMATCH");
    expect(out).toContain("KEY_ALL_OK");
  });
});

describe("main() — already-fixed failures are filtered, still-red failures signal", () => {
  // Drives the real main() with a URL-routed fake: /actions/runs returns the
  // failed-run window, /actions/workflows/<id>/runs returns each workflow's
  // latest run on main.
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
os.environ["GITHUB_TOKEN"] = "dummy-token-for-stillred-test"

${LOAD_MODULE}

def mk(run_id, workflow_id, name, path, conclusion, created):
    return {"id": run_id, "workflow_id": workflow_id, "name": name, "path": path,
            "conclusion": conclusion,
            "html_url": f"https://github.com/o/r/actions/runs/{run_id}",
            "head_sha": "abc123def456", "head_branch": "main", "created_at": created}

failed_payload = {"workflow_runs": [
    # fixed-then-green: failed Sep 28, green ever since -> NO signal
    mk(101, 100, "Build FORGE Capture (Windows)", ".github/workflows/capture.yml",
       "failure", "2026-09-28T10:00:00Z"),
    # still-red: failed, failed again -> signal
    mk(201, 200, "Nightly Sync", ".github/workflows/sync.yml",
       "failure", "2026-10-01T10:00:00Z"),
    # failed-once-never-reran -> signal
    mk(301, 300, "Lonely Workflow", ".github/workflows/lonely.yml",
       "failure", "2026-10-01T11:00:00Z"),
    # later-cancelled (cancelled does not count as fixed) -> signal
    mk(401, 400, "Cancel Prone", ".github/workflows/cancel.yml",
       "failure", "2026-10-01T12:00:00Z"),
    # flaky fail-pass-fail: latest is red again -> both failures signal
    mk(501, 500, "Flaky", ".github/workflows/flaky.yml",
       "failure", "2026-09-29T10:00:00Z"),
    mk(502, 500, "Flaky", ".github/workflows/flaky.yml",
       "failure", "2026-10-01T13:00:00Z"),
]}

latest_payloads = {
    100: {"workflow_runs": [mk(102, 100, "Build FORGE Capture (Windows)",
       ".github/workflows/capture.yml", "success", "2026-09-29T10:00:00Z")]},
    200: {"workflow_runs": [mk(202, 200, "Nightly Sync",
       ".github/workflows/sync.yml", "failure", "2026-10-01T14:00:00Z")]},
    300: {"workflow_runs": [mk(301, 300, "Lonely Workflow",
       ".github/workflows/lonely.yml", "failure", "2026-10-01T11:00:00Z")]},
    400: {"workflow_runs": [mk(402, 400, "Cancel Prone",
       ".github/workflows/cancel.yml", "cancelled", "2026-10-01T15:00:00Z")]},
    500: {"workflow_runs": [mk(503, 500, "Flaky",
       ".github/workflows/flaky.yml", "failure", "2026-10-01T16:00:00Z")]},
}

calls = []
def fake_urlopen(req, timeout=None):
    url = req.full_url
    calls.append(url)
    if "/actions/workflows/" in url:
        wid = int(url.split("/actions/workflows/")[1].split("/")[0])
        payload = latest_payloads[wid]
    else:
        payload = failed_payload
    class Ctx:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return json.dumps(payload).encode("utf8")
    return Ctx()

ns["urllib"].request.urlopen = fake_urlopen
ns["time"].sleep = lambda s: None

out_path = ${JSON.stringify(join(tmpdir(), "gh-signals-stillred-test.json"))}
sys.argv = ["fetchGithubSignals.py", "--out", out_path, "--days", "7"]
rc = ns["main"]()
print(f"RETURN:{rc}")
print(f"WORKFLOW_CALLS:{sum(1 for u in calls if '/actions/workflows/' in u)}")
with open(out_path, encoding="utf8") as fh:
    written = json.load(fh)
print(f"SIGNALS:{json.dumps(sorted(s['signal_id'] for s in written['signals']))}")
`;

  it("emits signals only for still-red workflows (one targeted call each)", () => {
    const out = execFileSync("python3", ["-c", e2eHarness], { encoding: "utf8" });
    expect(out).toContain("RETURN:0");
    expect(out).toContain("WORKFLOW_CALLS:5");
    expect(out).toContain(
      'SIGNALS:["github:actions:ci_failed:201", "github:actions:ci_failed:301", ' +
        '"github:actions:ci_failed:401", "github:actions:ci_failed:501", ' +
        '"github:actions:ci_failed:502"]'
    );
    expect(out).not.toContain("ci_failed:101"); // fixed-then-green stays silent
    expect(out).toContain("skipped 1 already-fixed run");
  });

  it("fails loud (exit 1) when the latest-run lookup fails", () => {
    const failHarness = `
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
os.environ["GITHUB_TOKEN"] = "dummy-token-for-stillred-fail-test"

${LOAD_MODULE}

failed_payload = {"workflow_runs": [
    {"id": 901, "workflow_id": 900, "name": "Boom", "path": ".github/workflows/boom.yml",
     "conclusion": "failure", "html_url": "https://github.com/o/r/actions/runs/901",
     "head_sha": "abc123", "head_branch": "main", "created_at": "2026-10-01T10:00:00Z"},
]}

def fake_urlopen(req, timeout=None):
    if "/actions/workflows/" in req.full_url:
        raise urllib.error.HTTPError(req.full_url, 500, "Server Error", {}, None)
    class Ctx:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return json.dumps(failed_payload).encode("utf8")
    return Ctx()

ns["urllib"].request.urlopen = fake_urlopen
ns["time"].sleep = lambda s: None

sys.argv = ["fetchGithubSignals.py", "--out",
            ${JSON.stringify(join(tmpdir(), "gh-signals-stillred-fail.json"))},
            "--days", "7"]
rc = ns["main"]()
print(f"RETURN:{rc}")
`;
    const out = execFileSync("python3", ["-c", failHarness], { encoding: "utf8" });
    expect(out).toContain("RETURN:1"); // never filter on incomplete data
  });
});
