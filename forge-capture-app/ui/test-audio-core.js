// FORGE Capture — Test audio core (ui/test-audio-core.js).
//
// Framework-neutral, DOM-free logic for the "Test audio" confirmation
// action: record ~5 seconds through the EXACT same getUserMedia path
// meeting mode uses (same selected microphone), measure real peak/RMS
// levels from the live samples, and refuse to call a silent clip a pass.
// Runs unmodified under vitest (node) and in the Tauri webview, same split
// as meeting-core.js / record-core.js.
//
// Why this exists: meeting mode's MediaRecorder bytes are opus-encoded —
// decoding compressed audio back into samples just to prove "is anything
// coming in" would be a second codec path to trust. Instead this module taps
// the SAME MediaStream with a Web Audio AnalyserNode running alongside the
// recorder, so the levels and the live waveform are both read straight off
// the hardware, sample by sample, while MediaRecorder independently encodes
// the bytes that get saved to disk. Nothing here assumes a level — every
// number comes from a `getFloatTimeDomainData` read.
//
// The waveform shown to the user and the pass/fail verdict are computed
// from the exact same per-tick sample buffers (see `tick()` in
// TestAudioSession and `aggregateLevels` below) — there is no separate
// "decorative" animation path.

import { pickAudioMime, describeRecordingError } from "./meeting-core.js";

export { pickAudioMime, describeRecordingError };

/// Target clip length. "About 5 seconds" per the brief — long enough to
/// catch a word or two, short enough to never feel like a real recording.
export const TEST_AUDIO_DURATION_MS = 5000;
/// How often the live level/waveform sample is read. 100ms gives a visibly
/// smooth wave without flooding onEvent.
export const TEST_AUDIO_TICK_MS = 100;
/// AnalyserNode window size (samples). Small enough to stay responsive,
/// large enough to give `computeLevels` a real window to measure.
export const TEST_AUDIO_FFT_SIZE = 1024;
/// Never hang the UI waiting for a misbehaving MediaRecorder to flush.
export const TEST_AUDIO_STOP_TIMEOUT_MS = 5000;

export const TEST_AUDIO_STATES = Object.freeze([
  "idle",
  "starting",
  "recording",
  "stopping",
  "saved",
  "failed",
  "cancelled",
]);

// --- level measurement ------------------------------------------------------
//
// Linear amplitude thresholds (samples are in [-1, 1]). Chosen so normal
// room noise / mic self-noise (well under -50 dBFS RMS on most hardware)
// reads as silence, while speech at a normal distance from the mic (which
// peaks well above -30 dBFS even when quiet) reads as captured. A silent
// clip must NOT pass — these thresholds are the enforcement of that rule,
// not a decoration on top of it.

export const SILENCE_PEAK_AMPLITUDE = 0.02; // ~ -34 dBFS
export const SILENCE_RMS_AMPLITUDE = 0.006; // ~ -44 dBFS

/// Floor used when clamping dB for display/transport — true silence is
/// -Infinity dBFS, which neither JSON nor a human needs to see.
const DB_FLOOR = -120;

/// Peak (max absolute sample) and RMS (root-mean-square) of one sample
/// window. The only inputs this function trusts are the samples themselves.
export function computeLevels(samples) {
  let peak = 0;
  let sumSquares = 0;
  const n = samples.length;
  for (let i = 0; i < n; i += 1) {
    const v = samples[i];
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
    sumSquares += v * v;
  }
  const rms = n > 0 ? Math.sqrt(sumSquares / n) : 0;
  return { peak, rms };
}

/// Combine every tick's { peak, rms } into one clip-level verdict: the max
/// peak seen (catches a short burst of speech) and the power-average RMS
/// across ticks (a fair "how loud overall" figure that isn't skewed by one
/// tick's window size).
export function aggregateLevels(ticks) {
  if (!ticks || ticks.length === 0) return { peak: 0, rms: 0 };
  let peak = 0;
  let sumSquares = 0;
  for (const t of ticks) {
    if (t.peak > peak) peak = t.peak;
    sumSquares += t.rms * t.rms;
  }
  return { peak, rms: Math.sqrt(sumSquares / ticks.length) };
}

/// Linear amplitude -> dBFS. 0 amplitude is -Infinity, not clamped here —
/// callers that need a finite number for display or transport clamp it
/// themselves (see `formatDbfs` / `finiteDbfs`), so the raw math stays
/// honest about true silence.
export function amplitudeToDbfs(amplitude) {
  const a = Math.abs(amplitude);
  if (a <= 0) return -Infinity;
  return 20 * Math.log10(a);
}

