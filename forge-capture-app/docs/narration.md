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
   `TTS(language='EN', config_path=<validated local config.json>,
   ckpt_path=<validated local checkpoint.pth>)` — bound to the pinned
   MeloTTS English base-model files (see the weights-source section
   below). The runner never constructs TTS without both paths: at the
   pinned MeloTTS code commit, absent paths make melo call
   `hf_hub_download()` for unpinned model files at no revision. The
   first speaker key starting with `EN` from
   `model.hps.data.spk2id` (no EN key → fail loudly, never guess);
   `model.tts_to_file(text, speaker_id, tmp_src_wav, speed=1.0)`; the
   base speaker's embedding from
   `checkpoints_v2/base_speakers/ses/<normalized-speaker-key>.pth`,
   where the key is normalized exactly as the pinned upstream V2 flow
   (`demo_part3.ipynb`): lowercase, `_` → `-` (so MeloTTS `EN-US`
   loads `en-us.pth`, `EN_INDIA` loads `en-india.pth`). The six
   English ses embeddings come from the official Hugging Face repo
   `myshell-ai/OpenVoiceV2` (pinned revision
   `f36e7edfe1684461a8343844af60babc2efbb727`); the
   `myshell-ai/OpenVoice` tree carries no `ses/` directory. A
   missing embedding fails the job closed — never a guessed speaker.
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
8. **Completion publication under the presenter lock:** after the
   render, the runner takes the per-presenter lock and only then
   re-runs the consent preflight. A revocation that landed mid-run
   drops the just-rendered artifacts and fails the job as
   `consent_revoked` — no `.done` marker, no managed record.
   Otherwise the runner writes `result.json`, upserts the output into
   `managed-outputs.json` (status `active`), replaces `.processing`
   with `.done`, and appends the audit events — all before releasing
   the lock, so a revocation can neither miss the publication nor
   interleave with it. On any exception it writes `result.json`
   failed (`failure_reason` = the error, truncated to 500 chars),
   the `.failed` marker, and an audit event, and exits non-zero.
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
  "weights_sha256": "cf5ce18b3a3841d3079fc47a3cd6ec76e0b51d12da5b62d33787c63e16028020",
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
             "weights_sha256": "cf5ce18b3a3841d3079fc47a3cd6ec76e0b51d12da5b62d33787c63e16028020",
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
                    "weights_sha256": "cf5ce18b3a3841d3079fc47a3cd6ec76e0b51d12da5b62d33787c63e16028020" },
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

**Serialization — one cross-process lock per presenter.** Job
creation, completion publication, and revocation for a presenter are
serialized by an OS advisory lock on
`presenters/<id>/.narration-lock` (Rust `fs2`, Python `fcntl` /
`msvcrt` — the same file, so the Tauri app process and the runner
process genuinely exclude each other; the OS releases the lock if a
holder dies). The lock is held only around the short critical
sections: job creation (consent preflight + job writes), the
runner's completion publication (consent re-check + `result.json` +
managed-output record + `.done`), the enrollment writes, and the
whole revocation transaction. The render itself runs unlocked. A
lock timeout (30 s) fails closed: the gated operation does not run.

1. **Durable pending state first.** Before any mutation, a pending
   state with empty plan lists is written to
   `presenters/<id>/revocation-pending.json` (two-phase write). The
   receipt's `revoked_at` and reason are the transaction's identity.
   The plan is deliberately NOT built here.
2. **The consent gate closes first.** `consent.json` is marked
   `revoked` (with `revoked_at` / `revoke_reason` + audit event)
   before any inventory is taken: from here on, no new job can be
   created and no in-flight completion can publish (both re-check
   consent under the lock).
3. **The plan is built from the final inventory** — jobs spool,
   managed-outputs index, enrollment — taken after the gate closed
   and while the lock is held, then persisted with `plan_ready`
   set. An in-flight completion that passed its check while consent
   was active is in this inventory; it cannot escape the plan.
4. **Effects apply in order, each verified on disk:** enrollment →
   `revoked`; derived voice assets deleted with absence verified (a
   missing asset counts as confirmed-absent); each queued job blocked
   — `.queued` removed and verified gone, `result.json` written
   `failed` / `consent_revoked`, `.failed` verified present; managed
   outputs re-read, marked `consent_revoked`, re-read again and
   verified.
