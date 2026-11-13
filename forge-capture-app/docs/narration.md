# Narration mode — OpenVoice V2 local narration contract + runner setup

FORGE Capture's **Narration mode** (Phase 3 Slice A) generates spoken
narration over a recorded capture with a presenter's own cloned voice —
**no generated face**. The voice work runs entirely on the local
iBUYPOWER GPU workstation (RTX 5080) via OpenVoice V2 zero-shot
tone-color cloning over a MeloTTS base voice. Capture itself never
touches the network for narration, and the runner makes no network
calls during a job.

## The honest design: a local spool, not fake network access

Same architecture as Meeting mode (`docs/meeting-mode.md`) and AI Edit
(`docs/ai-edit.md`): the app and the AI runner meet at a **local job
spool on disk**:

```
%LOCALAPPDATA%\FORGE Capture\narration\
  presenters/<presenter_id>/
    consent.json               ConsentReceipt
    consent-artifact.mp4       self-recorded consent statement (evidence)
    enrollment.json            VoiceEnrollment
    reference.wav              cleaned reference clip (from the consent video)
    speaker_embedding.json     derived speaker embedding (replaceable)
  jobs/<job_id>/
    job.json                   NarrationJobManifest
    script.json                NarrationScript
    segments/<step_id>.wav     per-step narration
    captions.vtt               WebVTT from the approved script
    output.mp4                 narrated render
    render-manifest.json       RenderManifest
    result.json                NarrationResult
    acceptance.json            AcceptanceReceipt (human review, not the runner)
    .queued / .processing / .done / .failed   marker files (empty)
  audit/audit-log.jsonl        append-only JSON lines
  managed-outputs.json         list of ManagedOutputRecord
```

The narration root is `%LOCALAPPDATA%\FORGE Capture\narration` on
Windows. A job directory without `job.json` is ignored, so a crash
mid-spool never yields a half job.

## Job lifecycle

1. The Rust core spools a job: `job.json` + `script.json` (manually
   authored or Phase-2-compatible) plus a `.queued` marker. The job id
   is canonical — `narr-` + the first 16 hex chars of the SHA-256 of
   the seven inputs joined by `\n` in order presenter_id,
   consent_receipt_version, model_id, model_version, weights_sha256,
   capture_sha256, script_sha256 (same construction in
   `narration_lib.canonical_job_id` and the Rust core). **Convention:**
   `script_sha256` is the hash of the script with `job_id` empty (the
   pre-assignment canonical form); the canonical job id derives from
   that hash, and the script is then stored with the real job id.
   Anyone recomputing the manifest's `script_sha256` must hash the
   same empty-`job_id` form, or the comparison will not match.
2. The external runner (`narration-sidecar/narration_runner.py`,
   iBUYPOWER only) claims the job by atomically renaming `.queued` →
   `.processing` (same filesystem rename — no second runner can claim
   it).
3. **Preflight, before any model work, re-checked at job start:** the
   runner reads `presenters/<id>/consent.json` and verifies status is
   `active`, scope includes `voice`, and
   SHA-256(`consent-artifact.mp4`) equals `artifact_sha256`. Any failure
   writes `result.json` `{status: "failed", failure_reason:
   "consent_missing" | "consent_revoked" | "consent_hash_mismatch"}`,
   the `.failed` marker, and an audit event — and the job stops. A
   queued job revoked before start **cannot run** (acceptance gate 1).

   **Job binding (fix round 1):** immediately after preflight and
   script-shape validation — still before capture checks, enrollment,
   or any model work — the runner recomputes the canonical
   empty-`job_id` script SHA-256 and the canonical job id from the
   manifest inputs and requires them to equal
   `job.json.script_sha256` and the job directory id. A script edited
   after job creation fails the job closed (no render, no enrollment,
   no model load) — the runner renders only the bytes the manifest
   bound. `render-manifest.json` records the verified recomputed hash,
   never a copy of the manifest's. The Rust core and the Python sidecar
   pin the same canonicalization: the fixture hash
   `20365a7f6b97b835e373964a13e9498738ca347643f924db08eaf36161c1d34b` is
   asserted in both test suites.
4. **Enrollment (zero-shot only, lazy model load):** if
   `enrollment.json` is missing or not `active`, the runner loads the
   OpenVoice `ToneColorConverter` (`checkpoints_v2/converter/`) and
   extracts the speaker embedding from `reference.wav`
   (`se_extractor.get_se(..., vad=True)`), writing
   `speaker_embedding.json` (`{"se": [...], "model": "openvoice-v2",
   "reference_audio_sha256": ...}`) and `enrollment.json` (status
   `active`). If enrollment is already active, the stored embedding is
   reused. **Never trains anything** — no durable personalized model.
