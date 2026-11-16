// FORGE Capture — PPTX bounded import (ui/pptx-import-core.js).
//
// DOM-free pure logic for the Create-video Slice 1 import path. Runs
// unmodified under vitest (node) and in the Tauri webview; the DOM/IPC
// wiring lives in pptx-create-video.js.
//
// The import is BOUNDED by construction, per the Slice 1 scope brief
// (§2.2 "PPTX safety limits"):
//   - the file is validated from its ZIP central directory BEFORE any
//     entry is expanded, so a declared ZIP bomb is refused without
//     allocating its expansion;
//   - every entry is then streamed through a capped inflater that
//     aborts past the per-entry cap, verifies the actual length against
//     the declared length, and verifies the CRC-32;
//   - XML parts are rejected when they contain DOCTYPE/ENTITY
//     declarations (no entity expansion, ever);
//   - nothing is ever written to disk by this module: it returns a
//     validated in-memory package (or throws PptxReject). Durable
//     storage is the Rust backend's job (pptx_video_* commands).
//
// No network is used anywhere in this module: no fetch, no XHR, no
// font lookup, no external URL is ever dereferenced. External
// relationships in a deck are recorded as warnings and ignored.
import { Inflate } from "./vendor/fflate.mjs";

// ---------------------------------------------------------------------------
// Caps (brief §2.2 "Initial caps to implement as constants")
// ---------------------------------------------------------------------------

export const PPTX_CAPS = Object.freeze({
  /** Maximum .pptx file size accepted (compressed bytes on disk). */
  maxInputBytes: 100 * 1024 * 1024,
  /** Maximum slides in one deck. */
  maxSlides: 100,
  /** Maximum total expanded ZIP bytes (declared, then verified). */
  maxExpandedBytes: 512 * 1024 * 1024,
  /** Maximum expanded bytes of any single ZIP entry. */
  maxEntryBytes: 64 * 1024 * 1024,
  /** Maximum decoded megapixels of any single embedded raster image. */
  maxImageMegapixels: 40,
  /** Maximum aggregate decoded megapixels of all embedded raster images. */
  maxAggregateImageMegapixels: 500,
  /** Maximum ZIP entries (sanity bound; a deck has hundreds at most). */
  maxEntries: 10000,
  /** Maximum bytes of any single XML part. */
  maxXmlBytes: 16 * 1024 * 1024,
  /** Maximum total bytes of XML/rels parts kept in memory. */
  maxKeptBytes: 64 * 1024 * 1024,
  /** Bytes kept per media part (header only — enough for dimensions). */
  mediaPrefixBytes: 64 * 1024,
  /** Wall-clock budget for the whole import (ms). */
  maxImportMillis: 60000,
});

// ---------------------------------------------------------------------------
// Rejection taxonomy: every refusal carries a stable machine code and a
// plain-words message the UI can show verbatim.
// ---------------------------------------------------------------------------

export const PPTX_REJECT_MESSAGES = Object.freeze({
  "not-a-zip": "This file is not a PowerPoint file.",
  "legacy-ppt": "This is an old .ppt file. Only modern .pptx files can be imported.",
  "too-large": "This file is larger than the 100 MB import limit.",
  "too-many-entries": "This file has too many parts inside it to import safely.",
  "entry-too-large": "One part inside this file is larger than the 64 MB limit.",
  "expanded-too-large": "This file expands to more than the 512 MB limit.",
  "path-traversal": "This file contains a part that tries to escape its folder. It was refused.",
  "duplicate-entry": "This file contains two parts with the same name. It was refused.",
  "unsupported-method": "This file uses a compression method Capture cannot read.",
  "unsupported-zip64": "This file uses ZIP64, which Capture does not support.",
  "encrypted-entry": "This file is encrypted. Encrypted presentations cannot be imported.",
  "malformed-zip": "This file is damaged and cannot be opened as a PowerPoint file.",
  "entity-expansion": "This file contains XML entity declarations, which are not allowed.",
  "missing-part": "This file is missing a part every PowerPoint file needs.",
  "bad-relationships": "This file has broken links between its slides.",
  "too-many-slides": "This deck has more than 100 slides.",
  "oversized-image": "One picture in this deck is larger than the 40 megapixel limit.",
  "too-many-image-pixels": "The pictures in this deck add up to more than 500 megapixels.",
  "unreadable-image": "One picture in this deck could not be read.",
  "import-timeout": "Import took too long and was stopped.",
  cancelled: "Import was cancelled.",
});

