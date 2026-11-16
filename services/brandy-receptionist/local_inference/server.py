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

Binds to 127.0.0.1 ONLY (brief §2.3: "Bind the Python worker bridge to
loopback only"). No other interface, no TLS needed for a loopback-only
service, no auth needed for a loopback-only service on a single-user
machine — if this process is ever exposed beyond loopback, that is a
separate, explicitly reviewed change, not something this file does.

Endpoints:
    GET  /health                 -> {"sttReady": bool, "kokoroReady": bool,
                                       "openvoiceReady": bool, "gpuName": str|None}
    POST /stt        (WAV bytes) -> {"text": str, "language": str, "confidence": float,
                                       "latencyMs": float}
    POST /tts/kokoro  (JSON {"text": str, "voice": str})
                                  -> WAV bytes, header X-First-Audio-Ms
    POST /tts/openvoice (JSON {"text": str, "speakerKey": str})
                                  -> WAV bytes, header X-First-Audio-Ms, OR
                                     503 if OPENVOICE_RECEPTIONIST_APPROVED_PATH
                                     is unset/missing (Tyler's Capture enrollment
                                     is NOT automatically approved for this use —
                                     see MODEL_PINS.md's open-decision note).

Every endpoint fails CLOSED on any model error: a 503/500 with a plain
JSON error body, never a partial/garbled audio response and never a
silent empty 200.
"""
from __future__ import annotations

import io
import json
import os
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("RECEPTIONIST_LOCAL_INFERENCE_PORT", "8809"))

# Pinned exactly (see MODEL_PINS.md) — never resolved by a moving alias
# like "turbo" at runtime, so a silent upstream change can never swap
# the model under this server without this file also changing.
STT_REPO_ID = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
STT_REVISION = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"
KOKORO_REPO_ID = "hexgrad/Kokoro-82M"
KOKORO_REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"
KOKORO_DEFAULT_VOICE = "af_heart"  # provisional — Stage 4 owner listening approval still owed

# Tyler's Capture voice enrollment is NOT automatically approved for the
# receptionist (Cut 1 scope brief, hard boundary). This server only
# attempts OpenVoice synthesis when a file at this path exists AND
# contains exactly the literal text "APPROVED" — an explicit, inspectable
# gate Jason sets, never an env flag alone (consistent with the
# project's "no env flag alone activates" pattern elsewhere).
OPENVOICE_RECEPTIONIST_APPROVAL_PATH = os.environ.get(
    "RECEPTIONIST_OPENVOICE_APPROVAL_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "openvoice-receptionist-approval.txt"),
)


def _openvoice_approved() -> bool:
    try:
        with open(OPENVOICE_RECEPTIONIST_APPROVAL_PATH, "r", encoding="utf-8") as fh:
            return fh.read().strip() == "APPROVED"
    except OSError:
        return False


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


class ModelState:
    """Loaded once at process startup; never reloaded per-request."""

    def __init__(self):
        self.stt_model = None
        self.kokoro_pipeline = None
        self.gpu_name = None
        self.stt_error: str | None = None
        self.kokoro_error: str | None = None

    def load(self):
        _add_cuda12_dll_dirs()
        try:
            import torch

            if torch.cuda.is_available():
                self.gpu_name = torch.cuda.get_device_name(0)
        except Exception as exc:  # noqa: BLE001 — GPU name is cosmetic, never fatal
            self.gpu_name = None

        try:
            import truststore

            truststore.inject_into_ssl()
        except Exception:  # noqa: BLE001 — best effort; HF downloads may fail without it, surfaced below
            pass

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


def _wav_bytes_from_audio(audio, sample_rate: int) -> bytes:
    import soundfile as sf

    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV")
    return buf.getvalue()


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


class Handler(BaseHTTPRequestHandler):
    server_version = "ForgeReceptionistLocalInference/1"

    def log_message(self, fmt, *args):  # noqa: A003 — quiet by default; stderr still gets load/error lines
        pass

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_wav(self, status: int, wav_bytes: bytes, first_audio_ms: float):
        self.send_response(status)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav_bytes)))
        self.send_header("X-First-Audio-Ms", f"{first_audio_ms:.1f}")
        self.end_headers()
        self.wfile.write(wav_bytes)

    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler's own naming convention
        if self.path == "/health":
            self._send_json(
                200,
                {
                    "sttReady": MODELS.stt_model is not None,
                    "sttError": MODELS.stt_error,
                    "kokoroReady": MODELS.kokoro_pipeline is not None,
                    "kokoroError": MODELS.kokoro_error,
                    "openvoiceApproved": _openvoice_approved(),
                    "gpuName": MODELS.gpu_name,
                },
            )
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length > 0 else b""
        try:
            if self.path == "/stt":
                return self._handle_stt(body)
            if self.path == "/tts/kokoro":
                return self._handle_kokoro(json.loads(body or b"{}"))
            if self.path == "/tts/openvoice":
                return self._handle_openvoice(json.loads(body or b"{}"))
            self._send_json(404, {"error": "not found"})
        except Exception as exc:  # noqa: BLE001 — fail closed with a plain error, never a stack trace to the client
            print(f"[local_inference] request failed: {traceback.format_exc()}", file=sys.stderr)
            self._send_json(500, {"error": f"{type(exc).__name__}: {exc}"})

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
        if MODELS.kokoro_pipeline is None:
            return self._send_json(503, {"error": MODELS.kokoro_error or "Kokoro model not loaded"})
        text = str(payload.get("text", "")).strip()
        if not text:
            return self._send_json(400, {"error": "text is required"})
        voice = str(payload.get("voice") or KOKORO_DEFAULT_VOICE)
        import numpy as np

        started = time.perf_counter()
        first_audio_ms = None
        chunks = []
        # Split on sentence boundaries too, not just literal newlines
        # (Kokoro's own default `split_pattern` is newline-only) — a
        # long multi-sentence caller/agent utterance fed as one giant
        # chunk was measured taking >45s and once triggered a dropped
        # connection on this machine; splitting per sentence keeps each
        # individual synthesis call short, and the loop below already
        # concatenates every yielded chunk into one continuous WAV.
        for result in MODELS.kokoro_pipeline(text, voice=voice, split_pattern=r"\n+|(?<=[.!?])\s+"):
            if first_audio_ms is None:
                first_audio_ms = (time.perf_counter() - started) * 1000.0
            audio = result.audio
            chunks.append(audio.numpy() if hasattr(audio, "numpy") else audio)
        audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype="float32")
        wav_bytes = _wav_bytes_from_audio(audio, 24000)
        self._send_wav(200, wav_bytes, first_audio_ms or 0.0)

    def _handle_openvoice(self, payload: dict):
        if not _openvoice_approved():
            return self._send_json(
                503,
                {
                    "error": "OpenVoice/Tyler is not approved for the receptionist. "
                    "This is Jason's decision, not an env flag — see MODEL_PINS.md."
                },
            )
        # Real OpenVoice synthesis reuses the narration-sidecar's own
        # proven generation path (narration_runner._generate_segments et
        # al.) — deliberately NOT reimplemented here. Until the approval
        # gate above is actually set, this branch is unreachable in
        # Cut 1, so no further wiring work is owed by this cut; it is
        # recorded as a named follow-on, not silently skipped.
        return self._send_json(
            501,
            {"error": "OpenVoice synthesis wiring is a follow-on once Jason approves Tyler's voice for this use."},
        )


def main():
    MODELS.load()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[local_inference] listening on {HOST}:{PORT}", file=sys.stderr)
    server.serve_forever()


if __name__ == "__main__":
    main()
