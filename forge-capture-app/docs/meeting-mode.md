# Meeting mode — local transcription contract + runner setup

FORGE Capture's **Meeting mode** records microphone audio locally (browser
`MediaRecorder`, no network) and gets it transcribed by a local Whisper
model — without Capture itself ever touching the network or holding AI
credentials. The finished transcript appears with timestamps, search and
copy; the original audio is never modified.

## The honest design: a local spool, not fake network access

Same architecture as AI Edit (`docs/ai-edit.md`): the app and the AI team
meet at a **local job spool on disk**:

```
<app-data>/ai-spool/
  pending/<job-id>/{input.<ext>, job.json}
  processing/<job-id>/…
  done/<job-id>/{input.<ext>, job.json, result.json}
  failed/<job-id>/{…, error.txt}
  imported/<job-id>/…
```

`<app-data>` is `%LOCALAPPDATA%\FORGE Capture` on Windows and
`~/.local/share/forge-capture` on other hosts. Transcription jobs share
the spool with AI Edit jobs; the `job_type` field tells them apart
(`"transcribe"` vs `"ai-edit"`).

## Job lifecycle

1. User opens the **Meeting** tab, picks a microphone (defaults to system
   default) and a language hint (defaults to auto-detect), hits **● Record**.
   Recording starts with a live `m:ss` timer.
2. Audio chunks stream to the Rust backend **as they are recorded**
   (`meeting_upload_begin` at record start, `meeting_upload_append` per
   one-second `MediaRecorder` timeslice). The backend appends each chunk to
   a `<stem>.<upload-id>.<ext>.meeting.part` file on disk immediately —
   nothing is held only in memory, so a crash mid-recording leaves a
   recoverable partial file.
3. User hits **■ Stop**. `meeting_upload_finish` validates the audio
   (container signature check: WebM EBML DocType, M4A `ftyp`), finalizes it
   as `<stem>.webm` (Chrome/Edge) or `<stem>.m4a` (Safari) in the captures
   folder with a `.forge.json` provenance sidecar (`"kind":
   "meeting-audio"`), and spools a `transcribe` job: the job directory gets
   a copy of the audio as `input.<ext>` plus `job.json`, **manifest written
   last** — a job directory without `job.json` is ignored, so a crash
   mid-spool never yields a half job.
4. An **external runner** (see below) picks the job up, moves it to
   `processing/`, transcribes with local Whisper, writes `result.json`,
   moves the job to `done/` (or writes `error.txt` and moves to `failed/`
   on failure).
5. `meeting_poll` is a pure directory-presence check — queued, processing,
   done, failed, imported. The UI polls every 2 s and auto-imports on done.
6. `meeting_import` validates `result.json` strictly (see schema below),
   stores it as `<audio-stem>.transcript.json` next to the untouched audio,
   moves the job to `imported/` so it can never be imported twice, and
   returns the transcript (segments inline) for display.

### Crash recovery

If the app crashes mid-recording, the `.meeting.part` file survives. On the
next launch the UI calls `meeting_recover`, which for each recoverable
partial:

- verifies the container signature (unverifiable files are left in place
  and reported on stderr; zero-byte files are deleted),
- finalizes it as `<stem>-recovered.<ext>` with a `"recovered": true`
  sidecar,
- spools a fresh `transcribe` job with language hint `"auto"` (the
  original choice died with the crashed process),
- hands the job back so the UI can adopt and poll it like a normal
  recording.

## `job.json` schema (`TranscribeJobManifest`, core/src/meeting.rs)

```json
{
  "job_id": "tr-1727212800000-42",
  "job_type": "transcribe",
  "meeting_id": "mtg-1727212790000-7",
  "audio_file": "meeting-2026-09-25t05-00-00z.webm",
  "language_hint": "auto",
  "created_at": "2026-09-25T05:00:00Z",
  "status": "queued"
}
```

- `job_id` matches `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` — path-safe, no traversal.
- `job_type` is always `"transcribe"` for these jobs.
- `audio_file` is the library-relative audio filename (provenance; the
  runner's actual input is `input.<ext>` inside the job directory).
- `language_hint` is `"auto"` or a 2–3 letter code (`"en"`, `"es"`, …).
- `created_at` is ISO-8601 UTC (`YYYY-MM-DDTHH:MM:SSZ`).

## `result.json` schema (the runner's contract)

The runner MUST write exactly this shape into the job directory before
moving it to `done/`. The app validates it strictly on import and refuses
the result with a named reason if anything is off.

```json
{
  "job_id": "tr-1727212800000-42",
  "language": "en",
  "duration_sec": 12.5,
  "segments": [
    { "start": 0.0, "end": 4.2, "text": "Hello everyone" },
    { "start": 4.2, "end": 12.5, "text": "Let's review the budget." }
  ],
  "model": "faster-whisper large-v3"
}
```

Field rules (enforced by `parse_transcript_result`, core/src/meeting.rs):

- `job_id` (required): MUST equal the job's id, and MUST match the
  job-id pattern above.
- `language` (optional, default `""`): detected language code.
- `duration_sec` (optional): total audio seconds; MUST be a finite
  non-negative number when present.
- `segments` (required): array, MAY be empty (a silent meeting is valid).
  At most 100,000 segments. Each segment:
  - `start`, `end`: seconds from the start of the audio. MUST be finite,
    non-negative, and `end >= start`.
  - `text`: the transcribed text. At most 10,000 characters.
- `model` (optional): free-form model identifier for provenance.

On validation failure the import is refused, the job stays in `done/`,
and the UI shows the reason — the transcript view never renders
unvalidated runner output.

On `failed/`: the runner writes `error.txt` (plain text, first 500 chars
shown in the UI) and moves the job to `failed/`.

## The runner: what Jason still needs (named gap)

Until a runner exists, jobs wait honestly in `pending/` and the UI says
"Still queued — no transcription runner has picked up the job yet" after
10 s. The runner is a small external process on the **iBUYPOWER box**
(Koe Jr's lane — it hosts the RTX 5080 and the local AI stack) that:

- watches `ai-spool/pending/` for new `<job-id>/` directories whose
  `job.json` has `"job_type": "transcribe"` (ignore incomplete dirs
  without `job.json`),
- moves each job to `processing/` (atomic rename = claim),
- transcribes `input.<ext>` with local Whisper (`faster-whisper` on the
  RTX 5080 is the sane default; `language_hint: "auto"` means detect,
  otherwise pass the hint through as the model language),
- writes `result.json` in the schema above, then moves the dir to `done/`
  (or writes `error.txt` and moves to `failed/`),
- never modifies `input.<ext>` or `job.json`.

Security notes for whoever writes the runner:

- The runner runs with Jason's own credentials on his own machine — no
  secrets are stored in Capture or in this repo.
- Treat `result.json` as untrusted input (it already is: the app validates
  every field before display).
- Audio is Jason's own voice/meetings; keep it on the local box — no
  cloud transcription without his explicit word.

## What this slice does NOT do

- No network calls from Capture itself.
- No credentials invented, embedded, or requested.
- No transcription inside Capture — the runner (local Whisper) is a
  separate, named piece of work.
- No modification of the original audio, ever.
- No silent failure: every state (queued with no runner, failed with the
  runner's error, done awaiting import) is shown in the UI with an explicit
  label.
- "Save to FORGE" on the transcript view is a disabled stub with a
  "Coming soon" tooltip — Capture-to-FORGE structured extraction is a
  later roadmap item.
