// Tests for forge-capture-app/ui/test-audio-core.js — the "Test audio"
// confirmation action: tone fixture must pass with real levels, silence
// fixture must FAIL, and the live waveform must come from the same
// measured samples as the verdict (never a canned animation).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TestAudioSession,
  computeLevels,
  aggregateLevels,
  amplitudeToDbfs,
  finiteDbfs,
  audioVerdict,
  pickAudioMime,
  SILENCE_PEAK_AMPLITUDE,
  SILENCE_RMS_AMPLITUDE,
  TEST_AUDIO_DURATION_MS,
} from "../test-audio-core.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// --- fixtures ----------------------------------------------------------
// A real sine tone and real silence — both are plain Float32 sample
// windows, the same shape AnalyserNode.getFloatTimeDomainData fills.

function toneSamples(n = 1024, amplitude = 0.5, freqCycles = 20) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freqCycles * i) / n);
  }
  return out;
}

function silenceSamples(n = 1024) {
  return new Float32Array(n); // all zeros
}

// --- pure level math -----------------------------------------------------

describe("computeLevels", () => {
  it("measures a real tone's peak and RMS from its samples", () => {
    const { peak, rms } = computeLevels(toneSamples(2048, 0.5));
    expect(peak).toBeCloseTo(0.5, 2);
    // RMS of a sine with amplitude A is A / sqrt(2).
    expect(rms).toBeCloseTo(0.5 / Math.sqrt(2), 2);
  });

  it("measures silence as exactly zero — never assumed", () => {
    const { peak, rms } = computeLevels(silenceSamples());
    expect(peak).toBe(0);
    expect(rms).toBe(0);
  });

  it("is never fooled by a single hot sample in otherwise-flat audio", () => {
    const flat = silenceSamples(100);
    flat[50] = 0.9;
    const { peak } = computeLevels(flat);
    expect(peak).toBeCloseTo(0.9, 5);
  });
});

describe("aggregateLevels", () => {
  it("takes the max peak and the power-averaged RMS across ticks", () => {
    const ticks = [
      { peak: 0.1, rms: 0.05 },
      { peak: 0.6, rms: 0.3 },
      { peak: 0.2, rms: 0.1 },
    ];
    const agg = aggregateLevels(ticks);
    expect(agg.peak).toBe(0.6);
    expect(agg.rms).toBeCloseTo(Math.sqrt((0.05 ** 2 + 0.3 ** 2 + 0.1 ** 2) / 3), 6);
  });

  it("is zero for no ticks at all", () => {
    expect(aggregateLevels([])).toEqual({ peak: 0, rms: 0 });
  });
});

describe("amplitudeToDbfs / finiteDbfs", () => {
  it("full-scale amplitude is 0 dBFS", () => {
    expect(amplitudeToDbfs(1)).toBeCloseTo(0, 6);
  });
  it("true silence is -Infinity, clamped to the floor for transport", () => {
    expect(amplitudeToDbfs(0)).toBe(-Infinity);
    expect(finiteDbfs(0)).toBe(-120);
    expect(Number.isFinite(finiteDbfs(0))).toBe(true);
  });
});

describe("audioVerdict", () => {
  it("passes a real tone with levels in the expected range", () => {
    const levels = computeLevels(toneSamples(2048, 0.5));
    const v = audioVerdict(levels);
    expect(v.captured).toBe(true);
    expect(v.text).toMatch(/audio captured/i);
    expect(v.text).toMatch(/dBFS/);
  });

  it("fails silence — a silent clip must never pass", () => {
    const levels = computeLevels(silenceSamples());
    const v = audioVerdict(levels);
    expect(v.captured).toBe(false);
    expect(v.text).toMatch(/no audio detected/i);
  });

  it("fails quiet noise that stays under both thresholds", () => {
    const quiet = toneSamples(2048, SILENCE_RMS_AMPLITUDE / 2);
    const v = audioVerdict(computeLevels(quiet));
    expect(v.captured).toBe(false);
  });

  it("passes the instant a short loud burst clears the peak threshold", () => {
    const samples = silenceSamples(100);
    samples[10] = SILENCE_PEAK_AMPLITUDE + 0.01;
    const v = audioVerdict(computeLevels(samples));
    expect(v.captured).toBe(true);
  });
});

describe("pickAudioMime (reused from meeting-core)", () => {
  it("is re-exported and works the same way", () => {
    expect(pickAudioMime(() => true)).toBe("audio/webm;codecs=opus");
  });
});

// --- session fakes ----------------------------------------------------------

function makeBlob(bytes) {
  return {
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer,
  };
}

class FakeRecorder {
  constructor(stream, opts) {
    this.stream = stream;
    this.opts = opts;
    this.state = "inactive";
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
  }
  static isTypeSupported(mime) {
    return mime.startsWith("audio/webm");
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    if (this.ondataavailable) this.ondataavailable({ data: makeBlob(new Uint8Array([1, 2, 3, 4])) });
    if (this.onstop) this.onstop({});
  }
}

