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


class RecordingAclError(RuntimeError):
    """Fix round 2 (P1 — ChatGPT re-review 2026-11-16): the ACL contract
    is now ENFORCED, not best-effort. Raised when the recording bundle
    directory's access cannot be restricted to the current user AND
    independently verified — a recording that cannot be proven access-
    restricted must not be saved at all."""


def _restrict_directory_to_current_user(path: str) -> None:
    """Fix round 2 (P1): restricts `path` to the current user only and
    VERIFIES the result by querying the ACL back, raising
    `RecordingAclError` on any failure to apply OR verify. Fix round 1's
    version called `icacls` with `check=False` and swallowed every
    exception — a transient or silent icacls failure left the bundle
    directory with its ORIGINAL (inherited, multi-principal) permissions
    while `save()` proceeded as if it had been restricted. Called on the
    call's own `bundle_dir` (not just the storage root) BEFORE any file
    is written into it — Windows ACL inheritance is live, so files
    written afterward automatically inherit this single-principal ACL
    (verified empirically: a file created after restriction shows only
    the current user, no SYSTEM/Administrators), which is what "the
    entire bundle tree" means here: restrict the tree's root once, at
    creation, before anything exists under it, and verify that root.

    POSIX: `os.chmod` IS meaningful there (unlike on NTFS) — recurses
    0o700 on directories / 0o600 on files and verifies via `os.stat`."""
    if sys.platform == "win32":
        username = os.environ.get("USERNAME", "")
        if not username:
            raise RecordingAclError(
                f"cannot restrict ACL on {path!r}: USERNAME environment variable is not set")
        for args in (["icacls", path, "/inheritance:r"],
                     ["icacls", path, "/grant:r", f"{username}:(OI)(CI)F"]):
            try:
                result = subprocess.run(args, capture_output=True, timeout=30, check=False, text=True)
            except Exception as exc:  # noqa: BLE001 — fail closed, not swallowed
                raise RecordingAclError(f"{' '.join(args)} failed to run: {exc}") from exc
            if result.returncode != 0:
                raise RecordingAclError(
                    f"{' '.join(args)} exited {result.returncode}: "
                    f"{(result.stderr or result.stdout).strip()}")
        _verify_restricted_to_current_user_win32(path)
    else:
        try:
            for root, dirs, files in os.walk(path):
                os.chmod(root, 0o700)
                for fname in files:
                    os.chmod(os.path.join(root, fname), 0o600)
        except Exception as exc:  # noqa: BLE001 — fail closed, not swallowed
            raise RecordingAclError(f"chmod failed restricting {path!r}: {exc}") from exc
        mode = os.stat(path).st_mode & 0o777
        if mode != 0o700:
            raise RecordingAclError(f"verified mode {oct(mode)} for {path!r}, expected 0o700")


def _current_user_identities_win32() -> set[str]:
    """Fix round 3 (P1 — ChatGPT re-review 2026-11-17): exact,
    resolvable identifiers for the CURRENT Windows user, never a
    substring to match against. Fix round 2's verification used
    `username.upper() in p` — a substring test. The reviewer proved
    this lets an ACE for a DIFFERENT account that merely CONTAINS the
    username as a substring (e.g. `OTHERDOMAIN\\JASON-GUEST` when the
    real user is `JASON`) pass as if it were the current user — in the
    worst case, satisfying "the current user is present" even when the
    REAL current user's own ACE is entirely absent.

    `whoami /user /fo csv` is the authoritative, always-available
    source (ships with Windows, needs no extra dependency): its one
    data row's first field is the exact `DOMAIN\\username` string this
    session is running as.

    Fix round 4 (P1 — ChatGPT re-review 2026-11-17): fix round 3's
    version parsed whoami correctly but then UNCONDITIONALLY unioned in
    `USERDOMAIN\\USERNAME` and `COMPUTERNAME\\USERNAME` as well, even
    when whoami had already succeeded — the comment said "fallback
    only if whoami fails" but the code never enforced that. On a
    domain-joined machine the real principal may be `CORP\\JASON` while
    a different LOCAL account `HOST\\JASON` also exists; the old code
    admitted both as "the current user," so an ACE for `HOST\\JASON`
    alone (the real `CORP\\JASON` entry entirely absent) could pass.
    Now: if whoami yields a usable identity, return ONLY that — the
    env-var-derived aliases are used only when whoami itself could not
    be run or produced nothing, never layered on top of a successful
    whoami result."""
    try:
        result = subprocess.run(
            ["whoami", "/user", "/fo", "csv"], capture_output=True, timeout=10, check=False, text=True)
        if result.returncode == 0:
            import csv
            import io

            rows = list(csv.reader(io.StringIO(result.stdout)))
            if len(rows) >= 2 and rows[1] and rows[1][0].strip():
                return {rows[1][0].strip().upper()}
    except Exception:  # noqa: BLE001 — fall through to the env-var fallback below
        pass
    # whoami was unavailable or produced nothing usable — fall back to
    # env-var-derived aliases ONLY in this case, never unioned with an
    # already-successful whoami result above.
    identities: set[str] = set()
    username = os.environ.get("USERNAME", "")
    if username:
        for domain in (os.environ.get("USERDOMAIN", ""), os.environ.get("COMPUTERNAME", "")):
            if domain:
                identities.add(f"{domain}\\{username}".upper())
    return identities


