# AI Edit — local spool contract + runner setup

FORGE Capture's **AI Edit** ("the AI plugin") lets Jason change a captured
image with a prompt — *remove the cursor, crop to the dialog, straighten it* —
without ever touching the original. The finished edit comes back as a new
versioned copy (`…-ai-edit.png`, then `…-ai-edit-2.png`).

## The honest design: a local spool, not fake network access

Capture is a **local-first desktop app with no network code and no AI
credentials**. It cannot reach the private `onyxgolden/forge-ai-drop` bus on
its own, and this slice deliberately does **not** invent credentials, tokens,
or a fake direct connection. Instead the app and the AI team meet at a
**local job spool on disk**:

```
<app-data>/ai-spool/
  pending/<job-id>/{input.png, prompt.txt, job.json}
  processing/<job-id>/…
  done/<job-id>/{input.png, prompt.txt, job.json, result.png, result.json?}
  failed/<job-id>/{…, error.txt}
  imported/<job-id>/…
```

`<app-data>` is `%LOCALAPPDATA%\FORGE Capture` on Windows and
`~/.local/share/forge-capture` on other hosts.

## Job lifecycle

1. User clicks **AI Edit** on a captured image, types a prompt (max 2,000
   chars), hits **Send to AI**.
2. `ai_edit_submit` validates the prompt, copies the capture's PNG, and
   writes `input.png` + `prompt.txt` + `job.json` into `pending/<job-id>/`.
   The manifest is written **last**: a job directory without `job.json` is
   ignored, so a crash mid-spool never yields a half job. Nothing is
   uploaded anywhere.
3. An **external runner** (see below) picks the job up, moves the directory
   to `processing/`, carries it to the AI team, and drops the result back
   into `done/<job-id>/` as `result.png` (+ optional `result.json` with
   model metadata, + `error.txt` and a move to `failed/` on failure).
4. `ai_edit_poll` is a pure directory-presence check — queued, processing,
   done, failed, imported. No blocking, no network.
5. `ai_edit_import` validates `result.png` (PNG signature + IHDR dimensions;
   foreign PNGs are accepted — the app reads dimensions without decoding),
   stores it as `<stem>-ai-edit.png` in the captures folder with its own
   sidecar, moves the job to `imported/` so it can never be imported twice,
   and returns the new capture ref. The original is untouched.

`job.json` schema (`AiJobManifest`, core/src/ai_edit.rs):

```json
{
  "job_id": "ai-1727212800000-42",
  "capture_id": "cap-1727212790000-7",
  "prompt": "remove the mouse cursor",
  "created_at": "2026-09-24T21:00:00Z",
  "status": "queued",
  "source_kind": "region"
}
```

Job ids match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` — path-safe, no traversal.

## The runner: what Jason still needs (named gap)

Until a runner exists, jobs wait honestly in `pending/` and the UI says
"Still queued — no AI runner has picked up the job yet" after 10 s. The
runner is a small external process (it can run on the iBUYPOWER box, which
already hosts the AI stack) that:

- watches `ai-spool/pending/` for new `<job-id>/` directories containing a
  complete `job.json`,
- moves each job to `processing/` (atomic rename = claim),
- sends `input.png` + `prompt.txt` to the AI team — e.g. via the existing
  `onyxgolden/forge-ai-drop` file bus (`commands/` → `results/`) or a local
  model through Ollama,
- writes the returned raster as `result.png` into the job dir, then moves
  the dir to `done/` (or writes `error.txt` and moves to `failed/`),
- never modifies `input.png`, `prompt.txt`, or `job.json`.

Result requirements (enforced by `ai_edit_import`):

- `result.png` must be a real PNG (signature + IHDR); dimensions are capped
  at 16,384 px per side like every other capture.
- The runner should return the model's best-quality PNG; the app validates
  the container, not the pixels.

Security notes for whoever writes the runner:

- The runner runs with Jason's own credentials on his own machine — no
  secrets are stored in Capture or in this repo.
- Treat `result.png` as untrusted input (it already is: the app only reads
  its dimensions and stores the bytes).
- `prompt.txt` is user text; pass it through, don't interpret it as
  commands.

## What this slice does NOT do

- No network calls from Capture itself.
- No credentials invented, embedded, or requested.
- No modification of the original capture, ever.
- No silent failure: every state (queued with no runner, failed with the
  runner's error, done awaiting import) is shown in the UI with an explicit
  label.
