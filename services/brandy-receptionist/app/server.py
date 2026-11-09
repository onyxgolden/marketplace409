"""Stdlib-only HTTP server for the voice worker.

Routes:
  GET  /health          — liveness + redacted feature flags (no secrets)
                         + activation, kill switch, budget, latency,
                         disclosure revision, provider state.
  GET  /operator/status — operator view: mode, kill, budget, latency
                         receipt, active sessions, disclosure, alerts.
  POST /operator/kill   — engage the kill switch (operator token).
  POST /operator/unkill — release the kill switch (operator token).
  POST /twilio/voice    — inbound call webhook (Twilio signature verified;
                          503 while telephony is disabled, which is default;
                          OFF mode / kill / wrong number -> human fallback).
  POST /twilio/status   — call-status callbacks; idempotent via event key.
  POST /alerts/ack      — explicit human acknowledgment (DTMF / authenticated).
  GET  /config          — redacted config (no secrets).

No third-party web framework: the service must run and test with the
Python 3.12 standard library only. Vendor SDKs (Twilio/Deepgram/Cartesia/
Pipecat) are pinned in requirements.txt for go-live wiring and are NOT
imported here — the real adapters lazy-import them in app/providers.py.
"""
from __future__ import annotations

import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .activation import load_activation_state
from .config import DisabledError, ReceptionistConfig
from .cost import CostLedger, blended_minute_usd
from .integrations.alerts import (
    AlertDispatcher, AlertRefused, FakeAlertTransport, RecipientAllowlist)