def _verify_restricted_to_current_user_win32(path: str) -> None:
    """Queries `icacls path` back and confirms no principal beyond the
    EXACT current user (by identity, never by substring — see
    `_current_user_identities_win32`) and a small, fixed set of
    OS-trusted pseudo-accounts has an ACE.

    Verified empirically (fix round 2): even a freshly restricted
    directory under `%TEMP%` still shows `NT AUTHORITY\\SYSTEM`,
    `BUILTIN\\Administrators`, and `OWNER RIGHTS` alongside the current
    user — Windows re-adds these regardless of `/inheritance:r`. They
    are not a leak: SYSTEM and Administrators can always reach local
    files on this machine via their own privileges irrespective of any
    ACL, and OWNER RIGHTS/CREATOR OWNER are placeholder SIDs, not an
    actual additional reader. Requiring EXACTLY one principal (as a
    first attempt at this check did) made every real save fail closed —
    the wrong failure mode for a check whose purpose is to catch an
    actual leak (Everyone, Users, Authenticated Users, or some other
    named or impostor account). Raises RecordingAclError when any
    principal outside (always-allowed ∪ {exact current-user identity})
    is present, when the real current-user identity is missing
    entirely, OR when the current user's identity could not be
    determined at all (fails closed rather than skipping the check)."""
    current_user_identities = _current_user_identities_win32()
    if not current_user_identities:
        raise RecordingAclError(
            f"could not determine the current Windows user's exact identity to verify {path!r} against "
            f"(whoami failed and no USERDOMAIN/COMPUTERNAME env var was set) — refusing to save")

    try:
        result = subprocess.run(["icacls", path], capture_output=True, timeout=30, check=False, text=True)
    except Exception as exc:  # noqa: BLE001
        raise RecordingAclError(f"icacls verification query failed to run on {path!r}: {exc}") from exc
    if result.returncode != 0:
        raise RecordingAclError(
            f"icacls verification query exited {result.returncode} for {path!r}: {result.stderr.strip()}")

    principals: set[str] = set()
    for i, raw_line in enumerate(result.stdout.splitlines()):
        line = raw_line.strip()
        if not line:
            break  # the ACE list ends at the first blank line; a summary follows
        low = line.lower()
        if low.startswith("successfully processed") or low.startswith("failed processing"):
            break
        if i == 0 and low.startswith(path.lower()):
            line = line[len(path):].strip()
        if ":" not in line:
            continue
        principal = line.split(":", 1)[0].strip()
        if principal:
            principals.add(principal.upper())

    always_allowed = {"NT AUTHORITY\\SYSTEM", "BUILTIN\\ADMINISTRATORS", "OWNER RIGHTS", "CREATOR OWNER"}
    # Fix round 3: EXACT set membership against the real current-user
    # identities, never `username in principal` — an impostor account
    # that merely contains the username as a substring no longer
    # satisfies either "present" or "allowed".
    user_present = bool(principals & current_user_identities)
    unexpected = principals - always_allowed - current_user_identities
    if unexpected or not user_present:
        raise RecordingAclError(
            f"recording bundle {path!r} shows unexpected ACL principal(s) {unexpected!r} and/or is "
            f"missing the current user's exact identity {current_user_identities!r} after restriction — "
            f"found {principals!r}; refusing to save")


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
        # Fix round 2 (P1): enforced, not best-effort — raises
        # RecordingAclError (uncaught here, so save() fails closed) if
        # either directory cannot be restricted AND verified. The
        # bundle_dir restriction is the one that actually matters (it's
        # freshly created and empty, so restricting it covers "the
        # entire bundle tree" before any file exists under it); the
        # storage-root restriction is defense in depth for siblings.
        _restrict_directory_to_current_user(config.recording_storage_path)
        _restrict_directory_to_current_user(bundle_dir)

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
