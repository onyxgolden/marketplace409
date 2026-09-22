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
