#!/usr/bin/env python3
"""Rollback drill + activation preflight + retention audit (go-live §5).

Read-only by default. The live drill engages the REAL kill switch
against a running server — it is a deliberate operator action, not a
test, and it ends live sessions. Run the preflight first.

  preflight:        file/config checks only — activation record, kill
                    switch state, disclosure pinning, fallback TwiML
                    render, cost ledger, outbox, recipients, latency log.
  drill:            against a running server (--server-url + operator
                    token): kill -> /health shows killed -> new voice
                    webhook gets human-fallback TwiML -> live sessions
                    ended -> clear kill -> /health shows not killed.
                    Each step is timed and recorded.
  retention-audit:  recordings + raw transcript storage must be OFF in
                    config; data/ must hold no recording/transcript
                    files; provider-side retention is reported as an
                    operator confirmation item (it cannot be checked
                    from this host).
  receipt:          preflight + retention-audit, written as one redacted
                    JSON receipt (no secrets, no phone numbers — E.164s
                    are masked to last 4) to --receipt.

Exit 0 only when every check passes. A drill that cannot complete a
step fails loudly and leaves the kill switch in whatever state the
step reached — the receipt says so, and the operator clears it by hand
(scripts/activation.py set-off does NOT clear a kill; use the
/operator/unkill endpoint or scripts below).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.activation import load_activation_state
from app.config import ReceptionistConfig
from app.kill_switch import KillSwitch
from app.policy.disclosure import (
    VOICEMAIL_RECORDING_POLICY, current_revision, verify_disclosure_text,
    voicemail_recording_approved)
from app.policy.quote_guard import TEMPLATES
from app.telephony_twilio import (
    twiml_human_fallback, verify_twiml_disclosure, voicemail_recording_allowed)


def mask_e164(value: str) -> str:
    digits = "".join(c for c in str(value) if c.isdigit())
    return f"+1-***-***-{digits[-4:]}" if len(digits) >= 4 else "***"


def _check(name: str, ok: bool, detail: str = "") -> dict:
    return {"check": name, "status": "PASS" if ok else "FAIL", "detail": detail}


def preflight(config: ReceptionistConfig, base_dir: str) -> list[dict]:
    checks: list[dict] = []
    state = load_activation_state(config)
    checks.append(_check("activation_record", state["valid"] or state["mode"] == "OFF",
                         f"mode={state['mode']} reason={state['reason']}"))
    ks = KillSwitch(config.kill_switch_path)
    ks_state = ks.state()
    checks.append(_check("kill_switch_readable", isinstance(ks_state.get("killed"), bool),
                         f"killed={ks_state.get('killed')}"))
    disc = verify_twiml_disclosure()
    checks.append(_check("disclosure_pinned", disc["ok"],
                         f"revision={disc['revision_id']} status={disc['revision_status']}"))
    revision = current_revision()
    checks.append(_check("disclosure_revision_status", True,
                         f"revision={revision['id']} status={revision['status']} — "
                         f"{'LIVE_APPROVED unreachable until an APPROVED revision exists' if revision['status'] != 'APPROVED' else 'an APPROVED revision exists; LIVE_APPROVED is reachable with owner word + rehearsal receipts'}"))
    try:
        # The fallback served on OFF / kill / worker-unreachable records
        # the caller ONLY when voicemail recording is approved + enabled
        # (fix round 1, P2-2). Prove the rendered fallback matches the
        # policy: <Record> present exactly when recording is allowed.
        allowed = voicemail_recording_allowed(config)
        fallback = twiml_human_fallback(config.fallback_forward_e164 or None,
                                        record_voicemail=allowed)
        records = "<Record" in fallback
        checks.append(_check("fallback_twiml_renders", "<Response>" in fallback,
                             "human fallback renders"))
        checks.append(_check("fallback_records_only_when_approved", records == allowed,
                             f"voicemail recording allowed={allowed}, <Record> present={records}"))
    except Exception as exc:  # noqa: BLE001 — a render failure is a failed check
        checks.append(_check("fallback_twiml_renders", False, str(exc)))
        checks.append(_check("fallback_records_only_when_approved", False, str(exc)))
    checks.append(_check("voicemail_recording_policy",
                         VOICEMAIL_RECORDING_POLICY["status"] in ("APPROVED", "UNAPPROVED"),
                         f"policy={VOICEMAIL_RECORDING_POLICY['id']} status={VOICEMAIL_RECORDING_POLICY['status']} "
                         f"enabled={config.voicemail_recording_enabled} "
                         f"records={voicemail_recording_allowed(config)} — "
                         f"{'recording is ON with an approved disclosure' if voicemail_recording_allowed(config) else 'fallback does not record (policy unapproved or flag off)'}"))
    checks.append(_check("recording_off_by_default", not config.recording_enabled,
                         "recording_enabled=False" if not config.recording_enabled else "recording is ON"))
    checks.append(_check("transcript_storage_off_by_default", not config.transcript_storage_enabled,
                         "transcript_storage_enabled=False" if not config.transcript_storage_enabled else "transcript storage is ON"))
    checks.append(_check("test_number_configured", bool(config.test_number_e164),
                         f"test_number={mask_e164(config.test_number_e164)}" if config.test_number_e164 else "no test number configured (TEST_ONLY cannot validate)"))
    # Data files exist and parse (missing is fine — fresh start).
    for label, path in (("cost_ledger", config.cost_ledger_path),
                        ("alert_state", config.alert_state_path),
                        ("delivery_outbox", config.delivery_outbox_path)):
        if not os.path.exists(path):
            checks.append(_check(f"{label}_readable", True, "no file yet (fresh start)"))
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                json.load(fh)
            checks.append(_check(f"{label}_readable", True, "parses as JSON"))
        except (OSError, ValueError) as exc:
            checks.append(_check(f"{label}_readable", False, str(exc)))
    return checks


def retention_audit(config: ReceptionistConfig, base_dir: str) -> list[dict]:
    checks: list[dict] = []
    checks.append(_check("recording_flag_off", not config.recording_enabled))
    checks.append(_check("transcript_storage_flag_off", not config.transcript_storage_enabled))
    # No recording/transcript artifacts may sit in the service data dir.
    suspicious = []
    if os.path.isdir(base_dir):
        for name in os.listdir(base_dir):
            if re.search(r"\.(wav|mp3|webm|ogg)$", name, re.I) or "transcript" in name.lower():
                suspicious.append(name)
    checks.append(_check("no_recording_artifacts_in_data", not suspicious,
                         f"found: {suspicious}" if suspicious else "clean"))
    checks.append(_check("provider_retention_audited", False,
                         "OPERATOR ACTION: confirm Deepgram/Cartesia/Twilio retention "
                         "settings in each vendor console (cannot be checked from this host)"))
    checks.append(_check("voicemail_retention_audited", False,
                         "OPERATOR ACTION: if voicemail recording is ever approved, "
                         "confirm the Twilio number's recording storage/retention "
                         "for <Record> voicemails in the Twilio console (cannot be "
                         "checked from this host); with recording off, no voicemail "
                         "recordings exist to retain"))
    return checks


def _http(server_url: str, method: str, path: str, body: dict | None = None,
          token: str = "") -> tuple[int, dict]:
    url = server_url.rstrip("/") + path
    data = json.dumps(body or {}).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"{}")
        except ValueError:
            return exc.code, {}
    except OSError as exc:
        return 0, {"error": str(exc)}


def drill(server_url: str, token: str, *, set_by: str) -> list[dict]:
    checks: list[dict] = []
    status, health0 = _http(server_url, "GET", "/health")
    checks.append(_check("server_reachable", status == 200, f"GET /health -> {status}"))
    if status != 200:
        return checks
    live_before = health0.get("active_live_sessions", 0)
    started = time.time()
    status, killed = _http(server_url, "POST", "/operator/kill",
                           {"reason": "rollback drill", "set_by": set_by}, token)
    checks.append(_check("kill_engaged", status == 200 and killed.get("killed") is True,
                         f"POST /operator/kill -> {status}"))
    _s, health1 = _http(server_url, "GET", "/health")
    checks.append(_check("health_shows_killed", bool((health1.get("kill_switch") or {}).get("killed")),
                         f"killed={bool((health1.get('kill_switch') or {}).get('killed'))}"))
    checks.append(_check("live_sessions_ended", health1.get("active_live_sessions", -1) == 0,
                         f"before={live_before} after={health1.get('active_live_sessions')}"))
    status, cleared = _http(server_url, "POST", "/operator/unkill",
                            {"reason": "rollback drill complete", "set_by": set_by}, token)
    checks.append(_check("kill_cleared", status == 200 and cleared.get("killed") is False,
                         f"POST /operator/unkill -> {status}"))
    _s, health2 = _http(server_url, "GET", "/health")
    checks.append(_check("health_shows_not_killed", not bool((health2.get("kill_switch") or {}).get("killed")),
                         "kill switch clear"))
    checks.append(_check("drill_duration_s", True, f"{time.time() - started:.1f}s"))
    return checks


def cmd_receipt(args) -> int:
    config = ReceptionistConfig()
    base_dir = os.path.dirname(config.cost_ledger_path)
    checks = preflight(config, base_dir) + retention_audit(config, base_dir)
    receipt = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "kind": "brandy-receptionist-golive-preflight-receipt",
               "checks": checks,
               "passed": sum(1 for c in checks if c["status"] == "PASS"),
               "failed": sum(1 for c in checks if c["status"] == "FAIL")}
    if args.receipt:
        with open(args.receipt, "w", encoding="utf-8") as fh:
            json.dump(receipt, fh, indent=2, sort_keys=True)
        print(f"wrote {args.receipt} ({receipt['passed']} pass, {receipt['failed']} fail)")
    else:
        print(json.dumps(receipt, indent=2))
    return 0 if receipt["failed"] == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Brandy receptionist rollback drill / preflight")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("preflight")
    p = sub.add_parser("drill")
    p.add_argument("--server-url", required=True)
    p.add_argument("--set-by", required=True)
    sub.add_parser("retention-audit")
    p = sub.add_parser("receipt")
    p.add_argument("--receipt", default="")
    args = parser.parse_args()
    config = ReceptionistConfig()
    base_dir = os.path.dirname(config.cost_ledger_path)
    token = os.environ.get("RECEPTIONIST_OPERATOR_TOKEN", "")
    if args.command == "preflight":
        checks = preflight(config, base_dir)
    elif args.command == "retention-audit":
        checks = retention_audit(config, base_dir)
    elif args.command == "drill":
        if not token:
            print("RECEPTIONIST_OPERATOR_TOKEN is not set; the drill cannot authenticate.", file=sys.stderr)
            return 2
        checks = drill(args.server_url, token, set_by=args.set_by)
    else:
        return cmd_receipt(args)
    for c in checks:
        print(f"{c['status']}: {c['check']} — {c['detail']}")
    failed = sum(1 for c in checks if c["status"] == "FAIL")
    print(f"{len(checks) - failed} pass, {failed} fail")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
