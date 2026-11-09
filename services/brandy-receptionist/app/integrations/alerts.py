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

Escalation durability (fix round 1, P1-4; hardened fix round 2, P1-1):
the ack deadline is armed on a dedicated scheduler thread the moment an
alert dispatches — no external caller is needed to start backup. Backup
escalation is claimed exactly once (atomic backup-once claim); repeated
timeout checks collapse to the same wave. Alert state persists to a JSON
file on every mutation, so a worker restart reloads unresolved alerts and
re-arms their deadlines instead of dropping them. Retries are bounded by
max_attempts per channel; an alert that exhausts them becomes
DEAD_LETTER, still UNRESOLVED, never silently closed.

Persistence is fail-LOUD, never best-effort (fix round 2, P1-1): a
write/rename/fsync failure raises AlertPersistenceError, is logged at
CRITICAL, and sticks in dispatcher health until a later persist
succeeds; the affected alert records carry persistence_degraded. The
alert attempt itself still goes out (fail-open for the human alert, per
the brief) — but nothing may claim the alert was safely persisted when
it was not. Persists are serialized across processes with a lock file
and merge disk state under the lock, so a second worker cannot clobber
the first worker's alerts; terminal states (ACKNOWLEDGED, DEAD_LETTER)
always win a merge. A corrupt state file is preserved aside
(<path>.corrupt-<ts>) and surfaced in health, never silently dropped.
No state_path means persistence is UNAVAILABLE, also visible in
health — in-memory-only operation is honest about that.

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

import contextlib
import json
import logging
import os
import threading
import time
import uuid

try:
    import fcntl  # POSIX cross-process state lock; absent on Windows.
except ImportError:  # pragma: no cover - Windows has no fcntl
    fcntl = None

from ..providers import ProviderAuthError, _clean_proxy_env

logger = logging.getLogger(__name__)

ACK_TIMEOUT_S_DEFAULT = 30


class AlertPersistenceError(RuntimeError):
    """Alert state could not be persisted durably. Raised by
    AlertDispatcher._persist; callers that must keep the human alert
    flowing catch it via _persist_safe, which leaves the failure sticky
    in health() instead of swallowing it."""


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


class AlertRefused(RuntimeError):
    """The live gate refused an alert send (mode OFF, kill switch engaged,
    outbound alerts disabled, or no consented recipient). The alert record
    is kept as REFUSED/UNRESOLVED — never silently dropped, never retried
    against the provider."""


class NoConsentError(RuntimeError):
    """No recorded individual consent exists for this recipient/channel."""


class RecipientAllowlist:
    """Server-side recipient allowlist (go-live §4).

    File-backed JSON (default data/recipients.json). Each entry records an
    individual's EXPLICIT consent for a channel:
      {"role": "PRIMARY", "name": "Brandy Morgan",
       "voice_e164": "+1…", "sms_e164": "+1…",
       "consent": {"voice": {"given": true, "given_at": "…", "recorded_by": "…"},
                   "sms": {"given": true, ...}}}
    resolve() returns the number ONLY when consent is recorded for that
    channel. No consent exists yet — the file ships empty and the operator
    adds entries with scripts/recipients.py — so no real recipient is
    wired in this build and every send attempt fails closed with
    "no_consented_recipient" instead of dialing anyone.
    """

    def __init__(self, entries: dict | None = None):
        self.entries = entries or {}

    @classmethod
    def load(cls, path: str) -> "RecipientAllowlist":
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                return cls(data)
        except (OSError, ValueError):
            pass
        return cls({})

    def resolve(self, role: str, channel: str) -> str | None:
        entry = self.entries.get(role)
        if not isinstance(entry, dict):
            return None
        consent = entry.get("consent") or {}
        channel_consent = consent.get(channel.lower())
        if not isinstance(channel_consent, dict) or channel_consent.get("given") is not True:
            return None
        number = entry.get("voice_e164" if channel == "VOICE" else "sms_e164")
        return number if isinstance(number, str) and number.startswith("+") else None

    def is_consented(self, role: str, channel: str) -> bool:
        return self.resolve(role, channel) is not None