class FakeAnalyser {
  constructor(samplesFn) {
    this.fftSize = 1024;
    this._samplesFn = samplesFn;
  }
  getFloatTimeDomainData(buf) {
    const samples = this._samplesFn();
    for (let i = 0; i < buf.length; i += 1) buf[i] = samples[i % samples.length];
  }
}

class FakeAudioContext {
  constructor(samplesFn) {
    this._samplesFn = samplesFn;
    this.closed = false;
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  createAnalyser() {
    return new FakeAnalyser(this._samplesFn);
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

function makeMediaDevices() {
  return {
    getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }),
  };
}

function makeSession({ samplesFn, invokeImpl } = {}) {
  const events = [];
  const fn = samplesFn || (() => toneSamples());
  const session = new TestAudioSession({
    invoke: invokeImpl || vi.fn(async () => ({ path: "/lib/test-audio-x.webm", fileName: "test-audio-x.webm" })),
    mediaDevices: makeMediaDevices(),
    MediaRecorderImpl: FakeRecorder,
    AudioContextImpl: function (...args) {
      return new FakeAudioContext(fn, ...args);
    },
    onEvent: (e) => events.push(e),
    durationMs: TEST_AUDIO_DURATION_MS,
  });
  return { session, events };
}

function flushMicrotasks() {
  return vi.advanceTimersByTimeAsync(0);
}

describe("TestAudioSession — tone fixture", () => {
  it("records, measures, and saves a passing clip", async () => {
    const calls = [];
    const invoke = vi.fn(async (cmd, args) => {
      calls.push([cmd, args]);
      return { path: "/lib/test-audio-ok.webm", fileName: "test-audio-ok.webm" };
    });
    const { session, events } = makeSession({ samplesFn: () => toneSamples(1024, 0.5), invokeImpl: invoke });

    await session.start({ deviceId: "mic1", deviceLabel: "Fake Mic" });
    expect(session.state).toBe("recording");

    await vi.advanceTimersByTimeAsync(TEST_AUDIO_DURATION_MS);
    await flushMicrotasks();

    expect(session.state).toBe("saved");
    expect(session.result.captured).toBe(true);
    expect(session.result.text).toMatch(/audio captured/i);
    expect(session.result.fileName).toBe("test-audio-ok.webm");

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("test_audio_save");
    const dto = calls[0][1].dto;
    expect(dto.captured).toBe(true);
    expect(dto.deviceLabel).toBe("Fake Mic");
    expect(dto.bytes.length).toBeGreaterThan(0);
    expect(Number.isFinite(dto.peakDbfs)).toBe(true);
    expect(Number.isFinite(dto.rmsDbfs)).toBe(true);

    // The live wave moved: not every tick's waveform is identical/flat.
    const waveforms = events.filter((e) => e.state === "recording" && e.tickLevels).map((e) => e.waveform);
    expect(waveforms.length).toBeGreaterThan(0);
    const allFlat = waveforms.every((w) => w.every((v) => v === 0));
    expect(allFlat).toBe(false);
  });
});

describe("TestAudioSession — silence fixture", () => {
  it("records, measures, and reports no audio — never passes", async () => {
    const invoke = vi.fn(async () => ({ path: "/lib/test-audio-silence.webm", fileName: "test-audio-silence.webm" }));
    const { session, events } = makeSession({ samplesFn: () => silenceSamples(1024), invokeImpl: invoke });

    await session.start({ deviceId: "", deviceLabel: "" });
    await vi.advanceTimersByTimeAsync(TEST_AUDIO_DURATION_MS);
    await flushMicrotasks();

    expect(session.state).toBe("saved");
    expect(session.result.captured).toBe(false);
    expect(session.result.text).toMatch(/no audio detected/i);

    const dto = invoke.mock.calls[0][1].dto;
    expect(dto.captured).toBe(false);

    // The live wave stayed flat — a silent input renders flat, not a fake
    // wiggle.
    const waveforms = events.filter((e) => e.state === "recording" && e.tickLevels).map((e) => e.waveform);
    expect(waveforms.length).toBeGreaterThan(0);
    for (const w of waveforms) {
      expect(w.every((v) => v === 0)).toBe(true);
    }
  });
});

describe("TestAudioSession — error paths", () => {
  it("fails honestly when no microphone is available", async () => {
    const session = new TestAudioSession({
      invoke: vi.fn(),
      mediaDevices: { getUserMedia: async () => { throw { name: "NotFoundError" }; } },
      MediaRecorderImpl: FakeRecorder,
      AudioContextImpl: function () {
        return new FakeAudioContext(() => silenceSamples());
      },
      onEvent: () => {},
    });
    await expect(session.start({})).rejects.toBeTruthy();
    expect(session.state).toBe("failed");
    expect(session.reason).toMatch(/no microphone/i);
  });

  it("cancel() aborts a live test without saving", async () => {
    const invoke = vi.fn();
    const { session } = makeSession({ invokeImpl: invoke });
    await session.start({});
    session.cancel();
    expect(session.state).toBe("cancelled");
    await vi.advanceTimersByTimeAsync(TEST_AUDIO_DURATION_MS);
    expect(invoke).not.toHaveBeenCalled();
  });
});
