"""Pure helpers for the FORGE Capture Phase 3 Slice A narration sidecar.

No heavy imports here (no torch, no openvoice, no melo) so this module
imports and tests cleanly on machines without a GPU or the model stack
— including the dev VM. The runner (narration_runner.py) imports these
helpers and does all heavy work behind lazy imports inside functions.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import math
import os
import time
from pathlib import Path

# Marker precedence: .done > .failed > .processing > .queued
MARKER_ORDER = (".done", ".failed", ".processing", ".queued")


def sha256_file(path) -> str:
    """SHA-256 hex digest of a file's bytes, streamed in 1 MiB chunks."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    """SHA-256 hex digest of a bytes object."""
    return hashlib.sha256(data).hexdigest()


def format_vtt_timestamp(sec: float) -> str:
    """Format seconds as a WebVTT timestamp ``HH:MM:SS.mmm``.

    Rounds to the nearest millisecond and carries overflow (e.g. 59.9996
    becomes 01:00.000 in the seconds field, 3599.9996 becomes 01:00:00.000).
    """
    if sec < 0 or not math.isfinite(sec):
        raise ValueError(f"VTT timestamp must be a finite non-negative number, got {sec!r}")
    total_ms = int(round(sec * 1000))
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    seconds, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{ms:03d}"


def build_vtt(segments) -> str:
    """Build a WebVTT document from script segments.

    Each segment is a mapping with ``capture_start_sec``,
    ``capture_end_sec`` and ``text``. Text is reproduced verbatim from the
    approved script — never reworded, never censored here (sensitive-text
    refusal happens upstream, before a script is approved).
    """
    lines = ["WEBVTT", ""]
    for seg in segments:
        start = format_vtt_timestamp(float(seg["capture_start_sec"]))
        end = format_vtt_timestamp(float(seg["capture_end_sec"]))
        lines.append(f"{start} --> {end}")
        lines.append(str(seg["text"]))
        lines.append("")
    return "\n".join(lines)


def build_ffmpeg_command(capture_path, segment_wavs, output_path,
                         capture_has_audio: bool) -> list:
    """Build the exact deterministic FFmpeg render command.

    ``segment_wavs`` is a list of ``(path, start_sec)`` pairs. Each
    narration track is delayed to its capture start with ``adelay`` and
    mixed with the original capture audio at volume 0.25 (narration at
    1.0). Video is copied, never re-encoded (``-c:v copy``); audio is AAC.
    When the capture has no audio stream, narration is the only audio
    (no ``[0:a]`` input in the mix).

    Returns the argv list the runner executes verbatim; the same list is
    recorded in render-manifest.json and result.json.
    """
    capture_path = str(capture_path)
    output_path = str(output_path)
    if not segment_wavs:
        raise ValueError("build_ffmpeg_command requires at least one narration segment")
    if capture_has_audio not in (True, False):
        raise ValueError("capture_has_audio must be a bool")

    cmd = ["ffmpeg", "-y", "-i", capture_path]
    for wav_path, _start in segment_wavs:
        cmd += ["-i", str(wav_path)]

    filters = []
    delayed_labels = []
    for i, (_wav_path, start_sec) in enumerate(segment_wavs):
        ms = int(round(float(start_sec) * 1000))
        label = f"a{i}"
        # Single delay value: it applies to every channel (mono segment
        # WAVs from OpenVoice are single-channel; "ms|ms" would fail on
        # them because adelay wants one value per channel).
        filters.append(f"[{i + 1}:a]adelay={ms}[{label}]")
        delayed_labels.append(f"[{label}]")

    if capture_has_audio:
        filters.append("[0:a]volume=0.25[orig]")
        mix_inputs = "[orig]" + "".join(delayed_labels)
        total_inputs = 1 + len(segment_wavs)
    else:
        mix_inputs = "".join(delayed_labels)
        total_inputs = len(segment_wavs)
    filters.append(f"{mix_inputs}amix=inputs={total_inputs}:normalize=0[aout]")

    cmd += [
        "-filter_complex", ";".join(filters),
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        str(output_path),
    ]
    return cmd


