// Tests for the RecordingSession lifecycle in forge-capture-app/ui/record.js.
// DOM-free: mediaDevices, MediaRecorder, and invoke are all injected fakes.
// (The canvas Compositor is not constructed here — cursorMode "none".)

import { describe, it, expect, vi } from "vitest";
import {
  RecordingSession,
  RecordingError,
  formatBytes,
  formatDuration,
} from "../record.js";
import { RecordingError as CoreRecordingError } from "../record-core.js";

function fakeTrack(settings = {}) {
  return {
    getSettings: () => ({ displaySurface: "monitor", width: 1920, height: 1080, ...settings }),
    stop: vi.fn(),
    onended: null,
  };
}

function fakeStream(trackSettings) {
  const video = fakeTrack(trackSettings);
  return {
    getVideoTracks: () => [video],
    getAudioTracks: () => [],
    getTracks: () => [video],
    __video: video,
  };
}

function makeRecorder({ supported = ["video/webm;codecs=vp9"], chunks = [100, 200] } = {}) {
  return class FakeRecorder {
    static isTypeSupported(mime) {
      return supported.includes(mime);
    }
    constructor(stream, opts) {
      this.stream = stream;
      this.opts = opts;
      this.state = "inactive";
      this.timeslice = 0;
    }
    start(timeslice) {
      this.state = "recording";
      this.timeslice = timeslice;
      for (const size of chunks) {
        setTimeout(() => this.ondataavailable && this.ondataavailable({ data: new Blob([new Uint8Array(size)]) }), 1);
      }
    }
    stop() {
      this.state = "inactive";
      setTimeout(() => this.onstop && this.onstop(), 1);
    }
  };
}

function deps(overrides = {}) {
  return {
    invoke: async () => ({ x: 10, y: 20 }),
    mediaDevices: { getDisplayMedia: async () => fakeStream() },
    Recorder: makeRecorder(),
    monitors: [],
    ...overrides,
  };
}

describe("RecordingSession lifecycle", () => {
  it("starts and stops, collecting chunks into a blob", async () => {
    const s = new RecordingSession(deps());
    const ticks = [];
    s.on("tick", (t) => ticks.push(t));
    const started = await s.start({ mode: "monitor", cursorMode: "none", format: "webm" });
    expect(s.state).toBe("recording");
    expect(started.mime).toBe("video/webm;codecs=vp9");
    expect(started.trackInfo.width).toBe(1920);
    await new Promise((r) => setTimeout(r, 20));
    const result = await s.stop();
    expect(s.state).toBe("stopped");
    expect(result.mime).toBe("video/webm;codecs=vp9");
    expect(result.byteLength).toBe(300);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[0].bytes).toBeGreaterThan(0);
  });

  it("rejects a second start while recording", async () => {
    const s = new RecordingSession(deps());
    await s.start({});
    const err = await s.start({}).catch((e) => e);
    expect(err).toBeInstanceOf(CoreRecordingError);
    expect(err.code).toBe("already-recording");
    await s.stop();
  });

  it("stop() on an idle session returns null", async () => {
    const s = new RecordingSession(deps());
    expect(await s.stop()).toBe(null);
  });

  it("reports unsupported when getDisplayMedia is missing", async () => {
    const s = new RecordingSession(deps({ mediaDevices: {} }));
    await expect(s.start({})).rejects.toThrow(CoreRecordingError);
    const blocker = await s.start({}).catch((e) => e.message);
    expect(blocker).toContain("getDisplayMedia");
  });

  it("reports unsupported when the host cannot encode WebM", async () => {
    const s = new RecordingSession(deps({ Recorder: makeRecorder({ supported: [] }) }));
    await expect(s.start({})).rejects.toThrow(/WebM/);
  });

  it("picks mp4 only where the platform reports support", async () => {
    const noMp4 = new RecordingSession(deps());
    await expect(noMp4.start({ format: "mp4" })).rejects.toThrow(/MP4/);
    const yesMp4 = new RecordingSession(
      deps({ Recorder: makeRecorder({ supported: ["video/webm;codecs=vp9", "video/mp4"] }) }),
    );
    const started = await yesMp4.start({ format: "mp4" });
    expect(started.mime).toBe("video/mp4");
    await yesMp4.stop();
  });

  it("turns a denied picker into an honest capture-denied error", async () => {
    const denied = new Error("denied");
    denied.name = "NotAllowedError";
    const s = new RecordingSession(
      deps({
        mediaDevices: {
          getDisplayMedia: async () => {
            throw denied;
          },
        },
      }),
    );
    const err = await s.start({}).catch((e) => e);
    expect(err).toBeInstanceOf(CoreRecordingError);
    expect(err.code).toBe("capture-denied");
  });

  it("warns instead of misplacing the overlay when mapping fails", async () => {
    const s = new RecordingSession(deps());
    const warnings = [];
    s.on("warning", (w) => warnings.push(w));
    // cursorMode highlight but no matching monitor -> overlay-unavailable
    await s.start({ mode: "window", cursorMode: "highlight" });
    expect(warnings.some((w) => w.kind === "overlay-unavailable")).toBe(true);
    await s.stop();
  });

  it("stops when the shared track ends", async () => {
    const stream = fakeStream();
    const s = new RecordingSession(deps({ mediaDevices: { getDisplayMedia: async () => stream } }));
    const ended = [];
    s.on("ended", (e) => ended.push(e));
    await s.start({});
    stream.__video.onended();
    await new Promise((r) => setTimeout(r, 30));
    expect(ended.length).toBe(1);
    expect(s.state).toBe("stopped");
  });

  it("RecordingError is exported from both modules as the same class", () => {
    expect(RecordingError).toBe(CoreRecordingError);
  });
});

