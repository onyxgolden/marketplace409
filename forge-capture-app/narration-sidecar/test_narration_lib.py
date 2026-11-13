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

def test_load_json_reads_utf8_bom_file(tmp_path):
    # Fix round 6 live-proof find: the setup receipt is written by
    # PowerShell Out-File -Encoding utf8, which emits a UTF-8 BOM;
    # load_json with plain utf-8 rejects it ("Unexpected UTF-8 BOM")
    # and the first real enrollment failed on exactly that.
    bom_path = tmp_path / "receipt-bom.json"
    bom_path.write_bytes(b"\xef\xbb\xbf" + json.dumps(
        {"checkpoints_v2_zip_sha256": "ab" * 32}).encode("utf-8"))
    assert runner.load_json(bom_path)["checkpoints_v2_zip_sha256"] == "ab" * 32
    plain_path = tmp_path / "receipt-plain.json"
    plain_path.write_text(json.dumps({"a": 1}), encoding="utf-8")
    assert runner.load_json(plain_path) == {"a": 1}


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

def test_runner_weights_pinned_when_no_receipt(tmp_path):
    assert runner.weights_sha256(str(tmp_path / "nope.json")) == \
        runner.WEIGHTS_SHA256_PINNED


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


# --- Job binding (P1-1) -----------------------------------------------------
#
# ONE fixed fixture script for all binding tests. Its canonical
# empty-job_id JSON and SHA-256 are pinned as literals below so the
# Rust side can pin the same values (same fixture, same hash).
# Fixture JSON (as stored on disk, with the real job_id):
#   {"version": 1, "job_id": "<canonical id>", "presenter_id": "tyler-welch",
#    "capture_duration_sec": 45.0,
#    "segments": [
#      {"step_id": "s1", "text": "Open the valve.",
#       "source_evidence": "transcript 00:00–00:04",
#       "capture_start_sec": 0.0, "capture_end_sec": 4.2,
#       "audio_hash": null, "correction": null},
#      {"step_id": "s2", "text": "Check the gauge.",
#       "source_evidence": "transcript 00:04–00:12",
#       "capture_start_sec": 4.2, "capture_end_sec": 12.5,
#       "audio_hash": null, "correction": null}]}
# Canonical empty-job_id JSON (job_id forced to ""):
#   {"version":1,"job_id":"","presenter_id":"tyler-welch","capture_duration_sec":45.0,
#    "segments":[{"step_id":"s1","text":"Open the valve.",
#    "source_evidence":"transcript 00:00–00:04","capture_start_sec":0.0,
#    "capture_end_sec":4.2,"audio_hash":null,"correction":null},
#    {"step_id":"s2","text":"Check the gauge.",
#    "source_evidence":"transcript 00:04–00:12","capture_start_sec":4.2,
#    "capture_end_sec":12.5,"audio_hash":null,"correction":null}]}
# Canonical script SHA-256:
#   20365a7f6b97b835e373964a13e9498738ca347643f924db08eaf36161c1d34b

_BINDING_SCRIPT_HASH = (
    "20365a7f6b97b835e373964a13e9498738ca347643f924db08eaf36161c1d34b")
_BINDING_CANONICAL_JSON = (
    '{"version":1,"job_id":"","presenter_id":"tyler-welch",'
    '"capture_duration_sec":45.0,"segments":['
    '{"step_id":"s1","text":"Open the valve.",'
    '"source_evidence":"transcript 00:00\u201300:04",'
    '"capture_start_sec":0.0,"capture_end_sec":4.2,'
    '"audio_hash":null,"correction":null},'
    '{"step_id":"s2","text":"Check the gauge.",'
    '"source_evidence":"transcript 00:04\u201300:12",'
    '"capture_start_sec":4.2,"capture_end_sec":12.5,'
    '"audio_hash":null,"correction":null}]}')
_BINDING_WEIGHTS = "w" * 64
_BINDING_CAPTURE_SHA256 = "c" * 64


def _binding_script(job_id):
    """The one fixed binding fixture script, with the given job_id."""
    return {
        "version": 1, "job_id": job_id, "presenter_id": "tyler-welch",
        "capture_duration_sec": 45.0,
        "segments": [
            {"step_id": "s1", "text": "Open the valve.",
             "source_evidence": "transcript 00:00\u201300:04",
             "capture_start_sec": 0.0, "capture_end_sec": 4.2,
             "audio_hash": None, "correction": None},
            {"step_id": "s2", "text": "Check the gauge.",
             "source_evidence": "transcript 00:04\u201300:12",
             "capture_start_sec": 4.2, "capture_end_sec": 12.5,
             "audio_hash": None, "correction": None},
        ],
    }


def _binding_job_id(script_hash=None, weights=_BINDING_WEIGHTS,
                    capture_sha256=_BINDING_CAPTURE_SHA256):
    return lib.canonical_job_id(
        "tyler-welch", 1, "openvoice-v2", "checkpoints_v2_0417",
        weights, capture_sha256,
        script_hash if script_hash is not None else _BINDING_SCRIPT_HASH)


def _binding_manifest(job_id, script_hash=None,
                      capture_sha256=_BINDING_CAPTURE_SHA256):
    return {
        "version": 1, "job_id": job_id, "job_type": "narrate",
        "presenter_id": "tyler-welch", "consent_receipt_version": 1,
        "capture_file": "capture.mp4",
        "capture_path": "C:\\capture.mp4",
        "capture_sha256": capture_sha256,
        "model_id": "openvoice-v2", "model_version": "checkpoints_v2_0417",
        "script_sha256": script_hash if script_hash is not None
        else _BINDING_SCRIPT_HASH,
        "created_at": "2026-11-12T00:00:00Z", "status": "queued",
    }


def test_canonical_script_json_pinned():
    script = _binding_script("narr-0123456789abcdef")
    assert lib.canonical_script_json(script) == _BINDING_CANONICAL_JSON


def test_canonical_script_sha256_pinned():
    script = _binding_script("narr-0123456789abcdef")
    assert lib.canonical_script_sha256(script) == _BINDING_SCRIPT_HASH
    # The stored job_id must not affect the hash (empty-job_id form).
    assert lib.canonical_script_sha256(_binding_script("")) == \
        _BINDING_SCRIPT_HASH


def test_canonical_script_json_drops_unknown_keys_and_coerces_ints():
    script = _binding_script("narr-0123456789abcdef")
    script["extra_top_level"] = "not part of the Rust struct"
    script["capture_duration_sec"] = 45  # int form of the same f64
    script["segments"][0]["extra_segment_key"] = 123
    assert lib.canonical_script_json(script) == _BINDING_CANONICAL_JSON
    assert lib.canonical_script_sha256(script) == _BINDING_SCRIPT_HASH