5. **Final verification sweep, still under the lock.** The jobs spool
   and managed-outputs index are re-read and must show no queued job
   and no active managed output for the presenter. A violation fails
   closed instead of publishing a receipt that claims completeness
   it does not have.
6. **No success receipt until every required effect is confirmed.**
   The final receipt (`revocation-<stamp>.json`) lists only confirmed
   effects. Any failure saves the pending state with `last_error` and
   returns an error — never a success receipt with unconfirmed effects.
   Filesystem errors are never ignored.
7. **Restartable.** A re-run with a pending state present resumes the
   transaction (same `revoked_at`/reason, confirmed lists carried
   forward, already-done effects skipped). A resume whose plan was
   never built (`plan_ready` false — including pending states written
   before this ordering existed) rebuilds the plan under the lock
   after closing the gate. A re-run after completion errors
   `"already revoked"`. A corrupt pending state, unreadable consent
   receipt, or corrupt enrollment fails closed before anything is
   claimed done.
8. New/queued jobs are rejected at the next preflight — the runner
   re-checks consent at every job start, so a job queued before the
   revocation cannot run afterward. A job already processing when
   revocation lands is named in the audit event; the runner's
   completion-time re-check (under the lock) drops its output and
   fails the job as `consent_revoked`.
9. Derived voice assets unique to that presenter (reference clip,
   speaker embedding, model caches) are deleted from managed storage;
   only the minimum consent/revocation audit and hashes are retained.
   Every managed generated output for that presenter is marked
   `consent_revoked` in `managed-outputs.json`, removed from
   active/published library views, and blocked from download, re-render,
   duplication, or republishing.
10. The owner gets a replacement/delete queue for managed historical
    outputs. The source capture and the audit record are **not** silently
    erased. External files already exported cannot be recalled; the UI
    must state that limitation and list known managed copies.
11. Re-enrollment requires a new self-recorded consent receipt; restoring
    an old embedding is prohibited.

The runner's part is the preflight gate (step 8), the locked
completion publication, and the locked enrollment writes. It never
deletes another presenter's files. It writes `managed-outputs.json`
only at completion publication, under the presenter lock.

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

**Weights source (resolved 2026-11-13):** the documented OpenVoice V2
checkpoints URL
(`https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip`)
is dead — S3 `NoSuchBucket`, the bucket `myshell-public-repo-host`
does not exist (verified 2026-11-12 from both the iBUYPOWER and this
VM; env setup run 5 died at that download). The replacement source is
the official Hugging Face repo `myshell-ai/OpenVoice` (pinned revision
`c70fc8b939bd1d8213994ff7c88e32be39708271`) for the nine files of the
repo's `checkpoints/` tree, PLUS the official Hugging Face repo
`myshell-ai/OpenVoiceV2` (same author, pinned revision
`f36e7edfe1684461a8343844af60babc2efbb727`) for the six English
`base_speakers/ses/` embeddings the V2 generation path loads. The
`myshell-ai/OpenVoice` tree carries no `ses/` directory (verified
2026-11-13 at the pinned revision and at main) — the nine-file zip
fix round 2 validated could therefore never generate: the runner's
ses load had no file to load. The setup downloads all fifteen files
and assembles `checkpoints_v2_0417.zip` with the deterministic builder
(`narration-sidecar/build_checkpoints_zip.py`). The zip SHA-256 is
`cf5ce18b3a3841d3079fc47a3cd6ec76e0b51d12da5b62d33787c63e16028020`,
pinned in the Rust core, the runner, and `LICENSE-RECEIPT.md`. The
live enrollment / generation proof still needs a setup run with the
new step 6 — it is not claimed as done here.