export class PptxReject extends Error {
  constructor(code, detail) {
    super(detail ? `${PPTX_REJECT_MESSAGES[code]} ${detail}` : PPTX_REJECT_MESSAGES[code]);
    this.name = "PptxReject";
    this.code = code;
  }
}

function reject(code, detail) {
  throw new PptxReject(code, detail);
}

// ---------------------------------------------------------------------------
// CRC-32 (IEEE, table-driven). fflate does not verify CRCs in streaming
// mode, so the bounded reader checks them itself.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes, previous = 0) {
  let c = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Little-endian readers over a Uint8Array.
// ---------------------------------------------------------------------------

function u16(bytes, off) {
  return bytes[off] | (bytes[off + 1] << 8);
}

function u32(bytes, off) {
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
}

// ---------------------------------------------------------------------------
// ZIP central directory
// ---------------------------------------------------------------------------

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

/**
 * Read the ZIP central directory without expanding anything.
 * Returns [{ name, method, flags, crc, compressedSize, uncompressedSize,
 * localHeaderOffset }]. Throws PptxReject on any structural problem.
 */
export function readCentralDirectory(bytes, caps = PPTX_CAPS) {
  if (bytes.length < 4) reject("not-a-zip");
  if (OLE_MAGIC.every((b, i) => bytes[i] === b)) reject("legacy-ppt");
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    reject("not-a-zip");
  }

  // Find the End Of Central Directory record: scan backwards over the
  // last 64 KiB + 22 bytes (the largest legal trailing comment).
  const searchStart = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= searchStart; i -= 1) {
    if (u32(bytes, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) reject("malformed-zip");
  const entryCount = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    reject("unsupported-zip64");
  }
  if (entryCount > caps.maxEntries) reject("too-many-entries", `(${entryCount} parts)`);
  if (centralOffset + centralSize > bytes.length) reject("malformed-zip");

  const entries = [];
  let off = centralOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (off + 46 > bytes.length || u32(bytes, off) !== CENTRAL_HEADER_SIG) {
      reject("malformed-zip", `(central directory entry ${i})`);
    }
    const flags = u16(bytes, off + 8);
    const method = u16(bytes, off + 10);
    const crc = u32(bytes, off + 16);
    const compressedSize = u32(bytes, off + 20);
    const uncompressedSize = u32(bytes, off + 24);
    const nameLen = u16(bytes, off + 28);
    const extraLen = u16(bytes, off + 30);
    const commentLen = u16(bytes, off + 32);
    const localHeaderOffset = u32(bytes, off + 42);
    if (nameLen === 0 || off + 46 + nameLen + extraLen + commentLen > bytes.length) {
      reject("malformed-zip", `(central directory entry ${i})`);
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      reject("unsupported-zip64");
    }
    const nameBytes = bytes.subarray(off + 46, off + 46 + nameLen);
    const name = new TextDecoder("utf-8", { fatal: false }).decode(nameBytes);
    entries.push({ name, method, flags, crc, compressedSize, uncompressedSize, localHeaderOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Entry-name rules: no absolute paths, no `..` segments, no backslashes. */
export function validateEntryName(name) {
  if (
    !name ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.split("/").some((segment) => segment === "..")
  ) {
    reject("path-traversal", `(part name: ${name})`);
  }
}

/**
 * Validate the central directory against the caps using DECLARED sizes
 * only — no entry is expanded by this step. Returns the declared total
 * expanded bytes.
 */
export function validateZipEntries(entries, caps = PPTX_CAPS) {
  const seen = new Set();
  let declaredTotal = 0;
  for (const entry of entries) {
    validateEntryName(entry.name);
    const lower = entry.name.toLowerCase();
    if (seen.has(lower)) reject("duplicate-entry", `(part name: ${entry.name})`);
    seen.add(lower);
    if (entry.flags & 0x1) reject("encrypted-entry", `(part name: ${entry.name})`);
    if (entry.method !== 0 && entry.method !== 8) {
      reject("unsupported-method", `(part ${entry.name} uses method ${entry.method})`);
    }
    if (entry.uncompressedSize > caps.maxEntryBytes) {
      reject("entry-too-large", `(part ${entry.name} declares ${entry.uncompressedSize} bytes)`);
    }
    if (entry.compressedSize > caps.maxInputBytes) {
      reject("entry-too-large", `(part ${entry.name})`);
    }
    declaredTotal += entry.uncompressedSize;
    if (declaredTotal > caps.maxExpandedBytes) {
      reject("expanded-too-large", `(declares ${declaredTotal} bytes)`);
    }
  }
  return declaredTotal;
}

// ---------------------------------------------------------------------------
// Bounded extraction: stream one entry through fflate's inflater in 64 KiB
// pushes, aborting past the cap. Verifies actual length and CRC-32.
// ---------------------------------------------------------------------------

const INFLATE_PUSH_CHUNK = 64 * 1024;

export function extractEntryBounded(bytes, entry, caps = PPTX_CAPS, signal = null) {
  const localOff = entry.localHeaderOffset;
  if (localOff + 30 > bytes.length || u32(bytes, localOff) !== LOCAL_HEADER_SIG) {
    reject("malformed-zip", `(part ${entry.name} has no local header)`);
  }
  const nameLen = u16(bytes, localOff + 26);
  const extraLen = u16(bytes, localOff + 28);
  const localName = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.subarray(localOff + 30, localOff + 30 + nameLen),
  );
  if (localName !== entry.name) {
    reject("malformed-zip", `(part ${entry.name} disagrees with its local header)`);
  }
  const dataStart = localOff + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) reject("malformed-zip", `(part ${entry.name} is truncated)`);
  const compressed = bytes.subarray(dataStart, dataEnd);

  if (entry.method === 0) {
    // Stored: no inflation. Length and CRC are still verified by the caller.
    if (compressed.length !== entry.uncompressedSize) {
      reject("malformed-zip", `(part ${entry.name} size mismatch)`);
    }
    return Uint8Array.from(compressed);
  }

  // Deflate: stream through the inflater in bounded pushes.
  const inflater = new Inflate();
  const chunks = [];
  let total = 0;
  let failed = null;
  inflater.ondata = (chunk) => {
    total += chunk.length;
    if (total > caps.maxEntryBytes) {
      failed = new PptxReject(
        "entry-too-large",
        `(part ${entry.name} expands past ${caps.maxEntryBytes} bytes)`,
      );
      return;
    }
    chunks.push(chunk);
  };
  for (let off = 0; off < compressed.length; off += INFLATE_PUSH_CHUNK) {
    if (signal && signal.aborted) reject("cancelled");
    if (failed) throw failed;
    const last = off + INFLATE_PUSH_CHUNK >= compressed.length;
    try {
      inflater.push(compressed.subarray(off, off + INFLATE_PUSH_CHUNK), last);
    } catch {
      reject("malformed-zip", `(part ${entry.name} is not valid compressed data)`);
    }
    if (failed) throw failed;
  }
  if (failed) throw failed;
  if (total !== entry.uncompressedSize) {
    reject("malformed-zip", `(part ${entry.name} expanded to ${total} bytes, declared ${entry.uncompressedSize})`);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Verify the CRC-32 of extracted bytes against the central directory. */
export function verifyEntryCrc(entry, extracted) {
  if (crc32(extracted) !== entry.crc) {
    reject("malformed-zip", `(part ${entry.name} failed its checksum)`);
  }
}

// ---------------------------------------------------------------------------
// XML safety + parsing (fast-xml-parser, vendored in pptx.bundle.mjs).
// Entity expansion is refused BEFORE parsing: any DOCTYPE or ENTITY
// declaration in an XML part rejects the whole file.
// ---------------------------------------------------------------------------

import { XMLParser } from "./vendor/pptx.bundle.mjs";

const XML_PARSER_OPTIONS = Object.freeze({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  // Preserve document order: repeated siblings stay arrays in order, and
  // mixed content (runs + breaks) keeps its sequence. Text extraction
  // depends on this.
  preserveOrder: true,
});

export function assertXmlSafe(text, partName) {
  if (/<!\s*DOCTYPE/i.test(text) || /<!\s*ENTITY/i.test(text)) {
    reject("entity-expansion", `(part ${partName})`);
  }
}

export function parseXmlPart(bytes, partName) {
  if (bytes.length > PPTX_CAPS.maxXmlBytes) {
    reject("entry-too-large", `(part ${partName})`);
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  assertXmlSafe(text, partName);
  try {
    return new XMLParser(XML_PARSER_OPTIONS).parse(text);
  } catch {
    reject("malformed-zip", `(part ${partName} is not valid XML)`);
  }
}

// ---------------------------------------------------------------------------
// preserveOrder navigation helpers. A parsed node is an array of ENTRY
// objects shaped { "tag": [children], ":@": { attributes } }. The
// attributes live on the entry object itself — even for empty elements
// ({"p:sldSz": [], ":@": {...}}) — so helpers return ENTRY objects and
// xmlAttr reads the entry, never a bare children array.
// ---------------------------------------------------------------------------

/** Children array of an entry object (or the array itself, unchanged). */
export function xmlKids(node) {
  if (Array.isArray(node)) return node;
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key !== ":@") return Array.isArray(value) ? value : [];
    }
  }
  return [];
}

/** Entry objects under `node` whose tag is `tag`, in document order. */
export function xmlChildren(node, tag) {
  const out = [];
  for (const entry of xmlKids(node)) {
    if (entry && typeof entry === "object" && Array.isArray(entry[tag])) {
      out.push(entry);
    }
  }
  return out;
}

/** First entry object under `node` whose tag is `tag`, or null. */
export function xmlFirst(node, tag) {
  const found = xmlChildren(node, tag);
  return found.length > 0 ? found[0] : null;
}

/** Descend a tag path, returning the final entry object or null. */
export function xmlFind(node, ...tags) {
  let current = node;
  for (const tag of tags) {
    current = xmlFirst(current, tag);
    if (!current) return null;
  }
  return current;
}

/** Attribute of an entry object (`name` without the `@_` prefix). */
export function xmlAttr(entry, name) {
  if (!entry || typeof entry !== "object" || !entry[":@"]) return undefined;
  const value = entry[":@"][`@_${name}`];
  return value === undefined ? undefined : value;
}

/** All text of a node, in document order (used for <a:t> runs). */
export function xmlText(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) {
    let out = "";
    for (const entry of node) out += xmlText(entry);
    return out;
  }
  if (node && typeof node === "object") {
    let out = "";
    for (const [key, value] of Object.entries(node)) {
      if (key === ":@") continue;
      if (key === "#text") out += typeof value === "string" ? value : "";
      else out += xmlText(value);
    }
    return out;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Image dimensions from headers only (no pixel decode).
// ---------------------------------------------------------------------------

function pngDimensions(prefix) {
  if (prefix.length < 33 || prefix[0] !== 0x89 || prefix[1] !== 0x50) return null;
  if (prefix[12] !== 0x49 || prefix[13] !== 0x48 || prefix[14] !== 0x44 || prefix[15] !== 0x52) {
    return null;
  }
  const width =
    (prefix[16] << 24) | (prefix[17] << 16) | (prefix[18] << 8) | prefix[19];
  const height =
    (prefix[20] << 24) | (prefix[21] << 16) | (prefix[22] << 8) | prefix[23];
  return { width, height };
}

function gifDimensions(prefix) {
  if (prefix.length < 10) return null;
  const sig = String.fromCharCode(prefix[0], prefix[1], prefix[2]);
  if (sig !== "GIF") return null;
  return { width: prefix[6] | (prefix[7] << 8), height: prefix[8] | (prefix[9] << 8) };
}

function bmpDimensions(prefix) {
  if (prefix.length < 26 || prefix[0] !== 0x42 || prefix[1] !== 0x4d) return null;
  const width = u32(prefix, 18);
  const height = Math.abs(u32(prefix, 22));
  return { width, height };
}

function jpegDimensions(prefix) {
  if (prefix.length < 4 || prefix[0] !== 0xff || prefix[1] !== 0xd8) return null;
  let off = 2;
  while (off + 9 < prefix.length) {
    if (prefix[off] !== 0xff) return null;
    const marker = prefix[off + 1];
    if (marker === 0xd9 || marker === 0xda) return null; // SOS / EOI before SOF
    const length = (prefix[off + 2] << 8) | prefix[off + 3];
    if (length < 2) return null;
    // SOF0/1/2/3/5/6/7/9/10/11/13/14/15 carry dimensions.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (prefix[off + 5] << 8) | prefix[off + 6];
      const width = (prefix[off + 7] << 8) | prefix[off + 8];
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    off += 2 + length;
  }
  return null;
}

export function imageDimensionsFromPrefix(prefix, name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return { format: "png", ...(pngDimensions(prefix) || {}) };
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return { format: "jpeg", ...(jpegDimensions(prefix) || {}) };
  }
  if (lower.endsWith(".gif")) return { format: "gif", ...(gifDimensions(prefix) || {}) };
  if (lower.endsWith(".bmp")) return { format: "bmp", ...(bmpDimensions(prefix) || {}) };
  return { format: "other" };
}

// ---------------------------------------------------------------------------
// Full package validation + bounded extraction.
// ---------------------------------------------------------------------------

const XML_PART = /\.xml$/i;
const RELS_PART = /\.rels$/i;
const MEDIA_PREFIX = /^ppt\/media\//i;

function isMediaPart(name) {
  return MEDIA_PREFIX.test(name);
}

function isXmlPart(name) {
  return XML_PART.test(name) || RELS_PART.test(name);
}

/**
 * Validate a .pptx byte array and extract the parts Slice 1 needs.
 *
 * @param {Uint8Array|ArrayBuffer} input — the whole file.
 * @param {object} [options]
 * @param {object} [options.caps] — overrides for PPTX_CAPS (tests).
 * @param {AbortSignal} [options.signal] — cancellation.
 * @returns {object} the validated package (see below). Throws PptxReject.
 *
 * The returned package keeps the original bytes (for the Pagus render
 * pass) plus the extracted XML/rels parts and media header prefixes.
 * Nothing here touches the disk or the network.
 */
export async function validateAndExtractPptx(input, options = {}) {
  const caps = { ...PPTX_CAPS, ...(options.caps || {}) };
  const signal = options.signal || null;
  const started = Date.now();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) reject("not-a-zip");
  if (bytes.length > caps.maxInputBytes) reject("too-large", `(${bytes.length} bytes)`);

  const entries = readCentralDirectory(bytes, caps);
  validateZipEntries(entries, caps);

  // Streaming validation pass: every entry is expanded through the
  // capped inflater (or copied, for stored entries), its length and
  // CRC verified. XML/rels parts are kept; media parts keep only a
  // header prefix; everything else is counted and discarded.
  const kept = new Map();
  const mediaPrefixes = new Map();
  let keptBytes = 0;
  let expandedActual = 0;
  for (const entry of entries) {
    if (signal && signal.aborted) reject("cancelled");
    if (Date.now() - started > caps.maxImportMillis) reject("import-timeout");
    const extracted = extractEntryBounded(bytes, entry, caps, signal);
    verifyEntryCrc(entry, extracted);
    expandedActual += extracted.length;
    if (expandedActual > caps.maxExpandedBytes) reject("expanded-too-large");
    if (isXmlPart(entry.name)) {
      if (extracted.length > caps.maxXmlBytes) reject("entry-too-large", `(part ${entry.name})`);
      keptBytes += extracted.length;
      if (keptBytes > caps.maxKeptBytes) reject("expanded-too-large", "(too much XML)");
      kept.set(entry.name, extracted);
    } else if (isMediaPart(entry.name)) {
      mediaPrefixes.set(entry.name, extracted.subarray(0, caps.mediaPrefixBytes));
    }
  }

  // Package structure: content types, presentation, slide list.
  const pkg = buildPptxPackage(bytes, kept, mediaPrefixes, caps, {
    inputBytes: bytes.length,
    entryCount: entries.length,
    expandedBytes: expandedActual,
    elapsedMs: Date.now() - started,
  });
  return pkg;
}

