// FORGE Capture editor — host boundary (hosts.js).
// The framework-neutral core never calls these directly; the browser host
// wires them in. This module owns everything that touches the outside world:
// acquiring source bytes (CaptureSource), decoding + re-encoding images, and
// the localStorage adapter.
//
// Import safety is enforced here, not trusted from the caller:
//   - PNG/JPEG/WebP only. SVG (scriptable) and GIF (animated) are rejected,
//     as is anything else outside the supported list.
//   - Actual dimensions come from the decoder, never from caller claims; a
//     declared-vs-actual mismatch rejects the import.
//   - 16384 px per side and 128 MB decoded RGBA are hard caps.
//   - The decoded image is RE-ENCODED before a project is created. The
//     original imported file bytes are never retained and never embedded —
//     re-encoding is also what strips metadata (EXIF and friends) that a
//     straight byte-copy would preserve.

import {
  SourceRejectedError,
  assertDecodedSize,
  assertSourceDimensions,
  assertSourceMime,
} from "./limits.js";
import { createDocument } from "./document.js";
import { StorageError } from "./storage.js";

/**
 * CaptureSource — host-neutral contract for acquiring source-image bytes.
 *
 * {
 *   kind: "file" | "clipboard" | "display-media",
 *   label: string,                       // human-readable, for error messages
 *   load(): Promise<{                    // resolves to the RAW imported bytes
 *     bytes: Uint8Array,
 *     mime: string,                      // declared MIME (verified by sniffing)
 *     name?: string,
 *   }>,
 * }
 *
 * The returned bytes are the untrusted originals: decodeSourceImage() must
 * process them (decode, validate, re-encode) before anything reaches a
 * document. Nothing here retains them afterwards.
 */

export function fileSource(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new SourceRejectedError("invalid-source", "fileSource requires a File/Blob-like object");
  }
  return {
    kind: "file",
    label: typeof file.name === "string" && file.name.length > 0 ? file.name : "file",
    async load() {
      const buffer = await file.arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        mime: typeof file.type === "string" ? file.type : "",
        name: typeof file.name === "string" ? file.name : undefined,
      };
    },
  };
}

// Magic-byte sniffing: PNG 89 50 4E 47 0D 0A 1A 0A, JPEG FF D8 FF,
// WebP RIFF....WEBP. Anything else sniffs as "" (unsupported).
export function sniffImageMime(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return "";
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "";
}

