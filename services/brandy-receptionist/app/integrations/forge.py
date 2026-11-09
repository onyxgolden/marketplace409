"""Signed FORGE ingestion client (service -> FORGE).

Service→FORGE ingestion uses an HMAC-signed body with timestamp + nonce
and replay protection. Never a public Supabase service-role key in the
voice worker. The FORGE side verifies in
`src/lib/receptionist/ingestAuth.js` and rejects stale/forged requests.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.request
import uuid

REPLAY_WINDOW_S = 300


def sign_body(secret: str, body: bytes, timestamp: int, nonce: str) -> str:
    msg = f"{timestamp}.{nonce}.".encode() + body
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def verify_signature(secret: str, body: bytes, timestamp: int, nonce: str,
                     signature: str, *, now: int | None = None,
                     window_s: int = REPLAY_WINDOW_S) -> bool:
    """Server-side verification (mirrored in JS). Rejects stale timestamps
    and mismatched signatures with a constant-time compare."""
    now = now if now is not None else int(time.time())
    if abs(now - timestamp) > window_s:
        return False
    expected = sign_body(secret, body, timestamp, nonce)
    return hmac.compare_digest(expected, signature or "")


class ForgeIngestClient:
    def __init__(self, ingest_url: str, secret: str, timeout_s: int = 10):
        self.ingest_url = ingest_url
        self.secret = secret
        self.timeout_s = timeout_s

    def post(self, payload: dict) -> dict:
        body = json.dumps(payload, sort_keys=True).encode()
        timestamp = int(time.time())
        nonce = uuid.uuid4().hex
        req = urllib.request.Request(
            self.ingest_url, data=body, method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Forge-Timestamp": str(timestamp),
                "X-Forge-Nonce": nonce,
                "X-Forge-Signature": sign_body(self.secret, body, timestamp, nonce),
            })
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                return {"ok": True, "status": resp.status,
                        "body": json.loads(resp.read() or b"{}")}
        except Exception as exc:  # network down -> durable outbox, never lost
            return {"ok": False, "error": type(exc).__name__, "detail": str(exc)[:200]}
