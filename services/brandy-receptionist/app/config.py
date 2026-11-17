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
missing, tampered, or unsigned record means OFF. Local-build Cut 1
(2026-11-16) pinned an APPROVED disclosure revision (Jason's own exact
wording, not an attorney sign-off — see app/policy/disclosure.py), so
LIVE_APPROVED can now validate when every OTHER requirement is also met
(signed record, owner_word, non-empty rehearsal_receipts) — still never
from a merge or an env flag alone.
"""
from __future__ import annotations

import json
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
    # Local-build Cut 1 (2026-11-16): local STT/LLM/TTS providers (no
    # cloud, no spend, no PSTN — see app/providers.py's local_* factories).
    # Gated the same way as every other feature here for consistency,
    # even though constructing these carries no telephony/cost risk by
    # itself; Stage 0 rehearsal scripts set this explicitly.
    local_inference_enabled: bool = field(default_factory=lambda: _bool("RECEPTIONIST_LOCAL_INFERENCE_ENABLED", False))
    # Fix round 1 (P1): both URLs are validated as literal loopback HTTP
    # addresses before use (see `validate_loopback_url` below) — a
    # misconfigured value can never send audio to a non-loopback host.
    local_inference_base_url: str = field(default_factory=lambda: os.environ.get(
        "RECEPTIONIST_LOCAL_INFERENCE_URL", "http://127.0.0.1:8809"))
    ollama_base_url: str = field(default_factory=lambda: os.environ.get(
        "RECEPTIONIST_OLLAMA_URL", "http://127.0.0.1:11434"))
    ollama_model: str = field(default_factory=lambda: os.environ.get(
        "RECEPTIONIST_OLLAMA_MODEL", "qwen3:8b"))
    # Fix round 1 (P1): per-install bearer token the local_inference
    # server requires on every POST and the Python adapters attach to
    # every request — the loopback bind alone does not stop a hostile
    # browser-origin request from reaching it (see
    # local_inference/server.py's module docstring). Empty means the
    # server runs with NO auth check, which main() below refuses to do
    # by generating one automatically if unset; a caller must still read
    # the same value this config reads (the generated token is persisted
    # to `local_inference_auth_token_path` so both sides agree on it).
    local_inference_auth_token: str = field(default_factory=lambda: os.environ.get("RECEPTIONIST_LOCAL_INFERENCE_TOKEN", ""))
    local_inference_auth_token_path: str = field(default_factory=lambda: os.environ.get(
        "RECEPTIONIST_LOCAL_INFERENCE_TOKEN_PATH",
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "local-inference-token.txt")))

    # --- Recording + evidence contract (brief §6; app/recording.py) ----------
    # Root directory for encrypted recordings/transcripts/manifests.
    # Default under data/ (gitignored); never committed.
    recording_storage_path: str = field(default_factory=lambda: os.environ.get(
        "RECEPTIONIST_RECORDING_STORAGE_PATH",
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "recordings")))
    # Fix round 1 (P1): versioned keyring, not one bare key. JSON object
    # string, keyId -> Fernet key (urlsafe base64, 32 bytes), e.g.
    # '{"k1":"<fernet key>"}'. Decryption tries every key in this ring
    # (`cryptography.fernet.MultiFernet`), so a bundle encrypted under an
    # OLD key still reads after rotation — rotation means ADDING a new
    # keyId here and changing `recording_current_key_id`, never deleting
    # an old entry until every bundle using it has been re-encrypted
    # (see `recording.py`'s `rotate_bundle_key`). Env only; empty means
    # recording.py refuses to write anything — there is no "write
    # unencrypted" fallback. Losing every key's value in this ring means
    # the bundles encrypted under it are permanently unrecoverable by
    # design (real encryption, not obfuscation) — back up the ring
    # itself (e.g. a printed/offline copy), not just this running config.
    recording_encryption_keys_json: str = field(default_factory=lambda: os.environ.get(
        "RECEPTIONIST_RECORDING_ENCRYPTION_KEYS_JSON", ""))
    # Which keyId in the ring above new writes use. Must be a key present
    # in `recording_encryption_keys_json`; recording.py raises otherwise.
    recording_current_key_id: str = field(default_factory=lambda: os.environ.get(
        "RECEPTIONIST_RECORDING_CURRENT_KEY_ID", ""))
    # HMAC secret for the ANI lookup-key hash (brief §6: "keyed hash for
    # directory/index lookup" — never the raw number, never reversible
    # without this secret). Env only.
    recording_index_secret: str = field(default_factory=lambda: os.environ.get(
        "RECEPTIONIST_RECORDING_INDEX_SECRET", ""))
    # Retention policy, in days. None/0 = "no policy set yet" — a Jason
    # decision owed before LIVE_APPROVED (brief §6/§10); recording.py
    # records whatever policy is configured but never invents one and
    # never claims indefinite retention when none is set.
    recording_retention_days: int = field(default_factory=lambda: _int("RECEPTIONIST_RECORDING_RETENTION_DAYS", 0))

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
    # Fix round 1 (P1): a latency PASS says nothing about reliability —
    # a receipt where every 10th turn errors out could still show a
    # fine p95 over the turns that happened to succeed. 0.99 means at
    # most 1 in 100 turns may fail a stage outright before the receipt
    # calls itself a PASS.
    stage0_success_rate_target: float = 0.99
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
            "local_inference_enabled": self.local_inference_enabled,
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
            "local_inference": self.local_inference_enabled,
        }.get(feature, False)
        if not enabled:
            raise DisabledError(f"{feature} is disabled by default; enable explicitly and only with a go-live word.")


def recording_key_ring(config) -> dict:
    """Parses `recording_encryption_keys_json` into {keyId: fernetKey}.
    Empty dict (never raises) if unset/malformed — `recording.py`'s own
    `save()`/`decrypt_*` calls then raise their own clear "no key
    configured" error rather than this helper failing ambiguously."""
    if not config.recording_encryption_keys_json:
        return {}
    try:
        ring = json.loads(config.recording_encryption_keys_json)
    except ValueError:
        return {}
    if not isinstance(ring, dict):
        return {}
    return {str(k): str(v) for k, v in ring.items()}


_LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "[::1]", "::1")


def validate_loopback_url(url: str, *, label: str) -> None:
    """Fix round 1 (P1): fails closed unless `url` is a literal
    `http://` loopback address — never `https` (no TLS cert exists for
    127.0.0.1, so an `https` value here could only mean a misconfiguration
    or an attempt to point this at something else), never a hostname that
    merely RESOLVES to loopback at this instant (DNS can change under a
    TOCTOU race; only the literal address strings above are accepted),
    and never a value carrying userinfo/query/fragment components that
    could smuggle a different real destination past a naive check.
    Raises ValueError with the exact reason on any violation."""
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    if parts.scheme != "http":
        raise ValueError(f"{label} must be http:// (got scheme {parts.scheme!r}): {url!r}")
    if parts.username or parts.password:
        raise ValueError(f"{label} must not carry userinfo: {url!r}")
    if parts.query or parts.fragment:
        raise ValueError(f"{label} must not carry a query or fragment: {url!r}")
    hostname = parts.hostname or ""
    if hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError(f"{label} must be a literal loopback address (127.0.0.1/localhost/::1), got {hostname!r}: {url!r}")
    if parts.path not in ("", "/"):
        raise ValueError(f"{label} must not carry a path (the client appends its own): {url!r}")


def read_local_inference_token(config) -> str:
    """Client-side read: the env value if set, else whatever the server
    persisted to `local_inference_auth_token_path`. Never generates —
    only the server (see `ensure_local_inference_token`) does that.
    Returns "" if neither exists (the caller then sends no Authorization
    header, which the server — if it generated its own token — rejects,
    fail closed, never silently skipping the auth check)."""
    if config.local_inference_auth_token:
        return config.local_inference_auth_token
    try:
        with open(config.local_inference_auth_token_path, "r", encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def ensure_local_inference_token(config) -> str:
    """Server-side: the env value if set, else the persisted file's
    content if it already exists, else a freshly generated random token
    written to that file so the client (reading the same path) can agree
    on it without the value ever living in a committed file or an env
    var shared between processes."""
    if config.local_inference_auth_token:
        return config.local_inference_auth_token
    existing = read_local_inference_token(config)
    if existing:
        return existing
    import secrets

    token = secrets.token_urlsafe(32)
    path = config.local_inference_auth_token_path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(token)
    return token


class DisabledError(RuntimeError):
    """Raised when a disabled-by-default live feature is invoked."""
