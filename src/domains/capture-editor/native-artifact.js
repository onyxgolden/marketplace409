// FORGE Capture — Rung 2 native artifact bridge (Rung 2a).
//
// Parses the `forge-capture-artifact` sidecar the native shell writes next to
// every capture PNG and feeds the raster bytes through the Rung 1 editor's
// existing import path (`decodeSourceImage` / `createProjectFromSource`).
//
// Framework-neutral: no DOM, no Tauri APIs here. The caller supplies the
// sidecar JSON string, the raster bytes (read from the sibling PNG file), and
// the host image capabilities (`browserImageCapabilities()` in a browser,
// the editor's native host capabilities elsewhere).
//
// The sidecar is provenance, never trust: declared dimensions are passed to
// decodeSourceImage as declaredWidth/declaredHeight so the decoder's
// dimension-mismatch check still fires, and the CRC32 over the raster bytes
// is verified before any decode is attempted.

import { SourceRejectedError } from "./limits.js";
import {
  MAX_DECODED_BYTES,
  MAX_SOURCE_DIMENSION,
  SUPPORTED_SOURCE_MIME_TYPES,
} from "./limits.js";
import { createProjectFromSource, decodeSourceImage } from "./hosts.js";

export const NATIVE_ARTIFACT_KIND = "forge-capture-artifact";
export const NATIVE_ARTIFACT_SCHEMA_VERSION = 1;

const NATIVE_CAPTURE_KINDS = Object.freeze([
  "full-monitor",
  "window",
  "region",
  // Rung 2b: scrolling captures. The optional `scroll` provenance section
  // is tolerated but never required.
  "scrolling",
]);

export class NativeArtifactError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.name = "NativeArtifactError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new NativeArtifactError(code, message);
}

// --- CRC32 (IEEE, same polynomial as the Rust core's crc32) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32Ieee(bytes) {
  if (!(bytes instanceof Uint8Array)) fail("invalid-bytes", "crc32Ieee needs a Uint8Array");
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// --- sidecar parsing ---

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(obj, field) {
  if (typeof obj[field] !== "string" || obj[field].length === 0) {
    fail("corrupt-sidecar", `sidecar.${field} must be a non-empty string`);
  }
  return obj[field];
}

function requireUint(obj, field) {
  const v = obj[field];
  if (!Number.isInteger(v) || v < 0) {
    fail("corrupt-sidecar", `sidecar.${field} must be a non-negative integer`);
  }
  return v;
}

