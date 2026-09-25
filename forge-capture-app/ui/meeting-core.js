// FORGE Capture — Meeting mode core (ui/meeting-core.js).
//
// Framework-neutral, DOM-free logic for Meeting mode. Runs unmodified
// under vitest (node) and in the Tauri webview; the DOM (tab panel,
// timer, transcript view) lives in meeting.js. This module owns:
//   - transcript helpers (timestamps, text, search) — mirrors of
//     core/src/meeting.rs, pinned by tests on both sides
//   - audio mime selection
//   - the MeetingSession state machine:
//     idle → starting → recording → stopping → queued → processing →
//     importing → imported (or failed / cancelled)
//
// Transport is the same LOCAL spool contract as AI Edit (see
// forge-capture-app/docs/meeting-mode.md): the backend writes the audio
// file and a `transcribe` job.json into the ai-spool; an external runner
// (local Whisper, Koe Jr's lane) drops result.json back. Capture itself
// never touches the network and never transcribes.
//
// Crash safety: chunks stream to the backend AS THEY ARE RECORDED
// (meeting_upload_begin at record start, meeting_upload_append per
// MediaRecorder timeslice), so a crash mid-recording leaves a
// recoverable `.meeting.part` file that `meeting_recover` finalizes on
// the next launch.

export const MEETING_POLL_MS = 2000;
// How long a job may sit queued/processing before we tell the user the
// honest truth: no runner has picked it up yet.
export const MEETING_RUNNER_HINT_MS = 10000;
// MediaRecorder timeslice: one chunk per second streams to the backend.
export const MEETING_RECORD_TIMESLICE_MS = 1000;
// Declared capacity for a streaming upload (8 h at 128 kbit/s ≈ 460 MB,
// rounded up). The true byte count is reported at finish; the backend
// validates it against the bytes actually received.
export const MEETING_STREAM_CAP_BYTES = 512 * 1024 * 1024;
// Never hang the UI waiting for a misbehaving MediaRecorder.
export const MEETING_STOP_TIMEOUT_MS = 5000;

export const MEETING_STATES = Object.freeze([
  "idle",
  "starting",
  "recording",
  "stopping",
  "queued",
  "processing",
  "importing",
  "imported",
  "failed",
  "cancelled",
]);

