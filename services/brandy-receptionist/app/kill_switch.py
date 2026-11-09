"""Kill switch (go-live §5).

One operator-accessible KILL/OFF control. The state lives in a JSON file
(default data/kill-switch.json) and is read FRESH on every check, so a
kill takes effect without a restart and without waiting for any worker.

While killed, the server must atomically:
- refuse new AI sessions,
- refuse outbound sends,
- refuse scheduled retries (the outbox worker checks before every drain),
- refuse live tenant sync,
- end active sessions and transition them to safe human fallback.

The file is written atomically (tempfile + os.replace) so a concurrent
reader never sees a torn state. Clearing a kill is itself an operator
action and is recorded with who/when/why; the audit trail is the file's
own history (each write appends to data/kill-switch-history.jsonl).
"""
from __future__ import annotations

import json
import os
import threading
import time

_LOCK = threading.Lock()


def _history_path(path: str) -> str:
    return path + ".history.jsonl"


def read_state(path: str) -> dict:
    """Current kill state. Missing file => not killed (default OFF)."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            state = json.load(fh)
        if isinstance(state, dict) and isinstance(state.get("killed"), bool):
            return state
    except (OSError, ValueError):
        pass
    return {"killed": False, "set_by": None, "set_at": None, "reason": None}


def is_killed(path: str) -> bool:
    return bool(read_state(path).get("killed"))


def _write(path: str, state: dict) -> dict:
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, sort_keys=True)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
    with open(_history_path(path), "a", encoding="utf-8") as fh:
        fh.write(json.dumps(state, sort_keys=True) + "\n")
    return state


def kill(path: str, *, reason: str, set_by: str) -> dict:
    """Engage the kill switch. Idempotent — re-killing records the new reason."""
    with _LOCK:
        state = {
            "killed": True,
            "set_by": set_by,
            "set_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "reason": reason,
        }
        return _write(path, state)


def clear(path: str, *, reason: str, set_by: str) -> dict:
    """Release the kill switch. Operator-only; the reason is audited."""
    with _LOCK:
        state = {
            "killed": False,
            "set_by": set_by,
            "set_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "reason": reason,
        }
        return _write(path, state)


class KillSwitch:
    """Bound kill-switch handle for a config."""

    def __init__(self, path: str):
        self.path = path

    def is_killed(self) -> bool:
        return is_killed(self.path)

    def state(self) -> dict:
        return read_state(self.path)

    def kill(self, *, reason: str, set_by: str) -> dict:
        return kill(self.path, reason=reason, set_by=set_by)

    def clear(self, *, reason: str, set_by: str) -> dict:
        return clear(self.path, reason=reason, set_by=set_by)

    def require_not_killed(self) -> None:
        if self.is_killed():
            raise KillSwitchEngaged("kill switch is engaged; live action refused")


class KillSwitchEngaged(RuntimeError):
    """Raised when a live action is attempted while the kill is engaged."""
