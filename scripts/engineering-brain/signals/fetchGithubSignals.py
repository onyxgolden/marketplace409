#!/usr/bin/env python3
"""fetchGithubSignals.py — collect runtime signals from GitHub Actions.

Read-only. Lists workflow runs on main that concluded with failure in the last
--days days and emits one signal per failed run. A red run on main nobody has
asked about is an undiscovered error: the nightly engineering-brain sync going
red, for example, means the live index silently stops updating.

Auth: GITHUB_TOKEN env when present (CI), otherwise the Hatch surrogate for the
user-connected `custom.github` credential (local). Requests go only to
api.github.com.

Usage:
  python3 scripts/engineering-brain/signals/fetchGithubSignals.py --out <signals.json> [--days 7]

Exit codes: 0 = signals written; 1 = request failure; 2 = bad arguments.
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import (  # noqa: E402
    add_surrogate_to_request,
    read_json_response,
)

OWNER, REPO = "onyxgolden", "marketplace409"
BASE = f"https://api.github.com/repos/{OWNER}/{REPO}"
MAX_RUNS = 50


def api_get(path, params=None, attempts=4):
    url = BASE + path
    if params:
        query = "&".join(f"{k}={v}" for k, v in params.items())
        url += "?" + query
    last_error = None
    for attempt in range(attempts):
        req = urllib.request.Request(url, method="GET")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("User-Agent", "muse-github-skill")
        token = os.environ.get("GITHUB_TOKEN")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        else:
            add_surrogate_to_request(req, "custom.github", allowed_hosts=["api.github.com"])
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return read_json_response(resp)
        except Exception as exc:  # noqa: BLE001 - retry transient failures
            last_error = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GitHub API request failed after {attempts} attempts: {last_error}")


def to_signal(run):
    workflow_name = (run.get("name") or "workflow").strip()
    run_id = run["id"]
    return {
        "signal_id": f"github:actions:ci_failed:{run_id}",
        "source": "github",
        "kind": "ci_failed",
        "severity": "error",
        "title": f"CI failed on main: {workflow_name}",
        "group_title": f"CI failed on main: {workflow_name}",
        "detected_at": run.get("created_at"),
        "correlation_query": f"{workflow_name} failed",
        "evidence": {
            "workflow_name": workflow_name,
            "run_url": run.get("html_url"),
            "head_sha": (run.get("head_sha") or "")[:12],
            "head_branch": run.get("head_branch"),
            "conclusion": run.get("conclusion"),
            "created_at": run.get("created_at"),
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args()
    if args.days < 0:
        parser.error("--days must be non-negative")

    cutoff = (datetime.now(timezone.utc) - timedelta(days=args.days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        data = api_get(
            "/actions/runs",
            {"branch": "main", "status": "failure", "created": f">={cutoff}", "per_page": MAX_RUNS},
        )
    except Exception as exc:  # noqa: BLE001 - report and exit 1
        print(f"error: GitHub API request failed: {exc}", file=sys.stderr)
        return 1

    runs = data.get("workflow_runs") or []
    # Keep only runs that actually concluded as failure (API status filter is coarse).
    signals = [to_signal(r) for r in runs if r.get("conclusion") == "failure"]

    payload = {
        "schema_version": "1.0",
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "source": "github",
        "signals": signals,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    print(f"Wrote {len(signals)} signals to {args.out}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