// Parse + validate the sidecar envelope. Rejects unknown/newer schema
// versions, wrong kind discriminators, unsupported MIME types, and
// dimensions outside the Rung 1 editor limits — corrupt envelopes are never
// partially applied.
export function parseNativeSidecar(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    fail("corrupt-sidecar", `sidecar is not valid JSON: ${e.message}`);
  }
  if (!isPlainObject(raw)) fail("corrupt-sidecar", "sidecar must be a JSON object");

  const version = raw.schemaVersion;
  if (!Number.isInteger(version) || version < 1) {
    fail("corrupt-sidecar", "sidecar.schemaVersion must be a positive integer");
  }
  if (version > NATIVE_ARTIFACT_SCHEMA_VERSION) {
    fail("unsupported-version", `sidecar schemaVersion ${version} is newer than supported ${NATIVE_ARTIFACT_SCHEMA_VERSION}`);
  }
  if (raw.kind !== NATIVE_ARTIFACT_KIND) {
    fail("corrupt-sidecar", `sidecar.kind must be "${NATIVE_ARTIFACT_KIND}"`);
  }
  if (!NATIVE_CAPTURE_KINDS.includes(raw.captureKind)) {
    fail("corrupt-sidecar", `sidecar.captureKind "${raw.captureKind}" is not a known capture kind`);
  }

  const raster = raw.raster;
  if (!isPlainObject(raster)) fail("corrupt-sidecar", "sidecar.raster must be an object");
  const mime = raster.mime;
  if (!SUPPORTED_SOURCE_MIME_TYPES.includes(mime)) {
    fail("unsupported-mime", `sidecar raster mime "${mime}" is not importable by the editor`);
  }
  const width = raster.width;
  const height = raster.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    fail("corrupt-sidecar", "sidecar.raster.width/height must be positive integers");
  }
  if (width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION) {
    fail("dimension-too-large", `sidecar raster ${width}x${height} exceeds the editor's ${MAX_SOURCE_DIMENSION}px limit`);
  }
  if (width * height * 4 > MAX_DECODED_BYTES) {
    fail("decoded-too-large", `sidecar raster ${width}x${height} exceeds the editor's 128 MiB decoded limit`);
  }

  const byteLength = raster.byteLength;
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    fail("corrupt-sidecar", "sidecar.raster.byteLength must be a positive integer");
  }
  const crc = raster.crc32;
  if (!Number.isInteger(crc) || crc < 0 || crc > 0xffffffff) {
    fail("corrupt-sidecar", "sidecar.raster.crc32 must be a uint32");
  }

  return {
    schemaVersion: version,
    kind: raw.kind,
    id: requireString(raw, "id"),
    captureKind: raw.captureKind,
    raster: { mime, width, height, byteLength, crc32: crc >>> 0 },
    // Provenance the editor surfaces (not used for decode): monitor and
    // window identity stay optional so older/future shells keep importing.
    monitor: isPlainObject(raw.monitor) ? raw.monitor : null,
    window: isPlainObject(raw.window) ? raw.window : null,
    scale: typeof raw.scale === "number" && raw.scale > 0 ? raw.scale : 1,
    cursorCaptured: !!(raw.cursor && raw.cursor.captured === true),
    capturedAt: typeof raw.capturedAt === "string" ? raw.capturedAt : null,
    delayMs: Number.isInteger(raw.delayMs) && raw.delayMs >= 0 ? raw.delayMs : 0,
    // Rung 2b scrolling provenance (engine, direction, tiles, completeness).
    // Optional: older shells never wrote it, and the editor only surfaces it.
    scroll: isPlainObject(raw.scroll) ? raw.scroll : null,
  };
}

// Verify the raster bytes against the sidecar (length + CRC32) before any
// decode is attempted. Throws NativeArtifactError on mismatch.
export function verifyNativeArtifact(sidecar, rasterBytes) {
  if (!(rasterBytes instanceof Uint8Array) || rasterBytes.length === 0) {
    fail("invalid-bytes", "raster bytes must be a non-empty Uint8Array");
  }
  if (rasterBytes.length !== sidecar.raster.byteLength) {
    fail(
      "byte-length-mismatch",
      `raster is ${rasterBytes.length} bytes but sidecar declares ${sidecar.raster.byteLength}`,
    );
  }
  const actual = crc32Ieee(rasterBytes);
  if (actual !== sidecar.raster.crc32) {
    fail(
      "crc-mismatch",
      `raster CRC32 ${actual.toString(16)} does not match sidecar ${sidecar.raster.crc32.toString(16)}`,
    );
  }
  return true;
}

// Full import: parse sidecar, verify bytes, then run the editor's standard
// import path. Declared dimensions come from the sidecar so the editor's
// dimension-mismatch check still guards against lying sidecars.
export async function importNativeCapture({ sidecarJson, rasterBytes } = {}, capabilities = {}) {
  if (typeof sidecarJson !== "string" || sidecarJson.length === 0) {
    fail("invalid-sidecar", "importNativeCapture requires { sidecarJson, rasterBytes }");
  }
  const sidecar = parseNativeSidecar(sidecarJson);
  verifyNativeArtifact(sidecar, rasterBytes);
  let decoded;
  try {
    decoded = await decodeSourceImage(
      {
        bytes: rasterBytes,
        mime: sidecar.raster.mime,
        declaredWidth: sidecar.raster.width,
        declaredHeight: sidecar.raster.height,
      },
      capabilities,
    );
  } catch (e) {
    if (e instanceof SourceRejectedError) throw e;
    throw new NativeArtifactError("decode-failed", e?.message ?? String(e));
  }
  return { sidecar, decoded };
}

// Import + wrap in a new editor document (source embedded, re-encoded bytes).
export async function createProjectFromNativeCapture(input, options = {}) {
  const { sidecar, decoded } = await importNativeCapture(input, options.capabilities ?? {});
  const document = createProjectFromSource(decoded, { id: options.id, idGenerator: options.idGenerator });
  return { sidecar, decoded, document };
}
