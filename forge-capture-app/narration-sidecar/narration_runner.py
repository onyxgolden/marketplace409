"""FORGE Capture Phase 3 Slice A — narration sidecar runner (OpenVoice V2).

Runs on the iBUYPOWER (RTX 5080) only. Watches the narration spool at
``%LOCALAPPDATA%\\FORGE Capture\\narration`` for queued jobs, generates
per-step narration with OpenVoice V2 + MeloTTS (zero-shot tone-color
cloning, no training, no generated face), assembles captions + the
narrated MP4 with FFmpeg, and writes the result + render manifest.

Local-first: the runner makes NO network calls during a job.
``result.json`` ``outbound_requests`` is always ``[]``. Downloads happen
only in the setup script (``tools/narration/setup-env.ps1``), never at
job time.

Stdlib only at import time. torch / openvoice / melo are imported lazily
inside the functions that need them, so ``python -m py_compile`` and the
pure-helper tests pass on machines without the model stack.

Exit codes: 0 ok / 1 no job (``--once`` found nothing queued) /
2 job failed.

Usage (inside the venv on the iBUYPOWER):
  python narration_runner.py --narration-root "%LOCALAPPDATA%\\FORGE Capture\\narration" --once
  python narration_runner.py --narration-root "%LOCALAPPDATA%\\FORGE Capture\\narration" --loop
  python narration_runner.py --narration-root "..." --enroll-only tyler-welch
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from narration_lib import (  # noqa: E402
    build_ffmpeg_command,
    build_vtt,
    canonical_script_sha256,
    marker_path,
    resolve_marker,
    sha256_file,
    validate_result_dict,
    validate_script_dict,
    verify_job_binding,
)

# --- Pinned model identity (scope brief: pin exact code + weights) -------
MODEL_ID = "openvoice-v2"
MODEL_VERSION = "checkpoints_v2_0417"
MODEL_CODE_COMMIT = "74a1d147b17a8c3092dd5430504bd83ef6c7eb23"
BASE_TTS = "melotts"
BASE_TTS_COMMIT = "209145371cff8fc3bd60d7be902ea69cbdb7965a"
CHECKPOINTS_URL = "https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip"
# Weights SHA-256 is NOT known yet (env setup still running on the
# iBUYPOWER). Filled from C:\forge-bridge\narration\receipt.json
# (field checkpoints_v2_zip_sha256) when present; otherwise this
# placeholder is used and the run is flagged in the log.
WEIGHTS_SHA256_PLACEHOLDER = "<FILL-FROM-RECEIPT:C:\\forge-bridge\\narration\\receipt.json>"

DEFAULT_CHECKPOINTS_DIR = r"C:\forge-bridge\narration\checkpoints_v2"
DEFAULT_RECEIPT_PATH = r"C:\forge-bridge\narration\receipt.json"
DEFAULT_FFMPEG_DIR = r"C:\forge-bridge\tools\ffmpeg\bin"

POLL_SECONDS = 5
RESOURCE_POLL_SECONDS = 0.5


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[narration] {ts} {msg}", flush=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def default_narration_root() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "FORGE Capture" / "narration"
    return Path.home() / ".local" / "share" / "forge-capture" / "narration"


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def append_audit(root: Path, event: dict) -> None:
    """Append one JSON line to audit/audit-log.jsonl (append-only)."""
    audit_dir = root / "audit"
    audit_dir.mkdir(parents=True, exist_ok=True)
    line = {"at": utc_now(), **event}
    with open(audit_dir / "audit-log.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(line, ensure_ascii=False) + "\n")


def weights_sha256(receipt_path: str | None = None) -> str:
    """Weights hash from the setup receipt, else the placeholder.

    The setup script records ``checkpoints_v2_zip_sha256`` in
    C:\\forge-bridge\\narration\\receipt.json. Until that file exists the
    placeholder is returned and callers must flag it.
    """
    candidates = []
    if receipt_path:
        candidates.append(Path(receipt_path))
    candidates.append(Path(DEFAULT_RECEIPT_PATH))
    for path in candidates:
        try:
            if path.is_file():
                receipt = load_json(path)
                value = receipt.get("checkpoints_v2_zip_sha256")
                if isinstance(value, str) and value and value != "null":
                    return value.lower()
        except Exception as exc:  # receipt unreadable: placeholder, flagged
            log(f"WARNING: could not read receipt {path}: {exc}")
    return WEIGHTS_SHA256_PLACEHOLDER


def resolve_checkpoints_dir(cli_dir: str | None) -> Path:
    """Resolve the checkpoints dir.

    Task brief path is C:\\forge-bridge\\narration\\checkpoints_v2; the
    setup script extracts under ...\\narration\\src\\checkpoints_v2, so
    fall back to the src layout when the brief path has no converter
    config. Env NARRATION_CHECKPOINTS_DIR wins over both.
    """
    env_dir = os.environ.get("NARRATION_CHECKPOINTS_DIR")
    candidates = []
    if env_dir:
        candidates.append(Path(env_dir))
    if cli_dir:
        candidates.append(Path(cli_dir))
    candidates.append(Path(DEFAULT_CHECKPOINTS_DIR))
    candidates.append(Path(r"C:\forge-bridge\narration\src\checkpoints_v2"))
    for cand in candidates:
        if (cand / "converter" / "config.json").is_file():
            return cand
    return candidates[0] if candidates else Path(DEFAULT_CHECKPOINTS_DIR)


def resolve_tool(name: str, ffmpeg_dir: str | None) -> str | None:
    """Locate ffmpeg/ffprobe: --ffmpeg-dir, then PATH, then the known
    iBUYPOWER install dir."""
    if ffmpeg_dir:
        cand = Path(ffmpeg_dir) / (name + ".exe" if os.name == "nt" else name)
        if cand.is_file():
            return str(cand)
    found = shutil.which(name)
    if found:
        return found
    cand = Path(DEFAULT_FFMPEG_DIR) / (name + ".exe" if os.name == "nt" else name)
    if cand.is_file():
        return str(cand)
    return None


def ffmpeg_version(ffmpeg_bin: str) -> str:
    try:
        out = subprocess.run([ffmpeg_bin, "-version"], capture_output=True,
                             text=True, timeout=30)
        first = (out.stdout or "").splitlines()
        return first[0].strip() if first else "unknown"
    except Exception:
        return "unknown"


def probe_audio_duration_sec(ffprobe_bin: str, path: Path) -> float:
    """Audio duration in seconds via ffprobe (raises on failure)."""
    out = subprocess.run(
        [ffprobe_bin, "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        raise RuntimeError(f"ffprobe failed on {path}: {out.stderr.strip()[:300]}")
    duration = json.loads(out.stdout)["format"]["duration"]
    return float(duration)


def probe_has_audio_stream(ffprobe_bin: str, path: Path) -> bool:
    """True when the file has at least one audio stream."""
    out = subprocess.run(
        [ffprobe_bin, "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=60)
    return out.returncode == 0 and bool((out.stdout or "").strip())


# --- Consent preflight ------------------------------------------------------

def check_consent(root: Path, presenter_id: str):
    """Preflight: read the presenter's consent receipt.

    Returns ``(ok, failure_reason_or_None, consent_dict_or_None)``.
    Failure reasons: ``consent_missing``, ``consent_revoked``,
    ``consent_hash_mismatch``. A queued job revoked before start MUST
    NOT run — the caller fails the job on any non-ok result.
    """
    presenter_dir = root / "presenters" / presenter_id
    consent_path = presenter_dir / "consent.json"
    if not consent_path.is_file():
        return False, "consent_missing", None
    try:
        consent = load_json(consent_path)
    except Exception:
        return False, "consent_missing", None
    if consent.get("status") != "active":
        return False, "consent_revoked", consent
    if "voice" not in (consent.get("scope") or []):
        return False, "consent_revoked", consent
    artifact_rel = consent.get("consent_artifact_path")
    expected = consent.get("artifact_sha256")
    if not artifact_rel or not expected:
        return False, "consent_hash_mismatch", consent
    artifact = Path(artifact_rel)
    if not artifact.is_absolute():
        artifact = presenter_dir / artifact_rel
    if not artifact.is_file():
        return False, "consent_hash_mismatch", consent
    if sha256_file(artifact) != expected:
        return False, "consent_hash_mismatch", consent
    return True, None, consent


# --- Resource monitoring ----------------------------------------------------

class ResourceMonitor:
    """Polls nvidia-smi for peak VRAM and tracks peak RSS of this process.

    Runs in a background thread during generation + render. nvidia-smi
    absent (or no GPU) -> peak VRAM stays None and gpu is "unknown";
    psutil absent -> RSS falls back to the ``resource`` module (POSIX)
    or stays None on Windows without psutil.
    """

    def __init__(self):
        self.peak_vram_mib = None
        self.peak_ram_mib = None
        self.gpu = "unknown"
        self._stop = threading.Event()
        self._thread = None
        self._psutil = None
        try:
            import psutil  # lazy: optional dependency
            self._psutil = psutil
        except Exception:
            self._psutil = None
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=15)
            name = (out.stdout or "").strip().splitlines()
            if name:
                self.gpu = name[0].strip()
        except Exception:
            self.gpu = "unknown"

    def _poll_once(self):
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=15)
            for line in (out.stdout or "").splitlines():
                try:
                    used = int(line.strip())
                except ValueError:
                    continue
                if self.peak_vram_mib is None or used > self.peak_vram_mib:
                    self.peak_vram_mib = used
        except Exception:
            pass
        try:
            if self._psutil is not None:
                rss = self._psutil.Process(os.getpid()).memory_info().rss // (1024 * 1024)
            else:
                import resource  # POSIX only; ImportError on Windows
                rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024
            if self.peak_ram_mib is None or rss > self.peak_ram_mib:
                self.peak_ram_mib = rss
        except Exception:
            pass

    def _loop(self):
        while not self._stop.wait(RESOURCE_POLL_SECONDS):
            self._poll_once()

    def __enter__(self):
        self._poll_once()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        self._poll_once()


# --- Enrollment (lazy heavy imports) ----------------------------------------

def enroll_presenter(root: Path, presenter_id: str, checkpoints_dir: Path,
                     receipt_path: str | None = None) -> dict:
    """Zero-shot enrollment for a presenter. Returns the VoiceEnrollment dict.

    Loads OpenVoice ToneColorConverter + checkpoint, extracts the speaker
    embedding from the presenter's reference.wav, writes
    speaker_embedding.json and enrollment.json (status "active"). Never
    trains anything. Raises on any failure; the caller fails the job.
    """
    import torch  # lazy: model stack only on the iBUYPOWER

    from openvoice import se_extractor
    from openvoice.api import ToneColorConverter

    presenter_dir = root / "presenters" / presenter_id
    enrollment_path = presenter_dir / "enrollment.json"
    if enrollment_path.is_file():
        existing = load_json(enrollment_path)
        if existing.get("status") == "active" and \
                (presenter_dir / "speaker_embedding.json").is_file():
            log(f"enrollment already active for {presenter_id}; reusing stored speaker embedding")
            return existing

    reference_wav = presenter_dir / "reference.wav"
    if not reference_wav.is_file():
        raise RuntimeError(f"reference.wav missing for presenter {presenter_id}")
    ref_sha = sha256_file(reference_wav)
    consent_ok, reason, consent = check_consent(root, presenter_id)
    if not consent_ok:
        raise RuntimeError(f"consent preflight failed for enrollment: {reason}")

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    log(f"enrolling {presenter_id} on device {device} (zero-shot, no training)")
    converter = ToneColorConverter(str(checkpoints_dir / "converter" / "config.json"),
                                   device=device)
    converter.load_ckpt(str(checkpoints_dir / "converter" / "checkpoint.pth"))
    se = se_extractor.get_se(str(reference_wav), converter, vad=True)
    se_list = se.detach().cpu().float().tolist()
    write_json(presenter_dir / "speaker_embedding.json", {
        "se": se_list,
        "model": MODEL_ID,
        "reference_audio_sha256": ref_sha,
    })
    enrollment = {
        "version": 1,
        "presenter_id": presenter_id,
        "consent_receipt_version": consent.get("version", 1),
        "consent_artifact_sha256": consent.get("artifact_sha256"),
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "model_code_commit": MODEL_CODE_COMMIT,
        "weights_sha256": weights_sha256(receipt_path),
        "reference_audio_sha256": ref_sha,
        "preprocessing_version": "openvoice-se-extractor-vad-v1",
        "speaker_embedding_path": "speaker_embedding.json",
        "reference_clip_path": "reference.wav",
        "created_at": utc_now(),
        "last_used_at": None,
        "status": "active",
    }
    write_json(enrollment_path, enrollment)
    append_audit(root, {"event": "enrolled", "presenter_id": presenter_id,
                        "job_id": None})
    log(f"enrollment active for {presenter_id}")
    return enrollment


def load_target_se(root: Path, presenter_id: str):
    """Load the stored speaker embedding as a torch tensor (lazy import)."""
    import torch  # lazy

    presenter_dir = root / "presenters" / presenter_id
    data = load_json(presenter_dir / "speaker_embedding.json")
    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    return torch.tensor(data["se"], dtype=torch.float32, device=device)


def pick_en_speaker(model):
    """Pick the first EN speaker key from a MeloTTS model.

    Robust: prefer a key starting with "EN"; if no EN key exists, fail
    loudly — never guess a speaker id.
    Returns ``(speaker_key, speaker_id_int)``.
    """
    keys = list(model.hps.data.spk2id.keys())
    en_keys = [k for k in keys if k.startswith("EN")]
    if not en_keys:
        raise RuntimeError(
            f"no EN speaker key in MeloTTS spk2id (keys present: {keys[:10]}); "
            "refusing to guess a speaker id")
    key = en_keys[0]
    return key, model.hps.data.spk2id[key]


# --- Result helpers ---------------------------------------------------------

def make_result(job_id, status, failure_reason=None, segments=None,
                render=None, resources=None, consent_receipt_version=1,
                weights=None):
    result = {
        "version": 1,
        "job_id": job_id,
        "status": status,
        "failure_reason": failure_reason,
        "segments": segments if segments is not None else [],
        "render": render,
        "resources": resources or {"peak_vram_mib": None, "peak_ram_mib": None,
                                   "gpu": "unknown"},
        "outbound_requests": [],
        "model": {
            "model_id": MODEL_ID,
            "model_version": MODEL_VERSION,
            "code_commit": MODEL_CODE_COMMIT,
            "weights_sha256": weights or WEIGHTS_SHA256_PLACEHOLDER,
            "base_tts": BASE_TTS,
            "base_tts_commit": BASE_TTS_COMMIT,
        },
        "consent_receipt_version": consent_receipt_version,
        "completed_at": utc_now(),
    }
    return result


def fail_job(root: Path, job_dir: Path, job_id: str, reason: str,
             consent_receipt_version=1, weights=None) -> dict:
    """Write result.json {status: failed}, .failed marker, audit event."""
    log(f"job {job_id} FAILED: {reason}")
    result = make_result(job_id, "failed", failure_reason=str(reason)[:500],
                         consent_receipt_version=consent_receipt_version,
                         weights=weights)
    errors = validate_result_dict(result)
    if errors:
        log(f"WARNING: failed result failed validation: {errors}")
    write_json(job_dir / "result.json", result)
    proc = marker_path(job_dir, "processing")
    if proc.exists():
        proc.unlink()
    marker_path(job_dir, "failed").touch(exist_ok=True)
    append_audit(root, {"event": "job_failed", "job_id": job_id,
                        "failure_reason": str(reason)[:500]})
    return result


# --- Job processing ---------------------------------------------------------

def find_queued_job(root: Path):
    """First jobs/<job_id> dir with a .queued marker, skipping .done dirs.

    Idempotency (gate 9): a dir that already has .done is never re-run;
    it is logged and skipped.
    """
    jobs_dir = root / "jobs"
    if not jobs_dir.is_dir():
        return None
    for job_dir in sorted(jobs_dir.iterdir()):
        if not job_dir.is_dir():
            continue
        status = resolve_marker(job_dir)
        if status == "done":
            log(f"skipping already-completed job {job_dir.name} (.done present)")
            continue
        if status == "queued" and (job_dir / "job.json").is_file():
            return job_dir
    return None


def process_job(root: Path, job_dir: Path, checkpoints_dir: Path,
                ffmpeg_bin: str, ffprobe_bin: str,
                receipt_path: str | None = None) -> int:
    """Process one claimed job. Returns 0 on success, 2 on failure."""
    job_id = job_dir.name
    manifest = load_json(job_dir / "job.json")
    if manifest.get("job_id") and manifest["job_id"] != job_id:
        return _fail(root, job_dir, job_id,
                     f"job.json job_id {manifest['job_id']!r} does not match directory {job_id!r}")
    presenter_id = manifest["presenter_id"]
    consent_version = manifest.get("consent_receipt_version", 1)
    weights = weights_sha256(receipt_path)
    if weights == WEIGHTS_SHA256_PLACEHOLDER:
        log("WARNING: weights SHA-256 unknown (no receipt.json yet); "
            "using <FILL-FROM-RECEIPT> placeholder — fill from "
            "C:\\forge-bridge\\narration\\receipt.json")

    log(f"job {job_id} started (presenter {presenter_id})")
    append_audit(root, {"event": "job_started", "job_id": job_id,
                        "presenter_id": presenter_id})

    # --- Preflight (before ANY model work; re-checked at job start) ------
    consent_ok, reason, _consent = check_consent(root, presenter_id)
    if not consent_ok:
        return _fail(root, job_dir, job_id, reason,
                     consent_receipt_version=consent_version, weights=weights)

    try:
        script = load_json(job_dir / "script.json")
        script_errors = validate_script_dict(script)
        if script_errors:
            return _fail(root, job_dir, job_id,
                         "invalid script: " + "; ".join(script_errors),
                         consent_receipt_version=consent_version, weights=weights)
        if script.get("job_id") != job_id:
            return _fail(root, job_dir, job_id,
                         "script.json job_id does not match job directory",
                         consent_receipt_version=consent_version, weights=weights)

        # Job binding (P1-1): recompute the canonical empty-job_id
        # script hash and the canonical job id BEFORE capture checks,
        # enrollment, or any model work — a script edited after job
        # creation must fail closed here, never render.
        # Boundary note: the job-id recomputation uses the runner's
        # resolved weights hash (setup receipt when present, else the
        # <FILL-FROM-RECEIPT> placeholder). A job created before the
        # weights receipt is filled and run after it is filled will
        # fail closed on job-id mismatch — that is the safe direction;
        # the failure reason names the weights source, so the cause is
        # visible instead of looking like a tampered script. Do not
        # work around it by falling back to another weights value.
        binding_errors = verify_job_binding(manifest, script, job_id, weights)
        if binding_errors:
            weights_source = (
                "setup receipt (receipt.json)"
                if weights != WEIGHTS_SHA256_PLACEHOLDER
                else "placeholder <FILL-FROM-RECEIPT> (no receipt.json yet)")
            return _fail(root, job_dir, job_id,
                         "job binding verification failed "
                         f"(weights_sha256 from {weights_source}): "
                         + "; ".join(binding_errors),
                         consent_receipt_version=consent_version, weights=weights)
        verified_script_sha256 = canonical_script_sha256(script)

        capture_path = Path(manifest["capture_path"])
        if not capture_path.is_file():
            return _fail(root, job_dir, job_id,
                         f"capture file not found: {capture_path}",
                         consent_receipt_version=consent_version, weights=weights)
        if sha256_file(capture_path) != manifest.get("capture_sha256"):
            return _fail(root, job_dir, job_id,
                         "capture_sha256 mismatch: capture file changed since manifest",
                         consent_receipt_version=consent_version, weights=weights)
        # Defense in depth: the script was validated against the
        # duration CLAIMED at creation; check it against the capture's
        # REAL duration before generating anything. (Container rounding
        # gets a 0.5 s tolerance; anything further out fails loudly.)
        try:
            real_duration = probe_audio_duration_sec(ffprobe_bin, capture_path)
        except Exception as exc:
            return _fail(root, job_dir, job_id,
                         f"could not probe capture duration: {exc}",
                         consent_receipt_version=consent_version, weights=weights)
        overrun = [s for s in script["segments"]
                   if float(s["capture_end_sec"]) > real_duration + 0.5]
        if overrun:
            return _fail(root, job_dir, job_id,
                         "script extends past the capture: step "
                         f"{overrun[0]['step_id']} ends at "
                         f"{overrun[0]['capture_end_sec']}s but the capture "
                         f"is {real_duration:.2f}s",
                         consent_receipt_version=consent_version, weights=weights)

        # --- Enrollment (lazy heavy imports inside) ---------------------
        # Checkpoints are only required from here on: preflight and script
        # validation above run (and can fail the job) without them, so a
        # revoked job fails as consent_revoked even on a box mid-setup.
        if not (checkpoints_dir / "converter" / "config.json").is_file():
            return _fail(root, job_dir, job_id,
                         f"OpenVoice V2 checkpoints not installed under "
                         f"{checkpoints_dir} (env setup unfinished)",
                         consent_receipt_version=consent_version, weights=weights)
        enrollment = enroll_presenter(root, presenter_id, checkpoints_dir,
                                      receipt_path)
        presenter_dir = root / "presenters" / presenter_id
        ref_sha = enrollment["reference_audio_sha256"]
        enrollment["last_used_at"] = utc_now()
        write_json(presenter_dir / "enrollment.json", enrollment)

        with ResourceMonitor() as monitor:
            segment_results, segment_wavs = _generate_segments(
                root, job_dir, script, presenter_id, checkpoints_dir,
                ffprobe_bin)
            captions_path = job_dir / "captions.vtt"
            captions_path.write_text(build_vtt(script["segments"]),
                                     encoding="utf-8")
            render, render_manifest = _render(
                root, job_dir, manifest, script, capture_path, segment_wavs,
                captions_path, ffmpeg_bin, ffprobe_bin, weights,
                verified_script_sha256)

        resources = {"peak_vram_mib": monitor.peak_vram_mib,
                     "peak_ram_mib": monitor.peak_ram_mib,
                     "gpu": monitor.gpu}
        # Completion-time consent re-check: a revocation that landed
        # mid-run must not produce an active managed output. If consent
        # is gone now, drop the just-rendered artifacts and fail the job
        # as consent_revoked (the .done marker is never written).
        consent_ok, consent_reason, _ = check_consent(root, presenter_id)
        if not consent_ok:
            for stale in [job_dir / "output.mp4",
                          job_dir / "captions.vtt"]:
                stale.unlink(missing_ok=True)
            shutil.rmtree(job_dir / "segments", ignore_errors=True)
            return _fail(root, job_dir, job_id,
                         f"consent_revoked at completion ({consent_reason})",
                         consent_receipt_version=consent_version, weights=weights)
        result = make_result(job_id, "done", segments=segment_results,
                             render=render, resources=resources,
                             consent_receipt_version=consent_version,
                             weights=weights)
        errors = validate_result_dict(result)
        if errors:
            return _fail(root, job_dir, job_id,
                         "result validation failed: " + "; ".join(errors),
                         consent_receipt_version=consent_version, weights=weights)
        write_json(job_dir / "result.json", result)
        upsert_managed_output(root, presenter_id, job_id,
                              f"jobs/{job_id}/output.mp4",
                              render["output_sha256"])
        marker_path(job_dir, "processing").unlink(missing_ok=True)
        marker_path(job_dir, "done").touch(exist_ok=True)
        append_audit(root, {"event": "job_completed", "job_id": job_id,
                            "presenter_id": presenter_id,
                            "output_sha256": render["output_sha256"]})
        log(f"job {job_id} done: {render['output_file']} "
            f"({render['output_bytes']} bytes)")
        return 0
    except Exception as exc:
        return _fail(root, job_dir, job_id, str(exc),
                     consent_receipt_version=consent_version, weights=weights)


def _fail(root, job_dir, job_id, reason, consent_receipt_version=1,
          weights=None) -> int:
    fail_job(root, job_dir, job_id, reason,
             consent_receipt_version=consent_receipt_version, weights=weights)
    return 2


def _generate_segments(root, job_dir, script, presenter_id, checkpoints_dir,
                       ffprobe_bin):
    """TTS + tone-color conversion per segment. Returns
    (segment result dicts, [(wav_path, start_sec), ...])."""
    import torch  # lazy

    from melo.api import TTS
    from openvoice.api import ToneColorConverter

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    tmp_dir = job_dir / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    segments_dir = job_dir / "segments"
    segments_dir.mkdir(parents=True, exist_ok=True)

    converter = ToneColorConverter(str(checkpoints_dir / "converter" / "config.json"),
                                   device=device)
    converter.load_ckpt(str(checkpoints_dir / "converter" / "checkpoint.pth"))
    tgt_se = load_target_se(root, presenter_id)

    tts = TTS(language="EN", device=device)
    speaker_key, speaker_id = pick_en_speaker(tts)
    src_se_path = checkpoints_dir / "base_speakers" / "ses" / f"{speaker_key}.pth"
    if not src_se_path.is_file():
        raise RuntimeError(f"base speaker embedding missing: {src_se_path}")
    src_se = torch.load(str(src_se_path), map_location=device)
    log(f"base TTS speaker: {speaker_key} (id {speaker_id})")

    segment_results = []
    segment_wavs = []
    try:
        for seg in script["segments"]:
            step_id = seg["step_id"]
            out_wav = segments_dir / f"{step_id}.wav"
            tmp_src = tmp_dir / f"{step_id}-src.wav"
            gen_start = time.monotonic()
            tts.tts_to_file(seg["text"], speaker_id, str(tmp_src), speed=1.0)
            converter.convert(str(tmp_src), src_se, tgt_se, str(out_wav),
                              message="@MyShell")
            gen_sec = time.monotonic() - gen_start
            audio_sec = probe_audio_duration_sec(ffprobe_bin, out_wav) \
                if ffprobe_bin else None
            if audio_sec is None or audio_sec <= 0:
                raise RuntimeError(f"could not measure duration of {out_wav}")
            rtf = gen_sec / audio_sec
            segment_results.append({
                "step_id": step_id,
                "audio_file": f"segments/{step_id}.wav",
                "audio_sha256": sha256_file(out_wav),
                "duration_sec": round(audio_sec, 3),
                "real_time_factor": round(rtf, 3),
            })
            segment_wavs.append((out_wav, float(seg["capture_start_sec"])))
            log(f"segment {step_id}: {audio_sec:.2f}s audio in {gen_sec:.2f}s "
                f"(RTF {rtf:.2f})")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    return segment_results, segment_wavs


def upsert_managed_output(root: Path, presenter_id: str, job_id: str,
                          output_file: str, output_sha256: str) -> None:
    """Record a completed job's output in narration/managed-outputs.json.

    The Tauri revocation transaction reads this file to unpublish
    outputs. One entry per job_id (replaced on re-render); status
    "active" until revoked. Written BEFORE the .done marker flips, so a
    done job always has a managed record.
    """
    path = root / "managed-outputs.json"
    doc = {"version": 1, "outputs": []}
    if path.is_file():
        try:
            doc = load_json(path)
        except Exception:
            doc = {"version": 1, "outputs": []}
    outputs = [o for o in doc.get("outputs", [])
               if isinstance(o, dict) and o.get("job_id") != job_id]
    outputs.append({
        "job_id": job_id,
        "presenter_id": presenter_id,
        "output_file": output_file,
        "output_sha256": output_sha256,
        "status": "active",
        "published_at": None,
        "saved_to_forge": False,
    })
    doc["version"] = 1
    doc["outputs"] = outputs
    write_json(path, doc)


def _render(root, job_dir, manifest, script, capture_path, segment_wavs,
            captions_path, ffmpeg_bin, ffprobe_bin, weights,
            verified_script_sha256):
    """FFmpeg assembly + render manifest. Returns (render dict, manifest dict).

    ``verified_script_sha256`` is the recomputed canonical script hash
    that passed ``verify_job_binding`` in ``process_job`` — the render
    manifest records that verified value, never a copy of
    ``manifest.script_sha256``.
    """
    job_id = job_dir.name
    output_path = job_dir / "output.mp4"
    capture_has_audio = probe_has_audio_stream(ffprobe_bin, capture_path)
    log(f"capture has audio stream: {capture_has_audio}")
    cmd = build_ffmpeg_command(capture_path, segment_wavs, output_path,
                               capture_has_audio)
    render_start = time.monotonic()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    render_sec = time.monotonic() - render_start
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg render failed (exit {proc.returncode}): "
            f"{(proc.stderr or '').strip()[-500:]}")
    if not output_path.is_file():
        raise RuntimeError("ffmpeg exited 0 but output.mp4 was not created")
    output_sha = sha256_file(output_path)
    render = {
        "output_file": "output.mp4",
        "output_sha256": output_sha,
        "output_bytes": output_path.stat().st_size,
        "ffmpeg_version": ffmpeg_version(ffmpeg_bin),
        "ffmpeg_command": cmd,
        "captions_file": "captions.vtt",
        "render_sec": round(render_sec, 3),
    }
    render_manifest = {
        "version": 1,
        "job_id": job_id,
        "input_hashes": {
            "capture_sha256": manifest.get("capture_sha256"),
            "script_sha256": verified_script_sha256,
            "reference_audio_sha256": sha256_file(
                root / "presenters" / manifest["presenter_id"] / "reference.wav"),
        },
        "model_hashes": {
            "model_id": MODEL_ID,
            "code_commit": MODEL_CODE_COMMIT,
            "weights_sha256": weights,
        },
        "ffmpeg_version": render["ffmpeg_version"],
        "ffmpeg_command": cmd,
        "consent_receipt_version": manifest.get("consent_receipt_version", 1),
        "output_hash": output_sha,
        "caption_path": "captions.vtt",
        "acceptance_receipt": None,
    }
    write_json(job_dir / "render-manifest.json", render_manifest)
    log(f"render done in {render_sec:.1f}s: {output_sha[:16]}…")
    return render, render_manifest


# --- CLI --------------------------------------------------------------------

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="FORGE Capture Phase 3 Slice A narration runner (OpenVoice V2, local-only)")
    parser.add_argument("--narration-root", default=None,
                        help="narration spool root (default: %%LOCALAPPDATA%%\\FORGE Capture\\narration)")
    parser.add_argument("--once", action="store_true",
                        help="process a single queued job then exit")
    parser.add_argument("--loop", action="store_true",
                        help="poll every 5 s for queued jobs, forever")
    parser.add_argument("--enroll-only", metavar="PRESENTER_ID", default=None,
                        help="standalone enrollment run for one presenter, then exit")
    parser.add_argument("--checkpoints-dir", default=None,
                        help="OpenVoice V2 checkpoints dir (default: C:\\forge-bridge\\narration\\checkpoints_v2)")
    parser.add_argument("--ffmpeg-dir", default=None,
                        help="dir containing ffmpeg.exe/ffprobe.exe (default: PATH, then C:\\forge-bridge\\tools\\ffmpeg\\bin)")
    parser.add_argument("--receipt-path", default=None,
                        help="setup receipt JSON holding the weights SHA-256 (default: C:\\forge-bridge\\narration\\receipt.json)")
    args = parser.parse_args(argv)

    root = Path(args.narration_root) if args.narration_root else default_narration_root()
    (root / "jobs").mkdir(parents=True, exist_ok=True)
    (root / "presenters").mkdir(parents=True, exist_ok=True)
    (root / "audit").mkdir(parents=True, exist_ok=True)
    checkpoints_dir = resolve_checkpoints_dir(args.checkpoints_dir)
    log(f"narration root: {root}")
    log(f"checkpoints: {checkpoints_dir}")
    checkpoints_ok = (checkpoints_dir / "converter" / "config.json").is_file()
    if not checkpoints_ok:
        log(f"WARNING: converter config not found under {checkpoints_dir} "
            "(is the env setup finished? jobs will fail until it lands)")

    ffmpeg_bin = resolve_tool("ffmpeg", args.ffmpeg_dir)
    ffprobe_bin = resolve_tool("ffprobe", args.ffmpeg_dir)
    if not ffmpeg_bin or not ffprobe_bin:
        log("ERROR: ffmpeg/ffprobe not found (PATH or --ffmpeg-dir). "
            "Expected at C:\\forge-bridge\\tools\\ffmpeg\\bin")
        return 2
    log(f"ffmpeg: {ffmpeg_bin} ({ffmpeg_version(ffmpeg_bin)})")

    if args.enroll_only:
        presenter_id = args.enroll_only
        if not checkpoints_ok:
            log(f"ERROR: cannot enroll {presenter_id}: converter config "
                f"missing under {checkpoints_dir}")
            return 2
        consent_ok, reason, _c = check_consent(root, presenter_id)
        if not consent_ok:
            log(f"enrollment refused for {presenter_id}: {reason}")
            return 2
        try:
            enroll_presenter(root, presenter_id, checkpoints_dir,
                             args.receipt_path)
        except Exception as exc:
            log(f"enrollment failed for {presenter_id}: {exc}")
            return 2
        return 0

    if args.loop and args.once:
        log("ERROR: --loop and --once are mutually exclusive")
        return 2
    if not args.loop and not args.once:
        parser.error("one of --once, --loop, or --enroll-only is required")

    if args.once:
        job_dir = find_queued_job(root)
        if job_dir is None:
            log("no queued job")
            return 1
        # Claim: atomic rename .queued -> .processing (same filesystem).
        try:
            os.replace(marker_path(job_dir, "queued"),
                       marker_path(job_dir, "processing"))
        except FileNotFoundError:
            log(f"job {job_dir.name} was claimed by another runner; skipping")
            return 1
        log(f"claimed job {job_dir.name}")
        return process_job(root, job_dir, checkpoints_dir,
                           ffmpeg_bin, ffprobe_bin, args.receipt_path)

    # --loop
    log(f"looping: polling every {POLL_SECONDS}s (Ctrl+C to stop)")
    while True:
        try:
            job_dir = find_queued_job(root)
            if job_dir is not None:
                try:
                    os.replace(marker_path(job_dir, "queued"),
                               marker_path(job_dir, "processing"))
                except FileNotFoundError:
                    time.sleep(POLL_SECONDS)
                    continue
                log(f"claimed job {job_dir.name}")
                process_job(root, job_dir, checkpoints_dir,
                            ffmpeg_bin, ffprobe_bin, args.receipt_path)
            time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            log("loop stopped by user")
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
