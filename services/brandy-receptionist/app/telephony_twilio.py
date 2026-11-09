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


def require_telephony(config) -> None:
    if not config.telephony_enabled:
        raise DisabledError("telephony is disabled by default; enable explicitly and only with a go-live word.")