5. **TTS per segment (OpenVoice V2 documented pipeline):** MeloTTS
   `TTS(language='EN')`; the first speaker key starting with `EN` from
   `model.hps.data.spk2id` (no EN key → fail loudly, never guess);
   `model.tts_to_file(text, speaker_id, tmp_src_wav, speed=1.0)`; the
   base speaker's embedding from
   `checkpoints_v2/base_speakers/ses/<speaker_key>.pth`;
   `tone_color_converter.convert(tmp_src_wav, src_se, tgt_se,
   segments/<step_id>.wav, message="@MyShell")`. Per-segment wall time
   and ffprobe audio duration give `real_time_factor = gen_sec /
   audio_sec`. Temp files live under the job dir `tmp/` and are cleaned
   on success.
6. **Captions:** `captions.vtt` is built from the script segments
   (capture start/end, text verbatim from the approved script) by the
   pure helper `narration_lib.build_vtt`.
7. **Render (FFmpeg, deterministic):** inputs are the original capture
   video plus one delayed narration track per segment. The command is
   built by `narration_lib.build_ffmpeg_command`: `-i <capture>` plus
   `-i <segment wav>` per segment, `filter_complex` with
   `adelay=<start_ms>` (one value — it applies to every channel; the
   segment WAVs are mono) per narration input then `amix` with
   the original audio at volume 0.25 and narration at 1.0, video copied
   (`-c:v copy`, no re-encode), audio AAC. If the capture has no audio
   stream (ffprobe checked first), the mix is narration-only. The exact
   command list and the FFmpeg version (first line of `ffmpeg
   -version`) are recorded verbatim in `render-manifest.json` and
   `result.json`, and `render-manifest.json` also records input hashes,
   model hashes, consent receipt version, output hash, and caption path.
8. **Completion-time consent re-check:** after the render, before
   `result.json` is written, the runner re-runs the consent preflight.
   A revocation that landed mid-run drops the just-rendered artifacts
   and fails the job as `consent_revoked` — no `.done` marker, no
   managed record. Otherwise the runner writes `result.json`, upserts
   the output into `managed-outputs.json` (status `active`), replaces
   `.processing` with `.done`, and appends the audit events. On any
   exception it writes `result.json` failed (`failure_reason` = the
   error, truncated to 500 chars), the `.failed` marker, and an audit
   event, and exits non-zero.
9. **Human acceptance** (`acceptance.json`, presenter + reviewer
   decisions on the exact output hash) is a separate review step in the
   UI — the runner never writes it and never self-approves. Acceptance
   binds the decision to the bytes actually reviewed (fix round 1):
   the Tauri side hashes the live output file at acceptance time and
   requires the live hash to equal BOTH `result.json`'s
   `output_sha256` and `render-manifest.json`'s `output_hash` — a
   replaced or corrupted file, a mismatched manifest, or a missing
   manifest refuses acceptance. The output path is resolved as a plain
   file name under the job directory only. On acceptance the render
   manifest records the verdict AND `acceptance_receipt_path`
   (`"acceptance.json"`), and the manifest write is checked.

### Marker files

Empty files in the job dir; status is resolved by presence, with
precedence **`.done` > `.failed` > `.processing` > `.queued`**.
The UI polls by directory presence, same as Meeting mode.

### Idempotency (gate 9)

A job dir that already has `.done` is never re-run — the runner logs
the skip and moves on. Retrying a completed job with the same
input/model/script hashes returns the same managed output record
rather than duplicating it.

### Crash recovery

If the runner dies mid-job, the `.processing` marker stays and no
`.done`/`.failed` appears. The job is not auto-retried by the runner;
an operator re-queues it (rename `.processing` → `.queued`) after
checking the log — a half-generated job is never silently completed.

## Schemas

Field names are exact — the Rust core and UI depend on them.

### `ConsentReceipt` (`presenters/<id>/consent.json`)

```json
{
  "version": 1, "presenter_id": "tyler-welch",
  "display_name": "Tyler Welch",
  "consent_artifact_path": "consent-artifact.mp4",
  "artifact_sha256": "<sha256 of the consent video>",
  "recorded_at": "2026-11-11T00:00:00Z", "reviewed_by": "Jason Morgan",
  "scope": ["voice"], "status": "active",
  "granted_at": "2026-11-11T00:00:00Z",
  "revoked_at": null, "revoke_reason": null,
  "audit_events": [{ "event": "granted", "at": "...", "by": "...", "detail": "..." }]
}
```

