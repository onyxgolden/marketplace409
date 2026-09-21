import { describe, expect, it } from "vitest";
import {
  NATIVE_ARTIFACT_KIND,
  NATIVE_ARTIFACT_SCHEMA_VERSION,
  NativeArtifactError,
  crc32Ieee,
  createProjectFromNativeCapture,
  importNativeCapture,
  parseNativeSidecar,
  verifyNativeArtifact,
} from "../native-artifact.js";

function makeSidecar(overrides = {}) {
  const rasterBytes = overrides.rasterBytes ?? new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  const sidecar = {
    schemaVersion: 1,
    kind: NATIVE_ARTIFACT_KIND,
    id: "test-artifact-1",
    captureKind: "full-monitor",
    raster: {
      mime: "image/png",
      width: 64,
      height: 48,
      byteLength: rasterBytes.length,
      crc32: crc32Ieee(rasterBytes),
    },
    monitor: { id: 1, name: "Test", scale: 1 },
    window: null,
    scale: 1,
    cursor: { captured: false, position_physical: null },
    capturedAt: "2026-09-21T12:00:00.000Z",
    delayMs: 0,
    ...overrides.sidecar,
  };
  return { sidecarJson: JSON.stringify(sidecar), rasterBytes, sidecar };
}

function fakeCapabilities({ width = 64, height = 48, mime = "image/png" } = {}) {
  return {
    decode: async (bytes) => {
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error("empty input");
      return { image: { fake: true }, width, height, mime };
    },
    reencode: async ({ image, mime: targetMime, width: w, height: h }) => {
      if (!image || !image.fake) throw new Error("not a decoded image");
      return { bytes: new Uint8Array([9, 9, 9]), mime: targetMime, width: w, height: h };
    },
  };
}

describe("crc32Ieee", () => {
  it("matches the standard check vector", () => {
    // "123456789" -> 0xCBF43926 is the canonical CRC-32 check value.
    const bytes = new Uint8Array([49, 50, 51, 52, 53, 54, 55, 56, 57]);
    expect(crc32Ieee(bytes)).toBe(0xcbf43926);
  });

  it("detects a single flipped bit", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(crc32Ieee(a)).not.toBe(crc32Ieee(b));
  });

  it("matches the Rust core on the cross-language fixture vector", () => {
    // Fixed vector bytes 0x00..0x0F; forge-capture-core asserts the same
    // value in its artifact tests (crc32_cross_language_fixture). Both
    // sides implement IEEE 0xEDB88320 — if either polynomial ever changes,
    // both tests fail together.
    const v = Uint8Array.from({ length: 16 }, (_, i) => i);
    expect(crc32Ieee(v)).toBe(0xcecee288);
  });
});

describe("parseNativeSidecar", () => {
  it("parses a valid sidecar and keeps provenance", () => {
    const { sidecarJson } = makeSidecar();
    const parsed = parseNativeSidecar(sidecarJson);
    expect(parsed.schemaVersion).toBe(NATIVE_ARTIFACT_SCHEMA_VERSION);
    expect(parsed.id).toBe("test-artifact-1");
    expect(parsed.captureKind).toBe("full-monitor");
    expect(parsed.raster).toEqual({ mime: "image/png", width: 64, height: 48, byteLength: 8, crc32: expect.any(Number) });
    expect(parsed.monitor).toEqual({ id: 1, name: "Test", scale: 1 });
    expect(parsed.cursorCaptured).toBe(false);
  });

  it("accepts all native capture kinds", () => {
    for (const captureKind of ["full-monitor", "window", "region", "scrolling"]) {
      const { sidecarJson } = makeSidecar({ sidecar: { captureKind } });
      expect(parseNativeSidecar(sidecarJson).captureKind).toBe(captureKind);
    }
  });

  it("tolerates the optional scrolling provenance section", () => {
    const scroll = {
      engine: "dom-aware",
      direction: "vertical",
      tilesCaptured: 7,
      distancePx: 540,
      complete: true,
      reason: null,
    };
    const { sidecarJson } = makeSidecar({
      sidecar: { captureKind: "scrolling", scroll },
    });
    expect(parseNativeSidecar(sidecarJson).scroll).toEqual(scroll);
  });

  it("treats a missing scrolling provenance section as null", () => {
    const { sidecarJson } = makeSidecar({ sidecar: { captureKind: "scrolling" } });
    expect(parseNativeSidecar(sidecarJson).scroll).toBeNull();
  });

  it("keeps delay as metadata, not a capture kind", () => {
    // A delayed full-monitor capture is still a full-monitor capture: the
    // shell records the delay in delayMs, never as a distinct kind.
    const { sidecarJson } = makeSidecar({ sidecar: { captureKind: "full-monitor", delayMs: 3000 } });
    const parsed = parseNativeSidecar(sidecarJson);
    expect(parsed.captureKind).toBe("full-monitor");
    expect(parsed.delayMs).toBe(3000);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseNativeSidecar("{nope")).toThrowError(NativeArtifactError);
    expect(() => parseNativeSidecar("[1,2]")).toThrowError(/corrupt-sidecar/);
  });

  it("rejects newer schema versions", () => {
    const { sidecarJson } = makeSidecar({ sidecar: { schemaVersion: 999 } });
    expect(() => parseNativeSidecar(sidecarJson)).toThrowError(/unsupported-version/);
  });

  it("rejects a wrong kind discriminator", () => {
    const { sidecarJson } = makeSidecar({ sidecar: { kind: "something-else" } });
    expect(() => parseNativeSidecar(sidecarJson)).toThrowError(/corrupt-sidecar/);
  });

  it("rejects unknown capture kinds", () => {
    const { sidecarJson } = makeSidecar({ sidecar: { captureKind: "scroll-everything" } });
    expect(() => parseNativeSidecar(sidecarJson)).toThrowError(/corrupt-sidecar/);
  });

  it("rejects raster mimes the editor cannot import", () => {
    const { sidecarJson } = makeSidecar();
    const raw = JSON.parse(sidecarJson);
    raw.raster.mime = "image/gif";
    expect(() => parseNativeSidecar(JSON.stringify(raw))).toThrowError(/unsupported-mime/);
  });

  it("rejects dimensions outside editor limits", () => {
    const { sidecarJson } = makeSidecar();
    const raw = JSON.parse(sidecarJson);
    raw.raster.width = 20000;
    expect(() => parseNativeSidecar(JSON.stringify(raw))).toThrowError(/dimension-too-large/);
    raw.raster.width = 64;
    raw.raster.height = 70000;
    expect(() => parseNativeSidecar(JSON.stringify(raw))).toThrowError(/dimension-too-large/);
  });

  it("rejects rasters over the 128 MiB decoded cap", () => {
    const { sidecarJson } = makeSidecar();
    const raw = JSON.parse(sidecarJson);
    raw.raster.width = 8192;
    raw.raster.height = 8192; // 256 MiB RGBA
    expect(() => parseNativeSidecar(JSON.stringify(raw))).toThrowError(/decoded-too-large/);
  });
});