/// Clamp to a finite floor for JSON transport (JSON has no Infinity/NaN).
export function finiteDbfs(amplitude) {
  const db = amplitudeToDbfs(amplitude);
  return Number.isFinite(db) ? Math.max(db, DB_FLOOR) : DB_FLOOR;
}

function formatDbfs(amplitude) {
  const db = finiteDbfs(amplitude);
  return `${db.toFixed(1)} dBFS`;
}

/// Plain-words verdict from measured levels. A silent clip (both peak and
/// RMS under their thresholds) FAILS — this is the one function that
/// decides pass/fail, and it never special-cases "well it was probably
/// fine": the levels are what they measured, nothing more.
export function audioVerdict({ peak, rms }) {
  const captured = peak >= SILENCE_PEAK_AMPLITUDE || rms >= SILENCE_RMS_AMPLITUDE;
  const peakText = formatDbfs(peak);
  const rmsText = formatDbfs(rms);
  if (captured) {
    return {
      captured: true,
      text: `Audio captured — peak ${peakText}, average ${rmsText}.`,
    };
  }
  return {
    captured: false,
    text: `No audio detected — this looks like silence (peak ${peakText}, average ${rmsText}). Check the selected microphone and try again.`,
  };
}

function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// --- session state machine ---------------------------------------------

export class TestAudioSession {
  /**
   * @param {object} deps
   * @param {(cmd: string, args: object) => Promise<any>} deps.invoke
   * @param {object} [deps.mediaDevices]
   * @param {Function} [deps.MediaRecorderImpl]
   * @param {Function} [deps.AudioContextImpl]
   * @param {(evt: object) => void} [deps.onEvent]
   * @param {number} [deps.durationMs]
   * @param {number} [deps.tickMs]
   * @param {number} [deps.fftSize]
   */
  constructor({
    invoke,
    mediaDevices,
    MediaRecorderImpl,
    AudioContextImpl,
    onEvent,
    durationMs,
    tickMs,
    fftSize,
  } = {}) {
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
    this.AudioContextImpl =
      AudioContextImpl ||
      (typeof AudioContext !== "undefined" ? AudioContext : null) ||
      null;
    this.onEvent = onEvent || (() => {});
    this.durationMs = durationMs || TEST_AUDIO_DURATION_MS;
    this.tickMs = tickMs || TEST_AUDIO_TICK_MS;
    this.fftSize = fftSize || TEST_AUDIO_FFT_SIZE;
    this.reset();
  }

  reset() {
    this.stopTick();
    this.stopDeadline();
    this.state = "idle";
    this.reason = null;
    this.mime = null;
    this.stream = null;
    this.recorder = null;
    this.audioCtx = null;
    this.analyser = null;
    this.chunks = [];
    this.appendChain = Promise.resolve();
    this.tickLevels = [];
    this.lastWaveform = null;
    this.deviceLabel = "";
    this.startedAt = 0;
    this.result = null; // { path, fileName, peak, rms, captured, text }
  }

  get active() {
    return ["starting", "recording", "stopping"].includes(this.state);
  }

  emit(extra = {}) {
    this.onEvent({
      state: this.state,
      reason: this.reason,
      elapsedMs: this.startedAt ? Date.now() - this.startedAt : 0,
      waveform: this.lastWaveform,
      result: this.result,
      ...extra,
    });
  }

  /** Start recording + metering from the selected microphone; auto-stops and saves after durationMs. */
  async start({ deviceId = "", deviceLabel = "" } = {}) {
    if (!["idle", "failed", "cancelled", "saved"].includes(this.state)) {
      throw new Error(`cannot start from state ${this.state}`);
    }
    if (!this.MediaRecorderImpl) throw new Error("audio recording is not supported here");
    if (!this.mediaDevices || typeof this.mediaDevices.getUserMedia !== "function") {
      throw new Error("microphone access is not available");
    }
    if (!this.AudioContextImpl) throw new Error("live level metering is not supported here");
    this.reset();
    this.state = "starting";
    this.deviceLabel = deviceLabel || (deviceId ? "Selected microphone" : "System default");
    this.emit();
    try {
      this.mime = pickAudioMime((m) => this.MediaRecorderImpl.isTypeSupported(m));
      if (!this.mime) throw new Error("this browser cannot record audio in a supported format");
      // Same constraint shape as meeting mode: the exact selected device,
      // not a hint — the test must exercise the identical input path.
      const constraints = deviceId
        ? { audio: { deviceId: { exact: deviceId } } }
        : { audio: true };
      this.stream = await this.mediaDevices.getUserMedia(constraints);
      this.audioCtx = new this.AudioContextImpl();
      const source = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      source.connect(this.analyser);
      this.recorder = new this.MediaRecorderImpl(this.stream, { mimeType: this.mime });
      this.recorder.ondataavailable = (e) => this.onChunk(e && e.data);
      this.recorder.onerror = (e) => this.onRecorderError(e);
      this.recorder.start();
      this.startedAt = Date.now();
      this.state = "recording";
      this.emit();
      this.startTick();
      this.deadline = setTimeout(() => {
        this.stop().catch((err) => this.fail(err));
      }, this.durationMs);
    } catch (err) {
      await this.cleanupAfterFailedStart();
      this.state = "failed";
      this.reason = describeRecordingError(err);
      this.emit();
      throw err;
    }
  }