A filename or checkbox is not consent. The referenced self-recorded
statement must be readable and its hash must match the receipt.

### `VoiceEnrollment` (`presenters/<id>/enrollment.json`)

```json
{
  "version": 1, "presenter_id": "tyler-welch",
  "consent_receipt_version": 1,
  "consent_artifact_sha256": "<sha256>",
  "model_id": "openvoice-v2", "model_version": "checkpoints_v2_0417",
  "model_code_commit": "74a1d147b17a8c3092dd5430504bd83ef6c7eb23",
  "weights_sha256": "<FILL-FROM-RECEIPT:C:\\forge-bridge\\narration\\receipt.json>",
  "reference_audio_sha256": "<sha256 of reference.wav>",
  "preprocessing_version": "openvoice-se-extractor-vad-v1",
  "speaker_embedding_path": "speaker_embedding.json",
  "reference_clip_path": "reference.wav",
  "created_at": "2026-11-11T00:00:00Z", "last_used_at": null,
  "status": "active"
}
```

### `NarrationScript` (`jobs/<job_id>/script.json`)

```json
{
  "version": 1, "job_id": "narr-0123456789abcdef",
  "presenter_id": "tyler-welch", "capture_duration_sec": 45.0,
  "segments": [
    { "step_id": "s1", "text": "Open the valve.",
      "source_evidence": "transcript 00:00–00:04",
      "capture_start_sec": 0.0, "capture_end_sec": 4.2,
      "audio_hash": null, "correction": null }
  ]
}
```

Validation (same rules in `narration_lib.validate_script_dict`):
non-empty segments, non-empty text, start < end, end <= duration,
unique step ids, sorted, no overlaps.

### `NarrationJobManifest` (`jobs/<job_id>/job.json`)

```json
{
  "version": 1, "job_id": "narr-0123456789abcdef", "job_type": "narrate",
  "presenter_id": "tyler-welch", "consent_receipt_version": 1,
  "capture_file": "capture-2026-11-11.mp4",
  "capture_path": "C:\\Users\\jason\\...\\capture-2026-11-11.mp4",
  "capture_sha256": "<sha256>", "model_id": "openvoice-v2",
  "model_version": "checkpoints_v2_0417",
  "script_sha256": "<sha256 of script.json>",
  "created_at": "2026-11-11T00:00:00Z", "status": "queued"
}
```

### `NarrationResult` (`jobs/<job_id>/result.json`)

```json
{
  "version": 1, "job_id": "narr-0123456789abcdef", "status": "done",
  "failure_reason": null,
  "segments": [
    { "step_id": "s1", "audio_file": "segments/s1.wav",
      "audio_sha256": "<sha256>", "duration_sec": 3.1,
      "real_time_factor": 0.8 }
  ],
  "render": {
    "output_file": "output.mp4", "output_sha256": "<sha256>",
    "output_bytes": 1234567, "ffmpeg_version": "ffmpeg version 7.1 ...",
    "ffmpeg_command": ["ffmpeg", "-y", "-i", "..."],
    "captions_file": "captions.vtt", "render_sec": 4.2
  },
  "resources": { "peak_vram_mib": 4200, "peak_ram_mib": 3100,
                 "gpu": "NVIDIA GeForce RTX 5080" },
  "outbound_requests": [],
  "model": { "model_id": "openvoice-v2",
             "model_version": "checkpoints_v2_0417",
             "code_commit": "74a1d147b17a8c3092dd5430504bd83ef6c7eb23",
             "weights_sha256": "<FILL-FROM-RECEIPT:...>",
             "base_tts": "melotts",
             "base_tts_commit": "209145371cff8fc3bd60d7be902ea69cbdb7965a" },
  "consent_receipt_version": 1,
  "completed_at": "2026-11-11T00:00:00Z"
}
```

Rules (enforced by `narration_lib.validate_result_dict`): `done`
requires a render object and a non-empty segments list; `failed`
requires `failure_reason` and a null render; `outbound_requests` must
always be `[]`.

### `RenderManifest` (`jobs/<job_id>/render-manifest.json`)

```json
{
  "version": 1, "job_id": "narr-0123456789abcdef",
  "input_hashes": { "capture_sha256": "<sha256>",
                    "script_sha256": "<sha256>",
                    "reference_audio_sha256": "<sha256>" },
  "model_hashes": { "model_id": "openvoice-v2",
                    "code_commit": "74a1d147b17a8c3092dd5430504bd83ef6c7eb23",
                    "weights_sha256": "<FILL-FROM-RECEIPT:...>" },
  "ffmpeg_version": "ffmpeg version 7.1 ...",
  "ffmpeg_command": ["ffmpeg", "-y", "-i", "..."],
  "consent_receipt_version": 1,
  "output_hash": "<sha256 of output.mp4>",
  "caption_path": "captions.vtt",
  "acceptance_receipt": null,
  "acceptance_receipt_path": null
}
```