def validate_script_dict(script) -> list:
    """Validate a NarrationScript dict. Returns a list of error strings
    (empty means valid). Rules (per the scope brief):

    - ``segments`` is a non-empty list
    - every segment has a non-empty ``text`` and a non-empty ``step_id``
    - step ids are unique
    - segments are sorted by start time with no overlaps
    - every segment satisfies start < end and end <= capture_duration_sec
    """
    errors = []
    if not isinstance(script, dict):
        return ["script must be a JSON object"]
    duration = script.get("capture_duration_sec")
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) \
            or not math.isfinite(duration) or duration <= 0:
        errors.append("capture_duration_sec must be a positive number")
        duration = None
    segments = script.get("segments")
    if not isinstance(segments, list) or not segments:
        errors.append("segments must be a non-empty list")
        return errors

    seen_ids = set()
    prev_end = None
    prev_start = None
    for idx, seg in enumerate(segments):
        where = f"segments[{idx}]"
        if not isinstance(seg, dict):
            errors.append(f"{where} must be an object")
            continue
        step_id = seg.get("step_id")
        if not isinstance(step_id, str) or not step_id.strip():
            errors.append(f"{where}.step_id must be a non-empty string")
        elif step_id in seen_ids:
            errors.append(f"{where}.step_id {step_id!r} is duplicated")
        else:
            seen_ids.add(step_id)
        text = seg.get("text")
        if not isinstance(text, str) or not text.strip():
            errors.append(f"{where}.text must be a non-empty string")
        start = seg.get("capture_start_sec")
        end = seg.get("capture_end_sec")
        ok_numbers = True
        for name, val in (("capture_start_sec", start), ("capture_end_sec", end)):
            if not isinstance(val, (int, float)) or isinstance(val, bool) \
                    or not math.isfinite(val):
                errors.append(f"{where}.{name} must be a finite number")
                ok_numbers = False
        if not ok_numbers:
            continue
        if start < 0:
            errors.append(f"{where}.capture_start_sec must be >= 0")
        if end <= start:
            errors.append(f"{where}.capture_end_sec must be > capture_start_sec")
        if duration is not None and end > duration:
            errors.append(
                f"{where}.capture_end_sec ({end}) exceeds "
                f"capture_duration_sec ({duration})"
            )
        if prev_start is not None and start < prev_start:
            errors.append(f"{where} is not sorted by capture_start_sec")
        if prev_end is not None and start < prev_end:
            errors.append(f"{where} overlaps the previous segment")
        prev_start = start if prev_start is None else max(prev_start, start)
        prev_end = end if prev_end is None else max(prev_end, end)
    return errors


def canonical_script_json(script) -> str:
    """Canonical JSON of a NarrationScript in its pre-assignment form.

    Rebuilds the script as an ordered dict with EXACTLY the Rust
    ``NarrationScript`` / ``NarrationSegment`` struct fields, in struct
    order, with ``job_id`` forced to ``""`` — the empty-``job_id`` form
    the Rust core hashes at creation (``narration_create_job`` builds
    the script with ``job_id ""``, hashes it, derives the canonical job
    id from that hash, and only then stores the script with the real
    job id). Unknown keys are dropped: Rust's struct ignores them on
    deserialize, so they were never part of the hashed value.

    Top level: version, job_id (""), presenter_id,
    capture_duration_sec (coerced to float), segments. Each segment:
    step_id, text, source_evidence, capture_start_sec (float),
    capture_end_sec (float), audio_hash (default None), correction
    (default None). Serialized compact (``separators=(",", ":")``,
    ``ensure_ascii=False``) to match ``serde_json::to_string``.

    Assumption: Python's float repr matches Rust serde_json/ryu for
    ordinary second values — capture times are small, non-exotic
    decimals (``45.0 -> "45.0"``, ``4.2 -> "4.2"`` on both sides).
    """
    segments = []
    for seg in script.get("segments") or []:
        segments.append({
            "step_id": seg.get("step_id"),
            "text": seg.get("text"),
            "source_evidence": seg.get("source_evidence"),
            "capture_start_sec": float(seg.get("capture_start_sec")),
            "capture_end_sec": float(seg.get("capture_end_sec")),
            "audio_hash": seg.get("audio_hash"),
            "correction": seg.get("correction"),
        })
    canonical = {
        "version": script.get("version"),
        "job_id": "",
        "presenter_id": script.get("presenter_id"),
        "capture_duration_sec": float(script.get("capture_duration_sec")),
        "segments": segments,
    }
    return json.dumps(canonical, separators=(",", ":"), ensure_ascii=False)


def canonical_script_sha256(script) -> str:
    """SHA-256 hex of the script's canonical empty-``job_id`` JSON."""
    return hashlib.sha256(
        canonical_script_json(script).encode("utf-8")).hexdigest()


