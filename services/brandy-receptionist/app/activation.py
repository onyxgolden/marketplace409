"""Signed server-side activation record (go-live §2/§5).

The EFFECTIVE activation mode comes ONLY from this record. No env flag,
provider key, deployment, or migration can transition modes on its own.

Record shape (JSON, written by scripts/activation.py, an operator tool):
    {
      "mode": "TEST_ONLY" | "LIVE_APPROVED",
      "test_number_sid": "PN…",          # required for TEST_ONLY
      "test_number_e164": "+1…",         # required for TEST_ONLY
      "set_by": "operator name",
      "set_at": "2026-11-08T20:00:00Z",
      "reason": "…",
      "owner_word": true,                # required for LIVE_APPROVED
      "rehearsal_receipts": ["…"],       # required, non-empty, for LIVE_APPROVED
      "attorney_disclosure_revision": "…", # required for LIVE_APPROVED
      "signature": "<hmac-sha256 hex over the canonical JSON of the rest>"
    }

Verification rules (fail closed — any failure means OFF):
- the file must exist, parse, and carry a valid HMAC signature under
  RECEPTIONIST_ACTIVATION_SECRET (empty secret => nothing validates);
- mode must be one of OFF / TEST_ONLY / LIVE_APPROVED (OFF records are
  valid and mean OFF);
- TEST_ONLY requires test_number_sid + test_number_e164 present AND
  matching the deployment env (RECEPTIONIST_TEST_NUMBER_SID/E164);
- LIVE_APPROVED additionally requires owner_word true, a non-empty
  rehearsal_receipts list, and an attorney_disclosure_revision (field
  name kept from go-live §2; it now just names "the approved disclosure
  revision" — see local-build Cut 1 note below) that the disclosure
  registry marks APPROVED.

Local-build Cut 1 (2026-11-16): the disclosure registry now has an
APPROVED revision (Jason's own pinned wording, not an attorney sign-off
— see app/policy/disclosure.py), so this specific blocker is lifted.
Every OTHER LIVE_APPROVED requirement here (signature, owner_word,
non-empty rehearsal_receipts, mode matching) is UNCHANGED — reachability
still requires all of them, plus Jason's separate LIVE_APPROVED word;
no env flag or merge activates calls on its own.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os

from .config import ACTIVATION_MODES


def canonical_json(payload: dict) -> bytes:
    """Deterministic bytes for signing: sorted keys, compact separators."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sign_record(payload: dict, secret: str) -> dict:
    """Return a copy of payload with an HMAC-SHA256 signature attached."""
    body = dict(payload)
    body.pop("signature", None)
    sig = hmac.new(secret.encode("utf-8"), canonical_json(body), hashlib.sha256).hexdigest()
    body["signature"] = sig
    return body


def verify_record(record: dict, secret: str) -> bool:
    """True only when the record's signature matches under this secret."""
    if not secret or not isinstance(record, dict):
        return False
    sig = record.get("signature")
    if not isinstance(sig, str) or not sig:
        return False
    body = {k: v for k, v in record.items() if k != "signature"}
    expected = hmac.new(secret.encode("utf-8"), canonical_json(body), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


def validate_record(record: dict, secret: str, test_number_sid: str, test_number_e164: str) -> dict:
    """Validate a signed record and return the effective activation state.

    Returns {"mode": "OFF"|"TEST_ONLY"|"LIVE_APPROVED", "valid": bool,
    "reason": str, "record": <record or None>}. Any failure => OFF.
    The disclosure-approval check is injected lazily to avoid a hard
    import cycle (activation <- disclosure registry).
    """
    from .policy.disclosure import is_revision_approved

    if not isinstance(record, dict):
        return {"mode": "OFF", "valid": False, "reason": "no activation record", "record": None}
    if not verify_record(record, secret):
        return {"mode": "OFF", "valid": False, "reason": "activation record signature invalid or secret missing", "record": None}
    mode = record.get("mode")
    if mode not in ACTIVATION_MODES:
        return {"mode": "OFF", "valid": False, "reason": f"unknown activation mode {mode!r}", "record": record}
    if mode == "OFF":
        return {"mode": "OFF", "valid": True, "reason": "explicitly OFF", "record": record}
    # TEST_ONLY: the record's test number must match the deployment env.
    if not record.get("test_number_sid") or not record.get("test_number_e164"):
        return {"mode": "OFF", "valid": False, "reason": "TEST_ONLY record missing test number", "record": record}
    if test_number_sid and record["test_number_sid"] != test_number_sid:
        return {"mode": "OFF", "valid": False, "reason": "TEST_ONLY record test-number SID does not match deployment", "record": record}
    if test_number_e164 and record["test_number_e164"] != test_number_e164:
        return {"mode": "OFF", "valid": False, "reason": "TEST_ONLY record test number does not match deployment", "record": record}
    if mode == "TEST_ONLY":
        return {"mode": "TEST_ONLY", "valid": True, "reason": "signed TEST_ONLY record, test number matches", "record": record}
    # LIVE_APPROVED: owner word + rehearsal receipts + an APPROVED
    # disclosure revision (Cut 1: approval no longer requires an
    # attorney — see app/policy/disclosure.py — but every other gate
    # here is unchanged).
    if record.get("owner_word") is not True:
        return {"mode": "OFF", "valid": False, "reason": "LIVE_APPROVED requires a recorded owner word", "record": record}
    receipts = record.get("rehearsal_receipts")
    if not isinstance(receipts, list) or not receipts:
        return {"mode": "OFF", "valid": False, "reason": "LIVE_APPROVED requires non-empty rehearsal receipts", "record": record}
    revision = record.get("attorney_disclosure_revision")
    if not revision or not is_revision_approved(revision):
        return {"mode": "OFF", "valid": False, "reason": "LIVE_APPROVED requires an approved disclosure revision", "record": record}
    return {"mode": "LIVE_APPROVED", "valid": True, "reason": "signed LIVE_APPROVED record", "record": record}


def load_activation_state(config) -> dict:
    """Load and validate the activation record for this config.

    Missing file => OFF. Any validation failure => OFF. The returned
    dict is the server's single source of truth for mode.
    """
    path = config.activation_record_path
    try:
        with open(path, "r", encoding="utf-8") as fh:
            record = json.load(fh)
    except (OSError, ValueError):
        return {"mode": "OFF", "valid": False, "reason": "no activation record on disk", "record": None}
    return validate_record(record, config.activation_secret, config.test_number_sid, config.test_number_e164)


def activation_state_for_mode(mode: str, reason: str = "") -> dict:
    """Test helper: build a state dict without touching disk."""
    return {"mode": mode, "valid": mode != "OFF", "reason": reason or mode, "record": None}
