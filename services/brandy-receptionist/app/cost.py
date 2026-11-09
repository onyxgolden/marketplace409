"""Per-call cost ledger + ceilings (go-live §7).

Rate table v1.0 — unit prices from the Nov 8 harvest teardown
(results/muse/voice-receptionist-harvest-teardown-2026-11-08.md), which
cross-checked vendor list prices; the ~$0.04/min all-in total is the
teardown's planning number. All figures are ESTIMATES for ledger
purposes, not vendor invoices; the rate version is recorded on every
ledger entry and every call row so an estimate is always traceable to
the rates that produced it.

  Twilio inbound voice        $0.0085/min
  Twilio outbound voice       $0.0140/min
  Twilio Media Streams        $0.0044/min
  Twilio SMS (US)             $0.0079/message   [ESTIMATE — standard list price]
  Deepgram Nova-3 streaming   $0.0077/min (standard; $0.0048 promo)
  LLM, GPT-4o-mini class      $0.0020/min of conversation [ESTIMATE]
  Cartesia Sonic TTS          $39.00 per 1M chars  (≈ $0.016/min agent speech)
  Call recording (OFF by default) $0.0025/min

Ledger: a durable JSON file (default data/cost-ledger.json), appended on
every chargeable event, surviving restarts. The ledger is the worker's
record; the per-call totals also land on the FORGE call row (see the
go-live migration) so the operator inbox can show them.

Ceilings: a per-call HARD ceiling and an aggregate campaign ceiling,
both checked BEFORE provider sessions start and BEFORE expensive
actions (alert sends, TTS turns). On exhaustion the call fails closed
to human voicemail + an operator alert — never a silent drop, never an
unbounded session.

Reservations (fix round 1, P1-3, refined in fix round 2): `reserve()`
atomically claims projected spend under a cross-process file lock
before any chargeable provider session or send, so two concurrent
calls cannot both pass against the same remaining balance. A
reservation is a durable ledger entry (kind "reservation") that
counts toward the totals until the actual cost is recorded — `record_call`
/ `record_alert` release the open reservations for that call / alert
event in the same atomic write, so reserved and actual costs are never
double-counted.

Reservation identities (fix round 2, P1): a reservation carries a
`purpose` — `"session"` (the call's duration headroom, created once
by the gateway before the pipeline exists and held for the whole
call), `"turn"` (one turn's projected provider spend), or `"alert"`
(one alert attempt). A per-turn settlement releases ONLY that turn's
reservation (`settle_reservation_id`); the session reservation is
untouched by turns and is settled only by the call's final record at
close, priced on the ACTUAL elapsed billable call duration. Per-turn
actuals price only the turn's incremental provider usage (LLM minutes
+ TTS chars, duration 0) — duration is priced exactly once, at close
— so the final cost is the full elapsed duration plus the turns'
provider usage, never the sum of pipeline processing times. A final
record is at-most-once per call (`final_once`): the Twilio status
callback and the session close race, and only the first final entry
lands, so a call is never duration-charged twice.

Expired reservations (fix round 2, P1): a reservation older than
RESERVATION_TTL_S is NOT silently dropped. Spend may already have
occurred (crashed worker, unsettled provider attempt), so the
conservative reconciliation rule settles it as ASSUMED spend: the
entry is converted in place into an actual entry at its projected
amount, flagged `expired_reservation` + `assumed_spend` in its usage,
and it keeps counting toward the totals. The ceiling is never
silently restored. An operator who can prove the spend did NOT occur
removes the assumed-spend entry deliberately — that is an operator
action, never an automatic purge.

Multi-worker: all mutations take an exclusive fcntl lock on
<path>.lock and re-read the file under the lock, so two workers
sharing one ledger file cannot clobber each other's entries. The
POSIX cross-process guarantee depends on all workers sharing the
same persistent ledger file and lock path — verify the deployment
topology at activation (a worker with a private ledger file would
hold private headroom and the ceiling would not be hard across
workers).

Corrupt ledger (fix round 1, P1-3): a missing file is a fresh start;
an existing file that cannot be read or parsed is CORRUPT, and the
ledger fails closed on it — every spend-authorizing operation raises
BudgetExceeded and no new session or send is authorized. The corrupt
file is never silently reset to an empty ledger (that would erase
campaign spend). Fix the file (or replace it deliberately, as an
operator action) and the ledger recovers on the next read.

Multi-worker: all mutations take an exclusive fcntl lock on
<path>.lock and re-read the file under the lock, so two workers
sharing one ledger file cannot clobber each other's entries.
"""
from __future__ import annotations

