import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  createProjectFromSource,
  decodeSourceImage,
  fileSource,
  sniffImageMime,
} from "../hosts.js";
import { SourceRejectedError } from "../limits.js";

const PNG_MAGIC = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP_MAGIC = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const GIF_MAGIC = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);

// Fake host capabilities: the "decoder" pretends the bytes decode to a solid
// image of the configured size; the "re-encoder" returns fresh bytes that
// differ from the input (proving the original bytes are never retained).
function fakeCapabilities({ width = 64, height = 64, mime = "image/png", reencodeBytes = null, decodeError = null } = {}) {
  return {
    decode: async (bytes, declaredMime) => {
      if (decodeError) throw decodeError;
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error("empty input");
      return { image: { fake: true, declaredMime }, width, height, mime };
    },
    reencode: async ({ image, mime: targetMime, width: w, height: h }) => {
      if (!image || !image.fake) throw new Error("not a decoded image");
      return { bytes: reencodeBytes ?? new Uint8Array([9, 9, 9, 9]), mime: targetMime, width: w, height: h };
    },
  };
}

describe("sniffImageMime", () => {
  it("recognizes PNG, JPEG, and WebP magic bytes", () => {
    expect(sniffImageMime(PNG_MAGIC)).toBe("image/png");
    expect(sniffImageMime(JPEG_MAGIC)).toBe("image/jpeg");
    expect(sniffImageMime(WEBP_MAGIC)).toBe("image/webp");
  });

  it("does not sniff GIF or unknown bytes as supported", () => {
    expect(sniffImageMime(GIF_MAGIC)).toBe("");
    expect(sniffImageMime(new Uint8Array([1, 2, 3]))).toBe("");
    expect(sniffImageMime(new Uint8Array(0))).toBe("");
  });
});

describe("base64 helpers", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 137, 80]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("rejects invalid input", () => {
    expect(() => bytesToBase64("!!!")).toThrow(SourceRejectedError);
    expect(() => bytesToBase64("abc")).toThrow(SourceRejectedError); // length % 4
    expect(() => base64ToBytes("")).toThrow(SourceRejectedError);
  });
});

describe("fileSource", () => {
  it("loads bytes, mime, and name from a File-like", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const source = fileSource({
      name: "shot.png",
      type: "image/png",
      arrayBuffer: async () => bytes.buffer,
    });
    expect(source.kind).toBe("file");
    expect(source.label).toBe("shot.png");
    const loaded = await source.load();
    expect(loaded.bytes).toEqual(bytes);
    expect(loaded.mime).toBe("image/png");
  });

  it("rejects non-File input", () => {
    expect(() => fileSource(null)).toThrow(SourceRejectedError);
    expect(() => fileSource({})).toThrow(SourceRejectedError);
  });
});