**Weights provenance (fix round 2, moved-head re-review):** the pinned
hash is expected metadata, not evidence of the installed bytes — the
runner never claims it for an unverified tree. Before any enrollment
or generation, `validate_weights_receipt` requires ALL of: a setup
receipt exists (the explicit `--receipt-path` when given, else the
default `receipt.json`); it parses and carries
`checkpoints_v2_zip_sha256` as a 64-character lowercase hex digest
exactly equal to the pinned hash; it records `checkpoints_dir` naming
the directory the checkpoints were installed to, equal to the
resolved checkpoint directory; and every one of the fifteen installed
files hashes to its pinned per-file value (`CHECKPOINTS_FILES` in
the runner — full SHA-256s verified 2026-11-13 from the official
Hugging Face repos at the pinned revisions, and the deterministic zip
rebuilt from exactly those bytes hashes to the pinned hash, so the
per-file manifest and the zip hash are mutually consistent). A
missing, malformed, mismatched, or wrong-directory receipt, a missing
file, or a changed file fails the job closed with the weights reason
before any model work. Setup writes the receipt with the lowercase
hash and the `checkpoints_dir` binding.

**MeloTTS base-model provenance (fix round 3, moved-head re-review):**
the same rule covers the MeloTTS English base model — the first
narration job used to construct `TTS(language='EN')` with no paths,
so melo called `hf_hub_download()` for `config.json` +
`checkpoint.pth` at NO revision while `result.json` claimed
`outbound_requests: []`. Setup now downloads both files from the
official Hugging Face repo `myshell-ai/MeloTTS-English` at pinned
revision `bb4fb7346d566d277ba8c8c7dbfdf6786139b8ef` (setup step 6b),
verifies their sizes + SHA-256s, and records the revision, the
per-file hashes, and `melotts_dir` in the receipt. Before any TTS
work, `validate_melotts_model` requires the receipt to carry that
exact revision, the `melotts_dir` binding, and per-file hashes equal
to the pinned `MELO_MODEL_FILES`, and every installed file to hash
to its pinned value; a missing or changed base-model file fails the
job closed before generation. `_generate_segments` then constructs
TTS with explicit `config_path`/`ckpt_path` to those validated local
files — at the pinned melo code commit, giving both paths means
`load_or_download_config`/`load_or_download_model` read the local
files and never call `hf_hub_download`. The cold-cache,
network-disabled test (`HF_HUB_OFFLINE=1`, fake melo download
functions wired to raise) proves no outbound fetch is attempted.
`result.json` keeps `outbound_requests: []` only on that proof, and
its model block records the validated `melotts_model_revision` +
per-file hashes.

**BERT base encoder (fix round 3, found while fixing setup run 6):**
MeloTTS EN generation calls `get_bert` on every segment, and
`english_bert.py` does
`AutoTokenizer`/`AutoModelForMaskedLM.from_pretrained('bert-base-uncased')`
at NO revision — a second unpinned download on the first job, the
same class as the MeloTTS-model P1. Setup seeds it once (step 6c)
from `google-bert/bert-base-uncased` at pinned revision
`86b5e0934494bd15c9632b12f734a8a67f723594` (config + tokenizer +
`pytorch_model.bin` + `model.safetensors`, sizes verified) into the
transformers cache and records the revision + cache dir in the
receipt; the runner sets `HF_HUB_OFFLINE=1` before importing melo,
so a job loads BERT from the seeded cache only and fails closed if
it is missing. The MeloTTS code itself could not install on Python
3.12 from its pinned `requirements.txt` (fugashi 1.3.0 needs MeCab C
headers that are not on the box; tokenizers 0.13.3 has no cp312
wheel) — setup installs the pinned MeloTTS code `--no-deps` and only
the runtime deps the EN path executes (`cached_path`, `transformers`,
`g2p_en`, `pykakasi`, `num2words`, `jamo`, plus the NLTK cmudict data
for `g2p_en`), then verifies `from melo.api import TTS` imports and
`G2p()` loads before proceeding.

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
| 2 License/reproducibility | `narration-sidecar/LICENSE-RECEIPT.md` + setup receipt (`receipt.json`, frozen requirements). Weights SHA-256 pinned (`cf5ce18b…602820`, deterministic zip from Hugging Face `myshell-ai/OpenVoice` @ `c70fc8b9…` + `myshell-ai/OpenVoiceV2` @ `f36e7edf…` — fifteen files incl. the six English ses embeddings); the setup rebuilds the same zip and records the same hash. The dead S3 URL is replaced in `setup-env.ps1` step 6. |
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
