"""Twilio telephony adapter: inbound webhooks + Media Streams.

DISABLED BY DEFAULT (config.telephony_enabled=False). The server returns
503 for every Twilio route until explicitly enabled with a go-live word.

Security (brief §7):
- Verify the Twilio request signature against the exact public URL + body
  (HMAC-SHA1 over url + sorted POST params, per Twilio's spec).
- Media Stream WebSocket auth uses a signed, short-lived session token
  bound to the call SID + operation, validated on upgrade / first frame.
- Strict origin / rate / concurrency caps are enforced in server.py.
- No live numbers are configured here; the number is env-supplied at
  go-live and never redirected from the existing rental number.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import time

from .config import DisabledError

STREAM_TOKEN_TTL_S = 120


def verify_twilio_signature(auth_token: str, url: str, params: dict, signature: str) -> bool:
    """Twilio signature: HMAC-SHA1 over url + concatenated sorted params,
    base64-encoded. Constant-time compare."""
    if not auth_token or not signature:
        return False
    data = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    expected = base64.b64encode(
        hmac.new(auth_token.encode(), data.encode(), hashlib.sha1).digest()).decode()
    return hmac.compare_digest(expected, signature)


def sign_stream_token(secret: str, call_sid: str, operation_id: str,
                      issued_at: int | None = None) -> str:
    issued_at = issued_at if issued_at is not None else int(time.time())
    payload = f"{call_sid}.{operation_id}.{issued_at}"
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{payload}.{sig}"


def verify_stream_token(secret: str, token: str, call_sid: str, operation_id: str,
                        now: int | None = None) -> bool:
    now = now if now is not None else int(time.time())
    try:
        parts = token.split(".")
        if len(parts) != 4:
            return False
        tok_sid, tok_op, issued, sig = parts
        if tok_sid != call_sid or tok_op != operation_id:
            return False
        if now - int(issued) > STREAM_TOKEN_TTL_S or int(issued) > now + 5:
            return False
        expected = hmac.new(secret.encode(), ".".join(parts[:3]).encode(),
                            hashlib.sha256).hexdigest()[:32]
        return hmac.compare_digest(expected, sig)
    except (ValueError, TypeError):
        return False


def twiml_start_stream(stream_url: str, stream_token: str) -> str:
    """TwiML: greet via the disclosure template, then open a bidirectional
    Media Stream. The greeting text comes from the fixed disclosure
    template — never from model output."""
    from .policy.quote_guard import TEMPLATES
    greeting = TEMPLATES["disclosure"]
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f"<Say>{greeting}</Say>"
        "<Connect>"
        f'<Stream url="{stream_url}">'
        f"<Parameter name=\"token\" value=\"{stream_token}\" />"
        "</Stream>"
        "</Connect>"
        "</Response>"
    )


def twiml_alert_call(alert_ack_url: str, emergency_event_id: str,
                     message: str, ack_digit: str = "1") -> str:
    """TwiML for an outbound emergency alert call (P1-3 binding).

    The call gathers exactly one DTMF digit and posts it to the alert
    ack endpoint. The action URL carries the emergency_event_id, and
    Twilio posts CallSid + Digits with its request signature, so the ack
    handler can verify the callback is Twilio-signed AND bound to this
    alert call. No other digit acknowledges; hanging up acknowledges
    nothing."""
    import html
    import urllib.parse
    action = (f"{alert_ack_url}?{urllib.parse.urlencode({'emergency_event_id': emergency_event_id})}"
              if "?" not in alert_ack_url else
              f"{alert_ack_url}&{urllib.parse.urlencode({'emergency_event_id': emergency_event_id})}")
    safe_action = html.escape(action, quote=True)
    safe_message = html.escape(message)
    safe_digit = html.escape(ack_digit, quote=True)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f"<Say>{safe_message}</Say>"
        f"<Gather action=\"{safe_action}\" method=\"POST\" "
        f"numDigits=\"1\" timeout=\"10\">"
        f"<Say>Press {safe_digit} to confirm you received this emergency alert.</Say>"
        "</Gather>"
        "<Say>No confirmation received. Goodbye.</Say>"
        "</Response>"
    )


def verify_twiml_disclosure() -> dict:
    """Verify the text the inbound TwiML <Say> speaks is byte-identical
    to the pinned disclosure revision. The server calls this before
    returning voice TwiML; on drift it must serve the human fallback
    instead (fail closed — never speak an unpinned disclosure)."""
    from .policy.disclosure import current_revision, verify_disclosure_text
    from .policy.quote_guard import TEMPLATES
    revision = current_revision()
    ok = verify_disclosure_text(revision["id"], TEMPLATES["disclosure"])
    return {"ok": ok, "revision_id": revision["id"], "revision_status": revision["status"]}


def voicemail_recording_allowed(config) -> bool:
    """True only when BOTH gates pass: the operator enabled voicemail
    recording in config AND an attorney-APPROVED voicemail disclosure
    exists. Either one missing means the fallback must not record.
    (Fix round 1, P2-2: transcribe="false" disables transcription, NOT
    recording — so a <Record> in the fallback is a recording that needs
    its own approved disclosure, storage/retention decision, and
    test-number routing.)"""
    from .policy.disclosure import voicemail_recording_approved
    return bool(config.voicemail_recording_enabled) and voicemail_recording_approved()


def twiml_human_fallback(forward_e164: str | None = None, reason: str = "unavailable",
                         *, record_voicemail: bool = False) -> str:
    """Human voicemail/forwarding fallback TwiML for the TEST number.

    This is the content to host as the number's fallback (TwiML Bin or
    fallback webhook URL on the Twilio number). It must work when the
    worker is unreachable — Twilio serves it, not the worker — so the
    rollback drill verifies the number's configured fallback points at
    this content (rehearsal-only; no number is provisioned in this build).
    If a forward destination is configured, the caller is offered a human
    transfer first; otherwise straight to voicemail recording.

    Recording (fix round 1, P2-2): <Record> is rendered ONLY when
    record_voicemail is True AND the voicemail-recording policy is
    APPROVED — the builder re-checks the policy itself, so a caller
    passing True on a draft policy still gets no recording. When
    recording, the approved voicemail disclosure is spoken first. When
    not recording, the caller is told to call back — the fallback never
    promises a message it cannot take."""
    import html
    from .policy.disclosure import VOICEMAIL_RECORDING_POLICY, voicemail_recording_approved
    safe_reason = html.escape(reason, quote=True)
    record = bool(record_voicemail) and voicemail_recording_approved()
    parts = ['<?xml version="1.0" encoding="UTF-8"?>', "<Response>"]
    if record:
        parts.append("<Say>Brandy's rental office. The automated assistant is "
                     f"currently {safe_reason}. "
                     + html.escape(VOICEMAIL_RECORDING_POLICY["text"]) + "</Say>")
    else:
        parts.append("<Say>Brandy's rental office. The automated assistant is "
                     f"currently {safe_reason}. No one is available to take your call right now. "
                     "Please call back later and Brandy will help you.</Say>")
    if forward_e164:
        safe_forward = html.escape(forward_e164, quote=True)
        parts.append(f"<Dial timeout=\"20\">{safe_forward}</Dial>")
    if record:
        parts.append("<Record maxLength=\"120\" playBeep=\"true\" "
                     "transcribe=\"false\" />")
    parts.append("<Say>Thank you. Goodbye.</Say>")
    parts.append("</Response>")
    return "".join(parts)


def twiml_transfer(forward_e164: str, *, timeout_s: int = 20,
                   record_voicemail: bool = False) -> str:
    """TwiML: transfer the caller to a human number, then fall back to
    voicemail if nobody answers. Voicemail records only when
    record_voicemail is True AND the voicemail-recording policy is
    APPROVED (see twiml_human_fallback); otherwise the caller is told
    to call back."""
    import html
    from .policy.disclosure import VOICEMAIL_RECORDING_POLICY, voicemail_recording_approved
    safe_forward = html.escape(forward_e164, quote=True)
    record = bool(record_voicemail) and voicemail_recording_approved()
    parts = ['<?xml version="1.0" encoding="UTF-8"?>', "<Response>",
             "<Say>Transferring you to Brandy now.</Say>",
             f"<Dial timeout=\"{int(timeout_s)}\">{safe_forward}</Dial>"]
    if record:
        parts.append("<Say>" + html.escape(VOICEMAIL_RECORDING_POLICY["text"]) + "</Say>")
        parts.append("<Record maxLength=\"120\" playBeep=\"true\" transcribe=\"false\" />")
    else:
        parts.append("<Say>Brandy could not be reached. No one is available "
                     "to take a message right now. Please call back later.</Say>")
    parts.append("<Say>Thank you. Goodbye.</Say>")
    parts.append("</Response>")
    return "".join(parts)


def twiml_voicemail(*, max_length_s: int = 120, record_voicemail: bool = False) -> str:
    """TwiML: voicemail-only (no forward destination configured).
    Records only when record_voicemail is True AND the
    voicemail-recording policy is APPROVED (see twiml_human_fallback);
    otherwise the caller is told to call back — a voicemail box that
    cannot record takes no message."""
    import html
    from .policy.disclosure import VOICEMAIL_RECORDING_POLICY, voicemail_recording_approved
    record = bool(record_voicemail) and voicemail_recording_approved()
    parts = ['<?xml version="1.0" encoding="UTF-8"?>', "<Response>"]
    if record:
        parts.append("<Say>" + html.escape(VOICEMAIL_RECORDING_POLICY["text"]) + "</Say>")
        parts.append(f"<Record maxLength=\"{int(max_length_s)}\" playBeep=\"true\" transcribe=\"false\" />")
    else:
        parts.append("<Say>Brandy's rental office. No one is available to take "
                     "a message right now. Please call back later and Brandy will help you.</Say>")
    parts.append("<Say>Thank you. Goodbye.</Say>")
    parts.append("</Response>")
    return "".join(parts)


# --- Media Streams events -----------------------------------------------------
# Twilio sends JSON text frames: connected / start / media / stop / mark.
# The gateway validates every frame here; anything malformed is dropped
# and logged, never trusted.

MEDIA_EVENTS = ("connected", "start", "media", "stop", "mark", "clear")


def parse_media_event(raw: str | bytes) -> dict:
    """Parse + validate one Media Streams frame. Returns a normalised
    dict {"event", "call_sid", "sequence_number", "timestamp",
    "payload_b64", "custom_parameters", "stream_sid"} or raises ValueError
    for anything malformed/unknown. Audio payloads are base64 mulaw 8kHz."""
    import json
    try:
        data = json.loads(raw) if isinstance(raw, (str, bytes)) else raw
    except (ValueError, TypeError) as exc:
        raise ValueError(f"media event is not JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("media event is not an object")
    event = data.get("event")
    if event not in MEDIA_EVENTS:
        raise ValueError(f"unknown media event {event!r}")
    out = {"event": event,
           "stream_sid": data.get("streamSid"),
           "call_sid": None, "sequence_number": None, "timestamp": None,
           "payload_b64": None, "custom_parameters": {}}
    if event == "start":
        start = data.get("start") or {}
        out["stream_sid"] = start.get("streamSid") or data.get("streamSid")
        out["call_sid"] = start.get("callSid")
        out["custom_parameters"] = start.get("customParameters") or {}
        if not out["call_sid"]:
            raise ValueError("start event without callSid")
    elif event == "media":
        media = data.get("media") or {}
        out["call_sid"] = media.get("callSid")
        out["sequence_number"] = media.get("sequenceNumber")
        out["timestamp"] = media.get("timestamp")
        out["payload_b64"] = media.get("payload")
        if out["payload_b64"] is None:
            raise ValueError("media event without payload")
        if out["sequence_number"] is not None:
            try:
                out["sequence_number"] = int(out["sequence_number"])
            except (TypeError, ValueError) as exc:
                raise ValueError("media sequenceNumber is not an integer") from exc
    elif event == "stop":
        stop = data.get("stop") or {}
        out["call_sid"] = stop.get("callSid")
    return out


class MediaSequenceTracker:
    """Per-stream sequence/timestamp tracking. Media Streams can drop
    frames; a gap is recorded (and counted) but never fails the call —
    the audio is best-effort, the record is exact."""

    def __init__(self):
        self.expected_sequence: int | None = None
        self.last_timestamp: int | None = None
        self.frames = 0
        self.gaps = 0
        self.gap_details: list[dict] = []

    def observe(self, *, sequence_number: int | None, timestamp: int | None) -> dict:
        """Observe one media frame. Returns {"gap": bool, "details": ...}."""
        self.frames += 1
        gap = False
        if sequence_number is not None:
            if self.expected_sequence is not None and sequence_number != self.expected_sequence:
                gap = True
                self.gaps += 1
                self.gap_details.append({
                    "expected": self.expected_sequence, "got": sequence_number,
                    "frame": self.frames})
            self.expected_sequence = sequence_number + 1
        if timestamp is not None and self.last_timestamp is not None and timestamp < self.last_timestamp:
            gap = True
            self.gaps += 1
            self.gap_details.append({"non_monotonic_timestamp": timestamp,
                                     "last": self.last_timestamp, "frame": self.frames})
        if timestamp is not None:
            self.last_timestamp = timestamp
        return {"gap": gap, "frames": self.frames, "gaps": self.gaps}


def require_telephony(config) -> None:
    if not config.telephony_enabled:
        raise DisabledError("telephony is disabled by default; enable explicitly and only with a go-live word.")
