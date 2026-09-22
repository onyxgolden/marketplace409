// Tests for forge-capture-app/ui/record-core.js — Rung 4 recording core.
// Pure logic; no DOM, no MediaRecorder. WebM fixtures are built by hand
// below (minimal valid EBML), so no encoder is needed to test trim/combine.

import { describe, it, expect } from "vitest";
import {
  RecordingError,
  RECORDING_MIME_PRIORITY,
  probeRecordingSupport,
  pickRecordingMime,
  mp4RecordingSupported,
  describeRecordingBlocker,
  validateTrimRange,
  splitWebmSegment,
  clusterTimestamp,
  offsetClusterTimestamp,
  sniffWebm,
  trimWebm,
  combineWebm,
  planGifFrames,
  gifFrameSize,
  encodeGifFrames,
  resolveOverlayMapping,
  regionOverlayMapping,
  mapCursorToFrame,
  cursorOverlayGeometry,
  GIF_MAX_FRAMES,
  GIF_MAX_FPS,
} from "../record-core.js";

// --- synthetic WebM fixture builder --------------------------------------

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function sizeVint(n) {
  for (let len = 1; len <= 8; len += 1) {
    if (n < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i -= 1) {
        out[i] = v & 0xff;
        v = Math.floor(v / 256);
      }
      out[0] |= 0x80 >> (len - 1);
      return out;
    }
  }
  throw new Error("size too big for fixture");
}

function elem(idBytes, payload) {
  return concat(new Uint8Array(idBytes), sizeVint(payload.length), payload);
}

function sint(value, len) {
  let v = value < 0 ? value + 2 ** (8 * len) : value;
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i -= 1) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

const ID_EBML = [0x1a, 0x45, 0xdf, 0xa3];
const ID_SEGMENT = [0x18, 0x53, 0x80, 0x67];
const ID_CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
const ID_TIMESTAMP = [0xe7];
const ID_SIMPLE_BLOCK = [0xa3];
const ID_INFO = [0x15, 0x49, 0xa9, 0x66];
const ID_TRACKS = [0x16, 0x54, 0xae, 0x6b];

function cluster(tsMs, tsLen = 2) {
  return elem(
    ID_CLUSTER,
    concat(elem(ID_TIMESTAMP, sint(tsMs, tsLen)), elem(ID_SIMPLE_BLOCK, new Uint8Array([0x81, 0x00, 0x00]))),
  );
}

function webmFile(clusterTimes) {
  const ebml = elem(ID_EBML, elem([0x42, 0x82], new Uint8Array(0)));
  const segPayload = concat(
    elem(ID_INFO, new Uint8Array(0)),
    elem(ID_TRACKS, new Uint8Array(0)),
    ...clusterTimes.map((t) => cluster(t)),
  );
  // Segment with unknown size (0xFF) — what MediaRecorder emits.
  const segment = concat(new Uint8Array(ID_SEGMENT), new Uint8Array([0xff]), segPayload);
  return concat(ebml, segment);
}

function clusterTimesOf(bytes) {
  return splitWebmSegment(bytes).clusters.map((c) => clusterTimestamp(c).value);
}

// --- capability probing ---------------------------------------------------

describe("probeRecordingSupport", () => {
  const vp9Only = (mime) => mime === "video/webm;codecs=vp9";
  const none = () => false;

  it("reports full support when everything is present", () => {
    const s = probeRecordingSupport({ hasDisplayMedia: true, hasMediaRecorder: true, isTypeSupported: vp9Only });
    expect(s.canRecord).toBe(true);
    expect(s.webmMime).toBe("video/webm;codecs=vp9");
    expect(s.mp4Supported).toBe(false);
    expect(describeRecordingBlocker(s)).toBe("");
  });

  it("falls back down the WebM mime priority list", () => {
    const onlyPlain = (mime) => mime === "video/webm";
    const s = probeRecordingSupport({ hasDisplayMedia: true, hasMediaRecorder: true, isTypeSupported: onlyPlain });
    expect(s.webmMime).toBe("video/webm");
    expect(s.canRecord).toBe(true);
  });

  it("cannot record without WebM", () => {
    const s = probeRecordingSupport({ hasDisplayMedia: true, hasMediaRecorder: true, isTypeSupported: none });
    expect(s.canRecord).toBe(false);
    expect(s.webmMime).toBe(null);
    expect(describeRecordingBlocker(s)).toContain("WebM");
  });

  it("names the missing capability honestly", () => {
    expect(
      describeRecordingBlocker(
        probeRecordingSupport({ hasDisplayMedia: false, hasMediaRecorder: true, isTypeSupported: vp9Only }),
      ),
    ).toContain("getDisplayMedia");
    expect(
      describeRecordingBlocker(
        probeRecordingSupport({ hasDisplayMedia: true, hasMediaRecorder: false, isTypeSupported: vp9Only }),
      ),
    ).toContain("MediaRecorder");
  });

  it("never throws on a throwing isTypeSupported", () => {
    const throwing = () => {
      throw new Error("boom");
    };
    const s = probeRecordingSupport({ hasDisplayMedia: true, hasMediaRecorder: true, isTypeSupported: throwing });
    expect(s.canRecord).toBe(false);
  });
});