def verify_job_binding(manifest, script, job_id, weights_sha256) -> list:
    """Verify a job's script + manifest binding. Returns error strings
    (empty means OK). Checks, in order:

    (a) ``script.job_id`` equals the job directory name;
    (b) the recomputed canonical script hash equals
        ``manifest.script_sha256``;
    (c) the canonical job id recomputed from the manifest inputs
        (presenter_id, consent_receipt_version, model_id,
        model_version, weights_sha256, capture_sha256, and the
        RECOMPUTED script hash — not the manifest's) equals the job
        directory name;
    (d) that same recomputed id equals ``manifest.job_id``.

    Using the recomputed script hash in (c) means a tampered script
    fails at (b) first, and a stale manifest hash fails at (c).
    """
    if not isinstance(script, dict):
        return ["script must be a JSON object"]
    if not isinstance(manifest, dict):
        return ["manifest must be a JSON object"]
    errors = []
    if script.get("job_id") != job_id:
        errors.append(
            f"script job_id {script.get('job_id')!r} does not match "
            f"job directory {job_id!r}")
    try:
        recomputed_script_sha256 = canonical_script_sha256(script)
    except Exception as exc:
        return errors + [f"script canonicalization failed: {exc}"]
    if recomputed_script_sha256 != manifest.get("script_sha256"):
        errors.append(
            "script_sha256 mismatch: recomputed "
            f"{recomputed_script_sha256} != manifest "
            f"{manifest.get('script_sha256')!r}; the script was changed "
            "after job creation")
    recomputed_job_id = canonical_job_id(
        manifest.get("presenter_id"),
        manifest.get("consent_receipt_version"),
        manifest.get("model_id"),
        manifest.get("model_version"),
        weights_sha256,
        manifest.get("capture_sha256"),
        recomputed_script_sha256,
    )
    if recomputed_job_id != job_id:
        errors.append(
            f"canonical job id {recomputed_job_id!r} does not match "
            f"job directory {job_id!r}")
    if recomputed_job_id != manifest.get("job_id"):
        errors.append(
            f"canonical job id {recomputed_job_id!r} does not match "
            f"manifest job_id {manifest.get('job_id')!r}")
    return errors


def canonical_job_id(presenter_id, consent_receipt_version, model_id,
                     model_version, weights_sha256, capture_sha256,
                     script_sha256) -> str:
    """Canonical job id, same construction as the Rust core:
    ``"narr-"`` + first 16 hex chars of the SHA-256 of the seven inputs
    joined by ``"\\n"`` in order presenter_id, consent_receipt_version,
    model_id, model_version, weights_sha256, capture_sha256, script_sha256.
    """
    joined = "\n".join([
        str(presenter_id),
        str(consent_receipt_version),
        str(model_id),
        str(model_version),
        str(weights_sha256),
        str(capture_sha256),
        str(script_sha256),
    ])
    return "narr-" + hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def validate_result_dict(result) -> list:
    """Validate a NarrationResult dict. Returns a list of error strings
    (empty means valid)."""
    errors = []
    if not isinstance(result, dict):
        return ["result must be a JSON object"]
    if not result.get("job_id"):
        errors.append("job_id is required")
    status = result.get("status")
    if status not in ("done", "failed"):
        errors.append("status must be 'done' or 'failed'")
        return errors
    outbound = result.get("outbound_requests")
    if outbound != []:
        errors.append("outbound_requests must be [] (local-first: no network calls during a job)")
    segments = result.get("segments")
    if status == "done":
        if not isinstance(segments, list) or not segments:
            errors.append("status 'done' requires a non-empty segments list")
        else:
            for idx, seg in enumerate(segments):
                if not isinstance(seg, dict):
                    errors.append(f"segments[{idx}] must be an object")
                    continue
                for field in ("step_id", "audio_file", "audio_sha256"):
                    if not seg.get(field):
                        errors.append(f"segments[{idx}].{field} is required")
                rtf = seg.get("real_time_factor")
                if not isinstance(rtf, (int, float)) or isinstance(rtf, bool) \
                        or not math.isfinite(rtf) or rtf <= 0:
                    errors.append(f"segments[{idx}].real_time_factor must be a positive number")
        render = result.get("render")
        if not isinstance(render, dict):
            errors.append("status 'done' requires a render object")
        else:
            for field in ("output_file", "output_sha256", "ffmpeg_version",
                          "ffmpeg_command", "captions_file"):
                if not render.get(field):
                    errors.append(f"render.{field} is required")
            if not isinstance(render.get("output_bytes"), int) or render.get("output_bytes", 0) < 0:
                errors.append("render.output_bytes must be a non-negative integer")
    else:  # failed
        if not result.get("failure_reason"):
            errors.append("status 'failed' requires failure_reason")
        if result.get("render") is not None:
            errors.append("status 'failed' must have render null")
    return errors


