// @vitest-environment jsdom
// Tests for the FR1 (2026-11-13, PR #792 review P1) source-ended recovery
// paths in renderRecordControls (forge-capture-app/ui/record.js).
//
// The verdict's blocking finding: the source-ended save path could reject
// without any handled recovery — a failed stop() never emitted "ended",
// and a failed blob.arrayBuffer() inside presentStopResult escaped as an
// unhandled rejection with the preview/save controls never presented and
// the session already reset to null. These tests drive the real UI with
// fake media devices and assert, for each failure, no silent loss and an
// explicit user-visible failure/recovery path.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderRecordControls } from "../record.js";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mountRecording() {
  const stream = fakeStream();
  const container = document.createElement("div");
  document.body.appendChild(container);
  renderRecordControls(container, {
    invoke: async (cmd) => {
      if (cmd === "list_monitors") return [];
      if (cmd === "captures_dir_path") return "C:\\Captures";
      return {};
    },
    mediaDevices: { getDisplayMedia: async () => stream },
    Recorder: makeRecorder(),
  });
  const $ = (id) => container.querySelector(`#${id}`);
  $("rec-start").click();
  // Wait until the session reports recording (the initial "Recording (…)"
  // status is quickly replaced by tick updates like "Recording… 0:00").
  for (let i = 0; i < 50; i++) {
    if ($("rec-status").textContent.includes("Recording")) break;
    await sleep(10);
  }
  expect($("rec-status").textContent).toMatch(/Recording/);
  await sleep(20); // let the fake recorder emit its chunks
  return { container, stream, $ };
}

describe("source-ended presentation failure recovery", () => {
  let unhandled = [];
  let onUnhandled = null;
  let origArrayBuffer = null;
  let origBlob = null;
  let origCreateObjectURL = null;
  let origRevokeObjectURL = null;

  afterEach(() => {
    if (onUnhandled) process.off("unhandledRejection", onUnhandled);
    if (origArrayBuffer) Blob.prototype.arrayBuffer = origArrayBuffer;
    if (origBlob) globalThis.Blob = origBlob;
    if (origCreateObjectURL) URL.createObjectURL = origCreateObjectURL;
    if (origRevokeObjectURL) URL.revokeObjectURL = origRevokeObjectURL;
    document.body.innerHTML = "";
    onUnhandled = null;
    origArrayBuffer = null;
    origBlob = null;
  });

  function trackUnhandled() {
    unhandled = [];
    onUnhandled = (e) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
  }

  function stubObjectURLs() {
    // jsdom has no createObjectURL; the preview flow needs one.
    origCreateObjectURL = URL.createObjectURL;
    origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:test-preview";
    URL.revokeObjectURL = () => {};
  }

  it("a failed blob.arrayBuffer() during ended-result presentation keeps the recording and offers Retry preview", async () => {
    stubObjectURLs();
    trackUnhandled();
    const { container, stream, $ } = await mountRecording();
    // Simulate a transient conversion failure for the stop result's blob.
    origArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async () => {
      throw new Error("conversion blew up");
    };
    stream.__video.onended();
    await sleep(50);
    // Explicit user-visible failure state — not a silent loss, and the
    // preview/save controls are NOT presented as if everything were fine.
    expect($("rec-status").textContent).toMatch(/Couldn't read the recording for preview/);
    expect($("rec-status").textContent).toMatch(/Retry preview/);
    expect($("rec-status").className).toContain("error");
    expect($("rec-retry-preview").hidden).toBe(false);
    expect($("rec-preview-wrap").hidden).toBe(true);
    expect(unhandled.length).toBe(0);
    // The bytes were retained, so a retry recovers the recording: restore
    // the real conversion and click Retry preview.
    Blob.prototype.arrayBuffer = origArrayBuffer;
    origArrayBuffer = null;
    $("rec-retry-preview").click();
    await sleep(50);
    expect($("rec-preview-wrap").hidden).toBe(false);
    expect($("rec-retry-preview").hidden).toBe(true);
    expect($("rec-status").textContent).toMatch(/Recorded /);
    expect(unhandled.length).toBe(0);
    container.remove();
  });

  it("a failed automatic stop after source-end shows an error and lets the user retry Stop", async () => {
    stubObjectURLs();
    trackUnhandled();
    const { container, stream, $ } = await mountRecording();
    // Force blob assembly inside stop() to fail (teardown failure class).
    origBlob = globalThis.Blob;
    const RealBlob = origBlob;
    globalThis.Blob = class extends RealBlob {
      constructor(...args) {
        throw new Error("blob assembly failed");
      }
    };
    stream.__video.onended();
    await sleep(50);
    // Explicit failure state with a recovery action — the session is kept
    // alive, Stop stays reachable, nothing is silently dropped.
    expect($("rec-status").textContent).toMatch(/Automatic stop failed/);
    expect($("rec-status").textContent).toMatch(/click Stop to try again/);
    expect($("rec-status").className).toContain("error");
    expect($("rec-stop").hidden).toBe(false);
    expect(unhandled.length).toBe(0);
    // Retry: restore Blob assembly and click Stop — the recording is
    // recovered through the normal preview/save flow.
    globalThis.Blob = origBlob;
    origBlob = null;
    $("rec-stop").click();
    await sleep(50);
    expect($("rec-preview-wrap").hidden).toBe(false);
    expect($("rec-status").textContent).toMatch(/Recorded /);
    expect(unhandled.length).toBe(0);
    container.remove();
  });
});
