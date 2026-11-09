"""Stdlib-only HTTP server for the voice worker.

Routes:
  GET  /health        — liveness + redacted feature flags (no secrets).
  POST /twilio/voice  — inbound call webhook (Twilio signature verified;
                        503 while telephony is disabled, which is default).
  POST /twilio/status — call-status callbacks; idempotent via event key.
  POST /alerts/ack    — explicit human acknowledgment (DTMF / authenticated).
  GET  /config        — redacted config (no secrets).

No third-party web framework: the service must run and test with the
Python 3.12 standard library only. Vendor SDKs (Twilio/Deepgram/Cartesia/
Pipecat) are pinned in requirements.txt for go-live wiring and are NOT
imported here.
"""
from __future__ import annotations

import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .config import DisabledError, ReceptionistConfig
from .integrations.alerts import AlertDispatcher, FakeAlertTransport
from .session import CallSession, idempotency_key
from .telephony_twilio import require_telephony, twiml_start_stream, verify_twilio_signature

MAX_CONCURRENT_CALLS = 10


class BudgetGuard:
    """Synthetic-test spend cap (§11.14): deny new non-emergency sessions
    once the configured minute budget is reached. Emergency sessions are
    never denied by budget."""
    def __init__(self, max_minutes: float):
        self.max_minutes = max_minutes
        self.used_minutes = 0.0
        self._lock = threading.Lock()

    def allow(self, minutes: float = 1.0, emergency: bool = False) -> bool:
        if emergency:
            return True
        with self._lock:
            return self.used_minutes + minutes <= self.max_minutes

    def charge(self, minutes: float) -> None:
        with self._lock:
            self.used_minutes += minutes


class ReceptionistServer:
    def __init__(self, config: ReceptionistConfig | None = None,
                 dispatcher: AlertDispatcher | None = None):
        self.config = config or ReceptionistConfig()
        self.dispatcher = dispatcher or AlertDispatcher(
            FakeAlertTransport(), ack_timeout_s=self.config.emergency_ack_timeout_s,
            max_attempts=self.config.alert_max_attempts_per_channel,
            backoff_s=self.config.alert_retry_backoff_s,
            state_path=self.config.alert_state_path)
        self.budget = BudgetGuard(self.config.max_synthetic_minutes)
        self.sessions: dict[str, CallSession] = {}
        self._seen_status_keys: set = set()
        self._lock = threading.Lock()

    def shutdown(self) -> None:
        """Stop the escalation scheduler thread (lets tests exit cleanly)."""
        self.dispatcher.shutdown()

    # -- emergency acknowledgment verification (P1-3) -------------------------
    def verify_alert_ack(self, method: str, params: dict, headers,
                         url: str) -> tuple[str, str | None, str | None]:
        """Fail closed: return (method, call_sid, actor_ref) for a verified
        acknowledgment, or raise ValueError. Two verified paths only:
        - dtmf: Twilio-signed form callback, Digits == the configured ack
          digit, CallSid bound to a recorded attempt for this event.
        - authenticated: Bearer operator token from server env.
        Anything else (unsigned, forged, wrong call, wrong digit, unknown
        event) raises and changes no alert state."""
        if method == "dtmf":
            auth_token = os.environ.get("RECEPTIONIST_TWILIO_AUTH_TOKEN", "")
            signature = headers.get("X-Twilio-Signature", "")
            if not verify_twilio_signature(auth_token, url, params, signature):
                raise ValueError("DTMF acknowledgment failed Twilio signature verification")
            if params.get("Digits", "") != self.config.ack_digit:
                raise ValueError("DTMF acknowledgment requires the configured ack digit")
            call_sid = params.get("CallSid", "")
            if not call_sid:
                raise ValueError("DTMF acknowledgment requires the alert call SID")
            return "dtmf", call_sid, f"twilio:{call_sid}"
        if method == "authenticated":
            token = self.config.operator_token
            if not token:
                raise ValueError("authenticated acknowledgment is not configured")
            presented = (headers.get("Authorization", "") or "")
            if not presented.startswith("Bearer "):
                raise ValueError("authenticated acknowledgment requires a Bearer token")
            if not hmac.compare_digest(presented[len("Bearer "):], token):
                raise ValueError("authenticated acknowledgment failed operator token verification")
            return "authenticated", None, "operator"
        raise ValueError("acknowledgment requires explicit DTMF or authenticated confirmation")

    def handle_alert_ack(self, params: dict, headers, url: str) -> dict:
        """Verify, then acknowledge. Unknown events 404; every failed
        verification is a 403 with no state change."""
        event_id = params.get("emergency_event_id", "")
        method = params.get("method", "")
        if not event_id:
            raise ValueError("emergency_event_id is required")
        verified_method, call_sid, actor_ref = self.verify_alert_ack(
            method, params, headers, url)
        try:
            alert = self.dispatcher.acknowledge(
                event_id, verified_method, call_sid=call_sid, actor_ref=actor_ref)
        except KeyError:
            raise LookupError("no such emergency event") from None
        return {"ok": True, "state": alert["state"]}

    # -- call lifecycle ---------------------------------------------------------
    def start_call(self, call_sid: str, ani: str | None = None, emergency: bool = False) -> CallSession:
        with self._lock:
            if len(self.sessions) >= MAX_CONCURRENT_CALLS:
                raise RuntimeError("concurrency cap reached")
            if not self.budget.allow(emergency=emergency):
                raise RuntimeError("synthetic budget cap reached; new non-emergency sessions denied")
            session = CallSession(call_sid, ani=ani, config=self.config)
            self.sessions[call_sid] = session
            return session

    def end_call(self, call_sid: str, reason: str = "completed") -> dict | None:
        with self._lock:
            session = self.sessions.pop(call_sid, None)
        if session is None:
            return None
        self.budget.charge(max((session.ended_at or time.time()) - session.started_at, 0) / 60.0)
        return session.end(reason)

    def handle_status_callback(self, call_sid: str, status: str, params: dict) -> dict:
        """Idempotent: duplicate Twilio callbacks collapse to one event."""
        key = idempotency_key(call_sid, f"STATUS:{status}", params.get("SequenceNumber", "0"))
        with self._lock:
            if key in self._seen_status_keys:
                return {"deduped": True}
            self._seen_status_keys.add(key)
        return {"deduped": False, "event_id": key}