describe("pickRecordingMime / mp4RecordingSupported", () => {
  it("picks the first supported WebM mime", () => {
    expect(pickRecordingMime((m) => m === "video/webm;codecs=vp8")).toBe("video/webm;codecs=vp8");
    expect(pickRecordingMime(() => true)).toBe(RECORDING_MIME_PRIORITY[0]);
  });

  it("throws when the host cannot encode WebM", () => {
    expect(() => pickRecordingMime(() => false)).toThrow(RecordingError);
  });

  it("reports MP4 support only when the platform says so", () => {
    expect(mp4RecordingSupported((m) => m === "video/mp4")).toBe(true);
    expect(mp4RecordingSupported(() => false)).toBe(false);
    expect(mp4RecordingSupported(undefined)).toBe(false);
  });
});

// --- trim validation -------------------------------------------------------

describe("validateTrimRange", () => {
  it("clamps the end to the duration", () => {
    expect(validateTrimRange({ durationMs: 5000, startMs: 1000, endMs: 9000 })).toEqual({
      startMs: 1000,
      endMs: 5000,
    });
  });

  it("rejects inverted, negative, and out-of-range trims", () => {
    expect(() => validateTrimRange({ durationMs: 5000, startMs: 3000, endMs: 2000 })).toThrow(RecordingError);
    expect(() => validateTrimRange({ durationMs: 5000, startMs: -1, endMs: 2000 })).toThrow(RecordingError);
    expect(() => validateTrimRange({ durationMs: 5000, startMs: 6000, endMs: 7000 })).toThrow(RecordingError);
    expect(() => validateTrimRange({ durationMs: 5000, startMs: 2000, endMs: 2000 })).toThrow(RecordingError);
  });
});

// --- EBML parsing ----------------------------------------------------------

describe("splitWebmSegment", () => {
  it("splits header from clusters on a synthetic file", () => {
    const file = webmFile([0, 1000, 2000]);
    const { header, clusters } = splitWebmSegment(file);
    expect(header.length).toBeGreaterThan(0);
    expect(clusters).toHaveLength(3);
    expect(clusterTimesOf(file)).toEqual([0, 1000, 2000]);
    // Header must end exactly where the first cluster begins.
    expect(header.length + clusters.reduce((n, c) => n + c.length, 0)).toBe(file.length);
  });

  it("rejects non-WebM bytes", () => {
    expect(() => splitWebmSegment(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(RecordingError);
    expect(() => splitWebmSegment(new Uint8Array(0))).toThrow(RecordingError);
  });

  it("handles a file with no clusters", () => {
    const { header, clusters } = splitWebmSegment(webmFile([]));
    expect(header.length).toBeGreaterThan(0);
    expect(clusters).toHaveLength(0);
  });
});

describe("clusterTimestamp / offsetClusterTimestamp", () => {
  it("reads timestamps including negative values", () => {
    const c = cluster(2500);
    expect(clusterTimestamp(c).value).toBe(2500);
    expect(clusterTimestamp(cluster(-40, 2)).value).toBe(-40);
  });

  it("rewrites the timestamp without mutating the input", () => {
    const c = cluster(1000);
    const shifted = offsetClusterTimestamp(c, 2500);
    expect(clusterTimestamp(shifted).value).toBe(3500);
    expect(clusterTimestamp(c).value).toBe(1000); // input untouched
    expect(shifted.length).toBe(c.length); // same byte width
  });

  it("throws on overflow instead of corrupting the stream", () => {
    const c = cluster(32760); // int16 max is 32767
    expect(() => offsetClusterTimestamp(c, 100)).toThrow(RecordingError);
  });

  it("throws on a non-integer offset", () => {
    expect(() => offsetClusterTimestamp(cluster(0), 1.5)).toThrow(RecordingError);
  });
});

describe("sniffWebm", () => {
  it("recognizes the EBML magic", () => {
    expect(sniffWebm(webmFile([0]))).toBe(true);
  });
  it("rejects garbage", () => {
    expect(sniffWebm(new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]))).toBe(false);
    expect(sniffWebm(new Uint8Array(0))).toBe(false);
    expect(sniffWebm(null)).toBe(false);
  });
});