def test_verify_job_binding_happy_path():
    job_id = _binding_job_id()
    script = _binding_script(job_id)
    assert lib.verify_job_binding(
        _binding_manifest(job_id), script, job_id,
        _BINDING_WEIGHTS) == []


def test_verify_job_binding_tampered_text_fails_hash_check():
    job_id = _binding_job_id()
    script = _binding_script(job_id)
    script["segments"][0]["text"] = "Close the valve."
    errs = lib.verify_job_binding(
        _binding_manifest(job_id), script, job_id, _BINDING_WEIGHTS)
    assert errs
    assert any("script_sha256 mismatch" in e for e in errs)


def test_verify_job_binding_tampered_timing_fails_hash_check():
    job_id = _binding_job_id()
    script = _binding_script(job_id)
    script["segments"][1]["capture_end_sec"] = 13.5
    errs = lib.verify_job_binding(
        _binding_manifest(job_id), script, job_id, _BINDING_WEIGHTS)
    assert errs
    assert any("script_sha256 mismatch" in e for e in errs)


def test_verify_job_binding_different_presenter_fails_job_id_check():
    # Same job_id string, but the script names another presenter.
    # The manifest hash is updated to the new script so (b) passes and
    # the failure lands squarely on the job-id check (c).
    job_id = _binding_job_id()
    script = _binding_script(job_id)
    script["presenter_id"] = "gabby-test"
    new_hash = lib.canonical_script_sha256(script)
    assert new_hash != _BINDING_SCRIPT_HASH
    errs = lib.verify_job_binding(
        _binding_manifest(job_id, script_hash=new_hash), script, job_id,
        _BINDING_WEIGHTS)
    assert errs
    assert any("canonical job id" in e for e in errs)
    assert not any("script_sha256 mismatch" in e for e in errs)


def test_verify_job_binding_different_capture_fails_job_id_check():
    # Same script and job_id string, but the manifest binds a different
    # capture hash: the recomputed canonical id no longer matches.
    job_id = _binding_job_id()
    script = _binding_script(job_id)
    manifest = _binding_manifest(job_id, capture_sha256="d" * 64)
    errs = lib.verify_job_binding(manifest, script, job_id, _BINDING_WEIGHTS)
    assert errs
    assert any("canonical job id" in e for e in errs)


def test_verify_job_binding_manifest_job_id_mismatch():
    job_id = _binding_job_id()
    script = _binding_script(job_id)
    manifest = _binding_manifest(job_id)
    manifest["job_id"] = "narr-0000000000000000"
    errs = lib.verify_job_binding(manifest, script, job_id, _BINDING_WEIGHTS)
    assert len(errs) == 1
    assert "manifest job_id" in errs[0]


def test_verify_job_binding_same_payload_replay_verifies():
    job_id = _binding_job_id()
    script = _binding_script(job_id)
    manifest = _binding_manifest(job_id)
    assert lib.verify_job_binding(
        manifest, script, job_id, _BINDING_WEIGHTS) == []
    assert lib.verify_job_binding(
        manifest, script, job_id, _BINDING_WEIGHTS) == []


def test_runner_process_job_rejects_tampered_script(tmp_path, monkeypatch):
    """End-to-end wiring: a tampered script fails the job closed in
    process_job BEFORE capture checks (the capture file does not even
    exist here, yet the failure reason is the binding, not the
    missing capture), with the weights source named. The weights
    receipt is valid here so the job reaches the binding check."""
    # Consent preflight must pass so the job reaches the binding check.
    pdir = tmp_path / "presenters" / "tyler-welch"
    pdir.mkdir(parents=True)
    artifact = pdir / "consent-artifact.mp4"
    artifact.write_bytes(b"fake video bytes")
    (pdir / "consent.json").write_text(json.dumps({
        "version": 1, "presenter_id": "tyler-welch", "status": "active",
        "scope": ["voice"],
        "artifact_sha256": lib.sha256_bytes(b"fake video bytes"),
        "consent_artifact_path": "consent-artifact.mp4"}))
    receipt_path = _weights_fixture(tmp_path, monkeypatch, tmp_path / "ckpt")
    # Job created with the pinned weights, then the script text
    # tampered after creation.
    script_hash = _BINDING_SCRIPT_HASH
    job_id = lib.canonical_job_id(
        "tyler-welch", 1, "openvoice-v2", "checkpoints_v2_0417",
        runner.WEIGHTS_SHA256_PINNED, _BINDING_CAPTURE_SHA256,
        script_hash)
    job_dir = tmp_path / "jobs" / job_id
    job_dir.mkdir(parents=True)
    (job_dir / ".processing").touch()
    (job_dir / "job.json").write_text(json.dumps(
        _binding_manifest(job_id, capture_sha256=_BINDING_CAPTURE_SHA256)))
    script = _binding_script(job_id)
    script["segments"][0]["text"] = "Tampered after creation."
    (job_dir / "script.json").write_text(json.dumps(script))
    rc = runner.process_job(tmp_path, job_dir, tmp_path / "ckpt",
                            "ffmpeg", "ffprobe", receipt_path)
    assert rc == 2
    result = json.loads((job_dir / "result.json").read_text())
    assert result["status"] == "failed"
    assert "job binding verification failed" in result["failure_reason"]
    assert "script_sha256 mismatch" in result["failure_reason"]
    assert "setup receipt (receipt.json)" in result["failure_reason"]
    assert (job_dir / ".failed").exists()


# --- presenter lock (fix round 2) -------------------------------------------

def test_presenter_id_valid_accepts_good_ids():
    for good in ("tyler-welch", "josh-morgan", "a", "abc-123"):
        assert lib.presenter_id_valid(good), good


def test_presenter_id_valid_rejects_bad_ids():
    for bad in ("", "-abc", "abc-", "Tyler-Welch", "a/b", "a\\b", "..",
                "a" * 65, "a_b", "a b", "a.b"):
        assert not lib.presenter_id_valid(bad), bad


def test_presenter_lock_acquire_release(tmp_path):
    root = tmp_path
    with lib.presenter_lock(root, "tyler-welch"):
        assert (root / "presenters" / "tyler-welch"
                / lib.PRESENTER_LOCK_FILE).is_file()
    # Re-acquiring after release succeeds.
    with lib.presenter_lock(root, "tyler-welch"):
        pass


def test_presenter_lock_rejects_invalid_id(tmp_path):
    with pytest.raises(ValueError, match="invalid presenter id"):
        with lib.presenter_lock(tmp_path, "../escape"):
            pass


def test_presenter_lock_is_per_presenter(tmp_path):
    with lib.presenter_lock(tmp_path, "tyler-welch"):
        with lib.presenter_lock(tmp_path, "josh-morgan"):
            pass