class TwilioAlertTransport:
    """Real outbound voice+SMS via the Twilio SDK (twilio 9.x).

    Lazy-imports `twilio`; the client is built only when a send is
    attempted (and only when the dispatcher gate allowed it). The
    constructor takes env-sourced credentials + the sender number — no
    keys or numbers live in code. An optional injected `client` lets
    tests prove the wiring without network. Accepted sends record their
    estimated cost in the CostLedger when one is attached.
    """

    def __init__(self, account_sid: str, auth_token: str, from_number: str,
                 *, alert_ack_url: str = "", ack_digit: str = "1",
                 allowlist: RecipientAllowlist | None = None,
                 client=None, cost_ledger=None, source: str = "TEST"):
        if not account_sid or not auth_token:
            raise ProviderAuthError("Twilio credentials missing")
        if not from_number:
            raise ValueError("Twilio sender number missing")
        self.account_sid = account_sid
        self.auth_token = auth_token
        self.from_number = from_number
        self.alert_ack_url = alert_ack_url
        self.ack_digit = ack_digit
        self.allowlist = allowlist or RecipientAllowlist()
        self._client = client
        self.cost_ledger = cost_ledger
        self.source = source
        self.calls: list = []

    def _client_or_build(self):
        if self._client is not None:
            return self._client
        from twilio.rest import Client
        with _clean_proxy_env():
            self._client = Client(self.account_sid, self.auth_token)
        return self._client

    def resolve_recipient(self, role: str, channel: str) -> str | None:
        return self.allowlist.resolve(role, channel)

    def send(self, role: str, channel: str, message: str, *,
             emergency_event_id: str | None = None) -> dict:
        """Send one alert attempt. Returns the FakeAlertTransport-shaped
        dict (accepted, sid, answered, call_completed, delivered, ...).
        No consented recipient => accepted False, failure_class
        "no_consented_recipient", and NO provider call is made."""
        from ..providers import classify_error
        from ..telephony_twilio import twiml_alert_call
        now = time.time()
        to = self.resolve_recipient(role, channel)
        if not to:
            return {"accepted": False, "sid": None,
                    "failure_class": "no_consented_recipient",
                    "requested_at": now, "call_completed": True}
        try:
            client = self._client_or_build()
            if channel == "VOICE":
                twiml = twiml_alert_call(self.alert_ack_url,
                                         emergency_event_id or "emg-unknown",
                                         message, self.ack_digit)
                call = client.calls.create(to=to, from_=self.from_number,
                                           twiml=twiml)
                sid = getattr(call, "sid", None)
            else:
                msg = client.messages.create(to=to, from_=self.from_number, body=message)
                sid = getattr(msg, "sid", None)
        except Exception as exc:  # noqa: BLE001 — mapped to the taxonomy
            err = classify_error(exc)
            return {"accepted": False, "sid": None,
                    "failure_class": err.kind,
                    "requested_at": now, "call_completed": True}
        if self.cost_ledger is not None and emergency_event_id:
            self.cost_ledger.record_alert(
                emergency_event_id=emergency_event_id,
                source=self.source, channel=channel)
        self.calls.append({"role": role, "channel": channel, "sid": sid, "to": to})
        return {"accepted": True, "sid": sid, "answered": False,
                "call_completed": False,
                "requested_at": now, "provider_accepted_at": now}


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

    def send(self, role: str, channel: str, message: str, *,
             emergency_event_id: str | None = None) -> dict:
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
        # The thread only starts when an alert is armed; joining a
        # never-started thread raises, so skip the join in that case.
        if self._thread.is_alive():
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
                 state_path: str | None = None, scheduler_enabled: bool = True,
                 live_gate=None, recipient_allowlist: RecipientAllowlist | None = None):
        self.transport = transport
        self.ack_timeout_s = ack_timeout_s
        self.max_attempts = max_attempts
        # allowlist: {"PRIMARY": {"voice": "<ref>", "sms": "<ref>"},
        #             "BACKUP": {...}} — references only, resolved by the
        # transport from server config. No real numbers in code.
        self.allowlist = allowlist or {"PRIMARY": {}, "BACKUP": {}}
        # live_gate: optional callable () -> None that raises AlertRefused
        # when the activation mode / kill switch / outbound flag forbids
        # sending. Checked on dispatch AND on every attempt (including
        # backup/retry waves), so a kill mid-escalation stops the sends.
        self.live_gate = live_gate
        # recipient_allowlist: consent-gated RecipientAllowlist. When set,
        # an attempt with no consented recipient for that role+channel is
        # recorded FAILED ("no_consented_recipient") without any provider
        # call. Unset (v1 tests) means no allowlist check.
        self.recipient_allowlist = recipient_allowlist
        self.clock = clock
        self.backoff_s = backoff_s
        self.state_path = state_path
        self._alerts: dict = {}
        # RLock: _persist takes it while merging/serializing and is also
        # called from check_ack_timeout while the lock is already held.
        self._lock = threading.RLock()
        # Fail-loud persistence state (fix round 2, P1-1): sticky until
        # a later persist succeeds. Never reset silently.
        self._persistence_error: str | None = None
        self._persistence_error_at: float | None = None
        self._load_error: str | None = None
        self._scheduler = EscalationScheduler(self) if scheduler_enabled else None
        self._load_state()

    # -- durable state ---------------------------------------------------------
    def health(self) -> dict:
        """Persistence health for /health and operators. 'ok' means the
        last persist succeeded; 'degraded' means a persist or load failed
        and the failure is still sticky (a load error stays sticky even
        after later persists succeed, because prior alerts may have been
        lost); 'unavailable' means no state_path was configured, so
        nothing is durable at all."""
        if not self.state_path:
            persistence = "unavailable"
        elif self._persistence_error is not None or self._load_error is not None:
            persistence = "degraded"
        else:
            persistence = "ok"
        unresolved = sum(
            1 for a in self._alerts.values()
            if a.get("human_ack_at") is None and a.get("state") != "DEAD_LETTER")
        return {"persistence": persistence,
                "state_path": self.state_path,
                "locking": "fcntl" if fcntl is not None else "unavailable",
                "alerts": len(self._alerts),
                "unresolved": unresolved,
                "last_error": self._persistence_error or self._load_error,
                "last_error_at": self._persistence_error_at}

    def _record_persistence_error(self, message: str) -> None:
        self._persistence_error = message
        self._persistence_error_at = self.clock()
        for alert in self._alerts.values():
            alert["persistence_degraded"] = True
        logger.critical("brandy-receptionist alert persistence failed: %s", message)

    def _serialize_alert(self, alert: dict) -> dict:
        data = {k: v for k, v in alert.items()
                if k != "attempts" and not k.startswith("_")}
        data["attempts"] = [a.as_dict() for a in alert["attempts"]]
        return data

    def _deserialize_alert(self, data: dict) -> dict:
        attempts = [AlertAttempt.from_dict(a) for a in data.pop("attempts", [])]
        data["attempts"] = attempts
        data.setdefault("backup_claimed", False)
        data.setdefault("backup_waves", 0)
        data.setdefault("next_retry_at", None)
        data.setdefault("actor_ref", None)
        data.setdefault("refused_reason", None)
        data.setdefault("persistence_degraded", False)
        data["_dirty"] = False
        return data

    @contextlib.contextmanager
    def _state_lock(self):
        """Exclusive cross-process lock on <state_path>.lock (POSIX
        fcntl). Without fcntl (Windows) there is no cross-process
        serialization; health() reports locking as unavailable."""
        if fcntl is None or not self.state_path:
            yield
            return
        lock_path = f"{self.state_path}.lock"
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            deadline = time.time() + 5
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.time() >= deadline:
                        raise AlertPersistenceError(
                            f"timed out waiting for alert state lock {lock_path}")
                    time.sleep(0.01)
            yield
        finally:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            except OSError:
                pass
            os.close(fd)

    def _read_state_file(self) -> list:
        """Raw alert records from disk. Missing file is a fresh start.
        A corrupt file is preserved aside (<path>.corrupt-<ts>) and
        recorded as a load error — never silently dropped, never
        allowed to brick later persists."""
        if not self.state_path or not os.path.exists(self.state_path):
            return []
        try:
            with open(self.state_path) as fh:
                records = json.load(fh)
            if not isinstance(records, list):
                raise ValueError("alert state file is not a JSON list")
            return records
        except (ValueError, OSError) as exc:
            self._load_error = f"alert state file unreadable: {exc}"
            self._persistence_error_at = self.clock()
            logger.critical("brandy-receptionist %s", self._load_error)
            try:
                aside = f"{self.state_path}.corrupt-{int(time.time())}"
                os.replace(self.state_path, aside)
            except OSError:
                pass  # the corrupt file stays; the error is already sticky
            return []

    def _merge_disk_records(self, records: list) -> None:
        """Merge disk records into memory. Disk-only alerts are adopted.
        For a shared alert, a terminal disk state (ACKNOWLEDGED or
        DEAD_LETTER) always wins — an ack must never be lost to a stale
        in-memory copy. Otherwise a dirty in-memory alert wins; a clean
        in-memory alert yields to disk (another worker changed it)."""
        for raw in records:
            if not isinstance(raw, dict) or "emergency_event_id" not in raw:
                continue
            event_id = raw["emergency_event_id"]
            disk = self._deserialize_alert(dict(raw))
            memory = self._alerts.get(event_id)
            if memory is None:
                self._alerts[event_id] = disk
            elif disk.get("state") in ("ACKNOWLEDGED", "DEAD_LETTER") \
                    and memory.get("state") not in ("ACKNOWLEDGED", "DEAD_LETTER"):
                self._alerts[event_id] = disk
            elif memory.get("_dirty"):
                pass  # this worker changed it since load; memory wins
            else:
                self._alerts[event_id] = disk

    def _fsync_dir(self, directory: str) -> None:
        if not directory:
            return
        fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def _persist(self) -> None:
        """Durably write all alerts: lock, reload + merge disk state
        (so a second worker's alerts are not clobbered), write tmp,
        fsync file, atomic replace, fsync directory. Raises
        AlertPersistenceError on any failure — never swallows it. A
        missing state_path records persistence as unavailable. The
        in-process lock is held throughout so the merge, the payload
        snapshot and the dirty-flag clearing are one atomic step."""
        if not self.state_path:
            self._persistence_error = (
                "persistence unavailable: no state_path configured")
            self._persistence_error_at = self.clock()
            return
        with self._lock:
            try:
                with self._state_lock():
                    self._merge_disk_records(self._read_state_file())
                    payload = [self._serialize_alert(a)
                               for a in self._alerts.values()]
                    directory = os.path.dirname(self.state_path)
                    if directory:
                        os.makedirs(directory, exist_ok=True)
                    tmp = f"{self.state_path}.tmp"
                    with open(tmp, "w") as fh:
                        json.dump(payload, fh)
                        fh.flush()
                        os.fsync(fh.fileno())
                    os.replace(tmp, self.state_path)
                    self._fsync_dir(directory)
            except AlertPersistenceError:
                raise
            except OSError as exc:
                self._record_persistence_error(f"alert state persist failed: {exc}")
                raise AlertPersistenceError(str(exc)) from exc
            for alert in self._alerts.values():
                alert["_dirty"] = False
            self._persistence_error = None
            self._persistence_error_at = None

    def _persist_safe(self) -> bool:
        """Persist, fail-open for the human alert itself: a persistence
        failure must not stop the phone call, but the failure is sticky
        in health() and flagged on the alert records. Returns False
        when persistence failed."""
        try:
            self._persist()
        except AlertPersistenceError:
            return False
        return True

    def _load_state(self) -> None:
        if not self.state_path or not os.path.exists(self.state_path):
            return
        self._merge_disk_records(self._read_state_file())
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

    def _check_live_gate(self) -> None:
        """Raise AlertRefused when the live gate forbids sending."""
        if self.live_gate is not None:
            self.live_gate()

    def dispatch_emergency(self, emergency_event_id: str, hazard: str,
                           message: str) -> dict:
        """Start primary voice + SMS CONCURRENTLY. Returns the alert record.
        Idempotent per emergency_event_id: a second call for the same event
        returns the existing record (no alert storm on STT partials).

        Go-live gate: the record is created FIRST (so the refusal is
        durable and visible), then the live gate is checked. A refused
        dispatch is recorded REFUSED/UNRESOLVED with the reason — never
        silently dropped, never retried against the provider."""
        with self._lock:
            if emergency_event_id in self._alerts:
                return self._alerts[emergency_event_id]
            alert = {
                "emergency_event_id": emergency_event_id, "hazard": hazard,
                "detected_at": self.clock(), "state": "ALERTING",
                "human_ack_at": None, "ack_method": None, "actor_ref": None,
                "backup_attempted_at": None, "resolution_state": "UNRESOLVED",
                "backup_claimed": False, "backup_waves": 0, "next_retry_at": None,
                "persistence_degraded": False, "refused_reason": None,
                "attempts": [],
            }
            alert["_dirty"] = True
            self._alerts[emergency_event_id] = alert
        try:
            self._check_live_gate()
        except AlertRefused as exc:
            with self._lock:
                alert["state"] = "REFUSED"
                alert["resolution_state"] = "UNRESOLVED"
                alert["refused_reason"] = str(exc)
                alert["_dirty"] = True
            self._persist_safe()
            return alert
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
        alert["_dirty"] = True
        # Fail-open for the human alert: a persistence failure must not
        # stop the call, but it is sticky in health() — never silent.
        self._persist_safe()
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
        # Go-live gates, checked per attempt (retry waves included):
        # 1. the live gate (mode/kill/flag) — a refusal records FAILED
        #    "dispatch_refused" and never touches the provider;
        # 2. the consent allowlist — no consented recipient records FAILED
        #    "no_consented_recipient" and never touches the provider.
        try:
            self._check_live_gate()
        except AlertRefused as exc:
            attempt.state = "FAILED"
            attempt.failed_at = self.clock()
            attempt.failure_class = "dispatch_refused"
            with self._lock:
                alert["attempts"].append(attempt)
                alert["refused_reason"] = str(exc)
                alert["_dirty"] = True
            self._persist_safe()
            return attempt
        if self.recipient_allowlist is not None and not self.recipient_allowlist.is_consented(role, channel):
            attempt.state = "FAILED"
            attempt.failed_at = self.clock()
            attempt.failure_class = "no_consented_recipient"
            with self._lock:
                alert["attempts"].append(attempt)
                alert["_dirty"] = True
            self._persist_safe()
            return attempt
        result = self.transport.send(role, channel, message,
                                     emergency_event_id=alert["emergency_event_id"])
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
            alert["_dirty"] = True
        self._persist_safe()
        return attempt

    def _start_backup_wave(self, alert: dict) -> None:
        """One backup voice + SMS wave. Caller must already hold the
        backup-once claim and have incremented backup_waves."""
        alert["backup_attempted_at"] = self.clock()
        alert["_dirty"] = True
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
            if alert["state"] == "REFUSED":
                return alert  # gate-refused alerts never escalate to backup
            # A kill / mode change since dispatch blocks the backup wave:
            # the alert stays UNRESOLVED with the refusal recorded.
            try:
                self._check_live_gate()
            except AlertRefused as exc:
                alert["state"] = "REFUSED"
                alert["resolution_state"] = "UNRESOLVED"
                alert["refused_reason"] = str(exc)
                alert["_dirty"] = True
                self._persist_safe()
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
            alert["_dirty"] = True
            self._persist_safe()
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
        alert["_dirty"] = True
        if self._scheduler is not None:
            self._scheduler.disarm(emergency_event_id)
        self._persist_safe()
        return alert

    def get(self, emergency_event_id: str) -> dict | None:
        return self._alerts.get(emergency_event_id)
