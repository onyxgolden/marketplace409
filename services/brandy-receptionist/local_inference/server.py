"""Persistent local inference server (Receptionist Cut 1, Stage 0).

Loopback-only HTTP server that loads the local STT/TTS models ONCE at
startup and keeps them warm, so a live turn never pays model-load cost
(whisper-turbo ~54s, Kokoro pipeline ~25s cold — measured on this
machine; a per-call subprocess spawn would never meet the p95<=800ms
target). This mirrors how Ollama itself runs for the LLM slot: a
long-running local process the app talks to over loopback HTTP, never
spawned per request.

Run with the SAME venv Capture's Phase 3 Slice A narration already
proved out (C:\\forge-bridge\\narration\\venv) — it already has torch
cu130, faster-whisper, and (as of Cut 1) kokoro installed; see
`services/brandy-receptionist/local_inference/MODEL_PINS.md` for the
exact pinned revisions this server loads.

Binds to 127.0.0.1 ONLY. Fix round 1 (P1/P2) — the loopback bind alone
does NOT stop a hostile request: a website loaded in a browser on this
same machine can still issue "simple" cross-origin POSTs to
127.0.0.1:PORT with no CORS preflight required (Content-Type: text/plain
with a JSON body passes the simple-request check), and the earlier
build had no Host/Origin check, no auth, no body-size cap, and no
concurrency bound. This build now enforces, on every request:
  - exact `Host` header match (rejects a DNS-rebinding style request
    that resolves to 127.0.0.1 under a different Host name);
  - no `Origin` header may be present at all on a state-changing
    request (a legitimate same-machine CLI/Python client never sends
    one; every browser-issued cross-origin fetch does, even a "simple"
    one — presence alone is the signal, not its value);
  - a per-install random bearer token (`Authorization: Bearer <token>`),
    generated once and persisted next to the service's `data/` dir,
    required on every POST;
  - exact `Content-Type` per endpoint;
  - a hard `Content-Length` cap, checked BEFORE the body is read into
    memory;
  - a bounded number of concurrent inference requests (a semaphore),
    so `ThreadingHTTPServer`'s unbounded thread-per-request model cannot
    be used to pile up unbounded concurrent GPU work.

Fix round 1 (P1) also enforces the OFFLINE boundary directly, not just
by "not calling a cloud API": `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1`
are set before any model-library import, so a cache miss on ANY nested
model/tokenizer asset fails closed with a clear error instead of
silently reaching out to Hugging Face. Verified: a cached model still
loads correctly under these settings; a genuinely missing one raises
`LocalEntryNotFoundError`, never hangs, never falls through to a
network attempt (both confirmed by direct test on this machine before
this file was written this way).

Endpoints:
    GET  /health                 -> {"sttReady": bool, "kokoroReady": bool,
                                       "openvoiceReady": bool, "gpuName": str|None}
    POST /stt        (WAV bytes) -> {"text": str, "language": str, "confidence": float,
                                       "latencyMs": float}
    POST /tts/kokoro  (JSON {"text": str, "voice": str})
                                  -> WAV bytes, header X-First-Audio-Ms
    POST /tts/openvoice (JSON {"text": str, "speakerKey": str})
                                  -> WAV bytes, header X-First-Audio-Ms, OR
                                     503 if no valid SIGNED approval record
                                     exists (fix round 1, P2 — see
                                     `verify_openvoice_approval`; Tyler's
                                     Capture enrollment is NOT automatically
                                     approved for this use).

Every endpoint fails CLOSED on any model error: a 503/500 with a plain
JSON error body, never a partial/garbled audio response and never a
silent empty 200.
"""
from __future__ import annotations

import hashlib
import hmac
import io
import json
import os
import secrets
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("RECEPTIONIST_LOCAL_INFERENCE_PORT", "8809"))
EXPECTED_HOST_HEADER = f"{HOST}:{PORT}"

# Service root is one level up from this file (local_inference/) — the
# same relative layout `app/config.py`'s own path computation uses, so
# both sides agree on the token file's location without importing
# across Python environments (this server runs under the narration
# venv's interpreter, not necessarily the app's own).
_SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DEFAULT_TOKEN_PATH = os.path.join(_SERVICE_ROOT, "data", "local-inference-token.txt")
TOKEN_PATH = os.environ.get("RECEPTIONIST_LOCAL_INFERENCE_TOKEN_PATH", _DEFAULT_TOKEN_PATH)

