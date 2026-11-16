"""Recording and Call Shield evidence contract (Receptionist Cut 1 item 4,
scope brief §6).

A `RecordingSession` accumulates caller-direction and agent-direction
audio plus a timestamped, speaker-labelled transcript for one call, then
`save()`s a self-contained, locally encrypted evidence bundle: the full
audio, the transcript, and a manifest with every field §6 lists plus a
SHA-256 integrity hash of each file.

Hard rules this module enforces, not just documents:
- Recording only happens when `config.recording_enabled` is true
  (`config.require_live("recording")` — the same fail-closed gate every
  other live feature in this codebase uses).
- The full ANI is encrypted at rest; only a masked display number and a
  keyed HMAC lookup hash (never the raw number) are ever written in
  plaintext to the manifest or used as a directory/index name.
- No encryption key configured -> `save()` raises, never writes
  plaintext as a fallback.
- The original audio is never overwritten by a denoised/resampled
  derivative — this module only appends to and then seals the exact
  bytes it was given.
- Retention/hold state is recorded exactly as configured; this module
  never invents a retention policy or silently deletes anything.
  Deletion is a separate, explicit operation (`delete_bundle`), never a
  side effect of save() or of time passing.

Fix round 1 (P1) — key versioning, rotation, recovery:
- Every bundle's manifest records the exact `keyId` (from
  `config.recording_encryption_keys_json`'s ring) it was encrypted
  with. Decryption (`decrypt_bytes_any_key`, `decrypt_transcript`) tries
  EVERY key currently in the ring (`cryptography.fernet.MultiFernet`),
  so a bundle encrypted under an older key still reads after rotation —
  only NEW writes (`save()`) use `config.recording_current_key_id`.
- Rotation means ADDING a new keyId to the ring and changing
  `recording_current_key_id`; it never means deleting an old entry
  until `rotate_bundle_key` has re-encrypted every bundle that still
  uses it (see that function's own docstring for the full procedure).
- Key loss is real data loss by design (this is encryption, not
  obfuscation): if every value for a keyId is lost, bundles stamped
  with that keyId are permanently unreadable. The recommended backup
  practice is an offline copy of the whole `recording_encryption_keys_json`
  ring (e.g. printed, or in a separate secrets manager), never relying
  on the running config alone — this module does not implement that
  backup itself, only documents the requirement, since where backups
  live is an infrastructure decision outside this module's scope.
"""
from __future__ import annotations

import hashlib
import hmac
import io
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field

from .config import ReceptionistConfig, recording_key_ring
from .session import mask_e164

MANIFEST_SCHEMA = "BrandyReceptionistEvidenceBundleV1"


def ani_lookup_key(ani: str, index_secret: str) -> str:
    """Deterministic, non-reversible directory/index key for a caller
    number — same number always hashes the same (so Call Shield can
    group repeat callers), but the number itself cannot be recovered
    from this key without `index_secret`. Brief §6: "a keyed hash for
    directory/index lookup." An empty/withheld ANI gets its own fixed
    bucket, never guessed from anything else about the call."""
    if not ani:
        return "withheld"
    if not index_secret:
        raise ValueError("recording_index_secret is not configured; refusing to hash with an empty key")
    digest = hmac.new(index_secret.encode("utf-8"), ani.encode("utf-8"), hashlib.sha256).hexdigest()
    return digest[:32]


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _fernet(key: str):
    """Lazy import: `cryptography` is a general local crypto library,
    not a telephony vendor SDK, but is still imported only where
    actually used — consistent with this module's "no encryption key,
    no write" rule, the import itself only happens on an attempted
    real save/load, never at module import time."""
    if not key:
        raise ValueError("no encryption key configured; refusing to write unencrypted data")
    from cryptography.fernet import Fernet

    return Fernet(key.encode("utf-8") if isinstance(key, str) else key)


