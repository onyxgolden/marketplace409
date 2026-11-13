"""Tests for narration_lib.py (pure helpers) + stdlib-only runner behavior.

Runs on the dev VM: no torch, no GPU, no model downloads. Tests that need
ffmpeg/ffprobe are skipped when those binaries are absent.
"""

import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import narration_lib as lib
import narration_runner as runner

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


# --- hashing ---------------------------------------------------------------

def test_sha256_bytes_matches_hashlib():
    assert lib.sha256_bytes(b"hello") == hashlib.sha256(b"hello").hexdigest()


def test_sha256_file_matches_bytes(tmp_path):
    p = tmp_path / "a.bin"
    p.write_bytes(b"\x00\x01\x02" * 1000)
    assert lib.sha256_file(p) == lib.sha256_bytes(p.read_bytes())


def test_sha256_file_empty(tmp_path):
    p = tmp_path / "empty"
    p.write_bytes(b"")
    assert lib.sha256_file(p) == hashlib.sha256(b"").hexdigest()


# --- VTT -------------------------------------------------------------------

def test_format_vtt_timestamp_basic():
    assert lib.format_vtt_timestamp(0) == "00:00:00.000"
    assert lib.format_vtt_timestamp(1.5) == "00:00:01.500"
    assert lib.format_vtt_timestamp(61.234) == "00:01:01.234"
    assert lib.format_vtt_timestamp(3661.999) == "01:01:01.999"


def test_format_vtt_timestamp_hour_rollover():
    # 3599.9996 rounds up to exactly 1 hour.
    assert lib.format_vtt_timestamp(3599.9996) == "01:00:00.000"
    # 59.9996 rounds up to 1 minute.
    assert lib.format_vtt_timestamp(59.9996) == "00:01:00.000"
    # Large hour value.
    assert lib.format_vtt_timestamp(7325.25) == "02:02:05.250"


def test_format_vtt_timestamp_rejects_bad_input():
    with pytest.raises(ValueError):
        lib.format_vtt_timestamp(-1)
    with pytest.raises(ValueError):
        lib.format_vtt_timestamp(math.nan)
    with pytest.raises(ValueError):
        lib.format_vtt_timestamp(math.inf)


def test_build_vtt_header_and_cues():
    segs = [
        {"capture_start_sec": 0, "capture_end_sec": 4.2,
         "text": "Open the valve."},
        {"capture_start_sec": 4.2, "capture_end_sec": 12.5,
         "text": "Check the gauge — 150 psi."},
    ]
    vtt = lib.build_vtt(segs)
    assert vtt.startswith("WEBVTT\n\n")
    assert "00:00:00.000 --> 00:00:04.200\nOpen the valve.\n" in vtt
    assert "00:00:04.200 --> 00:00:12.500\nCheck the gauge — 150 psi.\n" in vtt
    # Cues are blank-line separated.
    assert "\n\n00:00:04.200" in vtt


def test_build_vtt_text_verbatim():
    segs = [{"capture_start_sec": 0, "capture_end_sec": 1,
             "text": "  spaced   AND CAPS, punctuation!  "}]
    assert "  spaced   AND CAPS, punctuation!  " in lib.build_vtt(segs)


def test_build_vtt_empty_segments():
    assert lib.build_vtt([]) == "WEBVTT\n"


# --- FFmpeg command --------------------------------------------------------

def test_ffmpeg_command_with_audio():
    cmd = lib.build_ffmpeg_command(
        "cap.mp4",
        [("s0.wav", 1.5), ("s1.wav", 10.0)],
        "out.mp4", capture_has_audio=True)
    assert cmd[0] == "ffmpeg"
    assert cmd[1] == "-y"
    assert cmd.count("-i") == 3
    assert cmd[cmd.index("-i") + 1] == "cap.mp4"
    assert "s0.wav" in cmd and "s1.wav" in cmd
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "[1:a]adelay=1500[a0]" in fc
    assert "[2:a]adelay=10000[a1]" in fc
    assert "[0:a]volume=0.25[orig]" in fc
    assert "[orig][a0][a1]amix=inputs=3:normalize=0[aout]" in fc
    assert "-c:v" in cmd and cmd[cmd.index("-c:v") + 1] == "copy"
    assert "-c:a" in cmd and cmd[cmd.index("-c:a") + 1] == "aac"
    assert cmd[-1] == "out.mp4"
    assert cmd[cmd.index("-map") + 1] == "0:v"
    assert "[aout]" in cmd