def make_handler(server: ReceptionistServer):
    config = server.config

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # keep logs structured, no raw bodies
            pass

        def _json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                return json.loads(raw or b"{}")
            except ValueError:
                return {}

        def _read_ack_params(self) -> tuple[dict, str]:
            """Ack callbacks arrive either as Twilio form-encoded POSTs
            (DTMF: CallSid + Digits + X-Twilio-Signature) or as JSON
            (authenticated operator confirmation). Returns (params, url)
            where url is the exact public URL Twilio signed."""
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            content_type = self.headers.get("Content-Type", "")
            if "application/x-www-form-urlencoded" in content_type:
                params = {k: v[0] for k, v in parse_qs(raw.decode()).items()}
            else:
                try:
                    params = json.loads(raw or b"{}")
                except ValueError:
                    params = {}
                params = {k: str(v) for k, v in params.items()}
            # Query-string params (the alert TwiML carries emergency_event_id
            # in the action URL) merge under body params.
            query = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            merged = {**query, **params}
            url = f"https://{self.headers.get('Host', '')}{self.path}"
            return merged, url

        def do_GET(self):
            if self.path == "/health":
                return self._json(200, {"ok": True, **config.live_features(),
                                        "budget_used_minutes": round(server.budget.used_minutes, 2),
                                        "active_calls": len(server.sessions)})
            if self.path == "/config":
                return self._json(200, config.live_features())
            return self._json(404, {"error": "not found"})

        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path == "/twilio/voice":
                try:
                    require_telephony(config)
                except DisabledError as exc:
                    return self._json(503, {"error": str(exc)})
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                params = {k: v[0] for k, v in parse_qs(raw.decode()).items()}
                url = f"https://{self.headers.get('Host', '')}{self.path}"
                from .telephony_twilio import sign_stream_token
                import os
                token_secret = os.environ.get("RECEPTIONIST_STREAM_TOKEN_SECRET", "")
                if not verify_twilio_signature(
                        os.environ.get("RECEPTIONIST_TWILIO_AUTH_TOKEN", ""), url,
                        params, self.headers.get("X-Twilio-Signature", "")):
                    return self._json(403, {"error": "invalid Twilio signature"})
                call_sid = params.get("CallSid", "")
                stream_url = os.environ.get("RECEPTIONIST_STREAM_URL", "")
                token = sign_stream_token(token_secret, call_sid, config.operation_id)
                twiml = twiml_start_stream(stream_url, token)
                body = twiml.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/xml")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if parsed.path == "/twilio/status":
                try:
                    require_telephony(config)
                except DisabledError as exc:
                    return self._json(503, {"error": str(exc)})
                body = self._read_json()
                return self._json(200, server.handle_status_callback(
                    body.get("CallSid", ""), body.get("CallStatus", ""), body))
            if parsed.path == "/alerts/ack":
                # Verified acknowledgment only (P1-3): unsigned, forged,
                # wrong-call or wrong-digit callbacks change nothing.
                params, url = self._read_ack_params()
                try:
                    return self._json(200, server.handle_alert_ack(params, self.headers, url))
                except LookupError as exc:
                    return self._json(404, {"error": str(exc)})
                except ValueError as exc:
                    return self._json(403, {"error": str(exc)})
            return self._json(404, {"error": "not found"})

    return Handler


def serve(host: str = "127.0.0.1", port: int = 8080,
          config: ReceptionistConfig | None = None) -> ThreadingHTTPServer:
    server = ReceptionistServer(config)
    httpd = ThreadingHTTPServer((host, port), make_handler(server))
    print(f"brandy-receptionist listening on {host}:{port} "
          f"(telephony_enabled={server.config.telephony_enabled})")
    try:
        httpd.serve_forever()
    finally:
        server.shutdown()
    return httpd


if __name__ == "__main__":
    serve()