/// Format seconds as m:ss (h:mm:ss past an hour). Mirror of
/// core/src/meeting.rs `format_timestamp` — pinned by tests here AND
/// there; keep them in lockstep.
export function formatTimestamp(totalSec) {
  const s = Math.max(0, Math.floor(Number(totalSec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(rest).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/// Assemble "[m:ss] text" lines, one per segment. Mirror of
/// core/src/meeting.rs `transcript_text`.
export function transcriptText(segments) {
  return (segments || [])
    .map((seg) => `[${formatTimestamp(seg.start)}] ${String(seg.text).trim()}`)
    .join("\n");
}

/// Case-insensitive substring search over segments. Returns matching
/// indices; an empty query matches everything. Mirror of
/// core/src/meeting.rs `search_segments`.
export function searchSegments(segments, query) {
  const q = String(query == null ? "" : query)
    .trim()
    .toLowerCase();
  const list = segments || [];
  if (!q) return list.map((_, i) => i);
  const out = [];
  list.forEach((seg, i) => {
    if (String(seg.text).toLowerCase().includes(q)) out.push(i);
  });
  return out;
}

/// Mirror of core/src/meeting.rs `validate_language_hint`.
export function validateLanguageHint(hint) {
  if (hint === "auto") return { ok: true };
  if (typeof hint === "string" && /^[a-z]{2,3}$/.test(hint)) return { ok: true };
  return {
    ok: false,
    error: 'Language hint must be "auto" or a 2-3 letter code like "en".',
  };
}

/// Pick the best audio mime the browser's MediaRecorder supports.
/// Returns null when audio recording is unsupported.
export function pickAudioMime(isTypeSupported) {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const mime of candidates) {
    try {
      if (isTypeSupported(mime)) return mime;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/// Map a recording failure to honest, actionable UI text.
export function describeRecordingError(err) {
  const name = err && err.name;
  const message = (err && err.message) || String(err);
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was denied. Allow microphone access for FORGE Capture and try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found. Check that a microphone is connected and try again.";
  }
  if (name === "NotReadableError") {
    return "The microphone is busy in another app. Close the other app and try again.";
  }
  return message || "Recording failed.";
}

export class MeetingSession {
  /**
   * @param {object} deps
   * @param {(cmd: string, args: object) => Promise<any>} deps.invoke - Tauri invoke bridge
   * @param {object} [deps.mediaDevices] - navigator.mediaDevices (injectable for tests)
   * @param {Function} [deps.MediaRecorderImpl] - MediaRecorder constructor (injectable for tests)
   * @param {(evt: object) => void} [deps.onEvent] - state-change sink
   */
  constructor({ invoke, mediaDevices, MediaRecorderImpl, onEvent }) {
    if (typeof invoke !== "function") throw new Error("invoke is required");
    this.invoke = invoke;
    this.mediaDevices =
      mediaDevices ||
      (typeof navigator !== "undefined" ? navigator.mediaDevices : null) ||
      null;
    this.MediaRecorderImpl =
      MediaRecorderImpl ||
      (typeof MediaRecorder !== "undefined" ? MediaRecorder : null) ||
      null;
    this.onEvent = onEvent || (() => {});
    this.reset();
  }

  reset() {
    this.stopPolling();
    this.state = "idle";
    this.jobId = null;
    this.fileName = null;
    this.audioPath = null;
    this.reason = null;
    this.transcript = null; // { segments, durationSec, transcriptPath }
    this.devices = [];
    this.deviceId = ""; // "" = system default
    this.deviceLabel = "";
    this.languageHint = "auto";
    this.startedAt = 0;
    this.uploadId = null;
    this.receivedBytes = 0;
    this.mime = null;
    this.stream = null;
    this.recorder = null;
    this.appendChain = Promise.resolve();
    this.submittedAt = 0;
    this.runnerHint = false;
  }

  get active() {
    return ["starting", "recording", "stopping", "queued", "processing", "importing"].includes(
      this.state
    );
  }

  statusText() {
    switch (this.state) {
      case "starting":
        return "Starting the microphone…";
      case "recording":
        return "Recording…";
      case "stopping":
        return "Saving the recording…";
      case "queued":
        return this.runnerHint
          ? "Still queued — no transcription runner has picked up the job yet. See Help → Meeting mode for the runner setup."
          : "Queued — waiting for the transcription runner…";
      case "processing":
        return this.runnerHint
          ? "Still transcribing — the runner is taking a while. See Help → Meeting mode for the runner setup."
          : "Transcribing…";
      case "importing":
        return "Importing the transcript…";
      case "imported":
        return "Transcript ready — the original audio is untouched in the library.";
      case "failed":
        return `Meeting failed: ${this.reason || "unknown error"}`;
      case "cancelled":
        return "Recording cancelled.";
      default:
        return "";
    }
  }

  emit() {
    this.onEvent({
      state: this.state,
      text: this.statusText(),
      reason: this.reason,
      jobId: this.jobId,
      fileName: this.fileName,
      elapsedMs: this.startedAt ? Date.now() - this.startedAt : 0,
      receivedBytes: this.receivedBytes,
      runnerHint: this.runnerHint,
    });
  }

  /** Refresh the microphone list. Labels are empty until the user has granted permission. */
  async listInputDevices() {
    if (!this.mediaDevices || typeof this.mediaDevices.enumerateDevices !== "function") {
      this.devices = [];
      return this.devices;
    }
    const all = await this.mediaDevices.enumerateDevices();
    this.devices = (all || [])
      .filter((d) => d && d.kind === "audioinput")
      .map((d) => ({ deviceId: d.deviceId || "", label: d.label || "" }));
    return this.devices;
  }

  async startRecording({ deviceId = "", languageHint = "auto" } = {}) {
    if (this.state !== "idle" && this.state !== "cancelled" && this.state !== "failed") {
      throw new Error(`cannot record from state ${this.state}`);
    }
    const v = validateLanguageHint(languageHint);
    if (!v.ok) throw new Error(v.error);
    if (!this.MediaRecorderImpl) throw new Error("audio recording is not supported here");
    if (!this.mediaDevices || typeof this.mediaDevices.getUserMedia !== "function") {
      throw new Error("microphone access is not available");
    }
    this.reset();
    this.state = "starting";
    this.emit();
    this.deviceId = deviceId;
    this.languageHint = languageHint;
    try {
      this.mime = pickAudioMime((m) => this.MediaRecorderImpl.isTypeSupported(m));
      if (!this.mime) throw new Error("this browser cannot record audio in a supported format");
      const constraints = deviceId
        ? { audio: { deviceId: { exact: deviceId } } }
        : { audio: true };
      this.stream = await this.mediaDevices.getUserMedia(constraints);
      // Permission unlocks device labels: refresh so the picker and the
      // sidecar can name the real microphone.
      await this.listInputDevices();
      const dev = this.devices.find((d) => d.deviceId === deviceId);
      this.deviceLabel = dev && dev.label ? dev.label : deviceId ? "Selected microphone" : "System default";
      this.uploadId = await this.invoke("meeting_upload_begin", {
        dto: {
          totalBytes: MEETING_STREAM_CAP_BYTES,
          mime: this.mime,
          nameHint: null,
        },
      });
      if (!this.uploadId || typeof this.uploadId !== "string") {
        throw new Error("backend returned no upload id");
      }
      this.recorder = new this.MediaRecorderImpl(this.stream, { mimeType: this.mime });
      this.recorder.ondataavailable = (e) => this.onChunk(e && e.data);
      this.recorder.onerror = (e) => this.onRecorderError(e);
      this.receivedBytes = 0;
      this.appendChain = Promise.resolve();
      this.recorder.start(MEETING_RECORD_TIMESLICE_MS);
      this.startedAt = Date.now();
      this.state = "recording";
      this.emit();
    } catch (err) {
      await this.cleanupAfterFailedStart();
      this.state = "failed";
      this.reason = describeRecordingError(err);
      this.emit();
      throw err;
    }
  }

  /** One MediaRecorder timeslice: stream it to the backend in order. */
  onChunk(blob) {
    if (!blob || blob.size === 0) return;
    if (this.state !== "recording" && this.state !== "stopping") return;
    const offset = this.receivedBytes;
    this.receivedBytes += blob.size;
    const uploadId = this.uploadId;
    this.appendChain = this.appendChain
      .then(async () => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await this.invoke("meeting_upload_append", {
          dto: { uploadId, offset, bytes: Array.from(bytes) },
        });
      })
      .catch((err) => {
        // A failed append poisons the upload: stop honestly rather than
        // finishing a recording with a hole in it.
        this.onUploadError(err);
      });
  }

  onRecorderError(e) {
    if (this.state !== "recording") return;
    this.fail(new Error(describeRecordingError((e && e.error) || e)));
  }

  onUploadError(err) {
    if (this.state !== "recording" && this.state !== "stopping") return;
    this.fail(err instanceof Error ? err : new Error(String(err)));
  }

  async fail(err) {
    try {
      this.stopRecorder();
    } catch {
      /* best effort */
    }
    if (this.uploadId) {
      try {
        await this.invoke("meeting_upload_cancel", { id: this.uploadId });
      } catch {
        /* best effort */
      }
      this.uploadId = null;
    }
    this.stopTracks();
    this.state = "failed";
    this.reason = describeRecordingError(err);
    this.emit();
  }

  async cleanupAfterFailedStart() {
    try {
      this.stopRecorder();
    } catch {
      /* best effort */
    }
    if (this.uploadId) {
      try {
        await this.invoke("meeting_upload_cancel", { id: this.uploadId });
      } catch {
        /* best effort */
      }
      this.uploadId = null;
    }
    this.stopTracks();
  }

  stopRecorder() {
    const rec = this.recorder;
    this.recorder = null;
    if (rec && rec.state && rec.state !== "inactive") {
      rec.stop();
    }
  }

  stopTracks() {
    const stream = this.stream;
    this.stream = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* best effort */
        }
      }
    }
  }

  /** Stop the recorder, wait for the final chunk, flush the append chain. */
  stopRecorderAndFlush() {
    const rec = this.recorder;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      if (!rec) {
        finish();
        return;
      }
      const prevOnStop = rec.onstop;
      rec.onstop = (e) => {
        try {
          if (typeof prevOnStop === "function") prevOnStop.call(rec, e);
        } finally {
          finish();
        }
      };
      // Never hang the UI on a misbehaving MediaRecorder.
      setTimeout(finish, MEETING_STOP_TIMEOUT_MS);
      try {
        this.stopRecorder();
      } catch {
        finish();
      }
    }).then(() => this.appendChain);
  }

  async stopRecording() {
    if (this.state !== "recording") throw new Error(`cannot stop from state ${this.state}`);
    this.state = "stopping";
    this.emit();
    const uploadId = this.uploadId;
    await this.stopRecorderAndFlush();
    if (this.state === "failed") {
      // An append failed mid-flush: fail() already reported it and
      // cancelled the upload. Do not call finish on a poisoned upload.
      return;
    }
    try {
      const res = await this.invoke("meeting_upload_finish", {
        dto: {
          uploadId,
          deviceLabel: this.deviceLabel,
          languageHint: this.languageHint,
          actualBytes: this.receivedBytes,
        },
      });
      if (!res || !res.jobId) throw new Error("backend returned no transcription job id");
      this.uploadId = null;
      this.audioPath = res.audioPath;
      this.fileName = res.fileName;
      this.jobId = res.jobId;
      this.stopTracks();
      this.submittedAt = Date.now();
      this.state = "queued";
      this.emit();
      this.startPolling();
      return res;
    } catch (err) {
      this.stopTracks();
      this.state = "failed";
      this.reason = String((err && err.message) || err);
      this.emit();
      throw err;
    }
  }

  /**
   * Adopt a job spooled by crash recovery (`meeting_recover`): skip
   * recording and go straight to polling.
   */
  adoptJob(jobId, fileName) {
    if (this.state !== "idle") throw new Error(`cannot adopt a job from state ${this.state}`);
    this.reset();
    this.jobId = jobId;
    this.fileName = fileName || null;
    this.submittedAt = Date.now();
    this.state = "queued";
    this.emit();
    this.startPolling();
  }

  startPolling() {
    this.stopPolling();
    const timer = setInterval(() => {
      this.pollOnce().catch(() => {
        /* pollOnce reports failures through onEvent itself */
      });
    }, MEETING_POLL_MS);
    this.pollTimer = timer;
  }

  stopPolling() {
    if (this.pollTimer !== null && this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Single poll round; returns the new state. Safe to call directly in tests. */
  async pollOnce(now = Date.now()) {
    if (!["queued", "processing"].includes(this.state) || !this.jobId) return this.state;
    let res;
    try {
      res = await this.invoke("meeting_poll", { jobId: this.jobId });
    } catch (err) {
      // A backend error here (e.g. job vanished) will not heal by
      // retrying: fail honestly and stop polling.
      this.stopPolling();
      this.state = "failed";
      this.reason = String((err && err.message) || err);
      this.emit();
      return this.state;
    }
    const status = res && res.status;
    if (status === "done") {
      this.stopPolling();
      await this.importResult();
    } else if (status === "failed") {
      this.stopPolling();
      this.state = "failed";
      this.reason = (res && res.reason) || "the transcription runner reported a failure";
      this.emit();
    } else if (status === "queued" || status === "processing") {
      this.state = status;
      if (["queued", "processing"].includes(this.state)) {
        this.runnerHint = now - this.submittedAt > MEETING_RUNNER_HINT_MS;
      }
      this.emit();
    }
    // Unknown status strings are ignored: the job keeps its last known
    // state rather than jumping somewhere invented.
    return this.state;
  }

  /** Import the finished transcript. The backend refuses a second import. */
  async importResult() {
    if (this.state !== "done" && this.state !== "queued" && this.state !== "processing") {
      throw new Error(`nothing to import from state ${this.state}`);
    }
    this.state = "importing";
    this.emit();
    const res = await this.invoke("meeting_import", { jobId: this.jobId });
    this.transcript = {
      segments: (res && res.segments) || [],
      durationSec: res && res.durationSec != null ? res.durationSec : null,
      transcriptPath: (res && res.transcriptPath) || null,
    };
    this.state = "imported";
    this.emit();
    return this.transcript;
  }

  cancel() {
    if (!this.active) return;
    if (this.state === "recording" || this.state === "starting" || this.state === "stopping") {
      // Cancelling a live recording discards it: stop the hardware and
      // the upload directly (fail() would land on "failed", not
      // "cancelled").
      const uploadId = this.uploadId;
      try {
        this.stopRecorder();
      } catch {
        /* best effort */
      }
      this.stopTracks();
      if (uploadId) {
        this.invoke("meeting_upload_cancel", { id: uploadId }).catch(() => {});
        this.uploadId = null;
      }
    }
    this.stopPolling();
    this.state = "cancelled";
    this.reason = null;
    this.emit();
  }

  dispose() {
    this.stopPolling();
    try {
      this.stopRecorder();
    } catch {
      /* best effort */
    }
    this.stopTracks();
  }
}