// --- trim / combine ----------------------------------------------------------

describe("trimWebm", () => {
  const file = webmFile([0, 1000, 2000, 3000, 4000]);

  it("keeps whole clusters in the range and rebases to t=0", () => {
    const out = trimWebm(file, 1500, 3500);
    expect(sniffWebm(out)).toBe(true);
    expect(clusterTimesOf(out)).toEqual([0, 1000]); // 2000,3000 rebased
    // Header is preserved from the original.
    const { header } = splitWebmSegment(file);
    expect(out.subarray(0, header.length)).toEqual(header);
  });

  it("keeps everything when the range covers the file", () => {
    expect(clusterTimesOf(trimWebm(file, 0, 5000))).toEqual([0, 1000, 2000, 3000, 4000]);
  });

  it("throws an honest error when the range holds no clusters", () => {
    expect(() => trimWebm(file, 100, 900)).toThrow(/no complete clusters/);
  });

  it("throws on a clusterless recording", () => {
    expect(() => trimWebm(webmFile([]), 0, 1000)).toThrow(/no clusters/);
  });
});

describe("combineWebm", () => {
  const seg = (times, durationMs, mime = "video/webm;codecs=vp9") => ({
    bytes: webmFile(times),
    durationMs,
    mime,
  });

  it("joins segments with cumulative timestamp offsets", () => {
    const out = combineWebm([seg([0, 1000, 2000], 3000), seg([0, 1000], 2000)]);
    expect(sniffWebm(out)).toBe(true);
    expect(clusterTimesOf(out)).toEqual([0, 1000, 2000, 3000, 4000]);
  });

  it("works with a single segment (offset 0 still copies)", () => {
    const src = seg([0, 1000], 2000);
    const out = combineWebm([src]);
    expect(clusterTimesOf(out)).toEqual([0, 1000]);
    expect(out).toEqual(src.bytes);
    expect(out).not.toBe(src.bytes);
  });

  it("rejects mixed mimes", () => {
    expect(() =>
      combineWebm([seg([0], 1000, "video/webm;codecs=vp9"), seg([0], 1000, "video/webm;codecs=vp8")]),
    ).toThrow(/only identical recordings/);
  });

  it("rejects empty input and clusterless segments", () => {
    expect(() => combineWebm([])).toThrow(RecordingError);
    expect(() => combineWebm([seg([], 1000)])).toThrow(/no clusters/);
  });

  it("refuses MP4 — concatenation is not valid for MP4", () => {
    const mp4seg = (times, durationMs) => ({ bytes: webmFile(times), durationMs, mime: "video/mp4" });
    expect(() => combineWebm([mp4seg([0], 1000), mp4seg([0], 1000)])).toThrow(/WebM recordings only/);
  });
});

// --- adversarial WebM fixtures -------------------------------------------------
// ChatGPT architecture review: prove the EBML manipulation is truly
// cluster-safe. trim/combine always operate on the fully concatenated byte
// stream (timeslice chunks are joined by the browser before parsing), so a
// "cluster split across chunks" can only appear as truncation or a malformed
// element — both must fail loudly, never silently corrupt.

