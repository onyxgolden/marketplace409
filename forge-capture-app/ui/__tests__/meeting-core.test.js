// Tests for forge-capture-app/ui/meeting-core.js — Meeting mode logic.
// Pure logic + the MeetingSession state machine with faked browser APIs.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MeetingSession,
  formatTimestamp,
  transcriptText,
  searchSegments,
  validateLanguageHint,
  pickAudioMime,
  describeRecordingError,
  MEETING_STREAM_CAP_BYTES,
  MEETING_STATES,
} from "../meeting-core.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// --- pure helpers -----------------------------------------------------------

describe("formatTimestamp (mirrors core/src/meeting.rs)", () => {
  it("formats m:ss", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(4.2)).toBe("0:04");
    expect(formatTimestamp(65)).toBe("1:05");
  });
  it("formats h:mm:ss past an hour", () => {
    expect(formatTimestamp(3723)).toBe("1:02:03");
  });
  it("clamps negatives to zero", () => {
    expect(formatTimestamp(-3)).toBe("0:00");
  });
});

describe("transcriptText", () => {
  it("renders one [m:ss] line per segment", () => {
    const text = transcriptText([
      { start: 0, end: 4.2, text: "Hello everyone" },
      { start: 4.2, end: 12.5, text: "  Let's review.  " },
    ]);
    expect(text).toBe("[0:00] Hello everyone\n[0:04] Let's review.");
  });
  it("is empty for a silent meeting", () => {
    expect(transcriptText([])).toBe("");
  });
});

describe("searchSegments", () => {
  const segs = [
    { start: 0, end: 1, text: "Hello everyone" },
    { start: 1, end: 2, text: "Let's review the budget" },
  ];
  it("matches case-insensitively", () => {
    expect(searchSegments(segs, "hello")).toEqual([0]);
    expect(searchSegments(segs, "REVIEW")).toEqual([1]);
  });
  it("matches everything on an empty query", () => {
    expect(searchSegments(segs, "")).toEqual([0, 1]);
    expect(searchSegments(segs, "   ")).toEqual([0, 1]);
  });
  it("returns no indices when nothing matches", () => {
    expect(searchSegments(segs, "nothing here")).toEqual([]);
  });
});

describe("validateLanguageHint (mirrors core/src/meeting.rs)", () => {
  it("accepts auto and 2-3 letter codes", () => {
    expect(validateLanguageHint("auto").ok).toBe(true);
    expect(validateLanguageHint("en").ok).toBe(true);
    expect(validateLanguageHint("eng").ok).toBe(true);
  });
  it("rejects the rest", () => {
    for (const bad of ["", "e", "engl", "EN", "en-US", null, 42]) {
      expect(validateLanguageHint(bad).ok).toBe(false);
    }
  });
});

describe("pickAudioMime", () => {
  it("prefers opus webm, then webm, then mp4", () => {
    expect(pickAudioMime(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickAudioMime((m) => m === "audio/mp4")).toBe("audio/mp4");
  });
  it("returns null when nothing is supported", () => {
    expect(pickAudioMime(() => false)).toBe(null);
    expect(
      pickAudioMime(() => {
        throw new Error("nope");
      })
    ).toBe(null);
  });
});

describe("describeRecordingError", () => {
  it("maps denial to an actionable message", () => {
    const text = describeRecordingError({ name: "NotAllowedError" });
    expect(text).toMatch(/denied/i);
    expect(text).toMatch(/microphone/i);
  });
  it("maps missing hardware", () => {
    expect(describeRecordingError({ name: "NotFoundError" })).toMatch(/no microphone/i);
  });
  it("falls back to the raw message", () => {
    expect(describeRecordingError(new Error("boom"))).toBe("boom");
  });
});

// --- session fakes ----------------------------------------------------------

function makeBlob(size, fill = 7) {
  return {
    size,
    arrayBuffer: async () => new Uint8Array(new Array(size).fill(fill)).buffer,
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
    FakeRecorder.instances.push(this);
  }
  static isTypeSupported(mime) {
    return mime.startsWith("audio/webm");
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    if (this.ondataavailable) this.ondataavailable({ data: makeBlob(16) });
    if (this.onstop) this.onstop({});
  }
  emitChunk(size) {
    if (this.ondataavailable) this.ondataavailable({ data: makeBlob(size) });
  }
}
FakeRecorder.instances = [];

function makeMediaDevices(overrides = {}) {
  return {
    enumerateDevices: async () => [
      { kind: "audioinput", deviceId: "mic1", label: "Fake Mic" },
      { kind: "videoinput", deviceId: "cam1", label: "Fake Cam" },
    ],
    getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }),
    ...overrides,
  };
}

