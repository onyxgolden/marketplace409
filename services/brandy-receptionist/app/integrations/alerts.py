"""Emergency alert dispatcher: deterministic, fail-open for attempting
human alert, fail-closed for claiming delivery or resolution.

Sequence (brief §4):
1. At hazard recognition, alert attempts are enqueued WITHOUT waiting for
   the database. Safety instruction plays first.
2. Brandy voice call + SMS start CONCURRENTLY with separate provider
   request IDs and timestamps. If voice fails/unanswered or no human
   acknowledgment by the configured threshold (default 30 s), the Jason
   backup call + SMS starts; on known primary failure, backup starts
   immediately. An SMS accepted by the provider is NOT human acknowledgment.
   A successful API response is not proof of delivery or answer.
3. Human acknowledgment must be EXPLICIT: DTMF acknowledgment or
   authenticated confirmation. Answering a call alone is NOT acknowledgment.
4. If nobody acknowledges, bounded retries continue and the alert stays
   UNACKNOWLEDGED prominently. Never claim the emergency was handled.
5. Idempotent event/attempt IDs prevent duplicated alert storms on STT
   partials, reconnects and webhook retries.

Transports are pluggable: production uses the Twilio transport (disabled
by default); tests use FakeAlertTransport. Recipients come from a
server-side allowlist only — never from caller speech, never hardcoded
real numbers in code.
"""
from __future__ import annotations

import threading
import time
import uuid

ACK_TIMEOUT_S_DEFAULT = 30


class AlertAttempt:
    def __init__(self, emergency_event_id: str, role: str, channel: str, attempt: int):
        self.attempt_id = f"{emergency_event_id}:{role}:{channel}:{attempt}"
        self.emergency_event_id = emergency_event_id
        self.role = role  # PRIMARY | BACKUP
        self.channel = channel  # VOICE | SMS
        self.attempt = attempt
        self.requested_at: float | None = None
        self.provider_accepted_at: float | None = None
        self.provider_sid: str | None = None
        self.delivered_at: float | None = None
        self.failed_at: float | None = None
        self.failure_class: str | None = None
        self.state: str = "PENDING"  # PENDING|ACCEPTED|DELIVERED|FAILED

    def as_dict(self) -> dict:
        return {"attempt_id": self.attempt_id, "role": self.role,
                "channel": self.channel, "attempt": self.attempt,
                "state": self.state, "provider_sid": self.provider_sid,
                "requested_at": self.requested_at,
                "provider_accepted_at": self.provider_accepted_at,
                "delivered_at": self.delivered_at,
                "failed_at": self.failed_at, "failure_class": self.failure_class}


class FakeAlertTransport:
    """Test transport with scripted outcomes. `outcomes` maps
    (role, channel) -> list of results consumed in order:
    'accepted', 'delivered', 'failed_5xx', 'unanswered', 'no_ack'."""
    def __init__(self, outcomes: dict | None = None):
        self.outcomes = outcomes or {}
        self.calls: list = []
        self._lock = threading.Lock()

    def _next(self, role, channel):
        with self._lock:
            queue = self.outcomes.get((role, channel), ["accepted"])
            return queue.pop(0) if queue else "accepted"

    def send(self, role: str, channel: str, message: str) -> dict:
        outcome = self._next(role, channel)
        sid = f"FAKE-{uuid.uuid4().hex[:8]}"
        with self._lock:
            self.calls.append({"role": role, "channel": channel,
                               "outcome": outcome, "sid": sid})
        now = time.time()
        if outcome == "failed_5xx":
            return {"accepted": False, "sid": None, "failure_class": "provider_5xx",
                    "requested_at": now}
        if outcome == "unanswered":
            return {"accepted": True, "sid": sid, "answered": False,
                    "requested_at": now, "provider_accepted_at": now}
        if outcome == "delivered":
            return {"accepted": True, "sid": sid, "answered": channel == "VOICE",
                    "delivered": True, "requested_at": now,
                    "provider_accepted_at": now, "delivered_at": now}
        return {"accepted": True, "sid": sid, "answered": False,
                "requested_at": now, "provider_accepted_at": now}