def resolve_marker(job_dir) -> str | None:
    """Resolve a job directory's status from its marker files.

    Precedence: .done > .failed > .processing > .queued. Returns the
    status string (``"done"`` / ``"failed"`` / ``"processing"`` /
    ``"queued"``) or None when no marker is present.
    """
    job_dir = Path(job_dir)
    for marker in MARKER_ORDER:
        if (job_dir / marker).exists():
            return marker[1:]
    return None


def marker_path(job_dir, status: str) -> Path:
    """Path of the marker file for a status (``.queued`` etc.)."""
    return Path(job_dir) / f".{status}"


# --- Presenter lock (fix round 2) -------------------------------------------
# One cross-process OS advisory lock per presenter, on the same file the
# Rust core locks (``<root>/presenters/<presenter_id>/.narration-lock``):
# flock on POSIX, LockFileEx via msvcrt.locking on Windows — the same
# underlying mechanism the Rust ``fs2`` crate uses, so the Tauri app
# process and this runner genuinely exclude each other. The OS releases
# the lock if a holder dies, so a crashed process can never wedge the
# presenter. Hold it only around the short critical sections (job
# creation is Rust-side; here: completion publication and the
# enrollment writes) — the render itself runs unlocked. A timeout fails
# closed: the caller must NOT proceed with the gated operation.
PRESENTER_LOCK_FILE = ".narration-lock"
PRESENTER_LOCK_TIMEOUT_SECONDS = 30.0
PRESENTER_LOCK_POLL_SECONDS = 0.05


def presenter_id_valid(presenter_id) -> bool:
    """Presenter ids are directory names (mirrors the Rust core rule):
    lowercase letters, digits, hyphens; 1–64 chars; no leading or
    trailing hyphen. Anything else — including ``/``, ``\\``, ``..`` —
    must never escape its own directory."""
    return (
        isinstance(presenter_id, str)
        and 0 < len(presenter_id) <= 64
        and not presenter_id.startswith("-")
        and not presenter_id.endswith("-")
        and all(
            c.isascii() and (c.islower() or c.isdigit() or c == "-")
            for c in presenter_id
        )
    )


def _acquire_lock_fd(fd, timeout, presenter_id) -> None:
    """Block until the advisory lock on ``fd`` is held or ``timeout``
    seconds pass (then raise TimeoutError — fail closed)."""
    deadline = time.monotonic() + timeout
    if os.name == "nt":
        import msvcrt

        while True:
            try:
                # msvcrt.locking locks from the current file position.
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                return
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"timed out waiting {timeout}s for the narration lock "
                        f"for presenter {presenter_id!r} (another process holds it)"
                    )
                time.sleep(PRESENTER_LOCK_POLL_SECONDS)
    else:
        import fcntl

        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"timed out waiting {timeout}s for the narration lock "
                        f"for presenter {presenter_id!r} (another process holds it)"
                    )
                time.sleep(PRESENTER_LOCK_POLL_SECONDS)


def _release_lock_fd(fd) -> None:
    """Best-effort unlock; closing the fd releases the lock regardless."""
    try:
        if os.name == "nt":
            import msvcrt

            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_UN)
    except OSError:
        pass


@contextlib.contextmanager
def presenter_lock(root, presenter_id, timeout=PRESENTER_LOCK_TIMEOUT_SECONDS):
    """Hold a presenter's narration lock for the ``with`` block.

    Serializes this process against the Tauri app's job creation and
    revocation for the same presenter. Raises ValueError on an invalid
    presenter id and TimeoutError when another process holds the lock
    past ``timeout`` — both fail closed: do not proceed with the gated
    operation. Releasing the context manager (including on exception)
    always frees the presenter.
    """
    if not presenter_id_valid(presenter_id):
        raise ValueError(f"invalid presenter id: {presenter_id!r}")
    presenter_dir = Path(root) / "presenters" / presenter_id
    presenter_dir.mkdir(parents=True, exist_ok=True)
    lock_path = presenter_dir / PRESENTER_LOCK_FILE
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        _acquire_lock_fd(fd, timeout, presenter_id)
        try:
            yield
        finally:
            _release_lock_fd(fd)
    finally:
        os.close(fd)