`acceptance_receipt_path` is `"acceptance.json"` once a human has
accepted the output (fix round 1); `null` before that. Old manifests
without the field still parse.

### `AcceptanceReceipt` (`jobs/<job_id>/acceptance.json`)

```json
{
  "version": 1, "job_id": "narr-0123456789abcdef",
  "output_sha256": "<sha256 of the reviewed output.mp4>",
  "presenter_decision": "approved", "presenter_by": "Tyler Welch",
  "presenter_at": "2026-11-12T00:00:00Z",
  "reviewer_decision": "approved", "reviewer_by": "Jason Morgan",
  "reviewer_at": "2026-11-12T00:00:00Z",
  "notes": "Recognizably me; acceptable for this SOP.",
  "verdict": "pass"
}
```

## Revocation behavior

Revocation is a fail-closed, restartable transaction owned by the
Tauri side (`forge-capture-core::execute_revocation`), not the runner:

1. **Durable pending state first.** Before any mutation, the plan
   (deleted assets, blocked jobs, unpublished outputs, processing jobs
   seen at plan time) is written to
   `presenters/<id>/revocation-pending.json` (two-phase write). The
   receipt's `revoked_at` and reason are the transaction's identity.
2. **Effects apply in order, each verified on disk:** consent receipt
   → `revoked` (with `revoked_at` / `revoke_reason` + audit event);
   enrollment → `revoked`; derived voice assets deleted with absence
   verified (a missing asset counts as confirmed-absent); each queued
   job blocked — `.queued` removed and verified gone, `result.json`
   written `failed` / `consent_revoked`, `.failed` verified present;
   managed outputs re-read, marked `consent_revoked`, re-read again
   and verified.
3. **No success receipt until every required effect is confirmed.**
   The final receipt (`revocation-<stamp>.json`) lists only confirmed
   effects. Any failure saves the pending state with `last_error` and
   returns an error — never a success receipt with unconfirmed effects.
   Filesystem errors are never ignored.
4. **Restartable.** A re-run with a pending state present resumes the
   transaction (same `revoked_at`/reason, confirmed lists carried
   forward, already-done effects skipped); a re-run after completion
   errors `"already revoked"`. A corrupt pending state, unreadable
   consent receipt, or corrupt enrollment fails closed before anything
   is claimed done.
5. New/queued jobs are rejected at the next preflight — the runner
   re-checks consent at every job start, so a job queued before the
   revocation cannot run afterward. A job already processing when
   revocation lands is named in the audit event; the runner's
   completion-time re-check drops its output.
6. Derived voice assets unique to that presenter (reference clip,
   speaker embedding, model caches) are deleted from managed storage;
   only the minimum consent/revocation audit and hashes are retained.
   Every managed generated output for that presenter is marked
   `consent_revoked` in `managed-outputs.json`, removed from
   active/published library views, and blocked from download, re-render,
   duplication, or republishing.
7. The owner gets a replacement/delete queue for managed historical
   outputs. The source capture and the audit record are **not** silently
   erased. External files already exported cannot be recalled; the UI
   must state that limitation and list known managed copies.
8. Re-enrollment requires a new self-recorded consent receipt; restoring
   an old embedding is prohibited.

The runner's part is only the preflight gate (step 5) plus refusing
enrollment under a non-active receipt. It never deletes another
presenter's files and never touches `managed-outputs.json`.

## Local-first proof

The runner makes **no network calls during a job** — downloads happen
only in the setup script (`tools/narration/setup-env.ps1`), never at
job time. Proof fields in every `result.json`:

- `outbound_requests`: always `[]`.
- `resources.peak_vram_mib` / `resources.peak_ram_mib`: peak VRAM
  (nvidia-smi polled every 500 ms in a thread during generation +
  render) and peak RSS of the runner process (psutil when available,
  else the `resource` module; null when neither is available).
- `resources.gpu`: GPU name from nvidia-smi, or `"unknown"`.
- Per-segment `real_time_factor`, `render.render_sec`,
  `render.output_bytes`.
- `model` block: pinned model id/version, code commit, weights hash,
  base TTS id + commit.

No performance number is invented in this doc — the numbers come from
the actual iBUYPOWER runs.

## The runner: how to start it on the iBUYPOWER