from .integrations.delivery import Outbox, OutboxWorker
from .integrations.forge import ForgeIngestClient
from .kill_switch import KillSwitch, KillSwitchEngaged
from .latency import LatencyRecorder
from .pipeline import CallPipeline
from .providers import FakeLLM, FakeSTT, FakeTTS, ProviderAuthError
from .session import CallSession, idempotency_key
from .telephony_twilio import (
    require_telephony, sign_stream_token, twiml_human_fallback,
    twiml_start_stream, verify_twilio_signature, verify_twiml_disclosure)

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
        self.kill_switch = KillSwitch(self.config.kill_switch_path)
        self.cost_ledger = CostLedger(self.config.cost_ledger_path,
                                      rate_version=self.config.cost_rate_version)
        self.latency_recorder = LatencyRecorder(
            os.path.join(os.path.dirname(self.config.cost_ledger_path), "latency.jsonl"))
        self.recipient_allowlist = RecipientAllowlist.load(
            os.path.join(os.path.dirname(self.config.alert_state_path), "recipients.json"))
        self.dispatcher = dispatcher or AlertDispatcher(
            FakeAlertTransport(), ack_timeout_s=self.config.emergency_ack_timeout_s,
            max_attempts=self.config.alert_max_attempts_per_channel,
            backoff_s=self.config.alert_retry_backoff_s,
            state_path=self.config.alert_state_path,
            live_gate=self.require_live_alerting,
            recipient_allowlist=self.recipient_allowlist)
        self.budget = BudgetGuard(self.config.max_synthetic_minutes)
        self.sessions: dict[str, CallSession] = {}
        self.live_sessions: dict[str, dict] = {}
        self._seen_status_keys: set = set()
        self._lock = threading.Lock()
        self._media_gateway = None
        self.outbox = Outbox(self.config.delivery_outbox_path)
        self.outbox_worker = OutboxWorker(
            self.outbox, send_fn=self._deliver_outbox_item,
            live_gate=self.require_outbox_delivery)

    def shutdown(self) -> None:
        """Stop the escalation scheduler thread (lets tests exit cleanly)."""
        self.dispatcher.shutdown()
        self.stop_media_gateway()
        self.outbox_worker.stop()

    # -- activation / gates -----------------------------------------------------
    def activation_state(self) -> dict:
        """Effective activation mode, from the signed record (fresh read
        every call — a mode change takes effect without a restart)."""
        return load_activation_state(self.config)

    def require_live_alerting(self) -> None:
        """Live gate for outbound emergency sends. Raises AlertRefused
        when mode is OFF, the kill switch is engaged, or outbound alerts
        are disabled. Checked on dispatch AND on every attempt (including
        backup/retry waves)."""
        state = self.activation_state()
        if state["mode"] == "OFF":
            raise AlertRefused(f"activation mode OFF ({state['reason']})")
        if self.kill_switch.is_killed():
            raise AlertRefused("kill switch engaged")
        if not self.config.outbound_alerts_enabled:
            raise AlertRefused("outbound alerts disabled")

    def require_live_session(self) -> None:
        """Live gate for new AI sessions. Raises on any refusal."""
        state = self.activation_state()
        if state["mode"] == "OFF":
            raise KillSwitchEngaged(f"activation mode OFF ({state['reason']})")
        if self.kill_switch.is_killed():
            raise KillSwitchEngaged("kill switch engaged")
        self.config.require_live("telephony")
        if len(self.live_sessions) >= self.config.max_concurrent_sessions:
            raise KillSwitchEngaged("live concurrency cap reached")

    def require_outbox_delivery(self, item: dict) -> None:
        """Outbox drain gate (per item). A kill blocks everything (the
        kill switch prevents scheduled retries). Mode OFF blocks ALERT
        deliveries but NOT INGEST retries — the call record reaching
        FORGE is persistence, not a live action."""
        if self.kill_switch.is_killed():
            raise AlertRefused("kill switch engaged")
        if item.get("channel") == "ALERT":
            self.require_live_alerting()

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

    # -- operator kill switch ---------------------------------------------------
    def verify_operator(self, headers) -> None:
        """Operator token (Bearer) required for kill/unkill/status. Empty
        server token means the operator path is disabled (fail closed)."""
        token = self.config.operator_token
        if not token:
            raise ValueError("operator authentication is not configured")
        presented = (headers.get("Authorization", "") or "")
        if not presented.startswith("Bearer "):
            raise ValueError("operator authentication requires a Bearer token")
        if not hmac.compare_digest(presented[len("Bearer "):], token):
            raise ValueError("operator authentication failed")

    def handle_kill(self, *, reason: str, set_by: str) -> dict:
        """Engage the kill switch AND end every live session immediately
        (they transition to safe human fallback — the next call on the
        number hits the Twilio-level fallback, not the AI)."""
        state = self.kill_switch.kill(reason=reason, set_by=set_by)
        ended = []
        for call_sid in list(self.live_sessions):
            self.end_live_session(call_sid, "killed")
            ended.append(call_sid)
        return {"killed": True, "state": state, "sessions_ended": ended}

    def handle_unkill(self, *, reason: str, set_by: str) -> dict:
        state = self.kill_switch.clear(reason=reason, set_by=set_by)
        return {"killed": False, "state": state}

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
        """Idempotent: duplicate Twilio callbacks collapse to one event.
        On completion, the call's cost is ledgered (duration from the
        callback when present)."""
        key = idempotency_key(call_sid, f"STATUS:{status}", params.get("SequenceNumber", "0"))
        with self._lock:
            if key in self._seen_status_keys:
                return {"deduped": True}
            self._seen_status_keys.add(key)
        if status == "completed":
            duration_s = params.get("CallDuration")
            try:
                duration_s = float(duration_s) if duration_s is not None else None
            except (TypeError, ValueError):
                duration_s = None
            live = self.live_sessions.get(call_sid)
            source = (live or {}).get("source", "SYNTHETIC")
            if duration_s is not None:
                self.cost_ledger.record_call(
                    call_sid=call_sid, source=source, duration_s=duration_s)
        return {"deduped": False, "event_id": key}

    # -- live sessions (media gateway) ------------------------------------------
    def make_pipeline(self, call_sid: str, *, source: str, dialogue) -> CallPipeline:
        """Build the turn pipeline for a live session. Real adapters are
        used only when telephony is enabled AND all vendor keys are
        present; otherwise ProviderAuthError (no live session — the
        gateway refuses and Twilio falls back to human voicemail). Fakes
        are the offline/test path."""
        state = self.activation_state()
        if state["mode"] == "OFF":
            raise KillSwitchEngaged("activation mode OFF: no live pipeline")
        if self.config.telephony_enabled and os.environ.get("DEEPGRAM_API_KEY") \
                and os.environ.get("OPENAI_API_KEY") \
                and os.environ.get("CARTESIA_API_KEY") \
                and os.environ.get("CARTESIA_VOICE_ID"):
            from .providers import real_llm, real_stt, real_tts
            stt = real_stt(self.config)
            llm = real_llm(self.config)
            tts = real_tts(self.config)
        elif self.config.telephony_enabled:
            raise ProviderAuthError(
                "telephony enabled but a vendor key is missing "
                "(DEEPGRAM_API_KEY / OPENAI_API_KEY / CARTESIA_API_KEY / CARTESIA_VOICE_ID)")
        else:
            stt, llm, tts = FakeSTT(), FakeLLM(), FakeTTS()
        return CallPipeline(stt=stt, llm=llm, tts=tts, dialogue=dialogue,
                            config=self.config, cost_ledger=self.cost_ledger,
                            latency_recorder=self.latency_recorder,
                            kill_switch=self.kill_switch,
                            activation_mode=state["mode"], source=source,
                            call_sid=call_sid)

    def end_live_session(self, call_sid: str, reason: str = "completed") -> dict | None:
        """Idempotent: end a live media session, charge the budget +
        cost ledger, and ingest the call record (FORGE now, outbox on
        failure). Returns the ingest payload, or None if already ended."""
        with self._lock:
            live = self.live_sessions.pop(call_sid, None)
        if live is None:
            return None
        session: CallSession = live["session"]
        pipeline: CallPipeline = live["pipeline"]
        session.end(reason)
        duration_s = max((session.ended_at or time.time()) - session.started_at, 0)
        self.budget.charge(duration_s / 60.0)
        entry = self.cost_ledger.record_call(
            call_sid=call_sid, source=live["source"], duration_s=duration_s,
            agent_chars=pipeline.agent_chars)
        session.cost_estimate_usd = entry["estimated_usd"]
        session.cost_rate_version = entry["rate_version"]
        # Attach the emergency alert record (if any) so the FORGE ingest
        # upserts it into the alerts table — the inbox timeline's source
        # of truth. The dispatcher record is serialized here; the ingest
        # route writes it idempotently (attempt dedupe_key = attempt_id).
        event_id = session.dialogue.emergency_event_id
        if event_id:
            alert = self.dispatcher.get(event_id)
            if alert is not None:
                session.alert_record = {
                    "emergency_event_id": alert["emergency_event_id"],
                    "hazard": alert["hazard"],
                    "detected_at": alert["detected_at"],
                    "human_ack_at": alert.get("human_ack_at"),
                    "ack_method": alert.get("ack_method"),
                    "backup_attempted_at": alert.get("backup_attempted_at"),
                    # A gate-refused alert lands as REFUSED (the widened
                    # CHECK admits it); anything else uses the dispatcher's
                    # resolution_state (UNRESOLVED / ACKNOWLEDGED /
                    # DEAD_LETTER).
                    "resolution_state": "REFUSED" if alert.get("state") == "REFUSED" else alert.get("resolution_state", "UNRESOLVED"),
                    "refused_reason": alert.get("refused_reason"),
                    "attempts": [a.as_dict() for a in alert.get("attempts", [])],
                }
        payload = session.ingest_payload()
        self._ingest_or_enqueue(payload)
        return payload

    def _ingest_or_enqueue(self, payload: dict) -> None:
        """POST the call record to FORGE now; on any failure enqueue it
        in the durable outbox (never drop the record)."""
        if self.config.forge_ingest_url:
            client = ForgeIngestClient(self.config.forge_ingest_url,
                                       self.config.forge_ingest_secret)
            try:
                result = client.post(payload)
            except Exception:  # noqa: BLE001 — outbox covers it
                result = {"ok": False}
            if result.get("ok"):
                return
        self.outbox.enqueue(payload.get("idempotency_key", payload["provider_call_sid"]),
                            "INGEST", "FORGE", payload)

    def _deliver_outbox_item(self, item: dict) -> None:
        """OutboxWorker send_fn: INGEST items POST to FORGE; ALERT items
        re-dispatch through the alert dispatcher. Any exception marks the
        item failed (bounded retry, then dead-letter)."""
        channel = item.get("channel")
        if channel == "INGEST":
            if not self.config.forge_ingest_url:
                raise RuntimeError("FORGE ingest URL not configured")
            client = ForgeIngestClient(self.config.forge_ingest_url,
                                       self.config.forge_ingest_secret)
            result = client.post(item["payload"])
            if not result.get("ok"):
                raise RuntimeError("FORGE ingest failed")
            return
        if channel == "ALERT":
            payload = item["payload"] or {}
            self.dispatcher.dispatch_emergency(
                payload["emergency_event_id"], payload["hazard"], payload["message"])
            return
        raise RuntimeError(f"unknown outbox channel {channel!r}")

    def dispatch_emergency_for_session(self, call_sid: str) -> dict | None:
        """Dispatch the emergency alert for a live session's dialogue
        state. Returns the alert record (REFUSED included — the caller
        already heard the safety script; the human fallback covers the
        rest). None when the session has no emergency."""
        live = self.live_sessions.get(call_sid)
        if live is None:
            return None
        session: CallSession = live["session"]
        event_id = session.dialogue.emergency_event_id
        hazard = session.dialogue.slots.get("emergency_type")
        if not event_id or not hazard:
            return None
        from .policy.emergencies import safety_script
        message = (f"Emergency alert ({hazard}) from Brandy's rental office. "
                   f"Caller: {session.dialogue.slots.get('caller_name') or 'unknown'}. "
                   f"{safety_script(hazard)}")
        return self.dispatcher.dispatch_emergency(event_id, hazard, message)

    # -- inbound voice webhook ----------------------------------------------------
    def stream_url(self) -> str:
        """wss:// URL for the Media Streams gateway: explicit env wins,
        else derived from the worker public URL + media port. Empty when
        neither is configured (voice webhook then fails closed)."""
        explicit = os.environ.get("RECEPTIONIST_STREAM_URL", "")
        if explicit:
            return explicit
        base = self.config.worker_public_url.rstrip("/")
        if not base:
            return ""
        if base.startswith("https://"):
            base = "wss://" + base[len("https://"):]
        elif base.startswith("http://"):
            base = "ws://" + base[len("http://"):]
        return f"{base}:{self.config.media_stream_port}"

    def handle_voice_webhook(self, params: dict, url: str, signature: str) -> tuple[int, str, str]:
        """Inbound Twilio voice webhook. Returns (http_status, content_type,
        body). Fail-closed at every step: bad signature -> 403; telephony
        disabled -> 503; mode OFF / kill / wrong number / unpinned
        disclosure / no stream URL -> human-fallback TwiML (the caller
        always reaches a human path, never silence). TEST_ONLY requires
        the called number to be the dedicated test number."""
        auth_token = os.environ.get("RECEPTIONIST_TWILIO_AUTH_TOKEN", "")
        if not verify_twilio_signature(auth_token, url, params, signature):
            return 403, "application/json", json.dumps({"error": "invalid Twilio signature"})
        try:
            require_telephony(self.config)
        except DisabledError as exc:
            return 503, "application/json", json.dumps({"error": str(exc)})
        state = self.activation_state()
        called = params.get("To", "")
        if state["mode"] == "OFF":
            return 200, "text/xml", twiml_human_fallback(reason="unavailable")
        if self.kill_switch.is_killed():
            return 200, "text/xml", twiml_human_fallback(
                self.config.fallback_forward_e164 or None, reason="temporarily unavailable")
        if state["mode"] == "TEST_ONLY" and called != self.config.test_number_e164:
            return 200, "text/xml", twiml_human_fallback(reason="unavailable")
        if state["mode"] == "LIVE_APPROVED":
            live_number = os.environ.get("RECEPTIONIST_LIVE_NUMBER_E164", "")
            if live_number and called != live_number:
                return 200, "text/xml", twiml_human_fallback(reason="unavailable")
        disclosure = verify_twiml_disclosure()
        if not disclosure["ok"]:
            return 200, "text/xml", twiml_human_fallback(reason="unavailable")
        url_out = self.stream_url()
        if not url_out:
            return 200, "text/xml", twiml_human_fallback(reason="unavailable")
        call_sid = params.get("CallSid", "")
        token = sign_stream_token(self.config.stream_token_secret, call_sid,
                                  self.config.operation_id)
        return 200, "text/xml", twiml_start_stream(url_out, token)

    # -- media gateway --------------------------------------------------------------
    def start_media_gateway(self, *, host: str = "127.0.0.1") -> dict:
        if self._media_gateway is not None and self._media_gateway.running:
            return {"running": True, "port": self.config.media_stream_port}
        from .media_stream import MediaStreamGateway
        gateway = MediaStreamGateway(self, host=host, port=self.config.media_stream_port)
        gateway.start()
        self._media_gateway = gateway
        return {"running": True, "port": self.config.media_stream_port}

    def stop_media_gateway(self) -> None:
        if self._media_gateway is not None:
            self._media_gateway.stop()
            self._media_gateway = None

    @property
    def media_gateway_running(self) -> bool:
        return self._media_gateway is not None and self._media_gateway.running

    # -- health + operator status ------------------------------------------------------
    def health(self) -> dict:
        """GET /health: liveness + redacted feature flags + activation,
        kill switch, budget, latency receipt, disclosure revision, alert
        persistence. No secrets, no phone numbers."""
        state = self.activation_state()
        latency = self.latency_recorder.receipt(targets={
            "latency_p95_target_ms": self.config.latency_p95_target_ms,
            "barge_in_stop_p95_target_ms": self.config.barge_in_stop_p95_target_ms})
        from .policy.disclosure import current_revision
        revision = current_revision()
        return {"ok": True, **self.config.live_features(),
                "activation_mode": state["mode"],
                "activation_valid": state["valid"],
                "activation_reason": state["reason"],
                "kill_switch": self.kill_switch.state(),
                "budget_used_minutes": round(self.budget.used_minutes, 2),
                "cost_total_usd": self.cost_ledger.total_usd(),
                "cost_per_call_ceiling_usd": self.config.max_cost_per_call_usd,
                "cost_campaign_ceiling_usd": self.config.max_cost_campaign_usd,
                "active_calls": len(self.sessions),
                "active_live_sessions": len(self.live_sessions),
                "media_gateway_running": self.media_gateway_running,
                "alert_persistence": self.dispatcher.health(),
                "outbox_pending": self.outbox.pending_count(),
                "latency": latency,
                "disclosure_revision": {"id": revision["id"], "status": revision["status"]}}

    def operator_status(self) -> dict:
        """GET /operator/status: everything in /health plus the per-call
        cost ledger totals, unresolved alerts, and live session list
        (call SIDs + source + duration, no phone numbers)."""
        status = self.health()
        status["cost_ledger_entries"] = len(self.cost_ledger.entries())
        status["cost_by_source"] = {
            source: self.cost_ledger.total_usd(source=source)
            for source in ("TEST", "LIVE", "SYNTHETIC")}
        status["alerts_unresolved"] = self.dispatcher.health()["unresolved"]
        status["live_sessions"] = [
            {"call_sid": sid, "source": live["source"],
             "duration_s": round(time.time() - live["session"].started_at, 1)}
            for sid, live in self.live_sessions.items()]
        return status


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
                return self._json(200, server.health())
            if self.path == "/config":
                return self._json(200, config.live_features())
            if self.path == "/operator/status":
                try:
                    server.verify_operator(self.headers)
                except ValueError as exc:
                    return self._json(403, {"error": str(exc)})
                return self._json(200, server.operator_status())
            return self._json(404, {"error": "not found"})

        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path == "/twilio/voice":
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                params = {k: v[0] for k, v in parse_qs(raw.decode()).items()}
                url = f"https://{self.headers.get('Host', '')}{self.path}"
                status, content_type, body = server.handle_voice_webhook(
                    params, url, self.headers.get("X-Twilio-Signature", ""))
                encoded = body.encode()
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)
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
            if parsed.path in ("/operator/kill", "/operator/unkill"):
                try:
                    server.verify_operator(self.headers)
                except ValueError as exc:
                    return self._json(403, {"error": str(exc)})
                body = self._read_json()
                reason = str(body.get("reason", "operator action"))
                set_by = str(body.get("set_by", "operator"))
                if parsed.path == "/operator/kill":
                    return self._json(200, server.handle_kill(reason=reason, set_by=set_by))
                return self._json(200, server.handle_unkill(reason=reason, set_by=set_by))
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