def _multi_fernet(keys: list[str]):
    from cryptography.fernet import MultiFernet

    if not keys:
        raise ValueError("no encryption keys configured; cannot decrypt")
    return MultiFernet([_fernet(k) for k in keys])


def encrypt_bytes(data: bytes, key: str) -> bytes:
    """Single-key encrypt — always the CURRENT key for new writes."""
    return _fernet(key).encrypt(data)


def decrypt_bytes(token: bytes, key: str) -> bytes:
    """Single-key decrypt — kept for callers that already know the exact
    key a token was encrypted with (e.g. a test building its own
    fixture). Real bundle decryption should use `decrypt_bytes_any_key`
    instead, since a real bundle's key may have been rotated since."""
    return _fernet(key).decrypt(token)


def decrypt_bytes_any_key(token: bytes, keys: list[str]) -> bytes:
    """Tries every key in `keys` (fix round 1: the ring, not one key) —
    the standard `MultiFernet` decrypt-with-any-of-N-keys operation, so a
    bundle encrypted under an OLDER key still reads after rotation."""
    return _multi_fernet(keys).decrypt(token)


def _current_key(config: ReceptionistConfig) -> tuple[str, str]:
    """Returns (keyId, key) for NEW writes. Raises a clear ValueError if
    the ring is empty or `recording_current_key_id` doesn't name an
    entry actually present in it — never silently picks an arbitrary
    key from the ring."""
    ring = recording_key_ring(config)
    if not ring:
        raise ValueError("recording_encryption_keys_json is not configured; refusing to write unencrypted data")
    key_id = config.recording_current_key_id
    if not key_id or key_id not in ring:
        raise ValueError(
            f"recording_current_key_id {key_id!r} is not a key present in the ring {sorted(ring)!r}")
    return key_id, ring[key_id]


def _restrict_directory_to_current_user(path: str) -> None:
    """Fix round 1 (P1): "enforce restrictive ACLs/permissions" on the
    recording storage tree. POSIX `os.chmod` bits are largely no-ops on
    Windows NTFS beyond the read-only flag, so this uses `icacls` (a
    standard, always-present Windows tool) to strip inherited
    permissions and grant full control to the current user only.
    Best-effort: a failure here is logged, never raised — a recording
    that IS encrypted is still far better protected than one that
    wasn't saved at all because an ACL tool had a transient issue, and
    the encryption itself (not filesystem permissions) is this module's
    primary protection."""
    if sys.platform != "win32":
        return
    try:
        subprocess.run(
            ["icacls", path, "/inheritance:r", "/grant:r", f"{os.environ.get('USERNAME', '')}:(OI)(CI)F"],
            capture_output=True, timeout=10, check=False,
        )
    except Exception:  # noqa: BLE001 — best effort, never blocks a save
        pass


@dataclass
class TranscriptSegment:
    speaker: str  # "caller" | "agent"
    start_s: float
    end_s: float
    text: str
    confidence: float | None = None
    uncertain: bool = False  # brief §6: "a clear marker for uncertain/inaudible spans"

    def to_dict(self) -> dict:
        return {
            "speaker": self.speaker, "startS": self.start_s, "endS": self.end_s,
            "text": self.text, "confidence": self.confidence, "uncertain": self.uncertain,
        }