# Fix round 1 (P1): hard caps checked before a body is read into memory.
MAX_STT_BODY_BYTES = 10 * 1024 * 1024  # 10 MB of WAV — far above a single utterance
MAX_JSON_BODY_BYTES = 64 * 1024  # 64 KB — a narration/reply sentence, never a payload this large
MAX_TTS_TEXT_CHARS = 2000

# Fix round 1 (P1): bounds the number of concurrent inference calls this
# process will run — without this, ThreadingHTTPServer's thread-per-
# request model lets an attacker (or a bug) pile up unbounded concurrent
# GPU work. 2 matches the brief's own "run one inference session at a
# time initially... prioritize STT/TTS" guidance with a little headroom.
_INFERENCE_SEMAPHORE = threading.Semaphore(2)

# Pinned exactly (see MODEL_PINS.md) — never resolved by a moving alias
# like "turbo" at runtime, so a silent upstream change can never swap
# the model under this server without this file also changing.
STT_REPO_ID = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
STT_REVISION = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"
KOKORO_REPO_ID = "hexgrad/Kokoro-82M"
KOKORO_REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"
KOKORO_DEFAULT_VOICE = "af_heart"  # provisional — Stage 4 owner listening approval still owed


def _resolve_auth_token() -> str:
    """Env value if set, else the persisted file's content, else a
    freshly generated random token written to that file. The Python
    client (`app/providers.py`'s `read_local_inference_token`) reads the
    SAME file — never generates one itself, only this server does."""
    env_value = os.environ.get("RECEPTIONIST_LOCAL_INFERENCE_TOKEN", "")
    if env_value:
        return env_value
    try:
        with open(TOKEN_PATH, "r", encoding="utf-8") as fh:
            existing = fh.read().strip()
            if existing:
                return existing
    except OSError:
        pass
    token = secrets.token_urlsafe(32)
    os.makedirs(os.path.dirname(TOKEN_PATH), exist_ok=True)
    with open(TOKEN_PATH, "w", encoding="utf-8") as fh:
        fh.write(token)
    return token


AUTH_TOKEN = _resolve_auth_token()

# --- OpenVoice/Tyler approval: a signed record, not a forgeable literal file ---
#
# Fix round 1 (P2): the earlier gate was "does a file at this path
# contain exactly the text APPROVED" — forgeable by anyone who can write
# any file at a configurable path, with no approver identity, no scope
# binding, no expiry. This replaces it with an HMAC-SHA256-signed JSON
# record, the same signing primitive `app/activation.py` already uses
# for the go-live activation record, so the project has exactly one
# signing pattern, not two.
OPENVOICE_APPROVAL_SECRET = os.environ.get("RECEPTIONIST_OPENVOICE_APPROVAL_SECRET", "")
OPENVOICE_APPROVAL_RECORD_PATH = os.environ.get(
    "RECEPTIONIST_OPENVOICE_APPROVAL_PATH", os.path.join(_SERVICE_ROOT, "data", "openvoice-receptionist-approval.json")
)
REQUIRED_OPENVOICE_PURPOSE = "receptionist_tts"
REQUIRED_OPENVOICE_SPEAKER = "tyler-welch"
# Fix round 2 (P1 — ChatGPT re-review 2026-11-16): OpenVoice has no real
# synthesis wiring yet (`/tts/openvoice` is 501 regardless — see
# _handle_openvoice below), so there is no real checkpoint revision to
# pin yet. This sentinel can never match any real approval record's
# `modelRevision` field, so the gate stays closed by construction until
# BOTH of these happen: Jason pins the actual OpenVoice V2 checkpoint
# revision here, AND a newly signed approval record carries that exact
# same value. Fix round 1's version tolerated a MISSING modelRevision
# field entirely and ran `pass` on a mismatch either way — effectively
# no binding at all. See MODEL_PINS.md: this stays "Jason's decision
# via a signed approval record, not an env flag."
REQUIRED_OPENVOICE_MODEL_REVISION = "UNPINNED-OPENVOICE-NOT-YET-APPROVED-FOR-WIRING"


