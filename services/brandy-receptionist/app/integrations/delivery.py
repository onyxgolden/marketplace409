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

    def pending_count(self) -> int:
        return sum(1 for i in self._items.values() if i["state"] in ("PENDING", "CLAIMED"))

    def dead_letter(self) -> list:
        return [dict(i) for i in self._items.values() if i["state"] == "DEAD_LETTER"]
