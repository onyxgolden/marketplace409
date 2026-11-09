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

Escalation durability (fix round 1, P1-4): the ack deadline is armed on a
dedicated scheduler thread the moment an alert dispatches — no external
caller is needed to start backup. Backup escalation is claimed exactly
once (atomic backup-once claim); repeated timeout checks collapse to the
same wave. Alert state persists to a JSON file on every mutation, so a
worker restart reloads unresolved alerts and re-arms their deadlines
instead of dropping them. Retries are bounded by max_attempts per
channel; an alert that exhausts them becomes DEAD_LETTER, still
UNRESOLVED, never silently closed.

Acknowledgment binding (fix round 1, P1-3): a DTMF ack is only accepted
when it names the provider SID of a recorded alert attempt for that
emergency event. An unbound event id, a wrong call SID, or an unsigned
callback can never resolve an alert.

Transports are pluggable: production uses the Twilio transport (disabled
by default); tests use FakeAlertTransport. Recipients come from a
server-side allowlist only — never from caller speech, never hardcoded
real numbers in code.
"""
from __future__ import annotations

import json
import os
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
        # answered: the provider reports a human answered the voice call.
        # call_completed: the call leg finished (unanswered is terminal;
        # an in-flight "accepted" leg has call_completed False).
        self.answered: bool = False
        self.call_completed: bool = False
        self.state: str = "PENDING"  # PENDING|ACCEPTED|DELIVERED|FAILED

    def as_dict(self) -> dict:
        return {"attempt_id": self.attempt_id,
                "emergency_event_id": self.emergency_event_id,
                "role": self.role,
                "channel": self.channel, "attempt": self.attempt,
                "state": self.state, "provider_sid": self.provider_sid,
                "requested_at": self.requested_at,
                "provider_accepted_at": self.provider_accepted_at,
                "delivered_at": self.delivered_at,
                "failed_at": self.failed_at, "failure_class": self.failure_class,
                "answered": self.answered, "call_completed": self.call_completed}

    @classmethod
    def from_dict(cls, data: dict) -> "AlertAttempt":
        # Older state files (pre-fix) omitted emergency_event_id; recover
        # it from the attempt_id prefix "event:role:channel:attempt".
        event_id = data.get("emergency_event_id")
        if not event_id:
            event_id = data["attempt_id"].split(":")[0]
        attempt = cls(event_id, data["role"], data["channel"], data["attempt"])
        attempt.requested_at = data.get("requested_at")
        attempt.provider_accepted_at = data.get("provider_accepted_at")
        attempt.provider_sid = data.get("provider_sid")
        attempt.delivered_at = data.get("delivered_at")
        attempt.failed_at = data.get("failed_at")
        attempt.failure_class = data.get("failure_class")
        attempt.answered = bool(data.get("answered", False))
        attempt.call_completed = bool(data.get("call_completed", False))
        attempt.state = data.get("state", "PENDING")
        return attempt


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
                    "requested_at": now, "call_completed": True}
        if outcome == "unanswered":
            return {"accepted": True, "sid": sid, "answered": False,
                    "call_completed": True,
                    "requested_at": now, "provider_accepted_at": now}
        if outcome == "delivered":
            return {"accepted": True, "sid": sid, "answered": channel == "VOICE",
                    "call_completed": True, "delivered": True,
                    "requested_at": now, "provider_accepted_at": now,
                    "delivered_at": now}
        return {"accepted": True, "sid": sid, "answered": False,
                "call_completed": False,
                "requested_at": now, "provider_accepted_at": now}


class EscalationScheduler:
    """Dedicated ack-deadline timer (P1-4). The dispatcher arms one entry
    per unresolved alert; the thread wakes at the deadline and runs the
    timeout check. No external caller is needed to start backup. Uses
    wall-clock time; tests that inject a fake dispatcher clock must
    disable the scheduler and drive check_ack_timeout directly."""
    def __init__(self, dispatcher: "AlertDispatcher"):
        self.dispatcher = dispatcher
        self._cond = threading.Condition()
        self._due: dict[str, float] = {}
        self._stopped = False
        self._thread = threading.Thread(target=self._run, daemon=True,
                                        name="receptionist-escalation")

    def start(self) -> None:
        if not self._thread.is_alive():
            self._thread.start()

    def arm(self, event_id: str, at: float) -> None:
        with self._cond:
            current = self._due.get(event_id)
            if current is None or at < current:
                self._due[event_id] = at
            self._cond.notify_all()
        self.start()

    def disarm(self, event_id: str) -> None:
        with self._cond:
            self._due.pop(event_id, None)
            self._cond.notify_all()

    def stop(self) -> None:
        with self._cond:
            self._stopped = True
            self._cond.notify_all()
        self._thread.join(timeout=2)

    def _run(self) -> None:
        while True:
            with self._cond:
                while not self._stopped and not self._due:
                    self._cond.wait()
                if self._stopped:
                    return
                now = time.time()
                next_at = min(self._due.values())
                if next_at > now:
                    self._cond.wait(timeout=next_at - now)
                    continue
                due_now = [eid for eid, at in self._due.items() if at <= time.time()]
                for eid in due_now:
                    del self._due[eid]
            for event_id in due_now:
                try:
                    self.dispatcher.check_ack_timeout(event_id)
                except (KeyError, ValueError):
                    pass  # alert resolved or gone; nothing to escalate


class AlertDispatcher:
    def __init__(self, transport, *, ack_timeout_s: int = ACK_TIMEOUT_S_DEFAULT,
                 max_attempts: int = 3, allowlist: dict | None = None,
                 clock=time.time, backoff_s: tuple = (5, 15, 60),
                 state_path: str | None = None, scheduler_enabled: bool = True):
        self.transport = transport
        self.ack_timeout_s = ack_timeout_s
        self.max_attempts = max_attempts
        # allowlist: {"PRIMARY": {"voice": "<ref>", "sms": "<ref>"},
        #             "BACKUP": {...}} — references only, resolved by the
        # transport from server config. No real numbers in code.
        self.allowlist = allowlist or {"PRIMARY": {}, "BACKUP": {}}
        self.clock = clock
        self.backoff_s = backoff_s
        self.state_path = state_path
        self._alerts: dict = {}
        self._lock = threading.Lock()
        self._scheduler = EscalationScheduler(self) if scheduler_enabled else None
        self._load_state()

    # -- durable state ---------------------------------------------------------
    def _serialize_alert(self, alert: dict) -> dict:
        data = {k: v for k, v in alert.items() if k != "attempts"}
        data["attempts"] = [a.as_dict() for a in alert["attempts"]]
        return data

    def _persist(self) -> None:
        if not self.state_path:
            return
        try:
            directory = os.path.dirname(self.state_path)
            if directory:
                os.makedirs(directory, exist_ok=True)
            tmp = f"{self.state_path}.tmp"
            with open(tmp, "w") as fh:
                json.dump([self._serialize_alert(a) for a in self._alerts.values()], fh)
            os.replace(tmp, self.state_path)
        except OSError:
            pass  # persistence is best-effort; in-memory state still works

    def _load_state(self) -> None:
        if not self.state_path or not os.path.exists(self.state_path):
            return
        try:
            with open(self.state_path) as fh:
                records = json.load(fh)
        except (ValueError, OSError):
            return
        for data in records:
            attempts = [AlertAttempt.from_dict(a) for a in data.pop("attempts", [])]
            data["attempts"] = attempts
            data.setdefault("backup_claimed", False)
            data.setdefault("backup_waves", 0)
            data.setdefault("next_retry_at", None)
            data.setdefault("actor_ref", None)
            self._alerts[data["emergency_event_id"]] = data
        # Re-arm deadlines for anything still unresolved: a restart must
        # resume escalation, never silently drop a pending alert.
        if self._scheduler is not None:
            for alert in self._alerts.values():
                if alert.get("human_ack_at") is None and alert.get("state") != "DEAD_LETTER":
                    deadline = alert.get("next_retry_at")
                    if deadline is None:
                        deadline = alert["detected_at"] + self.ack_timeout_s
                    self._scheduler.arm(alert["emergency_event_id"], max(deadline, time.time()))

    def shutdown(self) -> None:
        if self._scheduler is not None:
            self._scheduler.stop()

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
                "human_ack_at": None, "ack_method": None, "actor_ref": None,
                "backup_attempted_at": None, "resolution_state": "UNRESOLVED",
                "backup_claimed": False, "backup_waves": 0, "next_retry_at": None,
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
        self._persist()
        # Arm the ack deadline: backup starts on the scheduler even if no
        # other code ever calls check_ack_timeout.
        if self._scheduler is not None:
            self._scheduler.arm(emergency_event_id,
                                alert["detected_at"] + self.ack_timeout_s)
        # Immediate backup on known primary failure: a hard provider
        # failure, or a voice leg that completed without an answer, does
        # not wait out the ack deadline.
        primary = [a for a in alert["attempts"] if a.role == "PRIMARY"]
        failed = any(a.state == "FAILED" for a in primary)
        voice_unanswered = any(
            a.channel == "VOICE" and a.call_completed and not a.answered
            for a in primary)
        if failed or voice_unanswered:
            self.check_ack_timeout(emergency_event_id)
        return alert

    def _attempt(self, alert: dict, role: str, channel: str, message: str, n: int) -> AlertAttempt:
        attempt = AlertAttempt(alert["emergency_event_id"], role, channel, n)
        attempt.requested_at = self.clock()
        result = self.transport.send(role, channel, message)
        attempt.provider_sid = result.get("sid")
        attempt.answered = bool(result.get("answered", False))
        attempt.call_completed = bool(result.get("call_completed", False))
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
        self._persist()
        return attempt

    def _start_backup_wave(self, alert: dict) -> None:
        """One backup voice + SMS wave. Caller must already hold the
        backup-once claim and have incremented backup_waves."""
        alert["backup_attempted_at"] = self.clock()
        attempt_no = 1 + alert["backup_waves"]
        threads = []
        for channel in ("VOICE", "SMS"):
            t = threading.Thread(target=self._attempt, daemon=True,
                                 args=(alert, "BACKUP", channel,
                                       "Emergency backup alert.", attempt_no))
            t.start()
            threads.append(t)
        for t in threads:
            t.join(timeout=5)

    def check_ack_timeout(self, emergency_event_id: str) -> dict:
        """Called when the ack deadline passes with no explicit human ack.
        Starts the backup (voice + SMS) and marks the alert UNACKNOWLEDGED
        if the backup also goes unacknowledged. Returns the alert record.

        Backup-once claim: the first call claims the backup wave; repeated
        calls collapse to the same wave and never start a duplicate one.
        Later calls only start a bounded retry wave when its backoff has
        elapsed and attempts remain; exhausting the bound dead-letters the
        alert (still UNRESOLVED, never silently closed)."""
        with self._lock:
            alert = self._alerts[emergency_event_id]
            if alert["human_ack_at"] is not None:
                return alert
            if alert["state"] == "DEAD_LETTER":
                return alert
            if not alert["backup_claimed"]:
                alert["backup_claimed"] = True
                alert["backup_waves"] = 1
                wave = True
            elif (alert["backup_waves"] < self.max_attempts - 1
                    and alert["next_retry_at"] is not None
                    and self.clock() >= alert["next_retry_at"]):
                alert["backup_waves"] += 1
                wave = True
            else:
                return alert
        if wave:
            self._start_backup_wave(alert)
        with self._lock:
            if alert["human_ack_at"] is not None:
                return alert
            if alert["backup_waves"] >= self.max_attempts - 1:
                alert["state"] = "DEAD_LETTER"
                alert["resolution_state"] = "DEAD_LETTER"
                alert["next_retry_at"] = None
            else:
                backoff = self.backoff_s[min(alert["backup_waves"] - 1,
                                             len(self.backoff_s) - 1)]
                alert["state"] = "UNACKNOWLEDGED"
                alert["resolution_state"] = "UNRESOLVED"
                alert["next_retry_at"] = self.clock() + backoff
                if self._scheduler is not None:
                    self._scheduler.arm(emergency_event_id, alert["next_retry_at"])
            self._persist()
            return alert

    def acknowledge(self, emergency_event_id: str, method: str, *,
                    call_sid: str | None = None,
                    actor_ref: str | None = None) -> dict:
        """Explicit human acknowledgment ONLY: 'dtmf' or 'authenticated'.
        Answering a call alone never calls this. A DTMF ack must be bound
        to a recorded alert attempt: the caller supplies the provider SID
        of the alert call that carried the DTMF digit, and it must match
        an attempt for this event — an unbound event id or wrong call SID
        can never resolve an alert. Idempotent: an already-acknowledged
        alert returns unchanged."""
        if method not in ("dtmf", "authenticated"):
            raise ValueError("acknowledgment requires explicit DTMF or authenticated confirmation")
        alert = self._alerts[emergency_event_id]
        if alert["human_ack_at"] is not None:
            return alert
        if method == "dtmf":
            if not call_sid:
                raise ValueError("DTMF acknowledgment requires the alert call SID")
            bound = any(a.provider_sid == call_sid for a in alert["attempts"])
            if not bound:
                raise ValueError("DTMF acknowledgment is not bound to a recorded alert attempt")
        alert["human_ack_at"] = self.clock()
        alert["ack_method"] = method
        alert["actor_ref"] = actor_ref or (f"twilio:{call_sid}" if call_sid else "operator")
        alert["state"] = "ACKNOWLEDGED"
        alert["resolution_state"] = "ACKNOWLEDGED"
        if self._scheduler is not None:
            self._scheduler.disarm(emergency_event_id)
        self._persist()
        return alert

    def get(self, emergency_event_id: str) -> dict | None:
        return self._alerts.get(emergency_event_id)