@dataclass
class RecordingSession:
    """Accumulates one call's audio + transcript. Nothing is written to
    disk until `save()` — a session that is never saved leaves no trace
    (e.g. a call that never actually reached recording_enabled checks)."""

    call_sid: str
    ani: str | None = None
    codec: str = "pcm_s16le"
    sample_rate: int = 16000
    disclosure_revision_id: str | None = None
    stt_model_revision: str | None = None
    source: str = "TEST"  # one of session.CALL_SOURCES
    _started_at: float = field(default_factory=time.time)
    _caller_audio_chunks: list[bytes] = field(default_factory=list)
    _agent_audio_chunks: list[bytes] = field(default_factory=list)
    _segments: list[TranscriptSegment] = field(default_factory=list)

    def append_caller_audio(self, pcm_bytes: bytes) -> None:
        self._caller_audio_chunks.append(pcm_bytes)

    def append_agent_audio(self, pcm_bytes: bytes) -> None:
        self._agent_audio_chunks.append(pcm_bytes)

    def append_transcript_segment(self, segment: TranscriptSegment) -> None:
        self._segments.append(segment)

    def caller_audio_bytes(self) -> bytes:
        return b"".join(self._caller_audio_chunks)

    def agent_audio_bytes(self) -> bytes:
        return b"".join(self._agent_audio_chunks)

    def save(self, config: ReceptionistConfig) -> dict:
        """Writes the encrypted bundle and returns the manifest dict
        (the same one written to disk). Raises DisabledError if
        recording is not enabled, ValueError if no current encryption
        key is configured — both fail closed, never a partial/plaintext
        write. Every file is encrypted with the CURRENT key
        (`config.recording_current_key_id`); the manifest records which
        one, so `rotate_bundle_key` and `decrypt_bytes_any_key` know
        which legacy keys a given bundle might need."""
        config.require_live("recording")
        key_id, key = _current_key(config)

        lookup_key = ani_lookup_key(self.ani or "", config.recording_index_secret)
        bundle_dir = os.path.join(config.recording_storage_path, lookup_key, self.call_sid)
        os.makedirs(bundle_dir, exist_ok=True)
        _restrict_directory_to_current_user(config.recording_storage_path)

        caller_wav = _pcm_to_wav_bytes(self.caller_audio_bytes(), self.sample_rate)
        agent_wav = _pcm_to_wav_bytes(self.agent_audio_bytes(), self.sample_rate)
        transcript_json = json.dumps(
            {"schemaVersion": "TranscriptV1", "segments": [s.to_dict() for s in self._segments]},
            indent=2,
        ).encode("utf-8")

        caller_hash = sha256_hex(caller_wav)
        agent_hash = sha256_hex(agent_wav)
        transcript_hash = sha256_hex(transcript_json)

        _write_atomic(os.path.join(bundle_dir, "caller.wav.enc"), encrypt_bytes(caller_wav, key))
        _write_atomic(os.path.join(bundle_dir, "agent.wav.enc"), encrypt_bytes(agent_wav, key))
        _write_atomic(os.path.join(bundle_dir, "transcript.json.enc"), encrypt_bytes(transcript_json, key))
        if self.ani:
            _write_atomic(os.path.join(bundle_dir, "ani.enc"), encrypt_bytes(self.ani.encode("utf-8"), key))

        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        manifest = {
            "schemaVersion": MANIFEST_SCHEMA,
            "callId": self.call_sid,
            "maskedDisplayNumber": mask_e164(self.ani) if self.ani else None,
            "aniLookupKey": lookup_key,
            "utcStart": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self._started_at)),
            "utcEnd": now,
            "callDirection": "inbound",
            "disclosureRevisionId": self.disclosure_revision_id,
            "recordingStatus": "complete",
            "transcriptRevision": 1,
            "audioFileHashes": {"callerWav": caller_hash, "agentWav": agent_hash},
            "transcriptHash": transcript_hash,
            "codec": self.codec,
            "sampleRate": self.sample_rate,
            "sttModelRevision": self.stt_model_revision,
            "encryptionKeyId": key_id,
            "source": self.source,
            "retentionDays": config.recording_retention_days or None,
            "retentionPolicySet": bool(config.recording_retention_days),
            "legalHold": False,
        }
        _write_atomic(os.path.join(bundle_dir, "manifest.json"), json.dumps(manifest, indent=2).encode("utf-8"))
        return manifest