describe("verifyNativeArtifact", () => {
  it("accepts matching bytes", () => {
    const { sidecarJson, rasterBytes } = makeSidecar();
    expect(verifyNativeArtifact(parseNativeSidecar(sidecarJson), rasterBytes)).toBe(true);
  });

  it("rejects tampered bytes via CRC32", () => {
    const { sidecarJson, rasterBytes } = makeSidecar();
    const sidecar = parseNativeSidecar(sidecarJson);
    const tampered = new Uint8Array(rasterBytes);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => verifyNativeArtifact(sidecar, tampered)).toThrowError(/crc-mismatch/);
  });

  it("rejects length mismatches", () => {
    const { sidecarJson, rasterBytes } = makeSidecar();
    const sidecar = parseNativeSidecar(sidecarJson);
    expect(() => verifyNativeArtifact(sidecar, rasterBytes.slice(0, 4))).toThrowError(/byte-length-mismatch/);
  });
});

describe("importNativeCapture", () => {
  it("flows through decodeSourceImage with sidecar-declared dimensions", async () => {
    const { sidecarJson, rasterBytes } = makeSidecar();
    const { sidecar, decoded } = await importNativeCapture(
      { sidecarJson, rasterBytes },
      fakeCapabilities(),
    );
    expect(sidecar.id).toBe("test-artifact-1");
    expect(decoded.width).toBe(64);
    expect(decoded.height).toBe(48);
    // Re-encoded bytes prove the original raster bytes were not retained.
    expect(decoded.bytes).toEqual(new Uint8Array([9, 9, 9]));
  });

  it("rejects when the decoder disagrees about dimensions", async () => {
    const { sidecarJson, rasterBytes } = makeSidecar();
    await expect(
      importNativeCapture({ sidecarJson, rasterBytes }, fakeCapabilities({ width: 999 })),
    ).rejects.toThrow(/dimension-mismatch/);
  });

  it("rejects corrupt bytes before touching the decoder", async () => {
    const { sidecarJson, rasterBytes } = makeSidecar();
    const tampered = new Uint8Array(rasterBytes);
    tampered[0] ^= 0xff;
    let decoderCalled = false;
    const caps = fakeCapabilities();
    const origDecode = caps.decode;
    caps.decode = async (...args) => {
      decoderCalled = true;
      return origDecode(...args);
    };
    await expect(importNativeCapture({ sidecarJson, rasterBytes: tampered }, caps)).rejects.toThrow(
      /crc-mismatch/,
    );
    expect(decoderCalled).toBe(false);
  });
});

describe("createProjectFromNativeCapture", () => {
  it("builds an editor document with the re-encoded source", async () => {
    const { sidecarJson, rasterBytes } = makeSidecar();
    const { document, decoded, sidecar } = await createProjectFromNativeCapture(
      { sidecarJson, rasterBytes },
      { capabilities: fakeCapabilities(), id: "doc-1" },
    );
    expect(sidecar.id).toBe("test-artifact-1");
    expect(document.id).toBe("doc-1");
    expect(document.canvas.width).toBe(decoded.width);
    expect(document.canvas.height).toBe(decoded.height);
    expect(document.source.mime).toBe("image/png");
  });
});
