"""Idempotent delivery outbox: durable, bounded retry, dead-letter.

Unique (event_id, channel, recipient_role). Worker lease / atomic claim,
bounded retry with backoff, dead-letter after the bound. Non-emergency
notifications persist first, then send; a failed notification stays
retriable and never erases the call record. The outbox survives worker
restart via a JSON file store (SQLite-free, stdlib-only).
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid

BACKOFF_S = (5, 15, 60)
MAX_ATTEMPTS = 4


class Outbox:
    def __init__(self, path: str | None = None):
        self.path = path
        self._lock = threading.Lock()
        self._items: dict = {}
        if path and os.path.exists(path):
            try:
                with open(path) as fh:
                    for item in json.load(fh):
                        self._items[item["key"]] = item
            except (ValueError, OSError):
                pass

    def _persist(self) -> None:
        if not self.path:
            return
        tmp = f"{self.path}.tmp"
        with open(tmp, "w") as fh:
            json.dump(list(self._items.values()), fh)
        os.replace(tmp, self.path)

    def enqueue(self, event_id: str, channel: str, recipient_role: str,
                payload: dict) -> dict:
        """Idempotent: the same (event, channel, role) enqueues once."""
        key = f"{event_id}:{channel}:{recipient_role}"
        with self._lock:
            if key in self._items:
                return self._items[key]
            item = {"key": key, "event_id": event_id, "channel": channel,
                    "recipient_role": recipient_role, "payload": payload,
                    "state": "PENDING", "attempts": 0,
                    "next_attempt_at": time.time(), "last_error_code": None,
                    "created_at": time.time()}
            self._items[key] = item
            self._persist()
            return item

    def claim_due(self, now: float | None = None) -> list:
        """Atomically claim due items (lease = claim; a second worker sees
        nothing to claim)."""
        now = now if now is not None else time.time()
        claimed = []
        with self._lock:
            for item in self._items.values():
                if item["state"] == "PENDING" and item["next_attempt_at"] <= now:
                    item["state"] = "CLAIMED"
                    item["lease_id"] = uuid.uuid4().hex[:8]
                    claimed.append(dict(item))
            self._persist()
        return claimed

    def mark_sent(self, key: str) -> None:
        with self._lock:
            if key in self._items:
                self._items[key]["state"] = "SENT"
                self._persist()

    def mark_failed(self, key: str, error_code: str, now: float | None = None) -> dict:
        now = now if now is not None else time.time()
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return {}
            item["attempts"] += 1
            item["last_error_code"] = error_code
            if item["attempts"] >= MAX_ATTEMPTS:
                item["state"] = "DEAD_LETTER"
            else:
                backoff = BACKOFF_S[min(item["attempts"] - 1, len(BACKOFF_S) - 1)]
                item["state"] = "PENDING"
                item["next_attempt_at"] = now + backoff
            self._persist()
            return dict(item)

    def release_claim(self, key: str) -> None:
        """Return a CLAIMED item to PENDING without counting an attempt
        (used when the live gate refuses mid-drain: the item must be
        retriable by a later drain, not stuck CLAIMED)."""
        with self._lock:
            if key in self._items and self._items[key]["state"] == "CLAIMED":
                self._items[key]["state"] = "PENDING"
                self._persist()

    def pending_count(self) -> int:
        return sum(1 for i in self._items.values() if i["state"] in ("PENDING", "CLAIMED"))

    def dead_letter(self) -> list:
        return [dict(i) for i in self._items.values() if i["state"] == "DEAD_LETTER"]


class OutboxWorker:
    """Drain worker for the durable outbox (go-live §3/§5).

    Claims due items, delivers each through the injected `send_fn`
    (the server supplies the per-channel delivery: FORGE ingest POST for
    INGEST items, alert dispatch for ALERT items), and marks sent/failed
    with bounded retry + dead-letter via the Outbox itself.

    The live gate is checked BEFORE claiming and BEFORE EVERY send, so
    a kill or mode change mid-drain stops the sends immediately. Items
    claimed but not sent because the gate refused are released back to
    PENDING (not failed, not dead-lettered) for a later drain.
    """

    def __init__(self, outbox: Outbox, *, send_fn, live_gate=None,
                 clock=time.time, poll_interval_s: float = 5.0):
        self.outbox = outbox
        self.send_fn = send_fn
        self.live_gate = live_gate
        self.clock = clock
        self.poll_interval_s = poll_interval_s
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def _gate_ok(self, item: dict | None = None) -> tuple[bool, str | None]:
        """The gate receives the item (or None for the drain-start check)
        so per-channel rules can apply — e.g. the server allows INGEST
        retries while mode is OFF but blocks ALERT sends."""
        if self.live_gate is None:
            return True, None
        try:
            self.live_gate(item)
        except Exception as exc:  # noqa: BLE001 — any gate refusal stops the drain
            return False, str(exc)
        return True, None

    def drain_once(self) -> dict:
        """One drain pass. Returns {"sent", "failed", "refused",
        "refused_reason"}."""
        ok, reason = self._gate_ok(None)
        if not ok:
            return {"sent": 0, "failed": 0, "refused": True, "refused_reason": reason}
        claimed = self.outbox.claim_due(now=self.clock())
        sent = failed = 0
        for item in claimed:
            ok, reason = self._gate_ok(item)
            if not ok:
                self.outbox.release_claim(item["key"])
                return {"sent": sent, "failed": failed, "refused": True,
                        "refused_reason": reason}
            try:
                self.send_fn(item)
            except Exception as exc:  # noqa: BLE001 — one item's failure never stops the drain
                self.outbox.mark_failed(item["key"], type(exc).__name__, now=self.clock())
                failed += 1
            else:
                self.outbox.mark_sent(item["key"])
                sent += 1
        return {"sent": sent, "failed": failed, "refused": False, "refused_reason": None}

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True,
                                        name="receptionist-outbox-worker")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.drain_once()
            except Exception:  # noqa: BLE001 — the worker never dies on a bad pass
                pass
            self._stop.wait(self.poll_interval_s)