describe("decodeSourceImage", () => {
  it.each([
    ["image/png", PNG_MAGIC],
    ["image/jpeg", JPEG_MAGIC],
    ["image/webp", WEBP_MAGIC],
  ])("accepts %s and re-encodes (never retaining the original bytes)", async (mime, magic) => {
    const original = new Uint8Array([...magic, 0xde, 0xad, 0xbe, 0xef]); // canary = fake metadata
    const reencoded = new Uint8Array([7, 7, 7, 7]);
    const out = await decodeSourceImage(
      { bytes: original, mime },
      fakeCapabilities({ mime, reencodeBytes: reencoded }),
    );
    expect(out.mime).toBe(mime);
    expect(out.width).toBe(64);
    expect(out.height).toBe(64);
    expect(out.bytes).toBe(reencoded); // the fresh bytes, not the original
    expect(out.bytes).not.toContain(0xde); // metadata canary is gone
    expect(out.image).toBeDefined(); // host keeps the decoded drawable
  });

  it("rejects SVG, GIF, and anything outside the supported list", async () => {
    const caps = fakeCapabilities();
    await expect(decodeSourceImage({ bytes: new Uint8Array([1, 2, 3]), mime: "image/svg+xml" }, caps))
      .rejects.toMatchObject({ name: "SourceRejectedError", reason: "svg-not-supported" });
    await expect(decodeSourceImage({ bytes: GIF_MAGIC, mime: "image/gif" }, caps))
      .rejects.toMatchObject({ name: "SourceRejectedError", reason: "animated-not-supported" });
    await expect(decodeSourceImage({ bytes: new Uint8Array([1, 2, 3]), mime: "image/bmp" }, caps))
      .rejects.toMatchObject({ name: "SourceRejectedError", reason: "unsupported-mime" });
    await expect(decodeSourceImage({ bytes: new Uint8Array([1, 2, 3]), mime: "" }, caps))
      .rejects.toThrow(SourceRejectedError);
  });

  it("rejects empty input", async () => {
    await expect(decodeSourceImage({ bytes: new Uint8Array(0), mime: "image/png" }, fakeCapabilities()))
      .rejects.toMatchObject({ reason: "empty-source" });
  });

  it("wraps decoder failures as decode-failed", async () => {
    const caps = fakeCapabilities({ decodeError: new Error("corrupt file") });
    await expect(decodeSourceImage({ bytes: PNG_MAGIC, mime: "image/png" }, caps))
      .rejects.toMatchObject({ reason: "decode-failed" });
    const noImage = { decode: async () => ({}), reencode: async () => ({}) };
    await expect(decodeSourceImage({ bytes: PNG_MAGIC, mime: "image/png" }, noImage))
      .rejects.toMatchObject({ reason: "decode-failed" });
  });

  it("rejects declared-vs-actual MIME mismatch", async () => {
    const caps = fakeCapabilities({ mime: "image/jpeg" }); // decoder says JPEG…
    await expect(decodeSourceImage({ bytes: JPEG_MAGIC, mime: "image/png" }, caps)) // …declared PNG
      .rejects.toMatchObject({ reason: "mime-mismatch" });
  });

  it("rejects a decoder-sniffed unsupported MIME", async () => {
    const caps = fakeCapabilities({ mime: "image/gif" });
    await expect(decodeSourceImage({ bytes: GIF_MAGIC, mime: "image/gif" }, caps))
      .rejects.toThrow(SourceRejectedError);
  });

  it("rejects declared-vs-actual dimension mismatch", async () => {
    const caps = fakeCapabilities({ width: 64, height: 64 });
    await expect(
      decodeSourceImage({ bytes: PNG_MAGIC, mime: "image/png", declaredWidth: 32, declaredHeight: 64 }, caps),
    ).rejects.toMatchObject({ reason: "dimension-mismatch" });
    await expect(
      decodeSourceImage({ bytes: PNG_MAGIC, mime: "image/png", declaredWidth: 64, declaredHeight: 48 }, caps),
    ).rejects.toMatchObject({ reason: "dimension-mismatch" });
    // Matching declarations pass.
    const out = await decodeSourceImage(
      { bytes: PNG_MAGIC, mime: "image/png", declaredWidth: 64, declaredHeight: 64 }, caps,
    );
    expect(out.width).toBe(64);
  });

  it("enforces the 16384px-per-side limit", async () => {
    await expect(
      decodeSourceImage({ bytes: PNG_MAGIC, mime: "image/png" }, fakeCapabilities({ width: 16385, height: 10 })),
    ).rejects.toMatchObject({ reason: "dimensions-exceed-limit" });
    await expect(
      decodeSourceImage({ bytes: PNG_MAGIC, mime: "image/png" }, fakeCapabilities({ width: 10, height: 16385 })),
    ).rejects.toMatchObject({ reason: "dimensions-exceed-limit" });
  });

  it("enforces the 128MB decoded-memory limit at the exact boundary", async () => {
    // 8192 x 4096 x 4 = 134,217,728 = exactly 128 MiB: allowed.
    const ok = await decodeSourceImage(
      { bytes: PNG_MAGIC, mime: "image/png" },
      fakeCapabilities({ width: 8192, height: 4096 }),
    );
    expect(ok.width).toBe(8192);
    // One row more: rejected.
    await expect(
      decodeSourceImage({ bytes: PNG_MAGIC, mime: "image/png" }, fakeCapabilities({ width: 8192, height: 4097 })),
    ).rejects.toMatchObject({ reason: "decoded-memory-exceeds-limit" });
  });

  it("wraps re-encode failures", async () => {
    const failing = {
      decode: async () => ({ image: { fake: true }, width: 64, height: 64, mime: "image/png" }),
      reencode: async () => { throw new Error("canvas exploded"); },
    };
    await expect(decodeSourceImage({ bytes: PNG_MAGIC, mime: "image/png" }, failing))
      .rejects.toMatchObject({ reason: "reencode-failed" });
    const empty = {
      decode: async () => ({ image: { fake: true }, width: 64, height: 64, mime: "image/png" }),
      reencode: async () => ({ bytes: new Uint8Array(0), mime: "image/png", width: 64, height: 64 }),
    };
    await expect(decodeSourceImage({ bytes: PNG_MAGIC, mime: "image/png" }, empty))
      .rejects.toMatchObject({ reason: "reencode-failed" });
  });

  it("requires decode and reencode capabilities", async () => {
    await expect(decodeSourceImage({ bytes: PNG_MAGIC, mime: "image/png" }, {})).rejects.toThrow(SourceRejectedError);
    await expect(
      decodeSourceImage({ bytes: PNG_MAGIC, mime: "image/png" }, { decode: async () => ({}) }),
    ).rejects.toThrow(SourceRejectedError);
  });
});

describe("createProjectFromSource", () => {
  it("embeds the re-encoded bytes as base64, never the original", async () => {
    const reencoded = new Uint8Array([7, 7, 7]);
    const decoded = await decodeSourceImage(
      { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), mime: "image/png" },
      fakeCapabilities({ mime: "image/png", reencodeBytes: reencoded }),
    );
    const doc = createProjectFromSource(decoded, { id: "proj-1" });
    expect(doc.canvas).toEqual({ width: 64, height: 64 });
    expect(doc.source.kind).toBe("embedded");
    expect(doc.source.mime).toBe("image/png");
    expect(base64ToBytes(doc.source.bytes)).toEqual(reencoded);
  });

  it("rejects invalid decoded input", () => {
    expect(() => createProjectFromSource(null, { id: "x" })).toThrow(SourceRejectedError);
    expect(() => createProjectFromSource({ bytes: "nope", mime: "image/png", width: 1, height: 1 }, { id: "x" }))
      .toThrow(SourceRejectedError);
  });
});