describe("adversarial WebM input", () => {
  it("survives an arbitrary timeslice-style split: chunk boundaries do not matter", () => {
    const file = webmFile([0, 1000, 2000]);
    for (const cut of [7, 100, file.length - 5]) {
      const rejoined = concat(file.subarray(0, cut), file.subarray(cut));
      expect(clusterTimesOf(rejoined)).toEqual([0, 1000, 2000]);
    }
  });

  it("throws on a truncated cluster (interrupted recording)", () => {
    const file = webmFile([0, 1000, 2000]);
    const cut = file.subarray(0, file.length - 10); // sever the last cluster mid-payload
    expect(() => trimWebm(cut, 0, 3000)).toThrow(RecordingError);
    expect(() => combineWebm([{ bytes: cut, durationMs: 3000, mime: "video/webm" }])).toThrow(
      RecordingError,
    );
  });

  it("throws on a cluster with no Timestamp element", () => {
    const noTs = elem(ID_CLUSTER, elem(ID_SIMPLE_BLOCK, new Uint8Array([0x81, 0x00, 0x00])));
    expect(() => clusterTimestamp(noTs)).toThrow(/no Timestamp/);
  });

  it("throws on a malformed element size inside the segment", () => {
    const ebml = elem(ID_EBML, elem([0x42, 0x82], new Uint8Array(0)));
    const bad = concat(
      new Uint8Array(ID_CLUSTER),
      new Uint8Array([0x81]), // declares 1 payload byte...
      new Uint8Array([]), // ...but the segment ends here
    );
    const segment = concat(new Uint8Array(ID_SEGMENT), new Uint8Array([0xff]), bad);
    expect(() => splitWebmSegment(concat(ebml, segment))).toThrow(RecordingError);
  });

  it("throws on an unknown-size cluster instead of swallowing later clusters", () => {
    const ebml = elem(ID_EBML, elem([0x42, 0x82], new Uint8Array(0)));
    const unknownCluster = concat(
      new Uint8Array(ID_CLUSTER),
      new Uint8Array([0xff]), // unknown size
      elem(ID_TIMESTAMP, sint(0, 2)),
    );
    const segment = concat(
      new Uint8Array(ID_SEGMENT),
      new Uint8Array([0xff]),
      concat(elem(ID_INFO, new Uint8Array(0)), unknownCluster, cluster(1000)),
    );
    expect(() => splitWebmSegment(concat(ebml, segment))).toThrow(/unknown size/);
  });

  it("throws on a cluster Timestamp outside the sane width range", () => {
    const wide = elem(ID_CLUSTER, elem(ID_TIMESTAMP, sint(1, 7))); // 7-byte timestamp
    expect(() => clusterTimestamp(wide)).toThrow(/outside the sane range/);
  });
});

// --- GIF ---------------------------------------------------------------------

describe("planGifFrames", () => {
  it("spaces frames evenly across the duration", () => {
    const { timestamps, fps, frameCount } = planGifFrames({ durationMs: 10000, fps: 10 });
    expect(frameCount).toBe(100);
    expect(fps).toBe(10);
    expect(timestamps).toHaveLength(100);
    expect(timestamps[0]).toBe(0);
    expect(timestamps[timestamps.length - 1]).toBeLessThan(10000);
  });

  it("caps frames and fps", () => {
    const { frameCount, fps } = planGifFrames({ durationMs: 120000, fps: 30 });
    expect(frameCount).toBe(GIF_MAX_FRAMES);
    expect(fps).toBe(GIF_MAX_FPS);
  });

  it("rejects non-positive durations", () => {
    expect(() => planGifFrames({ durationMs: 0 })).toThrow(RecordingError);
  });
});

describe("gifFrameSize", () => {
  it("downscales wide frames preserving aspect ratio", () => {
    expect(gifFrameSize({ width: 1920, height: 1080 })).toEqual({ width: 480, height: 270 });
  });
  it("leaves small frames alone", () => {
    expect(gifFrameSize({ width: 400, height: 300 })).toEqual({ width: 400, height: 300 });
  });
});

describe("encodeGifFrames", () => {
  const rgba = (w, h, r, g, b) => {
    const out = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i += 1) {
      out[i * 4] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
      out[i * 4 + 3] = 255;
    }
    return out;
  };

  it("encodes frames to a GIF89a byte stream", () => {
    const bytes = encodeGifFrames({
      frames: [rgba(4, 4, 255, 0, 0), rgba(4, 4, 0, 0, 255)],
      width: 4,
      height: 4,
      fps: 10,
    });
    expect(bytes instanceof Uint8Array).toBe(true);
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe("GIF89a");
    expect(bytes[bytes.length - 1]).toBe(0x3b); // trailer
  });

  it("accepts Uint8ClampedArray frames from canvas", () => {
    const clamped = new Uint8ClampedArray(4 * 4 * 4).fill(128);
    const bytes = encodeGifFrames({ frames: [clamped], width: 4, height: 4 });
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe("GIF89a");
  });

  it("rejects bad input honestly", () => {
    expect(() => encodeGifFrames({ frames: [], width: 4, height: 4 })).toThrow(RecordingError);
    expect(() => encodeGifFrames({ frames: [new Uint8Array(8)], width: 4, height: 4 })).toThrow(/expected 64/);
  });
});

// --- overlay mapping / geometry -------------------------------------------------

