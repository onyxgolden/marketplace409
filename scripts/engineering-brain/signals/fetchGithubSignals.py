#!/usr/bin/env python3
"""fetchGithubSignals.py — collect runtime signals from GitHub Actions.

Read-only. Lists workflow runs on main that concluded with failure in the last
--days days and emits one signal per failed run whose workflow is still red.
A failed run whose workflow has since succeeded on main is already addressed
and is NOT a signal: without this, one transient failure alarms every night
for 7 days until it ages out of the window. A red run on main nobody has
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

# NOTE: the Hatch `dynamic_credentials` adapter is imported lazily inside api_get,
# only on the surrogate-auth path. With GITHUB_TOKEN set this module must run on a
# plain CI runner / developer machine with no Hatch paths present.

OWNER, REPO = "onyxgolden", "marketplace409"
BASE = f"https://api.github.com/repos/{OWNER}/{REPO}"
MAX_RUNS = 50

# The scanner must never report on itself. A loud scan failure is visible by
# design -- it is not an "undiscovered error nobody asked about". Without this
# exclusion every red scan becomes a new self-signal the next night, so the
# scan can never go green again (self-flagging loop, first seen 2026-09-30:
# the scan kept re-flagging its own prior loud failures on main).
SELF_SCAN_WORKFLOW_PATH = ".github/workflows/engineering-brain-undiscovered-errors.yml"
SELF_SCAN_WORKFLOW_NAME = "FORGE Engineering Brain \u2014 Undiscovered Errors"


def is_self_scan_run(run):
    """True when the run belongs to this scanner workflow itself. Pure.

    Matched on the workflow file path (stable); falls back to the workflow
    name if the API ever stops sending `path`. A run with neither is never
    treated as self -- unknown runs stay reported, never silently dropped.
    """
    run = run or {}
    path = (run.get("path") or "").strip()
    if path:
        return path == SELF_SCAN_WORKFLOW_PATH
    return (run.get("name") or "").strip() == SELF_SCAN_WORKFLOW_NAME


def workflow_key(run):
    """Stable identity for the workflow a run belongs to. Pure.

    Prefers the numeric workflow_id the API always sends; falls back to the
    workflow file path, then the workflow name. The same function keys the
    latest-conclusion map and looks failed runs up in it, so both sides agree.
    """
    run = run or {}
    workflow_id = run.get("workflow_id")
    if workflow_id is not None:
        return f"workflow_id:{workflow_id}"
    path = (run.get("path") or "").strip()
    if path:
        return f"path:{path}"
    return f"name:{(run.get('name') or '').strip()}"


def is_still_red(failed_run, latest_conclusion_by_workflow):
    """True when the failed run's workflow has not gone green since. Pure.

    latest_conclusion_by_workflow maps workflow_key(run) -> conclusion of that
    workflow's latest run on main. Only `success` counts as fixed: a later
    cancellation, skip, or still-running build leaves the workflow red, and a
    workflow with no known later run is treated as still red -- fail loud,
    never silently drop.
    """
    return latest_conclusion_by_workflow.get(workflow_key(failed_run)) != "success"


def fetch_latest_conclusions(failed_runs):
    """Map workflow_key -> conclusion of each workflow's latest run on main.

    One targeted API call per distinct workflow (per_page=1, newest first).
    A workflow that cannot be resolved (no workflow_id, no runs returned)
    stays absent from the map; the caller treats absence as still red.
    Raises on request failure -- callers fail loud rather than filter on
    incomplete data.
    """
    latest = {}
    seen = set()
    for run in failed_runs or []:
        key = workflow_key(run)
        if key in seen:
            continue
        seen.add(key)
        workflow_id = (run or {}).get("workflow_id")
        if workflow_id is None:
            continue
        data = api_get(
            f"/actions/workflows/{workflow_id}/runs",
            {"branch": "main", "per_page": 1},
        )
        workflow_runs = data.get("workflow_runs") or []
        if workflow_runs:
            latest[key] = workflow_runs[0].get("conclusion")
    return latest


def api_get(path, params=None, attempts=4):
    url = BASE + path
    if params:
        query = "&".join(f"{k}={v}" for k, v in params.items())
        url += "?" + query
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        # Plain stdlib path: no Hatch adapter needed, works on any machine.
        def attach_auth(req):
            req.add_header("Authorization", f"Bearer {token}")

        def read_json(resp):
            return json.load(resp)
    else:
        # Sandbox path: user-connected credential via the Hatch surrogate.
        sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
        from dynamic_credentials import (  # noqa: E402
            add_surrogate_to_request,
            read_json_response,
        )

        def attach_auth(req):
            add_surrogate_to_request(req, "custom.github", allowed_hosts=["api.github.com"])

        def read_json(resp):
            return read_json_response(resp)

    last_error = None
    for attempt in range(attempts):
        req = urllib.request.Request(url, method="GET")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("User-Agent", "muse-github-skill")
        attach_auth(req)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return read_json(resp)
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
    # Never report this scanner's own runs: a loud scan failure is visible by
    # design, and re-reporting it the next night is a self-flagging loop.
    failed = [r for r in runs if r.get("conclusion") == "failure"]
    skipped_self = sum(1 for r in failed if is_self_scan_run(r))
    reportable = [r for r in failed if not is_self_scan_run(r)]
    # A failure the workflow already recovered from is not undiscovered: only
    # signal workflows whose latest run on main has not succeeded since.
    try:
        latest_by_workflow = fetch_latest_conclusions(reportable) if reportable else {}
    except Exception as exc:  # noqa: BLE001 - report and exit 1
        print(f"error: GitHub API request failed: {exc}", file=sys.stderr)
        return 1
    still_red = [r for r in reportable if is_still_red(r, latest_by_workflow)]
    skipped_fixed = len(reportable) - len(still_red)
    signals = [to_signal(r) for r in still_red]
    truncated = len(runs) >= MAX_RUNS

    payload = {
        "schema_version": "1.0",
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "source": "github",
        "truncated": truncated,
        "signals": signals,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    print(f"Wrote {len(signals)} signals to {args.out}."
          + (f" (skipped {skipped_self} self-scan runs)" if skipped_self else "")
          + (f" (skipped {skipped_fixed} already-fixed runs)" if skipped_fixed else "")
          + (" (truncated: hit the run cap)" if truncated else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