describe("RecordingSession stop idempotency and failure cleanup", () => {
  it("stop-during-stop joins the in-flight stop promise instead of returning null", async () => {
    const s = new RecordingSession(deps());
    await s.start({ mode: "monitor", cursorMode: "none", format: "webm" });
    const p1 = s.stop();
    expect(s.state).toBe("stopping");
    const p2 = s.stop();
    // The second caller gets the same in-flight promise, not null.
    expect(p2).toBeInstanceOf(Promise);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(r1.byteLength).toBe(300);
    expect(s.state).toBe("stopped");
    // A stop after completion is still null.
    expect(await s.stop()).toBe(null);
  });

  it("recorder error auto-stops the session instead of leaving it recording", async () => {
    let recorderInstance = null;
    const FailingRecorder = makeRecorder();
    const CapturingRecorder = class extends FailingRecorder {
      constructor(...args) {
        super(...args);
        recorderInstance = this;
      }
    };
    const s = new RecordingSession(deps({ Recorder: CapturingRecorder }));
    const errors = [];
    s.on("error", (e) => errors.push(e));
    await s.start({ mode: "monitor", cursorMode: "none", format: "webm" });
    expect(s.state).toBe("recording");
    // Simulate the encoder failing mid-recording.
    recorderInstance.onerror({ error: new Error("encoder blew up") });
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe("recorder-error");
    const result = await s.stopPromise;
    expect(s.state).toBe("stopped");
    expect(result).not.toBe(null);
  });

  it("destroy-path cleanup stops tracks, recorder, and timers", async () => {
    const stream = fakeStream();
    const s = new RecordingSession(deps({ mediaDevices: { getDisplayMedia: async () => stream } }));
    await s.start({ mode: "monitor", cursorMode: "none", format: "webm", maxDurationMs: 60000 });
    expect(s.stopTimer).not.toBe(0);
    const recorder = s.recorder;
    // This is exactly what renderRecordControls().destroy() does with the session.
    void s.stop();
    const result = await s.stopPromise;
    expect(s.state).toBe("stopped");
    expect(result).not.toBe(null);
    // Tracks released.
    expect(stream.__video.stop).toHaveBeenCalled();
    // Encoder shut down.
    expect(recorder.state).toBe("inactive");
    // Timers cleared.
    expect(s.cursorTimer).toBe(0);
    expect(s.stopTimer).toBe(0);
    expect(s.compositor).toBe(null);
  });
});

describe("format helpers", () => {
  it("formatBytes uses human units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("formatDuration renders m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65000)).toBe("1:05");
    expect(formatDuration(600000)).toBe("10:00");
  });
});