Prerequisites: the env setup script has finished (venv at
`C:\forge-bridge\narration\venv`, FFmpeg at
`C:\forge-bridge\tools\ffmpeg\bin`, checkpoints at
`C:\forge-bridge\narration\checkpoints_v2` — the runner also checks the
setup script's `...\narration\src\checkpoints_v2` layout — and the
receipt at `C:\forge-bridge\narration\receipt.json`).

**Known blocker (2026-11-12, verified from both the iBUYPOWER and
this VM):** the documented OpenVoice V2 checkpoints URL
(`https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip`)
is dead — S3 `NoSuchBucket`, the bucket `myshell-public-repo-host`
does not exist. Env setup run 5 died at that download (no receipt,
no checkpoints) and no replacement source is verified yet. Until a
replacement weights source is decided, the setup cannot complete, the
weights hash stays `<FILL-FROM-RECEIPT>`, and no live enrollment or
generation proof is possible. Do NOT substitute an unverified mirror
or invent a hash.

Copy the sidecar into place first:

```powershell
Copy-Item -Recurse <repo>\forge-capture-app\narration-sidecar `
  C:\forge-bridge\narration\sidecar
```

One job, then exit (exit codes: 0 ok / 1 no job / 2 job failed):

```powershell
$VenvPy = "C:\forge-bridge\narration\venv\Scripts\python.exe"
$Root = "$env:LOCALAPPDATA\FORGE Capture\narration"
& $VenvPy C:\forge-bridge\narration\sidecar\narration_runner.py --narration-root $Root --once
```

Long-running loop, detached (polls every 5 s):

```powershell
Start-Process -FilePath $VenvPy -ArgumentList `
  "C:\forge-bridge\narration\sidecar\narration_runner.py --narration-root `"$Root`" --loop" `
  -RedirectStandardOutput "C:\forge-bridge\narration\runner.log" `
  -RedirectStandardError "C:\forge-bridge\narration\runner.err.log" -WindowStyle Hidden
```

Standalone enrollment (consent preflight first, then zero-shot
embedding extraction):

```powershell
& $VenvPy C:\forge-bridge\narration\sidecar\narration_runner.py --narration-root $Root --enroll-only tyler-welch
```

Logs are plain `print()` lines with a `[narration]` prefix and ISO
timestamps; no secrets are logged. Log file: wherever the
`Start-Process` redirect points
(`C:\forge-bridge\narration\runner.log` in the example above).

## Acceptance gates — mapping

| Gate | How this slice proves it |
| --- | --- |
| 1 Consent denial | Preflight in `process_job` + `enroll_presenter`; revoked/missing/mismatched receipt fails the job before any model work. Verified on the dev VM with a revoked-consent spool (exit 2, `consent_revoked`). |
| 2 License/reproducibility | `narration-sidecar/LICENSE-RECEIPT.md` + setup receipt (`receipt.json`, frozen requirements). **Open item — BLOCKED:** weights SHA-256 still `<FILL-FROM-RECEIPT>`; the documented checkpoints URL is dead (S3 `NoSuchBucket`, verified 2026-11-12), so no receipt exists and no replacement source is verified yet. |
| 5 Narration-only utility | The render is complete with only capture footage + narration + captions; there is no face track to remove. |
| 6 Audio/video quality | Script validation (no overlaps, timing within duration), per-segment duration/RTF, captions verbatim from the approved script; human review (gate 10) is the evidence. |
| 7 Local-first proof | `outbound_requests: []` + `resources` + per-segment RTF + `render_sec`/`output_bytes` in every `result.json`; no network code in the runner. |
| 8 Revocation proof | Preflight gate (runner) + Tauri revocation transaction (delete derived assets, mark managed outputs `consent_revoked`, audit receipt). The end-to-end revocation test on a test presenter is still owed on the iBUYPOWER. |
| 9 Idempotency | `.done` dirs are skipped, never re-run (`find_queued_job`); canonical job id from the seven manifest inputs. |
| 3, 4, 10 Voice / instruction / human sign-off | Not provable by code: Tyler's blind A/B approval, the end-to-end step-binding watch-through, and the presenter + reviewer `acceptance.json` on the exact output hash. |

## What this slice does NOT do

- No generated face / avatar, no real-time or live avatar.
- No paid service, no cloud voice cloning, no network calls at job time.
- No training a durable per-person model (zero-shot enrollment only).
- No automatic publishing — "Save to FORGE" is an explicit reviewer
  choice on an accepted output only, through the existing opt-in
  Capture upload boundary.
- No modification of the original capture, ever.
- No silent failure: every state (queued with no runner, failed with
  the reason in `result.json`, done awaiting acceptance) is visible
  from the spool markers + `result.json`.