function getPart(kept, name) {
  const found = kept.get(name);
  if (!found) reject("missing-part", `(missing ${name})`);
  return found;
}

function buildPptxPackage(sourceBytes, kept, mediaPrefixes, caps, stats) {
  const warnings = [];
  const contentTypes = parseXmlPart(getPart(kept, "[Content_Types].xml"), "[Content_Types].xml");
  const presentation = parseXmlPart(getPart(kept, "ppt/presentation.xml"), "ppt/presentation.xml");
  const presentationNode = xmlFirst(presentation, "p:presentation");
  if (!presentationNode) reject("missing-part", "(no p:presentation in ppt/presentation.xml)");

  // Slide size (EMU) -> points.
  const sldSz = xmlFirst(presentationNode, "p:sldSz");
  const cxEmu = sldSz ? Number(xmlAttr(sldSz, "cx")) : 0;
  const cyEmu = sldSz ? Number(xmlAttr(sldSz, "cy")) : 0;
  if (!cxEmu || !cyEmu) reject("missing-part", "(no slide size in ppt/presentation.xml)");
  const slideSize = { cxEmu, cyEmu, widthPt: cxEmu / 12700, heightPt: cyEmu / 12700 };

  // Ordered slide list: p:sldIdLst (r:id) resolved through presentation rels.
  const rels = parseXmlPart(getPart(kept, "ppt/_rels/presentation.xml.rels"), "ppt/_rels/presentation.xml.rels");
  const relMap = parseRelationships(rels, "ppt/_rels/presentation.xml.rels");
  const sldIdLst = xmlFirst(presentationNode, "p:sldIdLst");
  const sldIds = sldIdLst ? xmlChildren(sldIdLst, "p:sldId") : [];
  if (sldIds.length === 0) reject("missing-part", "(deck has no slides)");
  if (sldIds.length > caps.maxSlides) reject("too-many-slides", `(${sldIds.length} slides)`);
  const slideParts = [];
  for (let i = 0; i < sldIds.length; i += 1) {
    const rId = xmlAttr(sldIds[i], "r:id");
    if (!rId) reject("bad-relationships", `(slide ${i + 1} has no relationship id)`);
    const rel = relMap.get(rId);
    if (!rel) reject("bad-relationships", `(slide ${i + 1} references missing ${rId})`);
    if (rel.targetMode === "External") {
      reject("bad-relationships", `(slide ${i + 1} points outside the file)`);
    }
    const partPath = resolvePartPath("ppt/", rel.target);
    if (!kept.has(partPath)) reject("missing-part", `(missing ${partPath})`);
    slideParts.push({ index: i, partPath, relId: rId });
  }

  // Image dimension caps (headers only — no pixel decode).
  const mediaInfo = [];
  let aggregateMp = 0;
  for (const [name, prefix] of mediaPrefixes) {
    const info = imageDimensionsFromPrefix(prefix, name);
    if (info.format === "other") {
      warnings.push({
        code: "unsupported-image-format",
        message: `Picture ${name} is in a format Capture cannot render fully; the slide may look different.`,
        part: name,
      });
      mediaInfo.push({ name, format: info.format });
      continue;
    }
    if (!info.width || !info.height) {
      reject("unreadable-image", `(part ${name})`);
    }
    const megapixels = (info.width * info.height) / 1_000_000;
    if (megapixels > caps.maxImageMegapixels) {
      reject("oversized-image", `(${name} is ${info.width}x${info.height})`);
    }
    aggregateMp += megapixels;
    if (aggregateMp > caps.maxAggregateImageMegapixels) {
      reject("too-many-image-pixels", `(pictures total ${aggregateMp.toFixed(1)} megapixels)`);
    }
    mediaInfo.push({ name, format: info.format, width: info.width, height: info.height, megapixels });
  }

  return {
    sourceBytes,
    parts: kept,
    mediaPrefixes,
    mediaInfo,
    slideParts,
    slideSize,
    slideCount: slideParts.length,
    contentTypes,
    presentation,
    warnings,
    stats,
  };
}