// Inverse of bytesToBase64: strict base64 -> Uint8Array. Used to re-decode
// embedded project bytes (recovery, renderer bitmap) without trusting them.
export function base64ToBytes(base64) {
  if (typeof base64 !== "string" || base64.length === 0 || base64.length % 4 !== 0) {
    throw new SourceRejectedError("invalid-source", "expected base64-encoded bytes");
  }
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  if (typeof atob === "function") {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  throw new SourceRejectedError("invalid-source", "no base64 decoder available in this host");
}

export function bytesToBase64(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new SourceRejectedError("invalid-source", "bytes must be a Uint8Array");
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  if (typeof btoa === "function") {
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  throw new SourceRejectedError("invalid-source", "no base64 encoder available in this host");
}

// capabilities:
//   decode(bytes, mime) -> Promise<{ image, width, height, mime? }>
//     image: drawable by ctx.drawImage AND re-encodable by reencode.
//     width/height: ACTUAL decoded dimensions. mime: decoder-sniffed actual
//     MIME (defaults to the declared mime when the decoder cannot sniff).
//   reencode({ image, mime, width, height, quality }) ->
//     Promise<{ bytes, mime, width, height }>
//
// Resolves to { bytes, mime, width, height, image } where bytes are the FRESH
// re-encoded image — safe to embed in a project — and image is the decoded
// drawable the host keeps for rendering/export. The input bytes are dropped
// on the floor. Throws SourceRejectedError on every rejection path.
export async function decodeSourceImage({ bytes, mime, declaredWidth, declaredHeight } = {}, capabilities = {}) {
  assertSourceMime(mime);
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new SourceRejectedError("empty-source", "source has no bytes");
  }
  const decode = capabilities.decode;
  const reencode = capabilities.reencode;
  if (typeof decode !== "function") throw new SourceRejectedError("invalid-source", "decode capability is required");
  if (typeof reencode !== "function") throw new SourceRejectedError("invalid-source", "reencode capability is required");

  let decoded;
  try {
    decoded = await decode(bytes, mime);
  } catch (e) {
    if (e instanceof SourceRejectedError) throw e;
    throw new SourceRejectedError("decode-failed", e?.message ?? String(e));
  }
  if (!decoded || !decoded.image) throw new SourceRejectedError("decode-failed", "decoder returned no image");
  const actualWidth = decoded.width;
  const actualHeight = decoded.height;
  const actualMime = decoded.mime ?? mime;

  // The decoder is the authority on what the bytes really are.
  assertSourceMime(actualMime);
  if (actualMime !== mime) {
    throw new SourceRejectedError("mime-mismatch", `declared ${mime} but decoded ${actualMime}`);
  }
  assertSourceDimensions(actualWidth, actualHeight);
  assertDecodedSize(actualWidth, actualHeight);
  if (declaredWidth !== undefined && declaredWidth !== actualWidth) {
    throw new SourceRejectedError("dimension-mismatch", `declared width ${declaredWidth} but decoded ${actualWidth}`);
  }
  if (declaredHeight !== undefined && declaredHeight !== actualHeight) {
    throw new SourceRejectedError("dimension-mismatch", `declared height ${declaredHeight} but decoded ${actualHeight}`);
  }

  // Re-encode through a canvas: this is the metadata strip (EXIF and friends
  // do not survive a decode/re-encode round trip) and the guarantee that the
  // original file bytes never reach the project.
  let reencoded;
  try {
    reencoded = await reencode({ image: decoded.image, mime: actualMime, width: actualWidth, height: actualHeight });
  } catch (e) {
    if (e instanceof SourceRejectedError) throw e;
    throw new SourceRejectedError("reencode-failed", e?.message ?? String(e));
  }
  if (!reencoded || !(reencoded.bytes instanceof Uint8Array) || reencoded.bytes.length === 0) {
    throw new SourceRejectedError("reencode-failed", "re-encoder returned no bytes");
  }
  return {
    bytes: reencoded.bytes,
    mime: reencoded.mime ?? actualMime,
    width: reencoded.width ?? actualWidth,
    height: reencoded.height ?? actualHeight,
    // The host keeps the decoded drawable for rendering and export; it is the
    // same image that was re-encoded, so pixels always match the project.
    image: decoded.image,
  };
}

// Builds a document whose source embeds the RE-ENCODED bytes. Callers must
// pass the output of decodeSourceImage(), never raw import bytes.
export function createProjectFromSource(decoded, { id, idGenerator } = {}) {
  if (!decoded || !(decoded.bytes instanceof Uint8Array)) {
    throw new SourceRejectedError("invalid-source", "createProjectFromSource requires decoded { bytes, mime, width, height }");
  }
  const docId = id ?? (typeof idGenerator === "function" ? idGenerator() : undefined);
  return createDocument({
    id: docId,
    width: decoded.width,
    height: decoded.height,
    source: {
      kind: "embedded",
      mime: decoded.mime,
      bytes: bytesToBase64(decoded.bytes),
    },
  });
}

// --- browser capabilities (lazy: this module loads without a DOM) ---

function requireBrowserWindow() {
  const g = globalThis;
  if (!g || typeof g.document === "undefined" || typeof g.createImageBitmap !== "function") {
    throw new SourceRejectedError("invalid-source", "browser image capabilities require a DOM with createImageBitmap");
  }
  return g;
}

function browserCreateCanvas(width, height) {
  const g = requireBrowserWindow();
  const canvas = g.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// Browser decode/re-encode/createCanvas triple. decode() sniffs magic bytes
// itself so a mislabeled file (declared image/png, actually a GIF) is caught
// as a mime-mismatch rather than trusted.
export function browserImageCapabilities() {
  return {
    createCanvas: browserCreateCanvas,
    async decode(bytes, mime) {
      requireBrowserWindow();
      const actualMime = sniffImageMime(bytes);
      if (!actualMime) throw new SourceRejectedError("decode-failed", "unrecognized image bytes");
      if (actualMime !== mime) {
        throw new SourceRejectedError("mime-mismatch", `declared ${mime} but bytes sniff as ${actualMime}`);
      }
      const g = globalThis;
      let bitmap;
      try {
        bitmap = await g.createImageBitmap(new Blob([bytes], { type: actualMime }));
      } catch (e) {
        throw new SourceRejectedError("decode-failed", e?.message ?? String(e));
      }
      if (!bitmap || !Number.isInteger(bitmap.width) || !Number.isInteger(bitmap.height)) {
        throw new SourceRejectedError("decode-failed", "decoder returned invalid dimensions");
      }
      return { image: bitmap, width: bitmap.width, height: bitmap.height, mime: actualMime };
    },
    async reencode({ image, mime, width, height, quality }) {
      const canvas = browserCreateCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new SourceRejectedError("reencode-failed", "2d context unavailable");
      ctx.drawImage(image, 0, 0, width, height);
      const blob = await new Promise((resolve) => {
        canvas.toBlob(
          (result) => resolve(result),
          mime,
          mime === "image/jpeg" || mime === "image/webp" ? (quality ?? 0.92) : undefined,
        );
      });
      if (!blob) throw new SourceRejectedError("reencode-failed", "toBlob returned null");
      const buffer = new Uint8Array(await blob.arrayBuffer());
      return { bytes: buffer, mime: blob.type || mime, width, height };
    },
  };
}

// localStorage-backed storage adapter. Every access is guarded: private-mode
// quota errors and missing localStorage surface as StorageError, never raw
// DOMExceptions.
export function browserStorageAdapter({ storage } = {}) {
  function backend() {
    const candidate = storage ?? globalThis.localStorage;
    if (!candidate || typeof candidate.getItem !== "function") {
      throw new StorageError("localStorage is unavailable in this host");
    }
    return candidate;
  }
  const guard = (op, fn) => {
    try {
      return fn(backend());
    } catch (e) {
      if (e instanceof StorageError) throw e;
      throw new StorageError(`localStorage ${op} failed: ${e?.message ?? e}`);
    }
  };
  return {
    getItem: (key) => guard("read", (s) => s.getItem(key)),
    setItem: (key, value) => guard("write", (s) => { s.setItem(key, String(value)); }),
    removeItem: (key) => guard("remove", (s) => { s.removeItem(key); }),
    keys: () => guard("list", (s) => {
      const out = [];
      for (let i = 0; i < s.length; i += 1) {
        const key = s.key(i);
        if (typeof key === "string") out.push(key);
      }
      return out;
    }),
  };
}