def test_ffmpeg_command_no_audio():
    cmd = lib.build_ffmpeg_command(
        "cap.mp4", [("s0.wav", 0.0)], "out.mp4", capture_has_audio=False)
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "[0:a]" not in fc
    assert "[1:a]adelay=0[a0]" in fc
    assert "[a0]amix=inputs=1:normalize=0[aout]" in fc
    assert cmd[cmd.index("-c:v") + 1] == "copy"


def test_ffmpeg_command_adelay_ms_math():
    cmd = lib.build_ffmpeg_command(
        "cap.mp4", [("s.wav", 2.3456)], "out.mp4", capture_has_audio=True)
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "adelay=2346" in fc  # rounded to nearest ms


def test_ffmpeg_command_rejects_empty_segments():
    with pytest.raises(ValueError):
        lib.build_ffmpeg_command("cap.mp4", [], "out.mp4", True)


# --- Script validation -----------------------------------------------------

def _good_script():
    return {
        "version": 1, "job_id": "narr-abc", "presenter_id": "tyler-welch",
        "capture_duration_sec": 45.0,
        "segments": [
            {"step_id": "s1", "text": "First step.",
             "source_evidence": "transcript", "capture_start_sec": 0.0,
             "capture_end_sec": 10.0, "audio_hash": None, "correction": None},
            {"step_id": "s2", "text": "Second step.",
             "source_evidence": "transcript", "capture_start_sec": 10.0,
             "capture_end_sec": 20.0, "audio_hash": None, "correction": None},
        ],
    }


def test_validate_script_good():
    assert lib.validate_script_dict(_good_script()) == []


def test_validate_script_empty_segments():
    s = _good_script()
    s["segments"] = []
    errs = lib.validate_script_dict(s)
    assert any("non-empty" in e for e in errs)


def test_validate_script_empty_text():
    s = _good_script()
    s["segments"][0]["text"] = "   "
    errs = lib.validate_script_dict(s)
    assert any("text" in e for e in errs)


def test_validate_script_duplicate_step_id():
    s = _good_script()
    s["segments"][1]["step_id"] = "s1"
    errs = lib.validate_script_dict(s)
    assert any("duplicated" in e for e in errs)


def test_validate_script_end_before_start():
    s = _good_script()
    s["segments"][0]["capture_end_sec"] = 0.0
    errs = lib.validate_script_dict(s)
    assert any("capture_end_sec" in e for e in errs)


def test_validate_script_end_beyond_duration():
    s = _good_script()
    s["segments"][1]["capture_end_sec"] = 99.0
    errs = lib.validate_script_dict(s)
    assert any("exceeds" in e for e in errs)


def test_validate_script_overlap():
    s = _good_script()
    s["segments"][1]["capture_start_sec"] = 9.0
    errs = lib.validate_script_dict(s)
    assert any("overlaps" in e for e in errs)


def test_validate_script_unsorted():
    s = _good_script()
    s["segments"] = [s["segments"][1], s["segments"][0]]
    # After swap, s2 (10-20) comes before s1 (0-10): start decreases.
    errs = lib.validate_script_dict(s)
    assert any("sorted" in e for e in errs)


def test_validate_script_not_a_dict():
    assert lib.validate_script_dict("nope")


def test_validate_script_missing_duration():
    s = _good_script()
    del s["capture_duration_sec"]
    assert lib.validate_script_dict(s)


# --- Canonical job id ------------------------------------------------------

def test_canonical_job_id_deterministic():
    args = ("tyler-welch", 1, "openvoice-v2", "checkpoints_v2_0417",
            "w" * 64, "c" * 64, "s" * 64)
    assert lib.canonical_job_id(*args) == lib.canonical_job_id(*args)
    assert lib.canonical_job_id(*args).startswith("narr-")
    assert len(lib.canonical_job_id(*args)) == 5 + 16


def test_canonical_job_id_sensitive_to_each_input():
    base = ["tyler-welch", 1, "openvoice-v2", "checkpoints_v2_0417",
            "w" * 64, "c" * 64, "s" * 64]
    ref = lib.canonical_job_id(*base)
    for i in range(len(base)):
        mutated = list(base)
        mutated[i] = str(mutated[i]) + "x"
        assert lib.canonical_job_id(*mutated) != ref