import contextlib
import json
import math
import os
import threading
import time
import uuid

try:
    import fcntl  # POSIX cross-process ledger lock; absent on Windows.
except ImportError:  # pragma: no cover - Windows has no fcntl
    fcntl = None

# Reservations outlive their session only by a crash. A reservation
# older than this belongs to a dead session — but the spend it held
# may already have happened, so `_load` settles it as ASSUMED spend
# (fix round 2, P1) instead of silently restoring the headroom.
# TTL is 2x the max call duration (1800 s), so a live call's session
# reservation can never expire mid-call; an operator who raises
# max_call_duration_s past the TTL must raise the TTL too.
RESERVATION_TTL_S = 3600

# --- Rate table ------------------------------------------------------------
RATE_TABLES = {
    "1.0": {
        "version": "1.0",
        "source": "voice-receptionist-harvest-teardown-2026-11-08 (verified unit prices; SMS + LLM per-minute are estimates)",
        "twilio_inbound_usd_per_min": 0.0085,
        "twilio_outbound_usd_per_min": 0.0140,
        "twilio_media_streams_usd_per_min": 0.0044,
        "twilio_sms_usd_per_message": 0.0079,
        "deepgram_stt_usd_per_min": 0.0077,
        "llm_usd_per_min": 0.0020,
        "cartesia_tts_usd_per_1m_chars": 39.00,
        "recording_usd_per_min": 0.0025,
        "blended_usd_per_min": 0.04,
    },
}


def rate_table(version: str = "1.0") -> dict:
    if version not in RATE_TABLES:
        raise ValueError(f"unknown cost rate version {version!r}")
    return dict(RATE_TABLES[version])


def estimate_call_cost_usd(*, duration_s: float, agent_chars: int = 0,
                           llm_minutes: float = 0.0, direction: str = "INBOUND",
                           recording: bool = False, version: str = "1.0") -> float:
    """Estimate one call's provider cost from raw usage. Pure function."""
    rates = rate_table(version)
    minutes = max(0.0, duration_s) / 60.0
    voice_rate = rates["twilio_outbound_usd_per_min"] if direction == "OUTBOUND" else rates["twilio_inbound_usd_per_min"]
    total = minutes * (voice_rate + rates["twilio_media_streams_usd_per_min"]
                       + rates["deepgram_stt_usd_per_min"])
    total += max(0.0, llm_minutes) * rates["llm_usd_per_min"]
    total += max(0, agent_chars) * rates["cartesia_tts_usd_per_1m_chars"] / 1_000_000
    if recording:
        total += minutes * rates["recording_usd_per_min"]
    return round(total, 6)


def estimate_alert_cost_usd(*, channel: str, version: str = "1.0") -> float:
    """Estimate one alert attempt's cost (voice minute vs SMS message)."""
    rates = rate_table(version)
    if channel == "SMS":
        return round(rates["twilio_sms_usd_per_message"], 6)
    # A voice alert attempt is priced as one billable minute (rounded up).
    return round(rates["twilio_outbound_usd_per_min"] + rates["twilio_media_streams_usd_per_min"], 6)


class BudgetExceeded(RuntimeError):
    """Raised when a cost ceiling would be breached. Fail closed."""


