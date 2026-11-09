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
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
import uuid

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
    """

    def __init__(self, path: str, rate_version: str = "1.0"):
        self.path = path
        self.rate_version = rate_version
        self._lock = threading.Lock()
        self._entries = self._load()

    def _load(self) -> list:
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, list):
                return data
        except (OSError, ValueError):
            pass
        return []

    def _save_locked(self) -> None:
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        tmp = f"{self.path}.tmp.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self._entries, fh, indent=2, sort_keys=True)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, self.path)

    def record_call(self, *, call_sid: str, source: str, duration_s: float,
                    agent_chars: int = 0, llm_minutes: float = 0.0,
                    direction: str = "INBOUND", recording: bool = False,
                    correlation_id: str | None = None) -> dict:
        cost = estimate_call_cost_usd(
            duration_s=duration_s, agent_chars=agent_chars,
            llm_minutes=llm_minutes, direction=direction,
            recording=recording, version=self.rate_version)
        entry = {
            "id": str(uuid.uuid4()),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "kind": "call",
            "call_sid": call_sid,
            "source": source,
            "rate_version": self.rate_version,
            "usage": {"duration_s": duration_s, "agent_chars": agent_chars,
                      "llm_minutes": llm_minutes, "direction": direction,
                      "recording": recording},
            "estimated_usd": cost,
            "correlation_id": correlation_id or call_sid,
        }
        with self._lock:
            self._entries.append(entry)
            self._save_locked()
        return entry

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
        with self._lock:
            self._entries.append(entry)
            self._save_locked()
        return entry

    def total_usd(self, *, source: str | None = None) -> float:
        with self._lock:
            entries = list(self._entries)
        total = sum(e["estimated_usd"] for e in entries
                    if source is None or e.get("source") == source)
        return round(total, 6)

    def call_total_usd(self, call_sid: str) -> float:
        with self._lock:
            entries = list(self._entries)
        return round(sum(e["estimated_usd"] for e in entries
                         if e.get("call_sid") == call_sid), 6)

    def entries(self) -> list:
        with self._lock:
            return [dict(e) for e in self._entries]

    def check_call_ceiling(self, *, call_sid: str, projected_usd: float,
                           max_per_call_usd: float, max_campaign_usd: float) -> None:
        """Raise BudgetExceeded before a session/action that would breach.

        projected_usd is the worst-case additional spend for this call
        (e.g. one more minute at the blended rate). The campaign total
        includes everything already ledgered.
        """
        spent_this_call = self.call_total_usd(call_sid)
        if spent_this_call + projected_usd > max_per_call_usd:
            raise BudgetExceeded(
                f"per-call ceiling ${max_per_call_usd:.2f} would be breached "
                f"(spent ${spent_this_call:.4f} + projected ${projected_usd:.4f})")
        if self.total_usd() + projected_usd > max_campaign_usd:
            raise BudgetExceeded(
                f"campaign ceiling ${max_campaign_usd:.2f} would be breached "
                f"(spent ${self.total_usd():.4f} + projected ${projected_usd:.4f})")


def blended_minute_usd(version: str = "1.0") -> float:
    """Worst-case planning cost of one more live minute (teardown $0.04)."""
    return rate_table(version)["blended_usd_per_min"]


def ceil_minutes(duration_s: float) -> int:
    return math.ceil(max(0.0, duration_s) / 60.0)