def test_canonical_job_id_matches_manual_hash():
    joined = "\n".join(["tyler-welch", "1", "openvoice-v2",
                        "checkpoints_v2_0417", "w", "c", "s"])
    expected = "narr-" + hashlib.sha256(joined.encode()).hexdigest()[:16]
    assert lib.canonical_job_id("tyler-welch", 1, "openvoice-v2",
                                "checkpoints_v2_0417", "w", "c", "s") == expected


# --- Result validation -----------------------------------------------------

def _good_result():
    return {
        "version": 1, "job_id": "narr-0123456789abcdef", "status": "done",
        "failure_reason": None,
        "segments": [{"step_id": "s1", "audio_file": "segments/s1.wav",
                      "audio_sha256": "a" * 64, "duration_sec": 3.1,
                      "real_time_factor": 0.8}],
        "render": {"output_file": "output.mp4", "output_sha256": "b" * 64,
                   "output_bytes": 12345, "ffmpeg_version": "ffmpeg 7.1",
                   "ffmpeg_command": ["ffmpeg", "-y"], "captions_file": "captions.vtt",
                   "render_sec": 1.2},
        "resources": {"peak_vram_mib": 4000, "peak_ram_mib": 2000,
                      "gpu": "NVIDIA GeForce RTX 5080"},
        "outbound_requests": [],
        "model": {"model_id": "openvoice-v2",
                  "model_version": "checkpoints_v2_0417",
                  "code_commit": "x", "weights_sha256": "y",
                  "base_tts": "melotts", "base_tts_commit": "z"},
        "consent_receipt_version": 1,
        "completed_at": "2026-11-12T00:00:00Z",
    }


def test_validate_result_good_done():
    assert lib.validate_result_dict(_good_result()) == []


def test_validate_result_good_failed():
    r = _good_result()
    r["status"] = "failed"
    r["failure_reason"] = "consent_revoked"
    r["segments"] = []
    r["render"] = None
    assert lib.validate_result_dict(r) == []


def test_validate_result_done_requires_render():
    r = _good_result()
    r["render"] = None
    assert any("render" in e for e in lib.validate_result_dict(r))


def test_validate_result_done_requires_segments():
    r = _good_result()
    r["segments"] = []
    assert any("segments" in e for e in lib.validate_result_dict(r))


def test_validate_result_failed_requires_reason():
    r = _good_result()
    r["status"] = "failed"
    r["failure_reason"] = None
    r["segments"] = []
    r["render"] = None
    assert any("failure_reason" in e for e in lib.validate_result_dict(r))


def test_validate_result_outbound_must_be_empty():
    r = _good_result()
    r["outbound_requests"] = ["https://example.com"]
    assert any("outbound_requests" in e for e in lib.validate_result_dict(r))


def test_validate_result_bad_status():
    r = _good_result()
    r["status"] = "maybe"
    assert lib.validate_result_dict(r)


# --- Marker precedence -----------------------------------------------------

def test_resolve_marker_precedence(tmp_path):
    d = tmp_path / "job"
    d.mkdir()
    assert lib.resolve_marker(d) is None
    (d / ".queued").touch()
    assert lib.resolve_marker(d) == "queued"
    (d / ".processing").touch()
    assert lib.resolve_marker(d) == "processing"
    (d / ".failed").touch()
    assert lib.resolve_marker(d) == "failed"
    (d / ".done").touch()
    assert lib.resolve_marker(d) == "done"


# --- Runner stdlib-only behavior (no torch needed) -------------------------

def test_runner_weights_placeholder_when_no_receipt(tmp_path):
    assert runner.weights_sha256(str(tmp_path / "nope.json")) == \
        runner.WEIGHTS_SHA256_PLACEHOLDER


def test_runner_weights_from_receipt(tmp_path):
    receipt = tmp_path / "receipt.json"
    receipt.write_text(json.dumps(
        {"checkpoints_v2_zip_sha256": "A" * 64}))
    assert runner.weights_sha256(str(receipt)) == "a" * 64


def test_runner_check_consent_missing(tmp_path):
    ok, reason, consent = runner.check_consent(tmp_path, "nobody")
    assert ok is False and reason == "consent_missing" and consent is None


def test_runner_check_consent_revoked(tmp_path):
    pdir = tmp_path / "presenters" / "tyler-welch"
    pdir.mkdir(parents=True)
    (pdir / "consent.json").write_text(json.dumps({
        "version": 1, "presenter_id": "tyler-welch", "status": "revoked",
        "scope": ["voice"], "artifact_sha256": "x",
        "consent_artifact_path": "consent-artifact.mp4"}))
    ok, reason, _ = runner.check_consent(tmp_path, "tyler-welch")
    assert ok is False and reason == "consent_revoked"