function makeSession({ invokeImpl, mediaDevices, MediaRecorderImpl } = {}) {
  const events = [];
  const session = new MeetingSession({
    invoke: invokeImpl || vi.fn(),
    mediaDevices: mediaDevices || makeMediaDevices(),
    MediaRecorderImpl: MediaRecorderImpl || FakeRecorder,
    onEvent: (e) => events.push(e),
  });
  FakeRecorder.instances = [];
  return { session, events };
}

function flushMicrotasks() {
  // With fake timers, a raw setTimeout(0) never fires: advance the mocked
  // clock instead so chained promises and 0-ms timers flush.
  return vi.advanceTimersByTimeAsync(0);
}

// --- session lifecycle ------------------------------------------------------

describe("MeetingSession recording", () => {
  it("streams chunks to the backend while recording, then finishes", async () => {
    const calls = [];
    const invoke = vi.fn(async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === "meeting_upload_begin") return "mu-1";
      if (cmd === "meeting_upload_finish")
        return { audioPath: "/lib/meeting-x.webm", fileName: "meeting-x.webm", jobId: "tr-1" };
      return null;
    });
    const { session } = makeSession({ invokeImpl: invoke });

    await session.startRecording({ deviceId: "", languageHint: "en" });
    expect(session.state).toBe("recording");

    // begin declared the streaming capacity cap with the picked mime
    const begin = calls.find(([c]) => c === "meeting_upload_begin");
    expect(begin[1].dto.totalBytes).toBe(MEETING_STREAM_CAP_BYTES);
    expect(begin[1].dto.mime).toBe("audio/webm;codecs=opus");

    // timeslice chunks stream in order with strict offsets
    const rec = FakeRecorder.instances[0];
    rec.emitChunk(100);
    rec.emitChunk(50);
    await session.stopRecording();
    await flushMicrotasks();

    const appends = calls.filter(([c]) => c === "meeting_upload_append");
    expect(appends.map(([, a]) => a.dto.offset)).toEqual([0, 100, 150]);
    const finish = calls.find(([c]) => c === "meeting_upload_finish");
    expect(finish[1].dto.actualBytes).toBe(166); // 100 + 50 + 16 (final stop chunk)
    expect(finish[1].dto.languageHint).toBe("en");
    expect(session.state).toBe("queued");
    expect(session.jobId).toBe("tr-1");
  });

  it("lists only audio inputs and names the chosen microphone", async () => {
    const { session } = makeSession({});
    const devices = await session.listInputDevices();
    expect(devices).toEqual([{ deviceId: "mic1", label: "Fake Mic" }]);
    const invoke = vi.fn(async (cmd) => (cmd === "meeting_upload_begin" ? "mu-9" : null));
    session.invoke = invoke;
    await session.startRecording({ deviceId: "mic1" });
    expect(session.deviceLabel).toBe("Fake Mic");
  });

  it("fails honestly when microphone permission is denied", async () => {
    const denied = makeMediaDevices({
      getUserMedia: async () => {
        const e = new Error("Permission denied");
        e.name = "NotAllowedError";
        throw e;
      },
    });
    const { session, events } = makeSession({ mediaDevices: denied });
    await expect(session.startRecording()).rejects.toThrow();
    expect(session.state).toBe("failed");
    expect(session.reason).toMatch(/denied/i);
    expect(events[events.length - 1].state).toBe("failed");
  });

  it("rejects a bad language hint before touching the microphone", async () => {
    const getUserMedia = vi.fn();
    const { session } = makeSession({ mediaDevices: makeMediaDevices({ getUserMedia }) });
    await expect(session.startRecording({ languageHint: "EN" })).rejects.toThrow(/language hint/i);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("a failed append poisons the upload and fails the session", async () => {
    const invoke = vi.fn(async (cmd) => {
      if (cmd === "meeting_upload_begin") return "mu-2";
      if (cmd === "meeting_upload_append") throw new Error("disk full");
      return null;
    });
    const { session } = makeSession({ invokeImpl: invoke });
    await session.startRecording();
    FakeRecorder.instances[0].emitChunk(64);
    await flushMicrotasks();
    await flushMicrotasks();
    expect(session.state).toBe("failed");
    // the poisoned upload was cancelled, never finished
    expect(invoke).toHaveBeenCalledWith("meeting_upload_cancel", { id: "mu-2" });
    expect(invoke).not.toHaveBeenCalledWith(
      "meeting_upload_finish",
      expect.anything()
    );
  });
});