  /** One AnalyserNode read: feeds both the live waveform and the final verdict. */
  tick() {
    if (!this.analyser) return;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    const levels = computeLevels(buf);
    this.tickLevels.push(levels);
    this.lastWaveform = Array.from(buf);
    this.emit({ tickLevels: levels });
  }

  startTick() {
    this.stopTick();
    this.tickTimer = setInterval(() => this.tick(), this.tickMs);
  }

  stopTick() {
    if (this.tickTimer !== null && this.tickTimer !== undefined) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  stopDeadline() {
    if (this.deadline !== null && this.deadline !== undefined) {
      clearTimeout(this.deadline);
      this.deadline = null;
    }
  }

  onChunk(blob) {
    if (!blob || blob.size === 0) return;
    this.appendChain = this.appendChain.then(async () => {
      const buf = await blob.arrayBuffer();
      this.chunks.push(new Uint8Array(buf));
    });
  }

  onRecorderError(e) {
    if (this.state !== "recording") return;
    this.fail(new Error(describeRecordingError((e && e.error) || e)));
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

  closeAudioCtx() {
    const ctx = this.audioCtx;
    this.audioCtx = null;
    this.analyser = null;
    if (ctx && typeof ctx.close === "function") {
      try {
        ctx.close();
      } catch {
        /* best effort */
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
      setTimeout(finish, TEST_AUDIO_STOP_TIMEOUT_MS);
      try {
        this.stopRecorder();
      } catch {
        finish();
      }
    }).then(() => this.appendChain);
  }

  async cleanupAfterFailedStart() {
    try {
      this.stopRecorder();
    } catch {
      /* best effort */
    }
    this.stopTracks();
    this.closeAudioCtx();
  }

  async fail(err) {
    this.stopTick();
    this.stopDeadline();
    try {
      this.stopRecorder();
    } catch {
      /* best effort */
    }
    this.stopTracks();
    this.closeAudioCtx();
    this.state = "failed";
    this.reason = describeRecordingError(err);
    this.emit();
  }

  /** Stop recording, measure the whole clip, save it, and report the verdict. */
  async stop() {
    if (this.state !== "recording") return;
    this.stopTick();
    this.stopDeadline();
    this.state = "stopping";
    this.emit();
    await this.stopRecorderAndFlush();
    this.stopTracks();
    this.closeAudioCtx();
    const bytes = concatBytes(this.chunks);
    const aggregate = aggregateLevels(this.tickLevels);
    const verdict = audioVerdict(aggregate);
    if (bytes.length === 0) {
      this.state = "failed";
      this.reason = "no audio bytes were recorded";
      this.emit();
      return;
    }
    try {
      const res = await this.invoke("test_audio_save", {
        dto: {
          bytes: Array.from(bytes),
          mime: this.mime,
          deviceLabel: this.deviceLabel,
          peakDbfs: finiteDbfs(aggregate.peak),
          rmsDbfs: finiteDbfs(aggregate.rms),
          captured: verdict.captured,
        },
      });
      this.result = {
        path: res && res.path,
        fileName: res && res.fileName,
        peak: aggregate.peak,
        rms: aggregate.rms,
        captured: verdict.captured,
        text: verdict.text,
      };
      this.state = "saved";
      this.emit();
    } catch (err) {
      this.state = "failed";
      this.reason = String((err && err.message) || err);
      this.emit();
    }
  }

  /** Abort a live test without saving anything. */
  cancel() {
    if (!this.active) return;
    this.stopTick();
    this.stopDeadline();
    try {
      this.stopRecorder();
    } catch {
      /* best effort */
    }
    this.stopTracks();
    this.closeAudioCtx();
    this.state = "cancelled";
    this.reason = null;
    this.emit();
  }

  dispose() {
    this.stopTick();
    this.stopDeadline();
    try {
      this.stopRecorder();
    } catch {
      /* best effort */
    }
    this.stopTracks();
    this.closeAudioCtx();
  }
}