def test_runner_check_consent_hash_mismatch(tmp_path):
    pdir = tmp_path / "presenters" / "tyler-welch"
    pdir.mkdir(parents=True)
    artifact = pdir / "consent-artifact.mp4"
    artifact.write_bytes(b"fake video bytes")
    (pdir / "consent.json").write_text(json.dumps({
        "version": 1, "presenter_id": "tyler-welch", "status": "active",
        "scope": ["voice"], "artifact_sha256": "0" * 64,
        "consent_artifact_path": "consent-artifact.mp4"}))
    ok, reason, _ = runner.check_consent(tmp_path, "tyler-welch")
    assert ok is False and reason == "consent_hash_mismatch"


def test_runner_check_consent_ok(tmp_path):
    pdir = tmp_path / "presenters" / "tyler-welch"
    pdir.mkdir(parents=True)
    artifact = pdir / "consent-artifact.mp4"
    artifact.write_bytes(b"fake video bytes")
    (pdir / "consent.json").write_text(json.dumps({
        "version": 1, "presenter_id": "tyler-welch", "status": "active",
        "scope": ["voice"],
        "artifact_sha256": lib.sha256_bytes(b"fake video bytes"),
        "consent_artifact_path": "consent-artifact.mp4"}))
    ok, reason, consent = runner.check_consent(tmp_path, "tyler-welch")
    assert ok is True and reason is None and consent["status"] == "active"


def test_runner_find_queued_skips_done(tmp_path):
    jobs = tmp_path / "jobs"
    done_job = jobs / "narr-aaa"
    done_job.mkdir(parents=True)
    (done_job / ".done").touch()
    (done_job / "job.json").write_text("{}")
    queued = jobs / "narr-bbb"
    queued.mkdir(parents=True)
    (queued / ".queued").touch()
    (queued / "job.json").write_text("{}")
    assert runner.find_queued_job(tmp_path) == queued


def test_runner_fail_job_writes_markers_and_audit(tmp_path):
    job = tmp_path / "jobs" / "narr-ccc"
    job.mkdir(parents=True)
    (job / ".processing").touch()
    runner.fail_job(tmp_path, job, "narr-ccc", "consent_revoked")
    result = json.loads((job / "result.json").read_text())
    assert result["status"] == "failed"
    assert result["failure_reason"] == "consent_revoked"
    assert result["outbound_requests"] == []
    assert (job / ".failed").exists()
    assert not (job / ".processing").exists()
    audit = (tmp_path / "audit" / "audit-log.jsonl").read_text()
    assert "job_failed" in audit and "narr-ccc" in audit


# --- ffprobe-dependent (skipped without the binary) ------------------------

@pytest.mark.skipif(not FFPROBE or not FFMPEG,
                    reason="ffprobe/ffmpeg not available")
def test_probe_audio_duration_sec(tmp_path):
    wav = tmp_path / "tone.wav"
    subprocess.run([FFMPEG, "-y", "-f", "lavfi", "-i",
                    "sine=frequency=440:duration=1.5",
                    str(wav)], check=True, capture_output=True)
    dur = runner.probe_audio_duration_sec(FFPROBE, wav)
    assert abs(dur - 1.5) < 0.05


@pytest.mark.skipif(not FFPROBE or not FFMPEG,
                    reason="ffprobe/ffmpeg not available")
def test_probe_has_audio_stream(tmp_path):
    silent_video = tmp_path / "novideo.mp4"
    subprocess.run([FFMPEG, "-y", "-f", "lavfi", "-i",
                    "color=c=black:s=64x64:d=1", "-c:v", "libx264",
                    str(silent_video)], check=True, capture_output=True)
    assert runner.probe_has_audio_stream(FFPROBE, silent_video) is False
    with_audio = tmp_path / "withaudio.mp4"
    subprocess.run([FFMPEG, "-y", "-f", "lavfi", "-i",
                    "color=c=black:s=64x64:d=1", "-f", "lavfi", "-i",
                    "sine=frequency=440:duration=1",
                    "-c:v", "libx264", "-c:a", "aac", "-shortest",
                    str(with_audio)], check=True, capture_output=True)
    assert runner.probe_has_audio_stream(FFPROBE, with_audio) is True