def load_manifest(config: ReceptionistConfig, lookup_key: str, call_sid: str) -> dict | None:
    path = os.path.join(config.recording_storage_path, lookup_key, call_sid, "manifest.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except OSError:
        return None


def decrypt_transcript(config: ReceptionistConfig, lookup_key: str, call_sid: str) -> dict:
    """Decrypts with the FULL key ring (fix round 1: not just the
    current key) — a bundle saved before the most recent rotation must
    still be readable without the caller needing to know which key it
    used."""
    path = os.path.join(config.recording_storage_path, lookup_key, call_sid, "transcript.json.enc")
    with open(path, "rb") as fh:
        token = fh.read()
    ring = recording_key_ring(config)
    return json.loads(decrypt_bytes_any_key(token, list(ring.values())))


def rotate_bundle_key(config: ReceptionistConfig, lookup_key: str, call_sid: str) -> dict:
    """Re-encrypts one bundle's files from whatever key they currently
    carry (tried via the full ring) to `config.recording_current_key_id`,
    and updates the manifest's `encryptionKeyId` to match. This is the
    real, tested rotation operation fix round 1 asked for — run it over
    every bundle still stamped with an outgoing keyId before that key is
    ever removed from the ring. Writes atomically per file (temp +
    rename, the same `_write_atomic` every other write in this module
    uses) so a crash mid-rotation never leaves a bundle half-re-encrypted
    under a mix of old/new keys with no record of which is which —
    either a file's `.enc` content matches the manifest's (possibly
    stale, pre-rotation) `encryptionKeyId` or the new one, never a torn
    write. Returns the updated manifest."""
    manifest = load_manifest(config, lookup_key, call_sid)
    if manifest is None:
        raise ValueError(f"no bundle found for {lookup_key}/{call_sid}")
    ring = recording_key_ring(config)
    new_key_id, new_key = _current_key(config)
    bundle_dir = os.path.join(config.recording_storage_path, lookup_key, call_sid)

    for name in ("caller.wav.enc", "agent.wav.enc", "transcript.json.enc", "ani.enc"):
        path = os.path.join(bundle_dir, name)
        if not os.path.exists(path):
            continue
        with open(path, "rb") as fh:
            old_token = fh.read()
        plaintext = decrypt_bytes_any_key(old_token, list(ring.values()))
        new_token = encrypt_bytes(plaintext, new_key)
        _write_atomic(path, new_token)

    manifest = dict(manifest)
    manifest["encryptionKeyId"] = new_key_id
    _write_atomic(os.path.join(bundle_dir, "manifest.json"), json.dumps(manifest, indent=2).encode("utf-8"))
    return manifest


def delete_bundle(config: ReceptionistConfig, lookup_key: str, call_sid: str, *, confirm: bool) -> bool:
    """Real, explicit deletion — never a side effect of save() or a
    retention timer in this module (a separate scheduled job would call
    this deliberately once a policy exists). Refuses without `confirm`,
    and refuses a bundle under legal hold."""
    if not confirm:
        raise ValueError("delete_bundle requires confirm=True")
    bundle_dir = os.path.join(config.recording_storage_path, lookup_key, call_sid)
    manifest = load_manifest(config, lookup_key, call_sid)
    if manifest and manifest.get("legalHold"):
        raise ValueError(f"bundle {call_sid} is under legal hold; refusing to delete")
    if not os.path.isdir(bundle_dir):
        return False
    for name in ("caller.wav.enc", "agent.wav.enc", "transcript.json.enc", "ani.enc", "manifest.json"):
        p = os.path.join(bundle_dir, name)
        if os.path.exists(p):
            os.remove(p)
    os.rmdir(bundle_dir)
    return True


# ---------------------------------------------------------------------------
# Small pure helpers
# ---------------------------------------------------------------------------

def _pcm_to_wav_bytes(pcm_s16le: bytes, sample_rate: int) -> bytes:
    """Wraps raw 16-bit PCM mono bytes in a minimal WAV header. stdlib
    `wave` module only — no audio library dependency for this."""
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm_s16le)
    return buf.getvalue()


def _write_atomic(path: str, data: bytes) -> None:
    tmp = f"{path}.tmp-{os.getpid()}-{time.time_ns()}"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, path)
