"""Deterministic configuration. Everything safety-relevant defaults OFF.

No credential, phone number, or real recipient lives in this file. All
operational values come from the environment at process start; anything
missing stays disabled. A developer cannot activate live telephony,
recording, or outbound emergency calls by merging alone: each requires an
explicit env flag plus (for go-live) a separate owner word.

Go-live activation model (§2/§5): the EFFECTIVE mode comes ONLY from a
signed server-side activation record (see app/activation.py). No env
flag, provider key, deployment, or migration can transition modes on its
own. The record is HMAC-signed with RECEPTIONIST_ACTIVATION_SECRET; a
missing, tampered, or unsigned record means OFF. LIVE_APPROVED can never
validate in this build: it requires an attorney-approved disclosure
revision, and no such revision exists yet (see app/policy/disclosure.py).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, "1" if default else "0").strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


ACTIVATION_MODES = ("OFF", "TEST_ONLY", "LIVE_APPROVED")


@dataclass(frozen=True)
class ReceptionistConfig:
    # --- Activation gates (all default OFF) ---------------------------------
    telephony_enabled: bool = field(default_factory=lambda: _bool("RECEPTIONIST_TELEPHONY_ENABLED", False))
    outbound_alerts_enabled: bool = field(default_factory=lambda: _bool("RECEPTIONIST_OUTBOUND_ALERTS_ENABLED", False))
    recording_enabled: bool = field(default_factory=lambda: _bool("RECEPTIONIST_RECORDING_ENABLED", False))
    # Voicemail recordings are a SEPARATE policy from AI call recording
    # (fix round 1, P2-2): the fallback TwiML records a caller's voice
    # only when this flag is on AND an attorney-APPROVED voicemail
    # disclosure exists (app/policy/disclosure.py). Either one missing
    # means no <Record> is rendered. Default OFF.
    voicemail_recording_enabled: bool = field(default_factory=lambda: _bool("RECEPTIONIST_VOICEMAIL_RECORDING_ENABLED", False))
    transcript_storage_enabled: bool = field(default_factory=lambda: _bool("RECEPTIONIST_TRANSCRIPT_STORAGE_ENABLED", False))
    live_tenant_sync_enabled: bool = field(default_factory=lambda: _bool("RECEPTIONIST_LIVE_TENANT_SYNC_ENABLED", False))

    # --- Go-live activation record (§2) -------------------------------------
    # Path to the signed activation record (JSON, HMAC-signed). Default
    # lives under the service's data/ directory (gitignored). No record
    # (or an invalid one) means OFF, whatever the env flags say.
    activation_record_path: str = field(default_factory=lambda: os.environ.get(
        "RECEPTIONIST_ACTIVATION_RECORD_PATH",
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                     "data", "activation.json")))
    # HMAC secret that signs/verifies the activation record. Env only.
    activation_secret: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_ACTIVATION_SECRET", ""))
    # Dedicated TEST number for TEST_ONLY mode. Env only; the activation
    # record must carry the same SID or TEST_ONLY does not validate.
    # No number is provisioned by this build — this is config only.
    test_number_sid: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_TEST_NUMBER_SID", ""))
    test_number_e164: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_TEST_NUMBER_E164", ""))

    # --- Kill switch (§5) ----------------------------------------------------
    # File-backed kill state, read fresh on every check so an operator
    # kill takes effect without a restart. Default under data/.
    kill_switch_path: str = field(default_factory=lambda: os.environ.get(
        "RECEPTIONIST_KILL_SWITCH_PATH",
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                     "data", "kill-switch.json")))

    # --- Fallback destination (§5) -------------------------------------------
    # Human voicemail / forwarding destination for the TEST number when the
    # worker is unreachable or killed. Env only; empty means no forwarding
    # is configured and the fallback is voicemail-only TwiML.
    fallback_forward_e164: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_FALLBACK_FORWARD_E164", ""))
    # Public base URL of this worker (used for the Twilio Media Streams
    # wss:// URL and status callbacks). Empty in offline/test runs.
    worker_public_url: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_WORKER_PUBLIC_URL", ""))
    # Port the stdlib Media Streams WebSocket gateway listens on.
    media_stream_port: int = field(default_factory=lambda: _int("RECEPTIONIST_MEDIA_STREAM_PORT", 8765))

    # --- Identity / operation -------------------------------------------------
    operation_id: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_OPERATION_ID", "brandy-rental-office"))
    policy_version: str = "brandy-receptionist-policy/1.0.0"
    forge_ingest_url: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_FORGE_INGEST_URL", ""))
    # HMAC secret for service->FORGE ingestion. Env only; never committed.
    forge_ingest_secret: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_FORGE_INGEST_SECRET", ""))
    # HMAC secret that signs Twilio Media Streams tokens. Env only; the
    # SAME secret signs (voice webhook) and verifies (media gateway) —
    # a mismatch here refuses every stream, by design.
    stream_token_secret: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_STREAM_TOKEN_SECRET", ""))
    # Durable delivery outbox (INGEST + ALERT retries). Default under data/.
    delivery_outbox_path: str = field(default_factory=lambda: os.environ.get(
        "RECEPTIONIST_DELIVERY_OUTBOX_PATH",
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                     "data", "delivery-outbox.json")))

    # --- Emergency escalation -------------------------------------------------
    # Proposed 30 s human-ack deadline; owner confirms operational practicality
    # before go-live. Backup starts immediately on known primary failure.
    emergency_ack_timeout_s: int = field(default_factory=lambda: _int("RECEPTIONIST_ACK_TIMEOUT_S", 30))
    alert_max_attempts_per_channel: int = field(default_factory=lambda: _int("RECEPTIONIST_ALERT_MAX_ATTEMPTS", 3))
    alert_retry_backoff_s: tuple = (5, 15, 60)
    # Durable alert state (restart recovery): JSON file the dispatcher
    # persists on every mutation. Default lives under the service's data/
    # directory (gitignored); override with RECEPTIONIST_ALERT_STATE_PATH.
    alert_state_path: str = field(default_factory=lambda: os.environ.get(
        "RECEPTIONIST_ALERT_STATE_PATH",
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                     "data", "alert-state.json")))
    # Operator token for the authenticated /alerts/ack path. Server env
    # only; empty means the authenticated path is disabled (fail closed).
    operator_token: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_OPERATOR_TOKEN", ""))
    # Single DTMF digit that counts as explicit acknowledgment on an alert
    # call. The production alert TwiML gathers exactly this digit.
    ack_digit: str = "1"

    # --- Budget caps (synthetic test spend; §10/§11.14) -----------------------
    max_synthetic_minutes: int = field(default_factory=lambda: _int("RECEPTIONIST_MAX_SYNTHETIC_MINUTES", 500))
    max_alert_attempts_total: int = field(default_factory=lambda: _int("RECEPTIONIST_MAX_ALERT_ATTEMPTS_TOTAL", 50))

    # --- Cost controls, go-live (§7) ------------------------------------------
    # Per-call HARD ceiling and aggregate campaign ceiling, USD. Checked
    # before provider sessions start and before expensive actions; on
    # exhaustion the call fails closed to human voicemail + operator alert.
    # Defaults are test-scale; production ceilings are set by the owner
    # with the spend word and recorded in the activation record.
    max_cost_per_call_usd: float = field(default_factory=lambda: _float("RECEPTIONIST_MAX_COST_PER_CALL_USD", 0.50))
    max_cost_campaign_usd: float = field(default_factory=lambda: _float("RECEPTIONIST_MAX_COST_CAMPAIGN_USD", 10.00))
    # Max live turns per call and max call duration (seconds); both bound
    # provider spend and runaway sessions.
    max_turns_per_call: int = field(default_factory=lambda: _int("RECEPTIONIST_MAX_TURNS_PER_CALL", 40))
    max_call_duration_s: int = field(default_factory=lambda: _int("RECEPTIONIST_MAX_CALL_DURATION_S", 1800))
    # Max concurrent AI sessions.
    max_concurrent_sessions: int = field(default_factory=lambda: _int("RECEPTIONIST_MAX_CONCURRENT_SESSIONS", 5))
    # Durable cost ledger (restart recovery): JSON file the ledger appends
    # on every chargeable event. Default under data/.
    cost_ledger_path: str = field(default_factory=lambda: os.environ.get(
        "RECEPTIONIST_COST_LEDGER_PATH",
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                     "data", "cost-ledger.json")))
    # Rate-table version the ledger prices with (see app/cost.py).
    cost_rate_version: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_COST_RATE_VERSION", "1.0"))

    # --- Latency targets (§8; measured end-to-end, never vendor claims) -------
    latency_p95_target_ms: int = 800
    latency_p99_target_ms: int = 1200
    barge_in_stop_p95_target_ms: int = 250
    emergency_alert_request_p95_target_ms: int = 2000

    # --- Dialogue --------------------------------------------------------------
    max_callback_attempts: int = 2
    replay_window_s: int = 300  # HMAC timestamp/nonce replay window

    def live_features(self) -> dict:
        """Redacted view for /health and logs. Never includes secrets."""
        return {
            "telephony_enabled": self.telephony_enabled,
            "outbound_alerts_enabled": self.outbound_alerts_enabled,
            "recording_enabled": self.recording_enabled,
            "voicemail_recording_enabled": self.voicemail_recording_enabled,
            "transcript_storage_enabled": self.transcript_storage_enabled,
            "live_tenant_sync_enabled": self.live_tenant_sync_enabled,
            "operation_id": self.operation_id,
            "policy_version": self.policy_version,
        }

    def require_live(self, feature: str) -> None:
        """Fail closed: any live path raises unless explicitly enabled."""
        enabled = {
            "telephony": self.telephony_enabled,
            "outbound_alerts": self.outbound_alerts_enabled,
            "recording": self.recording_enabled,
            "voicemail_recording": self.voicemail_recording_enabled,
            "transcript_storage": self.transcript_storage_enabled,
            "live_tenant_sync": self.live_tenant_sync_enabled,
        }.get(feature, False)
        if not enabled:
            raise DisabledError(f"{feature} is disabled by default; enable explicitly and only with a go-live word.")


class DisabledError(RuntimeError):
    """Raised when a disabled-by-default live feature is invoked."""