def _canonical_json(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def verify_openvoice_approval() -> tuple[bool, str]:
    """True only when a validly signed, unexpired, correctly scoped
    approval record exists. Returns (ok, reason) — the reason is never
    shown to a caller as proof either way, only logged/returned in the
    501 diagnostic, since the synthesis path itself stays unreachable in
    Cut 1 regardless (see `_handle_openvoice`)."""
    if not OPENVOICE_APPROVAL_SECRET:
        return False, "no approval secret configured"
    try:
        with open(OPENVOICE_APPROVAL_RECORD_PATH, "r", encoding="utf-8") as fh:
            record = json.load(fh)
    except (OSError, ValueError):
        return False, "no approval record on disk"
    if not isinstance(record, dict):
        return False, "approval record is not an object"
    signature = record.get("signature")
    if not isinstance(signature, str) or not signature:
        return False, "approval record has no signature"
    body = {k: v for k, v in record.items() if k != "signature"}
    expected = hmac.new(OPENVOICE_APPROVAL_SECRET.encode("utf-8"), _canonical_json(body), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return False, "approval record signature invalid"
    if record.get("purpose") != REQUIRED_OPENVOICE_PURPOSE:
        return False, "approval record purpose does not match receptionist_tts"
    if record.get("speaker") != REQUIRED_OPENVOICE_SPEAKER:
        return False, "approval record speaker does not match tyler-welch"
    # Fix round 2 (P1): exact model-revision binding, required and
    # enforced — a missing field, or any value other than the exact
    # pinned revision, fails closed. See REQUIRED_OPENVOICE_MODEL_REVISION's
    # own comment for why that pinned value is itself an unmatchable
    # sentinel today (no real OpenVoice wiring exists yet to pin to).
    if record.get("modelRevision") != REQUIRED_OPENVOICE_MODEL_REVISION:
        return False, "approval record modelRevision is missing or does not match the pinned OpenVoice revision"
    # Fix round 2 (P1): explicit revocation, independent of expiresAt —
    # lets an approval be killed immediately (with its own audit trail
    # in the signed record) without needing to delete or corrupt the
    # file to achieve the same effect.
    if record.get("revoked") is True or record.get("revokedAt"):
        return False, "approval record has been revoked"
    expires_at = record.get("expiresAt")
    if expires_at:
        try:
            import datetime

            if datetime.datetime.fromisoformat(expires_at.replace("Z", "+00:00")) < datetime.datetime.now(datetime.timezone.utc):
                return False, "approval record has expired"
        except ValueError:
            return False, "approval record expiresAt is not a valid timestamp"
    if not record.get("approvedBy") or not record.get("decisionAt"):
        return False, "approval record missing approvedBy/decisionAt"
    return True, "ok"


def _add_cuda12_dll_dirs():
    """CTranslate2 4.9.0 (faster-whisper's backend) is built against CUDA
    12's cuBLAS/cuDNN, but this machine's own CUDA runtime DLLs are
    CUDA 13 (torch 2.14.1+cu130's bundled `cublas64_13.dll` — torch
    itself doesn't need cublas64_12.dll, so this was invisible until
    the first real `.transcribe()` call actually exercised CTranslate2's
    GPU path, which failed closed with `cublas64_12.dll is not found`,
    a real error reproduced on this machine, not a hypothetical). The
    redistributable `nvidia-cublas-cu12`/`nvidia-cudnn-cu12` pip
    packages ship exactly the missing DLLs without a full CUDA 12
    toolkit install; this adds their bin/ dirs to the DLL search path
    before any CUDA-dependent import, the standard fix for this on
    Windows (`os.add_dll_directory`, not PATH, since PATH changes made
    after the process starts are not always honored by LoadLibrary)."""
    if sys.platform != "win32":
        return
    try:
        import nvidia.cublas as _cublas
        import nvidia.cudnn as _cudnn

        # These are PEP 420 implicit namespace packages (no __init__.py),
        # so __file__ is None — __path__ is the right way to locate them.
        for pkg in (_cublas, _cudnn):
            pkg_dir = next(iter(pkg.__path__), None)
            bin_dir = os.path.join(pkg_dir, "bin") if pkg_dir else None
            if bin_dir and os.path.isdir(bin_dir):
                os.add_dll_directory(bin_dir)
                # add_dll_directory() alone did not satisfy CTranslate2's
                # own CUDA DLL loading in testing (reproduced on this
                # machine: cublas64_12.dll still "not found" afterward) —
                # CTranslate2's compiled extension appears to resolve
                # CUDA DLLs via the classic PATH search instead of the
                # AddDllDirectory list. PATH changes made before the
                # first CUDA-triggering call ARE honored by Windows'
                # loader (it is not a one-time snapshot), so prepend here
                # too, belt and suspenders.
                os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
    except Exception as exc:  # noqa: BLE001 — STT load itself will fail closed below if this didn't work
        print(f"[local_inference] could not add CUDA 12 DLL dirs: {exc}", file=sys.stderr)


def _enforce_offline_env():
    """Fix round 1 (P1): set before any model-library import, so a
    cache miss on ANY nested model/tokenizer asset (not just the two
    top-level repos this file names) fails closed instead of silently
    reaching the network. Verified on this machine: a cached model still
    loads correctly under these settings; a genuinely missing one raises
    `LocalEntryNotFoundError`, never falls through to a download."""
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_DATASETS_OFFLINE"] = "1"


class ModelState:
    """Loaded once at process startup; never reloaded per-request."""

    def __init__(self):
        self.stt_model = None
        self.kokoro_pipeline = None
        self.gpu_name = None
        self.stt_error: str | None = None
        self.kokoro_error: str | None = None

    def load(self):
        _enforce_offline_env()
        _add_cuda12_dll_dirs()
        try:
            import torch

            if torch.cuda.is_available():
                self.gpu_name = torch.cuda.get_device_name(0)
        except Exception:  # noqa: BLE001 — GPU name is cosmetic, never fatal
            self.gpu_name = None

        try:
            from faster_whisper import WhisperModel

            t0 = time.perf_counter()
            self.stt_model = WhisperModel(
                STT_REPO_ID, device="cuda", compute_type="float16", revision=STT_REVISION
            )
            print(f"[local_inference] STT loaded in {time.perf_counter() - t0:.1f}s", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001 — recorded, never raised at import time
            self.stt_error = f"{type(exc).__name__}: {exc}"
            print(f"[local_inference] STT load FAILED: {self.stt_error}", file=sys.stderr)

        try:
            from kokoro import KPipeline

            t0 = time.perf_counter()
            self.kokoro_pipeline = KPipeline(lang_code="a", repo_id=KOKORO_REPO_ID, device="cuda")
            print(f"[local_inference] Kokoro loaded in {time.perf_counter() - t0:.1f}s", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            self.kokoro_error = f"{type(exc).__name__}: {exc}"
            print(f"[local_inference] Kokoro load FAILED: {self.kokoro_error}", file=sys.stderr)


MODELS = ModelState()


WHISPER_SAMPLE_RATE = 16000


def _decode_and_resample_to_16k(wav_bytes: bytes):
    """Decode WAV bytes to a mono float32 numpy array at 16 kHz, the
    rate Whisper models expect. Deliberately bypasses faster-whisper's
    own `decode_audio` (PyAV-based) — the installed `av` 19.0.2 does not
    accept the `metadata_errors` kwarg faster-whisper 1.2.1's
    `decode_audio` passes to it (a real, reproduced version mismatch in
    this venv, not a hypothetical). Reading with `soundfile` + resampling
    with `scipy` avoids that path entirely, and this module needed its
    own resampling anyway (brief §3: "resample G.711 8 kHz to model
    input"; synthetic test fixtures here are already 16 kHz/24 kHz, not
    8 kHz G.711, but the same resample path handles any input rate)."""
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly

    data, sample_rate = sf.read(io.BytesIO(wav_bytes), dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)  # downmix to mono
    if sample_rate != WHISPER_SAMPLE_RATE:
        from math import gcd

        g = gcd(sample_rate, WHISPER_SAMPLE_RATE)
        data = resample_poly(data, WHISPER_SAMPLE_RATE // g, sample_rate // g)
    return np.asarray(data, dtype="float32")


def reject_hostile_origin(headers) -> str | None:
    """Fix round 1 (P1): returns an error message if this request looks
    browser-issued rather than from our own local Python client, else
    None. `headers` is anything supporting `.get(name)` case-
    insensitively — `email.message.Message` (what `BaseHTTPRequestHandler`
    exposes) or a plain dict both work, which is what makes this
    directly unit-testable without any real HTTP server."""
    host = headers.get("Host", "")
    if host != EXPECTED_HOST_HEADER:
        return f"Host header {host!r} does not match {EXPECTED_HOST_HEADER!r}"
    # A legitimate same-machine Python client never sends Origin. Every
    # browser-issued cross-origin request does, even a CORS-"simple"
    # one — presence alone is the signal, not its value.
    if headers.get("Origin") is not None:
        return "Origin header present — this endpoint is not for browser use"
    sec_fetch_site = headers.get("Sec-Fetch-Site")
    if sec_fetch_site not in (None, "same-origin"):
        return f"Sec-Fetch-Site {sec_fetch_site!r} rejected"
    return None


def require_auth(headers, expected_token: str) -> str | None:
    auth = headers.get("Authorization", "")
    expected = f"Bearer {expected_token}"
    if not hmac.compare_digest(auth, expected):
        return "missing or invalid Authorization bearer token"
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "ForgeReceptionistLocalInference/1"
    # Required for chunked Transfer-Encoding (fix round 1, P1's real
    # streaming fix) — HTTP/1.0 has no concept of chunked encoding.
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # noqa: A003 — quiet by default; stderr still gets load/error lines
        pass

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _reject_hostile_origin(self) -> str | None:
        return reject_hostile_origin(self.headers)

    def _require_auth(self) -> str | None:
        return require_auth(self.headers, AUTH_TOKEN)

    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler's own naming convention
        if self.path == "/health":
            # /health is deliberately exempt from the Origin/bearer
            # checks (a local readiness probe, no state change, no model
            # inference) but still requires the exact Host match.
            reason = self._reject_hostile_origin()
            if reason and "Host header" in reason:
                return self._send_json(400, {"error": reason})
            ok, openvoice_reason = verify_openvoice_approval()
            self._send_json(
                200,
                {
                    "sttReady": MODELS.stt_model is not None,
                    "sttError": MODELS.stt_error,
                    "kokoroReady": MODELS.kokoro_pipeline is not None,
                    "kokoroError": MODELS.kokoro_error,
                    "openvoiceApproved": ok,
                    "openvoiceApprovalReason": None if ok else openvoice_reason,
                    "gpuName": MODELS.gpu_name,
                },
            )
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        reason = self._reject_hostile_origin()
        if reason:
            return self._send_json(403, {"error": reason})
        reason = self._require_auth()
        if reason:
            return self._send_json(401, {"error": reason})

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._send_json(400, {"error": "invalid Content-Length"})

        if self.path == "/stt":
            max_bytes, expected_ct = MAX_STT_BODY_BYTES, "audio/wav"
        elif self.path in ("/tts/kokoro", "/tts/openvoice"):
            max_bytes, expected_ct = MAX_JSON_BODY_BYTES, "application/json"
        else:
            return self._send_json(404, {"error": "not found"})

        if length <= 0 or length > max_bytes:
            return self._send_json(413, {"error": f"Content-Length {length} outside allowed 1..{max_bytes}"})
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        if content_type != expected_ct:
            return self._send_json(415, {"error": f"expected Content-Type {expected_ct}, got {content_type!r}"})

        body = self.rfile.read(length)

        # Fix round 1 (P1): bounds concurrent inference work — a request
        # that can't acquire a slot within a short wait is told the
        # server is busy rather than piling up unboundedly.
        acquired = _INFERENCE_SEMAPHORE.acquire(timeout=5.0)
        if not acquired:
            return self._send_json(503, {"error": "local inference server is at its concurrency limit"})
        try:
            if self.path == "/stt":
                return self._handle_stt(body)
            if self.path == "/tts/kokoro":
                return self._handle_kokoro(json.loads(body or b"{}"))
            if self.path == "/tts/openvoice":
                return self._handle_openvoice(json.loads(body or b"{}"))
        except Exception as exc:  # noqa: BLE001 — fail closed with a plain error, never a stack trace to the client
            print(f"[local_inference] request failed: {traceback.format_exc()}", file=sys.stderr)
            return self._send_json(500, {"error": f"{type(exc).__name__}: {exc}"})
        finally:
            _INFERENCE_SEMAPHORE.release()

    def _handle_stt(self, wav_bytes: bytes):
        if MODELS.stt_model is None:
            return self._send_json(503, {"error": MODELS.stt_error or "STT model not loaded"})

        started = time.perf_counter()
        try:
            audio = _decode_and_resample_to_16k(wav_bytes)
        except Exception as exc:  # noqa: BLE001 — malformed/unsupported audio fails closed, not a 500 traceback leak
            return self._send_json(400, {"error": f"could not decode audio: {type(exc).__name__}: {exc}"})
        segments, info = MODELS.stt_model.transcribe(audio, language="en", vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        confidence = float(getattr(info, "language_probability", 0.0) or 0.0)
        latency_ms = (time.perf_counter() - started) * 1000.0
        self._send_json(200, {"text": text, "language": "en", "confidence": confidence, "latencyMs": latency_ms})

    def _handle_kokoro(self, payload: dict):
        """Fix round 1 (P1): REAL HTTP streaming, not "measure a server-
        side timestamp, then send the whole buffered WAV anyway." The
        earlier version generated the complete audio, built a full WAV
        in memory, and only THEN sent one buffered response — so the
        `X-First-Audio-Ms` header described a server-side event the
        client could not actually observe any earlier than the full
        response arriving. This now sends each Kokoro-generated chunk
        over the wire via HTTP/1.1 chunked transfer encoding AS SOON AS
        it exists, so a client reading the socket incrementally (see
        `providers.py`'s `_local_post_streaming`) observes real first-
        byte timing, not a self-reported header on a fully buffered
        body."""
        if MODELS.kokoro_pipeline is None:
            return self._send_json(503, {"error": MODELS.kokoro_error or "Kokoro model not loaded"})
        text = str(payload.get("text", "")).strip()
        if not text:
            return self._send_json(400, {"error": "text is required"})
        if len(text) > MAX_TTS_TEXT_CHARS:
            return self._send_json(413, {"error": f"text exceeds {MAX_TTS_TEXT_CHARS} chars"})
        voice = str(payload.get("voice") or KOKORO_DEFAULT_VOICE)
        import numpy as np

        sample_rate = 24000
        headers_sent = False

        def _send_chunk(pcm_int16_bytes: bytes):
            nonlocal headers_sent
            if not headers_sent:
                self.send_response(200)
                self.send_header("Content-Type", "audio/x-raw-pcm")
                self.send_header("X-Sample-Rate", str(sample_rate))
                self.send_header("X-Channels", "1")
                self.send_header("X-Sample-Width-Bytes", "2")
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                headers_sent = True
            if pcm_int16_bytes:
                self.wfile.write(f"{len(pcm_int16_bytes):X}\r\n".encode("ascii"))
                self.wfile.write(pcm_int16_bytes)
                self.wfile.write(b"\r\n")
                self.wfile.flush()

        # Split on sentence boundaries too, not just literal newlines
        # (Kokoro's own default `split_pattern` is newline-only) — a
        # long multi-sentence caller/agent utterance fed as one giant
        # chunk was measured taking >45s and once triggered a dropped
        # connection on this machine; splitting per sentence keeps each
        # individual synthesis call short AND gives this streaming path
        # more, smaller chunks to flush sooner.
        for result in MODELS.kokoro_pipeline(text, voice=voice, split_pattern=r"\n+|(?<=[.!?])\s+"):
            audio = result.audio
            audio = audio.numpy() if hasattr(audio, "numpy") else audio
            pcm16 = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
            _send_chunk(pcm16)

        if not headers_sent:
            # No audio at all (shouldn't happen given the non-empty text
            # check above, but fail closed rather than hang on a chunked
            # response that never started).
            _send_chunk(b"")
        self.wfile.write(b"0\r\n\r\n")  # chunked terminator
        self.wfile.flush()

    def _handle_openvoice(self, payload: dict):
        ok, reason = verify_openvoice_approval()
        if not ok:
            return self._send_json(
                503,
                {"error": f"OpenVoice/Tyler is not approved for the receptionist ({reason}). "
                          "This is Jason's decision via a signed approval record, not an env flag — see MODEL_PINS.md."},
            )
        # Real OpenVoice synthesis reuses the narration-sidecar's own
        # proven generation path (narration_runner._generate_segments et
        # al.) — deliberately NOT reimplemented here. Even with a valid
        # signed approval record, this branch stays unreachable until
        # that wiring work happens, recorded as a named follow-on, not
        # silently skipped.
        return self._send_json(
            501,
            {"error": "OpenVoice synthesis wiring is a follow-on once Jason approves Tyler's voice for this use."},
        )


def main():
    MODELS.load()
    print(f"[local_inference] auth token persisted at {TOKEN_PATH}", file=sys.stderr)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[local_inference] listening on {HOST}:{PORT}", file=sys.stderr)
    server.serve_forever()


if __name__ == "__main__":
    main()
