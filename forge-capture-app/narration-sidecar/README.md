# Narration sidecar — README (FORGE Capture Phase 3 Slice A)

Narration over a recorded capture, **no generated face**. OpenVoice V2
(zero-shot tone-color cloning) + MeloTTS base TTS, rendered with FFmpeg,
all local on the iBUYPOWER (RTX 5080). No cloud, no paid service, no
training a durable model.

## Files

| File | What it is |
| --- | --- |
| `narration_runner.py` | The runner + CLI (stdlib at import; torch/openvoice/melo lazy) |
| `narration_lib.py` | Pure helpers: hashing, VTT, FFmpeg command building, manifest validation |
| `test_narration_lib.py` | pytest suite for the pure helpers (runs on the dev VM too) |
| `requirements.txt` | Pinned deps (installed by the setup script, not by hand) |
| `LICENSE-RECEIPT.md` | Licenses + pinned commits; weights hash pending (see below) |

## Prerequisites (iBUYPOWER)

The env setup script installs everything (run once, detached — it is
still running as of this writing):

- Python 3.12.10 — `C:\Users\jason\AppData\Local\Programs\Python\Python312\python.exe`
- venv — `C:\forge-bridge\narration\venv`
- FFmpeg — `C:\forge-bridge\tools\ffmpeg\bin`
- OpenVoice V2 checkpoints — `C:\forge-bridge\narration\checkpoints_v2`
  (the setup script extracts them under `...\narration\src\checkpoints_v2`;
  the runner checks both locations)
- Receipt — `C:\forge-bridge\narration\receipt.json`

Setup script: `~/workspace/forge-ai-drop/tools/narration/setup-env.ps1`
(in forge-ai-drop). Do **not** pip-install torch on the dev VM.

## Weights hash — pinned

The checkpoints zip SHA-256 is
`200e6e3992b28fce86a7c65d02a5921c33a4b34a4d724b5ed2564a43eb82e3fb`
(the deterministic zip built from the official Hugging Face repo
`myshell-ai/OpenVoice` at revision `c70fc8b9...`; see
`LICENSE-RECEIPT.md` and `build_checkpoints_zip.py`). It is pinned in
`LICENSE-RECEIPT.md`, the runner (`WEIGHTS_SHA256_PINNED`), and the
Rust core (`CHECKPOINTS_ZIP_SHA256`). The setup script rebuilds the
same zip on the iBUYPOWER and records the same hash as
`checkpoints_v2_zip_sha256` in `C:\forge-bridge\narration\receipt.json`;
the runner reads that receipt at runtime, so its `result.json` /
`render-manifest.json` hashes match the pinned value.

## Running it (iBUYPOWER, PowerShell)

```powershell
$VenvPy = "C:\forge-bridge\narration\venv\Scripts\python.exe"
$Root = "$env:LOCALAPPDATA\FORGE Capture\narration"

# One queued job, then exit (exit 0 ok / 1 no job / 2 job failed):
& $VenvPy C:\forge-bridge\narration\sidecar\narration_runner.py --narration-root $Root --once

# Long-running loop (polls every 5 s) — run detached:
Start-Process -FilePath $VenvPy -ArgumentList `
  "C:\forge-bridge\narration\sidecar\narration_runner.py --narration-root `"$Root`" --loop" `
  -RedirectStandardOutput "C:\forge-bridge\narration\runner.log" `
  -RedirectStandardError "C:\forge-bridge\narration\runner.err.log" -WindowStyle Hidden

# Standalone enrollment for one presenter (consent preflight first):
& $VenvPy C:\forge-bridge\narration\sidecar\narration_runner.py --narration-root $Root --enroll-only tyler-welch
```

> The sidecar source lives in this repo under
> `forge-capture-app/narration-sidecar/`; copy (or check out) that
> directory to `C:\forge-bridge\narration\sidecar\` on the iBUYPOWER
> before starting the runner. Log file: `C:\forge-bridge\narration\runner.log`
> (or wherever the `Start-Process` redirect points).

## How a job flows

1. The Rust core / UI spools `jobs/<job_id>/` with `job.json`,
   `script.json`, and a `.queued` marker. Job id is canonical:
   `narr-` + first 16 hex of SHA-256 of the seven manifest inputs
   joined by `\n` (see `narration_lib.canonical_job_id`).
2. The runner claims the job (atomic rename `.queued` → `.processing`),
   re-checks consent **at job start** (missing / revoked / hash
   mismatch → `result.json` failed, `.failed` marker, no model work),
   enrolls the presenter if needed (zero-shot only), generates one WAV
   per script segment, builds `captions.vtt`, renders `output.mp4`
   with FFmpeg (video copied, narration mixed over the original audio
   at 0.25), and writes `render-manifest.json` + `result.json` +
   the `.done` marker.
3. A job dir that already has `.done` is never re-run (idempotency,
   gate 9) — the runner logs the skip.
4. Every lifecycle event is appended to `audit/audit-log.jsonl`
   (`job_started`, `job_completed`, `job_failed`, `enrolled`).

## Revocation

Revoking a presenter's consent (`presenters/<id>/consent.json`
`status: "revoked"`, or a consent-artifact hash mismatch) blocks the
next preflight: a queued job revoked before start **cannot run**
(acceptance gate 1). The revocation transaction itself — deleting
derived clips/embeddings and marking managed outputs
`consent_revoked` — is owned by the Tauri side; the runner only
enforces the gate and never touches another presenter's files.

## Testing (dev VM — no torch, no GPU needed)

```bash
cd forge-capture-app/narration-sidecar
python3 -m pytest test_narration_lib.py -q
```

All heavy imports are lazy, so `python3 -m py_compile
narration_runner.py narration_lib.py` also passes on the dev VM.
Never run the runner against real models here — there is no torch,
no GPU, and 6 GB RAM.

## Full contract

See `forge-capture-app/docs/narration.md` for the spool layout, JSON
schemas, marker files, revocation behavior, and the acceptance-gate
mapping.