class CostLedger:
    """Durable per-call + per-alert cost ledger (JSON file, atomic writes).

    Entries are append-only dicts:
      {"id", "ts", "kind": "call"|"alert", "call_sid"|"emergency_event_id",
       "source": "TEST"|"LIVE"|"SYNTHETIC", "rate_version",
       "usage": {...raw usage...}, "estimated_usd": float,
       "correlation_id": str}
    Reservations add:
      {"kind": "reservation", "status": "reserved",
       "reserved_at": <epoch seconds>, "call_sid"|"emergency_event_id",
       "channel": <alert channel or None>,
       "purpose": "session"|"turn"|"alert",
       "estimated_usd": <projected>}
    A reservation counts toward every total until it is released or
    settled into an actual entry — that is what makes the ceiling hard
    across concurrent sessions. A per-turn settlement releases only
    its own reservation id; the session reservation ("session"
    purpose) is released only by the call's final record at close.
    """

    def __init__(self, path: str, rate_version: str = "1.0"):
        self.path = path
        self.rate_version = rate_version
        self._lock = threading.Lock()
        self._corrupt: str | None = None
        self._entries = self._load()

    # -- corruption + locking -------------------------------------------------

    @property
    def is_corrupt(self) -> bool:
        """True when the ledger file exists but cannot be read/parsed.
        Spend authorization is refused while corrupt; /health reports it."""
        return self._corrupt is not None

    @property
    def corrupt_reason(self) -> str | None:
        return self._corrupt

    def _load(self) -> list:
        """Read the ledger file. A missing file is a fresh start ([]).
        An existing file that cannot be read or parsed sets _corrupt
        and returns [] — the caller must refuse spend, never treat the
        empty list as a reset campaign. Expired reservations are
        settled as ASSUMED spend, never silently dropped (fix round 2,
        P1): a reservation older than RESERVATION_TTL_S belongs to a
        dead session, but the provider spend it held may already have
        happened (crashed worker, unsettled attempt), so the entry is
        converted in place into an actual entry at its projected
        amount, flagged expired_reservation + assumed_spend, and it
        keeps counting toward the totals. The conversion is a pure
        function of the file contents, so repeated loads without a
        save re-derive the same entries and never double-count. An
        operator who can prove the spend did NOT occur removes the
        assumed-spend entry deliberately — never an automatic purge."""
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if not isinstance(data, list):
                raise ValueError("cost ledger is not a JSON list")
        except FileNotFoundError:
            self._corrupt = None
            return []
        except (OSError, ValueError) as exc:
            self._corrupt = f"cost ledger unreadable: {exc}"
            return []
        self._corrupt = None
        now = time.time()
        entries: list = []
        for e in data:
            if (isinstance(e, dict) and e.get("kind") == "reservation"
                    and e.get("status") == "reserved"
                    and isinstance(e.get("reserved_at"), (int, float))
                    and now - e["reserved_at"] > RESERVATION_TTL_S):
                entries.append(self._settle_expired_reservation(e))
            else:
                entries.append(e)
        return entries

    @staticmethod
    def _settle_expired_reservation(reservation: dict) -> dict:
        """Conservative reconciliation for an expired reservation: the
        spend it held is ASSUMED to have happened. Returns an actual
        entry (kind "call" or "alert") at the reservation's projected
        amount, flagged so an operator can audit or deliberately
        reverse it. The projected amount is preserved exactly — the
        entry is never re-priced."""
        is_alert = reservation.get("emergency_event_id") is not None
        entry = {
            "id": str(uuid.uuid4()),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "kind": "alert" if is_alert else "call",
            "call_sid": reservation.get("call_sid"),
            "emergency_event_id": reservation.get("emergency_event_id"),
            "channel": reservation.get("channel"),
            "source": reservation.get("source", "TEST"),
            "rate_version": reservation.get("rate_version", "1.0"),
            "usage": {"duration_s": 0.0, "agent_chars": 0,
                      "llm_minutes": 0.0,
                      "expired_reservation": True,
                      "assumed_spend": True,
                      "reservation_id": reservation.get("id"),
                      "purpose": reservation.get("purpose", "turn")},
            "estimated_usd": round(reservation.get("estimated_usd", 0.0), 6),
            "correlation_id": reservation.get(
                "correlation_id") or reservation.get("call_sid")
                or reservation.get("emergency_event_id"),
        }
        if is_alert:
            entry["usage"]["channel"] = reservation.get("channel")
        return entry

    def _refresh(self) -> None:
        """Re-read the file into memory. Callers hold _lock; mutations
        additionally hold the file lock, so a refresh under a mutation
        sees every other worker's committed entries."""
        self._entries = self._load()

    def _require_readable(self) -> None:
        """Fail closed on a corrupt ledger: no spend may be authorized
        (or recorded) against a ledger whose prior spend is unknown."""
        if self._corrupt is not None:
            raise BudgetExceeded(
                f"cost ledger is corrupt ({self._corrupt}); refusing new "
                "spend until an operator repairs or deliberately replaces it")

    @contextlib.contextmanager
    def _file_lock(self):
        """Exclusive cross-process lock on <path>.lock (POSIX fcntl).
        Without fcntl (Windows) there is no cross-process serialization;
        the in-process lock still serializes threads of this worker."""
        if fcntl is None:
            yield
            return
        lock_path = f"{self.path}.lock"
        directory = os.path.dirname(lock_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            deadline = time.time() + 5
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.time() >= deadline:
                        raise BudgetExceeded(
                            f"timed out waiting for cost ledger lock {lock_path}")
                    time.sleep(0.01)
            yield
        finally:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            except OSError:
                pass
            os.close(fd)

    def _save_locked(self) -> None:
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        tmp = f"{self.path}.tmp.{os.getpid()}.{threading.get_ident()}"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self._entries, fh, indent=2, sort_keys=True)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, self.path)

    def _mutate(self, fn):
        """Run fn(entries) atomically: in-process lock + cross-process
        file lock + re-read under the lock, then save. fn returns the
        mutation's result. Raises BudgetExceeded on a corrupt ledger."""
        with self._lock:
            with self._file_lock():
                self._refresh()
                self._require_readable()
                result = fn(self._entries)
                self._save_locked()
                return result

    def _read(self, fn):
        """Read under the in-process lock, re-reading the file first so
        another worker's committed entries are visible. Raises
        BudgetExceeded on a corrupt ledger."""
        with self._lock:
            self._refresh()
            self._require_readable()
            return fn(list(self._entries))

    # -- reservations ----------------------------------------------------------

    def _spent_for_call(self, entries: list, call_sid: str) -> float:
        return round(sum(e["estimated_usd"] for e in entries
                         if e.get("call_sid") == call_sid), 6)

    def _campaign_total(self, entries: list) -> float:
        return round(sum(e["estimated_usd"] for e in entries), 6)

    def reserve(self, *, call_sid: str | None = None,
                emergency_event_id: str | None = None,
                channel: str | None = None, source: str = "TEST",
                purpose: str = "turn",
                projected_usd: float, max_per_call_usd: float | None = None,
                max_campaign_usd: float) -> dict:
        """Atomically claim projected spend before a chargeable provider
        session or send. The reservation is durable (it survives a
        restart) and counts toward the per-call and campaign totals
        until released or settled into an actual entry, so two
        concurrent calls cannot both pass against the same remaining
        balance. Raises BudgetExceeded when the claim would breach a
        ceiling or the ledger is corrupt. One of call_sid (a call) or
        emergency_event_id (an alert send) must be given. `purpose`
        names the claim's lifecycle — "session" (a call's duration
        headroom, held until close), "turn" (one turn's projected
        provider spend), or "alert" (one alert attempt) — so a
        settlement can release exactly the reservation it corresponds
        to (fix round 2, P1)."""
        if call_sid is None and emergency_event_id is None:
            raise ValueError("reserve requires call_sid or emergency_event_id")
        if projected_usd < 0:
            raise ValueError("reserve requires a non-negative projected_usd")

        def _claim(entries: list) -> dict:
            if call_sid is not None and max_per_call_usd is not None:
                spent = self._spent_for_call(entries, call_sid)
                if spent + projected_usd > max_per_call_usd:
                    raise BudgetExceeded(
                        f"per-call ceiling ${max_per_call_usd:.2f} would be breached "
                        f"(spent ${spent:.4f} + projected ${projected_usd:.4f})")
            total = self._campaign_total(entries)
            if total + projected_usd > max_campaign_usd:
                raise BudgetExceeded(
                    f"campaign ceiling ${max_campaign_usd:.2f} would be breached "
                    f"(spent ${total:.4f} + projected ${projected_usd:.4f})")
            reservation = {
                "id": str(uuid.uuid4()),
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "kind": "reservation",
                "status": "reserved",
                "reserved_at": time.time(),
                "call_sid": call_sid,
                "emergency_event_id": emergency_event_id,
                "channel": channel,
                "purpose": purpose,
                "source": source,
                "rate_version": self.rate_version,
                "estimated_usd": round(projected_usd, 6),
                "correlation_id": call_sid or emergency_event_id,
            }
            entries.append(reservation)
            return reservation

        return self._mutate(_claim)

    def release_reservation(self, reservation_id: str) -> bool:
        """Release one reservation by id (e.g. a session refused after
        the reserve, or a failed provider send). Returns True when a
        reservation was removed. Never raises on a missing id."""
        def _release(entries: list) -> bool:
            before = len(entries)
            entries[:] = [e for e in entries
                          if not (e.get("kind") == "reservation"
                                  and e.get("id") == reservation_id)]
            return len(entries) < before

        return self._mutate(_release)

    def _release_for_call(self, entries: list, call_sid: str) -> None:
        """Drop every open reservation for a call: the final actual
        cost entry replaces the headroom they held (never
        double-counted). Only the call's FINAL record uses this — a
        per-turn settlement releases exactly its own reservation id
        (see _release_reservation_id), so a turn can never drop the
        session reservation (fix round 2, P1)."""
        entries[:] = [e for e in entries
                      if not (e.get("kind") == "reservation"
                              and e.get("call_sid") == call_sid)]

    def _release_reservation_id(self, entries: list, reservation_id: str) -> bool:
        """Drop one reservation by id. Returns True when one was
        removed; a missing id is a no-op (the reservation was already
        settled, released, or converted to assumed spend)."""
        before = len(entries)
        entries[:] = [e for e in entries
                      if not (e.get("kind") == "reservation"
                              and e.get("id") == reservation_id)]
        return len(entries) < before

    def _release_for_alert(self, entries: list, emergency_event_id: str,
                           channel: str) -> None:
        entries[:] = [e for e in entries
                      if not (e.get("kind") == "reservation"
                              and e.get("emergency_event_id") == emergency_event_id
                              and e.get("channel") == channel)]

    # -- actuals ---------------------------------------------------------------

    def record_call(self, *, call_sid: str, source: str, duration_s: float,
                    agent_chars: int = 0, llm_minutes: float = 0.0,
                    direction: str = "INBOUND", recording: bool = False,
                    correlation_id: str | None = None,
                    settle_reservation_id: str | None = None,
                    final: bool = False, final_once: bool = False,
                    usage_extra: dict | None = None) -> dict:
        """Append an actual call-cost entry.

        Settlement (fix round 2, P1): `settle_reservation_id` releases
        exactly that reservation — a per-turn record settles ONLY its
        own turn reservation and never touches the session reservation.
        With no id given, every open reservation for the call is
        released — the FINAL record's semantics (the final actual
        replaces all remaining headroom). `final` marks the entry as
        the call-close record; `final_once` makes that at-most-once
        per call (the Twilio status callback and the session close
        race — only the first final entry lands, so a call is never
        duration-charged twice; a duplicate final returns the existing
        entry unchanged). `usage_extra` merges informational fields
        into the usage record (e.g. turn number, call totals).

        Pricing: a per-turn record prices ONLY the turn's incremental
        provider usage — pass duration_s=0 with the turn's agent_chars
        and llm_minutes. Duration is priced exactly once, by the final
        record, on the full elapsed billable call duration. Passing a
        turn's processing time as duration_s here would double-count
        it against the final duration charge."""
        cost = estimate_call_cost_usd(
            duration_s=duration_s, agent_chars=agent_chars,
            llm_minutes=llm_minutes, direction=direction,
            recording=recording, version=self.rate_version)
        usage = {"duration_s": duration_s, "agent_chars": agent_chars,
                 "llm_minutes": llm_minutes, "direction": direction,
                 "recording": recording}
        if final:
            usage["final"] = True
        if usage_extra:
            usage.update(usage_extra)
        entry = {
            "id": str(uuid.uuid4()),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "kind": "call",
            "call_sid": call_sid,
            "source": source,
            "rate_version": self.rate_version,
            "usage": usage,
            "estimated_usd": cost,
            "correlation_id": correlation_id or call_sid,
        }

        def _append(entries: list) -> dict:
            if final_once:
                for existing in entries:
                    if (existing.get("kind") == "call"
                            and existing.get("call_sid") == call_sid
                            and isinstance(existing.get("usage"), dict)
                            and existing["usage"].get("final") is True):
                        return existing
            if settle_reservation_id is not None:
                self._release_reservation_id(entries, settle_reservation_id)
            else:
                self._release_for_call(entries, call_sid)
            entries.append(entry)
            return entry

        return self._mutate(_append)

    def record_alert(self, *, emergency_event_id: str, source: str, channel: str,
                     correlation_id: str | None = None) -> dict:
        cost = estimate_alert_cost_usd(channel=channel, version=self.rate_version)
        entry = {
            "id": str(uuid.uuid4()),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "kind": "alert",
            "emergency_event_id": emergency_event_id,
            "source": source,
            "rate_version": self.rate_version,
            "usage": {"channel": channel},
            "estimated_usd": cost,
            "correlation_id": correlation_id or emergency_event_id,
        }

        def _append(entries: list) -> dict:
            self._release_for_alert(entries, emergency_event_id, channel)
            entries.append(entry)
            return entry

        return self._mutate(_append)

    def total_usd(self, *, source: str | None = None) -> float:
        def _total(entries: list) -> float:
            return round(sum(e["estimated_usd"] for e in entries
                             if source is None or e.get("source") == source), 6)

        return self._read(_total)

    def call_total_usd(self, call_sid: str) -> float:
        return self._read(lambda entries: self._spent_for_call(entries, call_sid))

    def entries(self) -> list:
        return self._read(lambda entries: [dict(e) for e in entries])

    def check_call_ceiling(self, *, call_sid: str, projected_usd: float,
                           max_per_call_usd: float,
                           max_campaign_usd: float | None = None) -> None:
        """Raise BudgetExceeded before a session/action that would breach.
        Read-only check (no reservation): callers that proceed to spend
        must use reserve() instead, so the headroom is actually held.
        projected_usd is the worst-case additional spend for this call
        (e.g. one more minute at the blended rate). The campaign total
        includes everything already ledgered, reservations included.
        Pass max_campaign_usd=None to check the per-call ceiling only:
        the campaign is a shared, dynamic resource — a sibling ending
        frees it — so the campaign fit is enforced atomically by each
        reserve() claim, not by an admission-time read (fix round 3,
        P1: the verdict's admission check is a per-call fit)."""
        def _check(entries: list) -> None:
            spent_this_call = self._spent_for_call(entries, call_sid)
            if spent_this_call + projected_usd > max_per_call_usd:
                raise BudgetExceeded(
                    f"per-call ceiling ${max_per_call_usd:.2f} would be breached "
                    f"(spent ${spent_this_call:.4f} + projected ${projected_usd:.4f})")
            if max_campaign_usd is None:
                return
            total = self._campaign_total(entries)
            if total + projected_usd > max_campaign_usd:
                raise BudgetExceeded(
                    f"campaign ceiling ${max_campaign_usd:.2f} would be breached "
                    f"(spent ${total:.4f} + projected ${projected_usd:.4f})")

        self._read(_check)


def blended_minute_usd(version: str = "1.0") -> float:
    """Worst-case planning cost of one more live minute (teardown $0.04)."""
    return rate_table(version)["blended_usd_per_min"]


def ceil_minutes(duration_s: float) -> int:
    return math.ceil(max(0.0, duration_s) / 60.0)