describe("MeetingSession polling + import", () => {
  function pollingInvoke(statuses, transcript) {
    let polls = 0;
    return vi.fn(async (cmd, args) => {
      if (cmd === "meeting_poll") return { jobId: args.jobId, status: statuses[Math.min(polls++, statuses.length - 1)] };
      if (cmd === "meeting_import") return transcript;
      throw new Error(`unexpected ${cmd}`);
    });
  }

  it("polls to done and auto-imports the transcript", async () => {
    const transcript = {
      transcriptPath: "/lib/t.transcript.json",
      segments: [{ start: 0, end: 1.5, text: "Hi" }],
      durationSec: 1.5,
    };
    const invoke = pollingInvoke(["queued", "processing", "done"], transcript);
    const { session, events } = makeSession({ invokeImpl: invoke });
    session.adoptJob("tr-7", "meeting-x.webm");
    expect(session.state).toBe("queued");

    await session.pollOnce(Date.now());
    expect(session.state).toBe("queued");
    await session.pollOnce(Date.now());
    expect(session.state).toBe("processing");
    await session.pollOnce(Date.now());
    expect(session.state).toBe("imported");
    expect(session.transcript.segments).toEqual(transcript.segments);
    expect(events[events.length - 1].state).toBe("imported");
  });

  it("says the honest runner-missing truth after the hint timeout", async () => {
    const invoke = pollingInvoke(["queued"], null);
    const { session, events } = makeSession({ invokeImpl: invoke });
    session.adoptJob("tr-8", "meeting-y.webm");
    const late = session.submittedAt + 11_000;
    await session.pollOnce(late);
    expect(session.runnerHint).toBe(true);
    expect(events[events.length - 1].text).toMatch(/no transcription runner/i);
  });

  it("fails honestly when the runner reports failure", async () => {
    const invoke = vi.fn(async (cmd) => {
      if (cmd === "meeting_poll") return { jobId: "tr-9", status: "failed", reason: "whisper crashed" };
      throw new Error(`unexpected ${cmd}`);
    });
    const { session } = makeSession({ invokeImpl: invoke });
    session.adoptJob("tr-9", "meeting-z.webm");
    await session.pollOnce();
    expect(session.state).toBe("failed");
    expect(session.reason).toBe("whisper crashed");
  });

  it("cancelling while queued stops polling", async () => {
    const invoke = pollingInvoke(["queued"], null);
    const { session } = makeSession({ invokeImpl: invoke });
    session.adoptJob("tr-10", "meeting-w.webm");
    session.cancel();
    expect(session.state).toBe("cancelled");
    expect(session.pollTimer).toBe(null);
  });
});

describe("MEETING_STATES", () => {
  it("is a frozen list", () => {
    expect(MEETING_STATES).toContain("recording");
    expect(MEETING_STATES).toContain("imported");
    expect(Object.isFrozen(MEETING_STATES)).toBe(true);
  });
});
