"""Deterministic configuration. Everything safety-relevant defaults OFF.

No credential, phone number, or real recipient lives in this file. All
operational values come from the environment at process start; anything
missing stays disabled. A developer cannot activate live telephony,
recording, or outbound emergency calls by merging alone: each requires an
explicit env flag plus (for go-live) a separate owner word.
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


@dataclass(frozen=True)
class ReceptionistConfig:
    # --- Activation gates (all default OFF) ---------------------------------
    telephony_enabled: bool = field(default_factory=lambda: _bool("RECEPTIONIST_TELEPHONY_ENABLED", False))
    outbound_alerts_enabled: bool = field(default_factory=lambda: _bool("RECEPTIONIST_OUTBOUND_ALERTS_ENABLED", False))
    recording_enabled: bool = field(default_factory=lambda: _bool("RECEPTIONIST_RECORDING_ENABLED", False))
    transcript_storage_enabled: bool = field(default_factory=lambda: _bool("RECEPTIONIST_TRANSCRIPT_STORAGE_ENABLED", False))
    live_tenant_sync_enabled: bool = field(default_factory=lambda: _bool("RECEPTIONIST_LIVE_TENANT_SYNC_ENABLED", False))

    # --- Identity / operation -------------------------------------------------
    operation_id: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_OPERATION_ID", "brandy-rental-office"))
    policy_version: str = "brandy-receptionist-policy/1.0.0"
    forge_ingest_url: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_FORGE_INGEST_URL", ""))
    # HMAC secret for service->FORGE ingestion. Env only; never committed.
    forge_ingest_secret: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_FORGE_INGEST_SECRET", ""))

    # --- Emergency escalation -------------------------------------------------
    # Proposed 30 s human-ack deadline; owner confirms operational practicality
    # before go-live. Backup starts immediately on known primary failure.
    emergency_ack_timeout_s: int = field(default_factory=lambda: _int("RECEPTIONIST_ACK_TIMEOUT_S", 30))
    alert_max_attempts_per_channel: int = field(default_factory=lambda: _int("RECEPTIONIST_ALERT_MAX_ATTEMPTS", 3))
    alert_retry_backoff_s: tuple = (5, 15, 60)

    # --- Budget caps (synthetic test spend; §10/§11.14) -----------------------
    max_synthetic_minutes: int = field(default_factory=lambda: _int("RECEPTIONIST_MAX_SYNTHETIC_MINUTES", 500))
    max_alert_attempts_total: int = field(default_factory=lambda: _int("RECEPTIONIST_MAX_ALERT_ATTEMPTS_TOTAL", 50))

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
            "transcript_storage": self.transcript_storage_enabled,
            "live_tenant_sync": self.live_tenant_sync_enabled,
        }.get(feature, False)
        if not enabled:
            raise DisabledError(f"{feature} is disabled by default; enable explicitly and only with a go-live word.")


class DisabledError(RuntimeError):
    """Raised when a disabled-by-default live feature is invoked."""