/**
 * Map package-level warnings to the slides that own them.
 * A warning carries the part it is about in `warning.part` (e.g. an
 * unsupported media part, `ppt/media/image18.wmf`); the owning slide
 * is the one whose relationships reference that part, or the slide
 * itself when the part is a slide part. Returns
 * `{ bySlide: Map<slideIndex, warning[]>, project: warning[] }` —
 * warnings no slide references (orphan media, or no part at all) go
 * to `project` so they are still shown and persisted, never dropped.
 * Pure logic: the panel merges `bySlide` into the slide records and
 * stores `project` on the manifest.
 */
export function mapPackageWarnings(pkg) {
  const bySlide = new Map();
  const project = [];
  for (const warning of pkg.warnings || []) {
    const owners = warning.part ? slideIndexesForPart(pkg, warning.part) : [];
    if (owners.length === 0) {
      project.push(warning);
      continue;
    }
    for (const index of owners) {
      if (!bySlide.has(index)) bySlide.set(index, []);
      bySlide.get(index).push(warning);
    }
  }
  return { bySlide, project };
}

/** Slide indexes whose relationships reference `partPath` (or that are the part itself). */
function slideIndexesForPart(pkg, partPath) {
  const owners = [];
  for (const slide of pkg.slideParts) {
    if (slide.partPath === partPath) {
      owners.push(slide.index);
      continue;
    }
    const relsPath = slide.partPath.replace(/\/([^/]+)\.xml$/, "/_rels/$1.xml.rels");
    const relsBytes = pkg.parts.get(relsPath);
    if (!relsBytes) continue;
    let relMap;
    try {
      relMap = parseRelationships(parseXmlPart(relsBytes, relsPath), relsPath);
    } catch {
      continue;
    }
    for (const rel of relMap.values()) {
      if (rel.targetMode === "External") continue;
      let target;
      try {
        target = resolvePartPath("ppt/slides/", rel.target);
      } catch {
        continue;
      }
      if (target === partPath) {
        owners.push(slide.index);
        break;
      }
    }
  }
  return owners;
}

/**
 * Parse a .rels part into Map<rId, { type, target, targetMode }>.
 * Duplicate rIds or targets escaping the package are rejected.
 */
export function parseRelationships(relsXml, partName) {
  const root = xmlFirst(relsXml, "Relationships");
  if (!root) reject("bad-relationships", `(part ${partName} has no Relationships)`);
  const map = new Map();
  for (const rel of xmlChildren(root, "Relationship")) {
    const id = xmlAttr(rel, "Id");
    const type = xmlAttr(rel, "Type");
    const target = xmlAttr(rel, "Target");
    const targetMode = xmlAttr(rel, "TargetMode") || "Internal";
    if (!id || !type || !target) reject("bad-relationships", `(part ${partName} has an incomplete relationship)`);
    if (map.has(id)) reject("bad-relationships", `(part ${partName} repeats ${id})`);
    map.set(id, { type, target, targetMode });
  }
  return map;
}

/** Resolve a relationship target relative to its part's folder. */
export function resolvePartPath(baseDir, target) {
  const base = baseDir.split("/").filter(Boolean);
  const out = [...base];
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) reject("path-traversal", `(relationship target: ${target})`);
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.join("/");
}
