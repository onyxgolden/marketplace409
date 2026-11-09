#!/usr/bin/env python3
"""Operator tool: create / verify the signed activation record.

The activation record is the ONLY thing that can move the service out of
OFF. It is HMAC-signed with RECEPTIONIST_ACTIVATION_SECRET; the server
refuses unsigned, tampered, or mismatched records (fail closed to OFF).

Usage (operator shell, secrets from env — never committed):
  # TEST_ONLY on the dedicated test number:
  RECEPTIONIST_ACTIVATION_SECRET=... python3 scripts/activation.py set-test-only \
      --test-number-sid PN... --test-number-e164 +15551234567 \
      --set-by "Jason Morgan" --reason "go-live rehearsal" \
      --out data/activation.json
  # Verify what the server will accept:
  RECEPTIONIST_ACTIVATION_SECRET=... python3 scripts/activation.py verify \
      --record data/activation.json
  # Back to OFF:
  RECEPTIONIST_ACTIVATION_SECRET=... python3 scripts/activation.py set-off \
      --set-by "Jason Morgan" --reason "rehearsal complete" \
      --out data/activation.json

LIVE_APPROVED cannot be created by this tool yet: it requires
--owner-word, --rehearsal-receipt (repeatable), and
--attorney-disclosure-revision naming a revision the disclosure registry
marks APPROVED — and no revision is APPROVED in this build. The tool
refuses to write a LIVE_APPROVED record until those exist. That is
deliberate: LIVE_APPROVED becomes reachable only after the attorney
blesses wording, the rehearsal receipts exist, and the owner gives the
word — three separate facts, all recorded here.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.activation import sign_record, validate_record
from app.policy.disclosure import is_revision_approved


def _utcnow() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _write(path: str, record: dict) -> None:
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2, sort_keys=True)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def cmd_set_test_only(args) -> int:
    secret = os.environ.get("RECEPTIONIST_ACTIVATION_SECRET", "")
    if not secret:
        print("RECEPTIONIST_ACTIVATION_SECRET is not set; refusing to sign.", file=sys.stderr)
        return 2
    if not args.test_number_sid or not args.test_number_e164:
        print("TEST_ONLY requires --test-number-sid and --test-number-e164.", file=sys.stderr)
        return 2
    record = sign_record({
        "mode": "TEST_ONLY",
        "test_number_sid": args.test_number_sid,
        "test_number_e164": args.test_number_e164,
        "set_by": args.set_by, "set_at": _utcnow(), "reason": args.reason,
    }, secret)
    _write(args.out, record)
    print(f"wrote signed TEST_ONLY record to {args.out}")
    return 0


def cmd_set_off(args) -> int:
    secret = os.environ.get("RECEPTIONIST_ACTIVATION_SECRET", "")
    if not secret:
        print("RECEPTIONIST_ACTIVATION_SECRET is not set; refusing to sign.", file=sys.stderr)
        return 2
    record = sign_record({
        "mode": "OFF",
        "set_by": args.set_by, "set_at": _utcnow(), "reason": args.reason,
    }, secret)
    _write(args.out, record)
    print(f"wrote signed OFF record to {args.out}")
    return 0


def cmd_set_live(args) -> int:
    secret = os.environ.get("RECEPTIONIST_ACTIVATION_SECRET", "")
    if not secret:
        print("RECEPTIONIST_ACTIVATION_SECRET is not set; refusing to sign.", file=sys.stderr)
        return 2
    if not args.owner_word:
        print("LIVE_APPROVED requires --owner-word (a recorded owner word).", file=sys.stderr)
        return 2
    if not args.rehearsal_receipt:
        print("LIVE_APPROVED requires at least one --rehearsal-receipt.", file=sys.stderr)
        return 2
    if not args.attorney_disclosure_revision or not is_revision_approved(args.attorney_disclosure_revision):
        print(f"LIVE_APPROVED requires --attorney-disclosure-revision naming an "
              f"APPROVED revision; {args.attorney_disclosure_revision!r} is not approved "
              f"(no revision is APPROVED in this build).", file=sys.stderr)
        return 2
    record = sign_record({
        "mode": "LIVE_APPROVED",
        "test_number_sid": args.test_number_sid or "",
        "test_number_e164": args.test_number_e164 or "",
        "set_by": args.set_by, "set_at": _utcnow(), "reason": args.reason,
        "owner_word": True,
        "rehearsal_receipts": args.rehearsal_receipt,
        "attorney_disclosure_revision": args.attorney_disclosure_revision,
    }, secret)
    _write(args.out, record)
    print(f"wrote signed LIVE_APPROVED record to {args.out}")
    return 0


def cmd_verify(args) -> int:
    secret = os.environ.get("RECEPTIONIST_ACTIVATION_SECRET", "")
    try:
        with open(args.record, "r", encoding="utf-8") as fh:
            record = json.load(fh)
    except (OSError, ValueError) as exc:
        print(f"cannot read record: {exc}", file=sys.stderr)
        return 2
    result = validate_record(record, secret,
                             os.environ.get("RECEPTIONIST_TEST_NUMBER_SID", ""),
                             os.environ.get("RECEPTIONIST_TEST_NUMBER_E164", ""))
    print(json.dumps({"mode": result["mode"], "valid": result["valid"],
                      "reason": result["reason"]}, indent=2))
    return 0 if result["valid"] else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Brandy receptionist activation record tool")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("set-test-only")
    p.add_argument("--test-number-sid", required=True)
    p.add_argument("--test-number-e164", required=True)
    p.add_argument("--set-by", required=True)
    p.add_argument("--reason", default="")
    p.add_argument("--out", required=True)
    p = sub.add_parser("set-off")
    p.add_argument("--set-by", required=True)
    p.add_argument("--reason", default="")
    p.add_argument("--out", required=True)
    p = sub.add_parser("set-live")
    p.add_argument("--test-number-sid", default="")
    p.add_argument("--test-number-e164", default="")
    p.add_argument("--set-by", required=True)
    p.add_argument("--reason", default="")
    p.add_argument("--owner-word", action="store_true")
    p.add_argument("--rehearsal-receipt", action="append", default=[])
    p.add_argument("--attorney-disclosure-revision", default="")
    p.add_argument("--out", required=True)
    p = sub.add_parser("verify")
    p.add_argument("--record", required=True)
    args = parser.parse_args()
    if args.command == "set-test-only":
        return cmd_set_test_only(args)
    if args.command == "set-off":
        return cmd_set_off(args)
    if args.command == "set-live":
        return cmd_set_live(args)
    return cmd_verify(args)


if __name__ == "__main__":
    raise SystemExit(main())