const MONITORS = [
  { id: "m1", origin_virtual: [0, 0], size_physical: [1920, 1080] },
  { id: "m2", origin_virtual: [1920, 0], size_physical: [1920, 1080] },
];

describe("resolveOverlayMapping", () => {
  it("maps a full-monitor capture to its monitor origin", () => {
    const m = resolveOverlayMapping({
      trackInfo: { displaySurface: "monitor", width: 1920, height: 1080 },
      monitors: MONITORS,
    });
    expect(m).not.toBe(null);
    expect(m.monitorId).toBe("m1");
  });

  it("returns null for window captures and unknown sizes", () => {
    expect(
      resolveOverlayMapping({
        trackInfo: { displaySurface: "window", width: 1920, height: 1080 },
        monitors: MONITORS,
      }),
    ).toBe(null);
    expect(
      resolveOverlayMapping({
        trackInfo: { displaySurface: "monitor", width: 1280, height: 720 },
        monitors: MONITORS,
      }),
    ).toBe(null);
  });
});

describe("mapCursorToFrame", () => {
  it("translates virtual-desktop coords into frame pixels", () => {
    const mapping = { offsetX: 1920, offsetY: 0, scaleX: 1, scaleY: 1, monitorId: "m2" };
    expect(mapCursorToFrame({ x: 2000, y: 500 }, mapping, 1920, 1080)).toEqual({ x: 80, y: 500 });
    // Clamped inside the frame.
    expect(mapCursorToFrame({ x: 5000, y: -10 }, mapping, 1920, 1080)).toEqual({ x: 1920, y: 0 });
  });
});

describe("regionOverlayMapping", () => {
  const base = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, monitorId: "m1" };

  it("maps OS coords into the cropped region frame", () => {
    const m = regionOverlayMapping(base, { x: 100, y: 50, w: 800, h: 600 }, 800, 600);
    expect(m).not.toBe(null);
    expect(mapCursorToFrame({ x: 500, y: 350 }, m, 800, 600)).toEqual({ x: 400, y: 300 });
  });

  it("scales when the frame size differs from the region", () => {
    const m = regionOverlayMapping(base, { x: 0, y: 0, w: 1920, h: 1080 }, 960, 540);
    expect(mapCursorToFrame({ x: 1920, y: 1080 }, m, 960, 540)).toEqual({ x: 960, y: 540 });
  });

  it("returns null without a base mapping or a bad region", () => {
    expect(regionOverlayMapping(null, { x: 0, y: 0, w: 100, h: 100 }, 100, 100)).toBe(null);
    expect(regionOverlayMapping(base, { x: 0, y: 0, w: 0, h: 100 }, 100, 100)).toBe(null);
    expect(regionOverlayMapping(base, null, 100, 100)).toBe(null);
  });
});

describe("cursorOverlayGeometry", () => {
  it("draws a highlight ring at the cursor", () => {
    const g = cursorOverlayGeometry({ frameW: 1920, frameH: 1080, x: 100, y: 200, mode: "highlight" });
    expect(g.kind).toBe("ring");
    expect(g.cx).toBe(100);
    expect(g.cy).toBe(200);
    expect(g.r).toBeGreaterThan(0);
  });

  it("builds a spotlight circle", () => {
    const g = cursorOverlayGeometry({ frameW: 1920, frameH: 1080, x: 100, y: 200, mode: "spotlight" });
    expect(g.kind).toBe("spotlight");
    expect(g.r).toBeGreaterThan(0);
  });

  it("keeps the magnifier inset inside the frame", () => {
    const g = cursorOverlayGeometry({ frameW: 1920, frameH: 1080, x: 1900, y: 1060, mode: "magnifier" });
    expect(g.kind).toBe("magnifier");
    expect(g.src.x + g.src.w).toBeLessThanOrEqual(1920);
    expect(g.src.y + g.src.h).toBeLessThanOrEqual(1080);
    expect(g.dest.x + g.dest.w).toBeLessThanOrEqual(1920);
    expect(g.dest.y).toBeGreaterThanOrEqual(0);
  });

  it("clamps the cursor into the frame and rejects bad modes", () => {
    const g = cursorOverlayGeometry({ frameW: 800, frameH: 600, x: -50, y: 9999, mode: "highlight" });
    expect(g.cx).toBe(0);
    expect(g.cy).toBe(600);
    expect(() => cursorOverlayGeometry({ frameW: 800, frameH: 600, x: 1, y: 1, mode: "laser" })).toThrow(
      RecordingError,
    );
  });
});
