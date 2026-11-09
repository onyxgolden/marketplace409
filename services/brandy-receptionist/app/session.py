"""Call session: lifecycle, append-only event log, timing traces, idempotency.

The event stream reconstructs draft state; raw unredacted audio is never
required and raw transcripts are NOT stored by default. Only minimum
needed data + redacted diagnostic metadata is kept. No plaintext phone
numbers in logs: numbers are masked (last 4 only) everywhere outside the
encrypted slot payload.
"""
from __future__ import annotations

import hashlib
import time
import uuid
from dataclasses import dataclass, field

from .config import ReceptionistConfig
from .policy.dialogue import CallDialogue


def mask_e164(e164: str | None) -> str | None:
    if not e164:
        return None
    digits = "".join(c for c in e164 if c.isdigit())
    return f"+1-***-***-{digits[-4:]}" if len(digits) >= 4 else "***"


def idempotency_key(call_sid: str, event_type: str, turn_id: str) -> str:
    """Stable per logical event: duplicate webhooks / STT partials / retries
    collapse to one logical event."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{call_sid}:{event_type}:{turn_id}"))


@dataclass
class TurnTrace:
    turn_id: str
    speech_end_at: float
    first_audio_at: float | None = None
    stt_ms: float | None = None
    llm_first_token_ms: float | None = None
    tts_first_audio_ms: float | None = None

    @property
    def end_to_end_ms(self) -> float | None:
        if self.first_audio_at is None:
            return None
        return (self.first_audio_at - self.speech_end_at) * 1000.0


class CallSession:
    def __init__(self, call_sid: str, ani: str | None = None,
                 config: ReceptionistConfig | None = None,
                 source: str = "SYNTHETIC"):
        self.call_sid = call_sid
        self.config = config or ReceptionistConfig()
        self.dialogue = CallDialogue(call_sid, ani=ani, config=self.config)
        self.started_at = time.time()
        self.ended_at: float | None = None
        self.events: list = []
        self.traces: list[TurnTrace] = []
        self._seen_keys: set = set()
        self.cost_minutes = 0.0
        # source: TEST | LIVE | SYNTHETIC. Labels every record the session
        # produces so test traffic can never be mistaken for live traffic
        # in the inbox or the ledger. Default SYNTHETIC (v1 behavior).
        self.source = source
        # Cost estimate for this call (USD, rate version), filled by the
        # server from the CostLedger at session end.
        self.cost_estimate_usd: float | None = None
        self.cost_rate_version: str | None = None
        # Alert record for this call's emergency (if any), attached by the
        # server at session end from the dispatcher — the FORGE ingest
        # route upserts it into the alerts table so the inbox timeline
        # shows attempts + ACKs. None when no emergency was detected.
        self.alert_record: dict | None = None

    def record_event(self, event_type: str, turn_id: str, payload: dict | None = None) -> dict:
        key = idempotency_key(self.call_sid, event_type, turn_id)
        if key in self._seen_keys:
            return {"deduped": True, "event_id": key}
        self._seen_keys.add(key)
        event = {
            "event_id": key, "call_id": self.call_sid, "event_type": event_type,
            "occurred_at": time.time(), "turn_id": turn_id,
            "policy_version": self.config.policy_version,
            "payload": payload or {},
        }
        self.events.append(event)
        return {"deduped": False, "event_id": key}

    def log(self, message: str, **fields) -> dict:
        """Structured log record with PII masked. Returns the record (the
        server layer decides where it goes)."""
        safe = {k: (mask_e164(v) if k in ("callback_e164", "ani") else v)
                for k, v in fields.items()}
        return {"call_sid": self.call_sid, "message": message, **safe}

    def end(self, reason: str = "completed") -> dict:
        self.ended_at = time.time()
        if self.dialogue.state in ("CLOSED", "REVIEW_AND_CLOSE"):
            self.dialogue.slots["processing_state"] = "COMPLETE"
        else:
            # A call that ends mid-capture (hangup, outage, emergency still
            # open) is INCOMPLETE — never silently COMPLETE.
            self.dialogue.slots["processing_state"] = "INCOMPLETE"
        return self.record_event("CALL_ENDED", f"t{self.dialogue.turn}",
                                 {"reason": reason, "duration_s": round(self.ended_at - self.started_at, 2)})

    def draft_kind(self) -> str | None:
        intent = self.dialogue.slots.get("intent")
        return {"LEASING": "LEASING_LEAD", "MAINTENANCE": "MAINTENANCE_INTAKE"}.get(intent, "GENERAL_MESSAGE")

    def summary(self) -> str:
        from .policy.render import render_summary
        meta = {"call_sid": self.call_sid, "started_at": self.started_at}
        return render_summary(self.dialogue.slots, self.events, meta)

    def ingest_payload(self) -> dict:
        """Payload for the FORGE ingestion endpoint. Callback is carried
        encrypted by the transport layer in production; here it is the
        validated slot value and the FORGE side encrypts at rest."""
        s = self.dialogue.slots
        return {
            "operation_id": self.config.operation_id,
            "provider_call_sid": self.call_sid,
            "started_at": self.started_at, "ended_at": self.ended_at,
            "direction": "INBOUND", "intent": s.get("intent"),
            "caller_ani_masked": mask_e164(self.dialogue.callback.ani_unverified),
            "name_claimed": s.get("caller_name"),
            "need_excerpt": (s.get("need_description") or "")[:200],
            "callback_e164": s.get("callback_e164"),
            "callback_confirmed": bool(s.get("callback_confirmed")),
            "callback_source": s.get("callback_source"),
            "property_hint": s.get("property_hint"),
            "emergency_event_id": self.dialogue.emergency_event_id,
            "emergency_type": s.get("emergency_type"),
            "consent_status": s.get("consent_status"),
            "consent_disclosure_revision": s.get("disclosure_revision_id"),
            "source": self.source,
            "cost_estimate_usd": self.cost_estimate_usd,
            "cost_rate_version": self.cost_rate_version,
            "alert": self.alert_record,
            "processing_state": s.get("processing_state"),
            "policy_version": self.config.policy_version,
            "draft_kind": self.draft_kind(),
            "events": self.events,
            "idempotency_key": idempotency_key(self.call_sid, "CALL_INGEST", "final"),
        }
