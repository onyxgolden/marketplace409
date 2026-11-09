#!/usr/bin/env python3
"""Operator tool: manage the consent-gated recipient allowlist.

Recipients are Brandy (PRIMARY) and Jason (BACKUP) — ONLY after each
person's EXPLICIT individual consent is recorded. No consent exists yet,
so the allowlist ships empty and every alert send fails closed with
"no_consented_recipient" until the operator records consent here.

Usage:
  python3 scripts/recipients.py add --role PRIMARY --name "Brandy Morgan" \
      --voice-e164 +15551234567 --sms-e164 +15551234567 \
      --consent-voice --consent-sms --recorded-by "Jason Morgan" \
      --file data/recipients.json
  python3 scripts/recipients.py list --file data/recipients.json
  python3 scripts/recipients.py remove --role BACKUP --file data/recipients.json

Consent is per channel: --consent-voice and --consent-sms are separate
flags. A recipient with voice consent but no SMS consent receives voice
calls only. Removing a role deletes the entry (future sends fail closed).
Numbers are stored as given; the server only ever dials numbers that
appear here with consent recorded.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time


def _load(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            return data
    except (OSError, ValueError):
        pass
    return {}


def _write(path: str, data: dict) -> None:
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, sort_keys=True)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def _utcnow() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def cmd_add(args) -> int:
    if args.role not in ("PRIMARY", "BACKUP"):
        print("role must be PRIMARY or BACKUP", file=sys.stderr)
        return 2
    if not args.consent_voice and not args.consent_sms:
        print("at least one of --consent-voice / --consent-sms is required: "
              "a recipient without recorded consent receives nothing.", file=sys.stderr)
        return 2
    data = _load(args.file)
    consent: dict = {}
    if args.consent_voice:
        if not args.voice_e164:
            print("--consent-voice requires --voice-e164", file=sys.stderr)
            return 2
        consent["voice"] = {"given": True, "given_at": _utcnow(), "recorded_by": args.recorded_by}
    if args.consent_sms:
        if not args.sms_e164:
            print("--consent-sms requires --sms-e164", file=sys.stderr)
            return 2
        consent["sms"] = {"given": True, "given_at": _utcnow(), "recorded_by": args.recorded_by}
    data[args.role] = {
        "role": args.role, "name": args.name,
        "voice_e164": args.voice_e164 or "", "sms_e164": args.sms_e164 or "",
        "consent": consent,
    }
    _write(args.file, data)
    print(f"recorded {args.role} ({args.name}) with consent {sorted(consent)} in {args.file}")
    return 0


def cmd_list(args) -> int:
    data = _load(args.file)
    for role in ("PRIMARY", "BACKUP"):
        entry = data.get(role)
        if not entry:
            print(f"{role}: (none)")
            continue
        channels = sorted(c for c, v in (entry.get("consent") or {}).items()
                          if isinstance(v, dict) and v.get("given") is True)
        print(f"{role}: {entry.get('name')} consent={channels or 'NONE'}")
    return 0


def cmd_remove(args) -> int:
    data = _load(args.file)
    if args.role not in data:
        print(f"{args.role} is not in the allowlist", file=sys.stderr)
        return 2
    del data[args.role]
    _write(args.file, data)
    print(f"removed {args.role} from {args.file} (future sends to it fail closed)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Brandy receptionist recipient allowlist tool")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("add")
    p.add_argument("--role", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--voice-e164", default="")
    p.add_argument("--sms-e164", default="")
    p.add_argument("--consent-voice", action="store_true")
    p.add_argument("--consent-sms", action="store_true")
    p.add_argument("--recorded-by", required=True)
    p.add_argument("--file", required=True)
    p = sub.add_parser("list")
    p.add_argument("--file", required=True)
    p = sub.add_parser("remove")
    p.add_argument("--role", required=True)
    p.add_argument("--file", required=True)
    args = parser.parse_args()
    if args.command == "add":
        return cmd_add(args)
    if args.command == "list":
        return cmd_list(args)
    return cmd_remove(args)


if __name__ == "__main__":
    raise SystemExit(main())