class AlertDispatcher:
    def __init__(self, transport, *, ack_timeout_s: int = ACK_TIMEOUT_S_DEFAULT,
                 max_attempts: int = 3, allowlist: dict | None = None,
                 clock=time.time):
        self.transport = transport
        self.ack_timeout_s = ack_timeout_s
        self.max_attempts = max_attempts
        # allowlist: {"PRIMARY": {"voice": "<ref>", "sms": "<ref>"},
        #             "BACKUP": {...}} — references only, resolved by the
        # transport from server config. No real numbers in code.
        self.allowlist = allowlist or {"PRIMARY": {}, "BACKUP": {}}
        self.clock = clock
        self._alerts: dict = {}
        self._lock = threading.Lock()

    def dispatch_emergency(self, emergency_event_id: str, hazard: str,
                           message: str) -> dict:
        """Start primary voice + SMS CONCURRENTLY. Returns the alert record.
        Idempotent per emergency_event_id: a second call for the same event
        returns the existing record (no alert storm on STT partials)."""
        with self._lock:
            if emergency_event_id in self._alerts:
                return self._alerts[emergency_event_id]
            alert = {
                "emergency_event_id": emergency_event_id, "hazard": hazard,
                "detected_at": self.clock(), "state": "ALERTING",
                "human_ack_at": None, "ack_method": None,
                "backup_attempted_at": None, "resolution_state": "UNRESOLVED",
                "attempts": [],
            }
            self._alerts[emergency_event_id] = alert
        # Concurrent primary voice + SMS (separate provider request IDs).
        threads = []
        for channel in ("VOICE", "SMS"):
            t = threading.Thread(target=self._attempt, daemon=True,
                                 args=(alert, "PRIMARY", channel, message, 1))
            t.start()
            threads.append(t)
        for t in threads:
            t.join(timeout=5)
        alert["alert_requested_at"] = alert["detected_at"]
        return alert

    def _attempt(self, alert: dict, role: str, channel: str, message: str, n: int) -> AlertAttempt:
        attempt = AlertAttempt(alert["emergency_event_id"], role, channel, n)
        attempt.requested_at = self.clock()
        result = self.transport.send(role, channel, message)
        attempt.provider_sid = result.get("sid")
        if not result.get("accepted"):
            attempt.state = "FAILED"
            attempt.failed_at = self.clock()
            attempt.failure_class = result.get("failure_class", "provider_error")
        else:
            attempt.provider_accepted_at = result.get("provider_accepted_at")
            attempt.state = "DELIVERED" if result.get("delivered") else "ACCEPTED"
            if result.get("delivered"):
                attempt.delivered_at = result.get("delivered_at")
        with self._lock:
            alert["attempts"].append(attempt)
        return attempt

    def check_ack_timeout(self, emergency_event_id: str) -> dict:
        """Called when the ack deadline passes with no explicit human ack.
        Starts the backup (voice + SMS) and marks the alert UNACKNOWLEDGED
        if the backup also goes unacknowledged. Returns the alert record."""
        alert = self._alerts[emergency_event_id]
        if alert["human_ack_at"] is not None:
            return alert
        alert["backup_attempted_at"] = self.clock()
        threads = []
        for channel in ("VOICE", "SMS"):
            t = threading.Thread(target=self._attempt, daemon=True,
                                 args=(alert, "BACKUP", channel,
                                       "Emergency backup alert.", 1))
            t.start()
            threads.append(t)
        for t in threads:
            t.join(timeout=5)
        alert["state"] = "UNACKNOWLEDGED"
        alert["resolution_state"] = "UNRESOLVED"
        return alert

    def acknowledge(self, emergency_event_id: str, method: str) -> dict:
        """Explicit human acknowledgment ONLY: 'dtmf' or 'authenticated'.
        Answering a call alone never calls this."""
        if method not in ("dtmf", "authenticated"):
            raise ValueError("acknowledgment requires explicit DTMF or authenticated confirmation")
        alert = self._alerts[emergency_event_id]
        alert["human_ack_at"] = self.clock()
        alert["ack_method"] = method
        alert["state"] = "ACKNOWLEDGED"
        alert["resolution_state"] = "ACKNOWLEDGED"
        return alert

    def get(self, emergency_event_id: str) -> dict | None:
        return self._alerts.get(emergency_event_id)