def test_presenter_lock_times_out_when_held(tmp_path):
    import threading

    # Hold the lock in a thread; a second acquisition with a short
    # timeout must fail closed instead of waiting out the 30 s default.
    acquired = threading.Event()
    release = threading.Event()

    def holder():
        with lib.presenter_lock(tmp_path, "tyler-welch"):
            acquired.set()
            release.wait(timeout=10)

    t = threading.Thread(target=holder, daemon=True)
    t.start()
    assert acquired.wait(timeout=5)
    try:
        with pytest.raises(TimeoutError, match="timed out"):
            with lib.presenter_lock(tmp_path, "tyler-welch", timeout=0.3):
                pass
    finally:
        release.set()
        t.join(timeout=5)


def test_presenter_lock_released_on_exception(tmp_path):
    with pytest.raises(RuntimeError, match="boom"):
        with lib.presenter_lock(tmp_path, "tyler-welch"):
            raise RuntimeError("boom")
    # The lock is free again.
    with lib.presenter_lock(tmp_path, "tyler-welch", timeout=1):
        pass


def test_presenter_lock_cross_process_contention(tmp_path):
    """A second PROCESS holding the lock must block this process.

    flock/msvcrt locks are per open-file description, so a thread-only
    test cannot prove the cross-process exclusion the revocation
    protocol depends on (Tauri app vs runner are separate processes).
    """
    script = tmp_path / "hold_lock.py"
    script.write_text(
        "import sys, time\n"
        f"sys.path.insert(0, {str(Path(__file__).resolve().parent)!r})\n"
        "from narration_lib import presenter_lock\n"
        f"with presenter_lock({str(tmp_path)!r}, 'tyler-welch'):\n"
        "    print('holding', flush=True)\n"
        "    time.sleep(3)\n"
    )
    proc = subprocess.Popen(
        [sys.executable, str(script)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert proc.stdout.readline().strip() == "holding"
        with pytest.raises(TimeoutError, match="timed out"):
            with lib.presenter_lock(tmp_path, "tyler-welch", timeout=0.5):
                pass
        # After the holder exits, acquisition succeeds.
        proc.wait(timeout=10)
        with lib.presenter_lock(tmp_path, "tyler-welch", timeout=2):
            pass
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait(timeout=5)


# --- runner completion publication (fix round 2) -----------------------------

def _weights_fixture(tmp_path, monkeypatch, ckpt_dir):
    """Fake-but-valid weights installation for tests.

    Writes the fifteen manifest files with small fake contents under
    ``ckpt_dir``, a setup receipt bound to that directory carrying
    the pinned hash, and monkeypatches the runner's per-file manifest
    to the fake files' real hashes. Returns the receipt path (str).
    The production manifest (real 160 MB weights) is NOT used here —
    the validation logic, not the weights bytes, is under test.

    Also installs the pinned MeloTTS English base model (fix round
    3): fake config.json + checkpoint.pth under ``tmp_path/melotts``,
    the runner's MeloTTS manifest patched to their real hashes, and
    the receipt fields the model validation requires, bound to that
    directory. NARRATION_MELOTTS_DIR is set so process_job resolves
    the fixture dir by default.

    Also installs the pinned BERT snapshot (fix round 5): the six
    BERT files under ``tmp_path/bert-snapshot``, the runner's BERT
    manifest patched to their real hashes, the receipt fields the
    BERT validation requires, and the cache resolver patched to
    return the fixture snapshot's config.json (the identity melo
    would resolve to). process_job now gates on the BERT snapshot
    too, so every spool test runs through it.
    """
    fake_hashes = {}
    for rel in sorted(runner.CHECKPOINTS_FILES):
        dest = Path(ckpt_dir) / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(f"fake weights bytes for {rel}".encode())
        fake_hashes[rel] = lib.sha256_file(dest)
    monkeypatch.setattr(runner, "CHECKPOINTS_FILES", fake_hashes)
    melotts_dir = tmp_path / "melotts"
    fake_melo = {}
    for rel in sorted(runner.MELO_MODEL_FILES):
        dest = melotts_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(f"fake melotts bytes for {rel}".encode())
        fake_melo[rel] = lib.sha256_file(dest)
    monkeypatch.setattr(runner, "MELO_MODEL_FILES", fake_melo)
    monkeypatch.setenv("NARRATION_MELOTTS_DIR", str(melotts_dir))
    bert_dir = tmp_path / "bert-snapshot"
    fake_bert = {}
    for rel in sorted(runner.BERT_MODEL_FILES):
        dest = bert_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(f"fake bert bytes for {rel}".encode())
        fake_bert[rel] = lib.sha256_file(dest)
    monkeypatch.setattr(runner, "BERT_MODEL_FILES", fake_bert)
    monkeypatch.setattr(runner, "resolve_bert_cache_path",
                        lambda: str(bert_dir / "config.json"))
    receipt = tmp_path / "receipt.json"
    receipt.write_text(json.dumps({
        "checkpoints_v2_zip_sha256": runner.WEIGHTS_SHA256_PINNED,
        "checkpoints_dir": str(ckpt_dir),
        "melotts_model_hf_revision": runner.MELO_MODEL_REVISION,
        "melotts_config_sha256": fake_melo["config.json"],
        "melotts_checkpoint_sha256": fake_melo["checkpoint.pth"],
        "melotts_dir": str(melotts_dir),
        "bert_model_repo": runner.BERT_MODEL_REPO_ID,
        "bert_model_hf_revision": runner.BERT_MODEL_REVISION,
        "bert_snapshot_dir": str(bert_dir),
        "bert_config_sha256": fake_bert["config.json"],
        "bert_vocab_sha256": fake_bert["vocab.txt"],
        "bert_tokenizer_config_sha256": fake_bert["tokenizer_config.json"],
        "bert_tokenizer_sha256": fake_bert["tokenizer.json"],
        "bert_pytorch_model_sha256": fake_bert["pytorch_model.bin"],
        "bert_safetensors_sha256": fake_bert["model.safetensors"]}))
    return str(receipt)


def _completion_spool(tmp_path, monkeypatch):
    """Spool with active consent + a valid processing job ready to run.

    Returns (root, job_dir, job_id, receipt_path). Heavy work
    (probe/enroll/TTS/render) is stubbed by the caller via
    monkeypatch; only the consent checks, binding verification,
    weights validation, and completion publication run for real.
    """
    root = tmp_path
    pdir = root / "presenters" / "tyler-welch"
    pdir.mkdir(parents=True)
    artifact = pdir / "consent-artifact.mp4"
    artifact.write_bytes(b"fake video bytes")
    (pdir / "consent.json").write_text(json.dumps({
        "version": 1, "presenter_id": "tyler-welch", "status": "active",
        "scope": ["voice"],
        "artifact_sha256": lib.sha256_bytes(b"fake video bytes"),
        "consent_artifact_path": "consent-artifact.mp4"}))
    capture = tmp_path / "capture.mp4"
    capture.write_bytes(b"fake capture bytes")
    capture_sha = lib.sha256_file(capture)
    job_id = lib.canonical_job_id(
        "tyler-welch", 1, "openvoice-v2", "checkpoints_v2_0417",
        runner.WEIGHTS_SHA256_PINNED, capture_sha, _BINDING_SCRIPT_HASH)
    job_dir = root / "jobs" / job_id
    job_dir.mkdir(parents=True)
    (job_dir / ".processing").touch()
    manifest = _binding_manifest(job_id, capture_sha256=capture_sha)
    manifest["capture_path"] = str(capture)
    (job_dir / "job.json").write_text(json.dumps(manifest))
    (job_dir / "script.json").write_text(json.dumps(_binding_script(job_id)))
    receipt_path = _weights_fixture(tmp_path, monkeypatch, tmp_path / "ckpt")
    return root, job_dir, job_id, receipt_path


def _stub_heavy_runner(monkeypatch, revoke_during_render=False):
    """Stub the model/ffmpeg work out of process_job. When
    ``revoke_during_render`` is set, the fake render flips consent to
    revoked first — the verdict's interleaving: the render finished
    while consent was active, revocation landed before publication.
    """
    monkeypatch.setattr(runner, "probe_audio_duration_sec",
                        lambda *a: 45.0)
    monkeypatch.setattr(runner, "enroll_presenter",
                        lambda *a, **k: {"reference_audio_sha256": "a" * 64,
                                         "status": "active"})

    def fake_segments(*a, **k):
        return ([{"step_id": "s1", "audio_file": "segments/s1.wav",
                   "audio_sha256": "a" * 64, "duration_sec": 4.2,
                   "real_time_factor": 0.5},
                 {"step_id": "s2", "audio_file": "segments/s2.wav",
                   "audio_sha256": "b" * 64, "duration_sec": 8.3,
                   "real_time_factor": 0.5}], [])

    monkeypatch.setattr(runner, "_generate_segments", fake_segments)

    def fake_render(root, job_dir, manifest, script, capture_path,
                    segment_wavs, captions_path, ffmpeg_bin, ffprobe_bin,
                    weights, verified_script_sha256):
        if revoke_during_render:
            consent_path = (root / "presenters" / "tyler-welch"
                            / "consent.json")
            consent = json.loads(consent_path.read_text())
            consent["status"] = "revoked"
            consent["revoked_at"] = "2026-11-12T09:00:00Z"
            consent["revoke_reason"] = "test revocation"
            consent_path.write_text(json.dumps(consent))
        out = job_dir / "output.mp4"
        out.write_bytes(b"fake narrated mp4")
        sha = lib.sha256_file(out)
        render = {"output_file": "output.mp4", "output_sha256": sha,
                  "output_bytes": out.stat().st_size,
                  "ffmpeg_version": "test", "ffmpeg_command": ["ffmpeg"],
                  "captions_file": "captions.vtt", "render_sec": 0.1}
        (job_dir / "render-manifest.json").write_text(json.dumps({
            "version": 1, "job_id": job_dir.name, "output_hash": sha}))
        return render, {"version": 1}

    monkeypatch.setattr(runner, "_render", fake_render)


def test_runner_completion_publishes_under_active_consent(tmp_path, monkeypatch):
    root, job_dir, job_id, receipt_path = _completion_spool(tmp_path, monkeypatch)
    _stub_heavy_runner(monkeypatch)
    rc = runner.process_job(root, job_dir, tmp_path / "ckpt",
                            "ffmpeg", "ffprobe", receipt_path)
    assert rc == 0
    result = json.loads((job_dir / "result.json").read_text())
    assert result["status"] == "done"
    assert result["render"]["output_sha256"] == lib.sha256_file(
        job_dir / "output.mp4")
    assert (job_dir / ".done").exists()
    assert not (job_dir / ".processing").exists()
    assert not (job_dir / ".failed").exists()
    outputs = json.loads(
        (root / "managed-outputs.json").read_text())["outputs"]
    assert len(outputs) == 1
    assert outputs[0]["job_id"] == job_id
    assert outputs[0]["status"] == "active"


def test_runner_completion_revoked_mid_render_fails_closed(tmp_path, monkeypatch):
    """The verdict's interleaving at the runner level: the render
    finished while consent was active, revocation landed before
    publication. The job must fail as consent_revoked and publish
    NOTHING — no result success, no managed output, no .done."""
    root, job_dir, job_id, receipt_path = _completion_spool(tmp_path, monkeypatch)
    _stub_heavy_runner(monkeypatch, revoke_during_render=True)
    rc = runner.process_job(root, job_dir, tmp_path / "ckpt",
                            "ffmpeg", "ffprobe", receipt_path)
    assert rc == 2
    result = json.loads((job_dir / "result.json").read_text())
    assert result["status"] == "failed"
    assert "consent_revoked" in result["failure_reason"]
    assert (job_dir / ".failed").exists()
    assert not (job_dir / ".done").exists()
    assert not (job_dir / "output.mp4").exists()
    assert not (job_dir / "captions.vtt").exists()
    assert not (root / "managed-outputs.json").exists()


def test_runner_completion_holds_presenter_lock(tmp_path, monkeypatch):
    """Publication happens UNDER the presenter lock: a nested lock
    acquisition attempted while result.json is being written must
    time out — proving the completion critical section is serialized
    against revocation, not merely checked before it."""
    root, job_dir, job_id, receipt_path = _completion_spool(tmp_path, monkeypatch)
    _stub_heavy_runner(monkeypatch)
    real_write_json = runner.write_json
    lock_seen_held = []

    def spying_write_json(path, data):
        if Path(path).name == "result.json" and Path(path).parent == job_dir:
            try:
                with lib.presenter_lock(root, "tyler-welch", timeout=0.3):
                    lock_seen_held.append(False)
            except TimeoutError:
                lock_seen_held.append(True)
        return real_write_json(path, data)

    monkeypatch.setattr(runner, "write_json", spying_write_json)
    rc = runner.process_job(root, job_dir, tmp_path / "ckpt",
                            "ffmpeg", "ffprobe", receipt_path)
    assert rc == 0
    assert lock_seen_held == [True]


# --- Weights receipt validation (moved-head re-review P1) ----------------
# The runner must not claim the pinned weights hash for bytes it did
# not verify. validate_weights_receipt requires a setup receipt with
# the pinned hash bound to the resolved checkpoint directory, and
# hashes the installed files against the pinned per-file manifest.


def test_weights_receipt_happy_path(tmp_path, monkeypatch):
    """Verified happy path: receipt carries the pinned hash, is bound
    to the resolved directory, and all fifteen files hash to the pinned
    manifest. Returns the pinned hash."""
    ckpt = tmp_path / "ckpt"
    receipt_path = _weights_fixture(tmp_path, monkeypatch, ckpt)
    assert runner.validate_weights_receipt(receipt_path, ckpt) == \
        runner.WEIGHTS_SHA256_PINNED


def test_weights_receipt_custom_checkpoint_directory(tmp_path, monkeypatch):
    """resolve_checkpoints_dir accepts an env/CLI directory — and the
    receipt must be bound to THAT directory. A receipt bound to the
    custom directory validates; the same receipt fails when the job
    resolves a different directory."""
    custom = tmp_path / "custom-ckpt"
    receipt_path = _weights_fixture(tmp_path, monkeypatch, custom)
    assert runner.validate_weights_receipt(receipt_path, custom) == \
        runner.WEIGHTS_SHA256_PINNED
    other = tmp_path / "other-ckpt"
    other.mkdir()
    with pytest.raises(RuntimeError, match="bound to checkpoints_dir"):
        runner.validate_weights_receipt(receipt_path, other)


def test_weights_receipt_no_receipt(tmp_path, monkeypatch):
    """No receipt at all: fail closed. The pinned hash is expected
    metadata, not evidence of the installed bytes."""
    ckpt = tmp_path / "ckpt"
    _weights_fixture(tmp_path, monkeypatch, ckpt)
    missing = str(tmp_path / "no-such-receipt.json")
    with pytest.raises(RuntimeError, match="no setup receipt"):
        runner.validate_weights_receipt(missing, ckpt)


def test_weights_receipt_malformed(tmp_path, monkeypatch):
    """Receipt that is not JSON, or not an object, or carries no
    usable hash: fail closed."""
    ckpt = tmp_path / "ckpt"
    _weights_fixture(tmp_path, monkeypatch, ckpt)
    bad = tmp_path / "bad-receipt.json"
    bad.write_text("{ not json")
    with pytest.raises(RuntimeError, match="malformed setup receipt"):
        runner.validate_weights_receipt(str(bad), ckpt)
    empty = tmp_path / "empty-receipt.json"
    empty.write_text(json.dumps({"something_else": 1}))
    with pytest.raises(RuntimeError, match="no valid checkpoints_v2"):
        runner.validate_weights_receipt(str(empty), ckpt)


def test_weights_receipt_mismatched_hash(tmp_path, monkeypatch):
    """Receipt hash that is not the pinned digest — a different hash,
    a short hash, or an uppercase hash: fail closed. A receipt's
    nonempty string is no longer accepted on its own."""
    ckpt = tmp_path / "ckpt"
    receipt_path = _weights_fixture(tmp_path, monkeypatch, ckpt)
    for bad_hash in ("0" * 64, "abc",
                     runner.WEIGHTS_SHA256_PINNED.upper()):
        receipt = tmp_path / "mismatch-receipt.json"
        receipt.write_text(json.dumps({
            "checkpoints_v2_zip_sha256": bad_hash,
            "checkpoints_dir": str(ckpt)}))
        with pytest.raises(RuntimeError):
            runner.validate_weights_receipt(str(receipt), ckpt)


def test_weights_receipt_wrong_directory(tmp_path, monkeypatch):
    """Receipt bound to one directory, checkpoints resolved to
    another: fail closed. Also covers a receipt that records no
    directory at all."""
    ckpt = tmp_path / "ckpt"
    receipt_path = _weights_fixture(tmp_path, monkeypatch, ckpt)
    other_dir = tmp_path / "elsewhere"
    other_dir.mkdir()
    bound_elsewhere = tmp_path / "bound-elsewhere.json"
    bound_elsewhere.write_text(json.dumps({
        "checkpoints_v2_zip_sha256": runner.WEIGHTS_SHA256_PINNED,
        "checkpoints_dir": str(other_dir)}))
    with pytest.raises(RuntimeError, match="bound to checkpoints_dir"):
        runner.validate_weights_receipt(str(bound_elsewhere), ckpt)
    no_dir = tmp_path / "no-dir.json"
    no_dir.write_text(json.dumps({
        "checkpoints_v2_zip_sha256": runner.WEIGHTS_SHA256_PINNED}))
    with pytest.raises(RuntimeError, match="does not record checkpoints_dir"):
        runner.validate_weights_receipt(str(no_dir), ckpt)


def test_weights_receipt_missing_checkpoint_file(tmp_path, monkeypatch):
    """An incomplete tree — one manifest file absent — fails closed,
    even with a valid receipt."""
    ckpt = tmp_path / "ckpt"
    receipt_path = _weights_fixture(tmp_path, monkeypatch, ckpt)
    (ckpt / "converter" / "checkpoint.pth").unlink()
    with pytest.raises(RuntimeError, match="checkpoint file missing"):
        runner.validate_weights_receipt(receipt_path, ckpt)


def test_weights_receipt_changed_checkpoint_file(tmp_path, monkeypatch):
    """A changed checkpoint file — same name, different bytes — fails
    closed and names the file. This is the verdict's 'replaced tree'
    leg: the receipt hash alone cannot catch it, the per-file
    manifest does."""
    ckpt = tmp_path / "ckpt"
    receipt_path = _weights_fixture(tmp_path, monkeypatch, ckpt)
    changed = ckpt / "base_speakers" / "EN" / "checkpoint.pth"
    changed.write_bytes(b"replaced weights bytes")
    with pytest.raises(RuntimeError) as excinfo:
        runner.validate_weights_receipt(receipt_path, ckpt)
    assert "checkpoint file changed" in str(excinfo.value)
    assert "base_speakers/EN/checkpoint.pth" in str(excinfo.value)


def test_runner_process_job_rejects_missing_receipt(tmp_path, monkeypatch):
    """End-to-end: a job with active consent and a valid script fails
    closed with the weights reason when no setup receipt exists —
    before enrollment or any model work. Nothing is rendered and no
    result claims the pinned hash."""
    root, job_dir, job_id, _receipt = _completion_spool(tmp_path, monkeypatch)
    (tmp_path / "receipt.json").unlink()  # spool built a valid one
    ckpt = tmp_path / "ckpt"
    _stub_heavy_runner(monkeypatch)
    rc = runner.process_job(root, job_dir, ckpt,
                            "ffmpeg", "ffprobe", str(tmp_path / "receipt.json"))
    assert rc == 2
    result = json.loads((job_dir / "result.json").read_text())
    assert result["status"] == "failed"
    assert "no setup receipt" in result["failure_reason"]
    assert (job_dir / ".failed").exists()
    assert not (job_dir / ".done").exists()
    assert not (job_dir / "output.mp4").exists()


# --- ses layout (fix-round-2 re-review P1) ---------------------------------
# The validated nine-file layout could not satisfy the generation
# path: the runner loads base_speakers/ses/<speaker>.pth, and no ses
# file existed. The fix pins the six English ses embeddings from the
# official myshell-ai/OpenVoiceV2 repo in the manifest + zip, and
# normalizes the MeloTTS speaker key exactly as the pinned upstream
# V2 flow does. These tests prove the layout contract with NO torch,
# NO GPU, and NO monkeypatched manifest — the production
# CHECKPOINTS_FILES is used as-is.


def test_normalize_speaker_key_matches_upstream_v2():
    """Speaker-key normalization is exactly the pinned upstream V2
    flow (demo_part3.ipynb): lowercase, '_' -> '-'. The runner used
    to load the RAW key (e.g. EN-US.pth), which matches no file
    upstream ships."""
    assert runner.normalize_speaker_key("EN-US") == "en-us"
    assert runner.normalize_speaker_key("EN-BR") == "en-br"
    assert runner.normalize_speaker_key("EN_INDIA") == "en-india"
    assert runner.normalize_speaker_key("EN-AU") == "en-au"
    assert runner.normalize_speaker_key("EN-Default") == "en-default"
    # A key with an underscore in the language slot normalizes too.
    assert runner.normalize_speaker_key("EN_NEWEST") == "en-newest"


def test_resolve_speaker_embedding_path_uses_normalized_key(tmp_path):
    """The ses path is built from the NORMALIZED key, under
    base_speakers/ses/ — not from the raw MeloTTS key."""
    assert runner.resolve_speaker_embedding_path(
        tmp_path / "ckpt", "EN-US") == \
        tmp_path / "ckpt" / "base_speakers" / "ses" / "en-us.pth"
    assert runner.resolve_speaker_embedding_path(
        tmp_path / "ckpt", "EN_INDIA") == \
        tmp_path / "ckpt" / "base_speakers" / "ses" / "en-india.pth"


def test_manifest_contains_six_en_ses_embeddings():
    """The production per-file manifest carries exactly the six
    English ses embeddings (the complete EN ses set of
    myshell-ai/OpenVoiceV2), each a 64-character lowercase digest.
    The runner is EN-only, so no other language's ses file can be
    required; the manifest is fifteen files total."""
    assert len(runner.CHECKPOINTS_FILES) == 15
    ses = sorted(rel for rel in runner.CHECKPOINTS_FILES
                 if rel.startswith("base_speakers/ses/"))
    assert ses == [
        "base_speakers/ses/en-au.pth",
        "base_speakers/ses/en-br.pth",
        "base_speakers/ses/en-default.pth",
        "base_speakers/ses/en-india.pth",
        "base_speakers/ses/en-newest.pth",
        "base_speakers/ses/en-us.pth",
    ]
    for rel in ses:
        digest = runner.CHECKPOINTS_FILES[rel]
        assert len(digest) == 64
        assert all(c in "0123456789abcdef" for c in digest)


def test_ses_layout_smoke_every_selectable_key_resolves(tmp_path):
    """Non-GPU layout smoke test (fix-round-2 re-review requirement).

    Starts from the PRODUCTION manifest/setup layout — the real
    CHECKPOINTS_FILES, not a monkeypatched one — builds a checkpoint
    tree with exactly the manifest's relative paths (dummy bytes;
    the layout, not the weights, is under test), and proves every
    MeloTTS EN speaker key the runner can select resolves to a
    validated source embedding in that tree. This test FAILS at the
    fix-round-2 head: the nine-file manifest has no ses entries, so
    every key misses. It also proves the full EN ses set is present
    in the manifest, so a future MeloTTS key in the same family
    (e.g. EN-Newest) resolves too.
    """
    ckpt = tmp_path / "ckpt"
    for rel in runner.CHECKPOINTS_FILES:
        dest = ckpt / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(f"layout probe for {rel}".encode())
    # Every selectable MeloTTS EN key resolves to an existing file.
    for key in runner.MELO_EN_SPEAKER_KEYS:
        path = runner.resolve_speaker_embedding_path(ckpt, key)
        assert path.is_file(), \
            f"selectable speaker key {key} has no ses file: {path}"
        assert str(path.relative_to(ckpt)).replace("\\", "/") \
            in runner.CHECKPOINTS_FILES
    # The full EN ses set shipped upstream is in the manifest.
    for stem in ("en-au", "en-br", "en-default", "en-india",
                 "en-newest", "en-us"):
        assert f"base_speakers/ses/{stem}.pth" in runner.CHECKPOINTS_FILES


# --- MeloTTS base-model pin (fix round 3) ---------------------------------

def _melotts_receipt(tmp_path, monkeypatch):
    """Install the fake MeloTTS model + receipt (via _weights_fixture).

    Returns (receipt_path, melotts_dir)."""
    receipt_path = _weights_fixture(tmp_path, monkeypatch, tmp_path / "ckpt")
    return receipt_path, tmp_path / "melotts"


def test_validate_melotts_model_happy_path(tmp_path, monkeypatch):
    receipt_path, melotts_dir = _melotts_receipt(tmp_path, monkeypatch)
    assert runner.validate_melotts_model(receipt_path, melotts_dir) \
        == runner.MELO_MODEL_REVISION


def test_validate_melotts_model_no_receipt(tmp_path, monkeypatch):
    _weights_fixture(tmp_path, monkeypatch, tmp_path / "ckpt")
    with pytest.raises(RuntimeError, match="setup receipt missing"):
        runner.validate_melotts_model(str(tmp_path / "nope.json"),
                                      tmp_path / "melotts")


def test_validate_melotts_model_wrong_revision(tmp_path, monkeypatch):
    receipt_path, melotts_dir = _melotts_receipt(tmp_path, monkeypatch)
    doc = json.loads(Path(receipt_path).read_text())
    doc["melotts_model_hf_revision"] = "0" * 40
    Path(receipt_path).write_text(json.dumps(doc))
    with pytest.raises(RuntimeError, match="pinned MeloTTS model revision"):
        runner.validate_melotts_model(receipt_path, melotts_dir)


def test_validate_melotts_model_wrong_dir(tmp_path, monkeypatch):
    receipt_path, _melotts_dir = _melotts_receipt(tmp_path, monkeypatch)
    with pytest.raises(RuntimeError, match="bound to melotts_dir"):
        runner.validate_melotts_model(receipt_path, tmp_path / "elsewhere")


def test_validate_melotts_model_missing_file(tmp_path, monkeypatch):
    receipt_path, melotts_dir = _melotts_receipt(tmp_path, monkeypatch)
    (melotts_dir / "checkpoint.pth").unlink()
    with pytest.raises(RuntimeError, match="model file missing"):
        runner.validate_melotts_model(receipt_path, melotts_dir)


def test_validate_melotts_model_changed_file(tmp_path, monkeypatch):
    receipt_path, melotts_dir = _melotts_receipt(tmp_path, monkeypatch)
    (melotts_dir / "config.json").write_bytes(b"tampered")
    with pytest.raises(RuntimeError, match="model file changed"):
        runner.validate_melotts_model(receipt_path, melotts_dir)


def test_validate_melotts_model_wrong_recorded_hash(tmp_path, monkeypatch):
    receipt_path, melotts_dir = _melotts_receipt(tmp_path, monkeypatch)
    doc = json.loads(Path(receipt_path).read_text())
    doc["melotts_config_sha256"] = "0" * 64
    Path(receipt_path).write_text(json.dumps(doc))
    with pytest.raises(RuntimeError, match="does not record the pinned hash"):
        runner.validate_melotts_model(receipt_path, melotts_dir)


# --- BERT offline pin (fix round 5) ---------------------------------------

def _bert_receipt(tmp_path, monkeypatch):
    """Install the fake BERT snapshot + receipt (via _weights_fixture).

    Returns receipt_path. The fixture snapshot is under
    ``tmp_path/bert-snapshot``."""
    receipt_path = _weights_fixture(tmp_path, monkeypatch, tmp_path / "ckpt")
    return receipt_path


def test_validate_bert_model_happy_path(tmp_path, monkeypatch):
    receipt_path = _bert_receipt(tmp_path, monkeypatch)
    assert runner.validate_bert_model(receipt_path) \
        == runner.BERT_MODEL_REVISION


def test_validate_bert_model_no_receipt(tmp_path, monkeypatch):
    _weights_fixture(tmp_path, monkeypatch, tmp_path / "ckpt")
    with pytest.raises(RuntimeError, match="setup receipt missing"):
        runner.validate_bert_model(str(tmp_path / "nope.json"))


def test_validate_bert_model_wrong_repo(tmp_path, monkeypatch):
    receipt_path = _bert_receipt(tmp_path, monkeypatch)
    doc = json.loads(Path(receipt_path).read_text())
    doc["bert_model_repo"] = "google-bert/bert-base-uncased"
    Path(receipt_path).write_text(json.dumps(doc))
    with pytest.raises(RuntimeError, match="pinned BERT repo"):
        runner.validate_bert_model(receipt_path)


def test_validate_bert_model_wrong_revision(tmp_path, monkeypatch):
    receipt_path = _bert_receipt(tmp_path, monkeypatch)
    doc = json.loads(Path(receipt_path).read_text())
    doc["bert_model_hf_revision"] = "0" * 40
    Path(receipt_path).write_text(json.dumps(doc))
    with pytest.raises(RuntimeError, match="pinned BERT revision"):
        runner.validate_bert_model(receipt_path)


def test_validate_bert_model_no_snapshot_dir(tmp_path, monkeypatch):
    receipt_path = _bert_receipt(tmp_path, monkeypatch)
    doc = json.loads(Path(receipt_path).read_text())
    del doc["bert_snapshot_dir"]
    Path(receipt_path).write_text(json.dumps(doc))
    with pytest.raises(RuntimeError, match="does not record bert_snapshot_dir"):
        runner.validate_bert_model(receipt_path)


def test_validate_bert_model_snapshot_dir_missing(tmp_path, monkeypatch):
    receipt_path = _bert_receipt(tmp_path, monkeypatch)
    doc = json.loads(Path(receipt_path).read_text())
    doc["bert_snapshot_dir"] = str(tmp_path / "no-such-snapshot")
    Path(receipt_path).write_text(json.dumps(doc))
    with pytest.raises(RuntimeError, match="snapshot directory missing"):
        runner.validate_bert_model(receipt_path)


def test_validate_bert_model_missing_file(tmp_path, monkeypatch):
    receipt_path = _bert_receipt(tmp_path, monkeypatch)
    (tmp_path / "bert-snapshot" / "pytorch_model.bin").unlink()
    with pytest.raises(RuntimeError, match="model file missing"):
        runner.validate_bert_model(receipt_path)


def test_validate_bert_model_changed_file(tmp_path, monkeypatch):
    receipt_path = _bert_receipt(tmp_path, monkeypatch)
    (tmp_path / "bert-snapshot" / "vocab.txt").write_bytes(b"tampered")
    with pytest.raises(RuntimeError, match="model file changed"):
        runner.validate_bert_model(receipt_path)


def test_validate_bert_model_wrong_recorded_hash(tmp_path, monkeypatch):
    receipt_path = _bert_receipt(tmp_path, monkeypatch)
    doc = json.loads(Path(receipt_path).read_text())
    doc["bert_tokenizer_sha256"] = "0" * 64
    Path(receipt_path).write_text(json.dumps(doc))
    with pytest.raises(RuntimeError, match="does not record the pinned hash"):
        runner.validate_bert_model(receipt_path)


def test_validate_bert_model_cache_resolves_elsewhere(tmp_path, monkeypatch):
    # An ambient alias cache pointing at unvalidated bytes must fail
    # closed even when the receipt snapshot itself is intact.
    receipt_path = _bert_receipt(tmp_path, monkeypatch)
    monkeypatch.setattr(runner, "resolve_bert_cache_path",
                        lambda: str(tmp_path / "other-cache" / "config.json"))
    with pytest.raises(RuntimeError, match="cache identity mismatch"):
        runner.validate_bert_model(receipt_path)


def test_validate_bert_model_cache_resolves_nothing(tmp_path, monkeypatch):
    receipt_path = _bert_receipt(tmp_path, monkeypatch)
    monkeypatch.setattr(runner, "resolve_bert_cache_path", lambda: None)
    with pytest.raises(RuntimeError, match="cache identity mismatch"):
        runner.validate_bert_model(receipt_path)


def _fake_ml_modules(monkeypatch, calls):
    """Inject fake torch/melo/openvoice modules into sys.modules.

    The fake melo download_utils RAISE if invoked — the runner must
    never take the download path. The fake TTS records its
    constructor kwargs so the test can prove it was bound to the
    validated local model files. No torch, no GPU, no network.
    """
    import types
    torch_mod = types.ModuleType("torch")

    class _Cuda:
        @staticmethod
        def is_available():
            return False

    torch_mod.cuda = _Cuda()
    torch_mod.load = lambda path, map_location=None: {"se": [0.0]}
    torch_mod.float32 = "float32"
    torch_mod.tensor = lambda data, dtype=None, device=None: {"se": data}

    melo = types.ModuleType("melo")
    melo_api = types.ModuleType("melo.api")

    class FakeTTS:
        def __init__(self, language, device="auto", use_hf=True,
                     config_path=None, ckpt_path=None):
            calls["tts_kwargs"] = {"language": language, "device": device,
                                   "use_hf": use_hf,
                                   "config_path": config_path,
                                   "ckpt_path": ckpt_path}

            class _Hps:
                pass

            class _Data:
                pass

            data = _Data()
            data.spk2id = {"EN-US": 0, "EN-BR": 1}
            hps = _Hps()
            hps.data = data
            self.hps = hps

        def tts_to_file(self, text, speaker_id, path, speed=1.0):
            Path(path).write_bytes(b"fake tts wav")

    melo_api.TTS = FakeTTS
    melo_dl = types.ModuleType("melo.download_utils")

    def _boom(*a, **k):
        calls["download_attempts"] = calls.get("download_attempts", 0) + 1
        raise AssertionError("melo download path invoked — unpinned fetch")

    melo_dl.load_or_download_config = _boom
    melo_dl.load_or_download_model = _boom
    ov = types.ModuleType("openvoice")
    ov_api = types.ModuleType("openvoice.api")

    class FakeConverter:
        def __init__(self, config_path, device="cpu"):
            calls["converter_config"] = config_path

        def load_ckpt(self, path):
            calls["converter_ckpt"] = path

        def convert(self, src, src_se, tgt_se, out, message=None):
            Path(out).write_bytes(b"fake converted wav")

    ov_api.ToneColorConverter = FakeConverter
    for name, mod in [("torch", torch_mod), ("melo", melo),
                      ("melo.api", melo_api),
                      ("melo.download_utils", melo_dl),
                      ("openvoice", ov), ("openvoice.api", ov_api)]:
        monkeypatch.setitem(sys.modules, name, mod)


def test_generate_segments_binds_validated_melotts_paths_offline(
        tmp_path, monkeypatch):
    """Cold-cache, network-disabled generation test (fix-round-3
    re-review requirement).

    With HF_HUB_OFFLINE=1 (a cold cache that cannot download) and
    the fake melo download functions wired to raise, _generate_segments
    must still generate — proving TTS was constructed from the
    validated local model files with explicit config_path/ckpt_path
    and no outbound fetch was attempted. If the runner ever passed
    no paths again, the fake download path would raise.

    NOTE (fix round 5): this test fakes melo/transformers, so it
    proves the MeloTTS path binding only — it proves NOTHING about
    the real BERT tokenizer/model load. That proof is the setup-run
    cold-cache proof (setup-env.ps1 step 7b): real libraries, fresh
    HF_HOME, sockets blocked, one real English segment.
    """
    _weights_fixture(tmp_path, monkeypatch, tmp_path / "ckpt")
    # Cold cache: no HF cache dir is seeded here, and the runner must
    # still generate from the validated local files — so the fake
    # melo download functions are wired to raise, and the runner
    # itself must force HF_HUB_OFFLINE=1 (asserted below) so no real
    # melo/transformers code path can fetch at job time.
    monkeypatch.delenv("HF_HUB_OFFLINE", raising=False)
    monkeypatch.setenv("HF_HOME", str(tmp_path / "empty-hf-cache"))
    calls = {}
    _fake_ml_modules(monkeypatch, calls)
    monkeypatch.setattr(runner, "probe_audio_duration_sec",
                        lambda *a: 4.0)
    pdir = tmp_path / "presenters" / "tyler-welch"
    pdir.mkdir(parents=True)
    (pdir / "speaker_embedding.json").write_text(
        json.dumps({"se": [0.1, 0.2]}))
    job_dir = tmp_path / "jobs" / "job1"
    job_dir.mkdir(parents=True)
    script = {"segments": [{"step_id": "s1", "text": "Hello world.",
                            "capture_start_sec": 0}]}
    results, wavs = runner._generate_segments(
        tmp_path, job_dir, script, "tyler-welch", tmp_path / "ckpt",
        "ffprobe", tmp_path / "melotts")
    assert len(results) == 1
    assert results[0]["step_id"] == "s1"
    assert "download_attempts" not in calls
    # The runner forces offline mode before importing melo, so the
    # generation above could not have fetched anything even with a
    # real melo/transformers stack.
    assert os.environ.get("HF_HUB_OFFLINE") == "1"
    tts_kwargs = calls["tts_kwargs"]
    assert tts_kwargs["language"] == "EN"
    assert tts_kwargs["config_path"] == str(tmp_path / "melotts" / "config.json")
    assert tts_kwargs["ckpt_path"] == str(tmp_path / "melotts" / "checkpoint.pth")
    assert tts_kwargs["config_path"] is not None
    assert tts_kwargs["ckpt_path"] is not None


def test_process_job_rejects_missing_melotts_model(tmp_path, monkeypatch):
    """End-to-end: a spool with valid weights but no MeloTTS model
    files fails the job closed with the MeloTTS reason — before any
    enrollment or generation."""
    root, job_dir, job_id, receipt_path = _completion_spool(tmp_path, monkeypatch)
    _stub_heavy_runner(monkeypatch)
    shutil.rmtree(tmp_path / "melotts")
    rc = runner.process_job(root, job_dir, tmp_path / "ckpt",
                            "ffmpeg", "ffprobe", receipt_path)
    assert rc == 2
    result = json.loads((job_dir / "result.json").read_text())
    assert result["status"] == "failed"
    assert "MeloTTS" in result["failure_reason"]
    assert (job_dir / ".failed").exists()
    assert not (job_dir / ".done").exists()


def test_process_job_records_melotts_provenance(tmp_path, monkeypatch):
    """End-to-end happy path: the done result carries the validated
    MeloTTS model revision + per-file hashes in its model block."""
    root, job_dir, job_id, receipt_path = _completion_spool(tmp_path, monkeypatch)
    _stub_heavy_runner(monkeypatch)
    rc = runner.process_job(root, job_dir, tmp_path / "ckpt",
                            "ffmpeg", "ffprobe", receipt_path)
    assert rc == 0
    result = json.loads((job_dir / "result.json").read_text())
    assert result["status"] == "done"
    model = result["model"]
    assert model["melotts_model_revision"] == runner.MELO_MODEL_REVISION
    assert model["melotts_config_sha256"] \
        == runner.MELO_MODEL_FILES["config.json"]
    assert model["melotts_checkpoint_sha256"] \
        == runner.MELO_MODEL_FILES["checkpoint.pth"]
    assert result["outbound_requests"] == []
