/**
 * VSDX package reader: unzip + OPC validation + ZIP-bomb resource guards.
 *
 * This is the ONLY module that knows about fflate. Everything downstream
 * works against the VsdxPackage interface: has(path), getText(path),
 * list(prefix), plus size accounting.
 *
 * Security posture: a .vsdx file is untrusted input. Entry-count, per-entry,
 * total-uncompressed, and overall compression-ratio caps are enforced DURING
 * streaming decompression (fflate exposes each entry's declared
 * originalSize before its bytes are expanded, and ondata lets us abort
 * mid-entry), so a hostile archive fails fast instead of after the tab's
 * memory is gone. The compression-ratio rule additionally runs a pre-expansion
 * projection: the declared uncompressed sizes are accumulated before each
 * entry starts, and the archive is rejected as soon as the projected
 * aggregate ratio exceeds the cap — before those bytes are decompressed.
 * XML byte caps are enforced again in getText before DOM parsing. All
 * processing is browser-local; nothing is uploaded.
 */

import { Unzip, UnzipInflate } from "fflate";
import { VsdxImportError } from "./vsdxErrors";

export const VSDX_LIMITS = Object.freeze({
  /**
   * Maximum number of entries (files + dirs) in the archive.
   * Empirically below fflate's central-directory recursion cliff (a single
   * push stack-overflows somewhere between ~2500-4500 entries depending on
   * name layout), so the cap always fires before the parser itself can
   * stack-overflow. Real .vsdx files contain at most a few hundred entries.
   */
  maxEntries: 2000,
  /** Maximum uncompressed bytes for a single entry. */
  maxEntryUncompressedBytes: 25 * 1024 * 1024,
  /** Maximum total uncompressed bytes across all entries. */
  maxTotalUncompressedBytes: 100 * 1024 * 1024,
  /**
   * Maximum overall compression ratio (total uncompressed / package bytes).
   * This is an overall-archive check rather than per-entry: it catches the
   * classic single-huge-entry bomb as well as many-small-entry bombs.
   */
  maxCompressionRatio: 200,
  /** Maximum bytes of a single XML part handed to the DOM parser. */
  maxXmlBytes: 10 * 1024 * 1024,
});

/** OPC parts a valid VSDX package must contain. */
const REQUIRED_PARTS = ["[Content_Types].xml", "visio/document.xml"];

function isUnsafeName(name) {
  if (typeof name !== "string" || name.length === 0) return true;
  if (name.startsWith("/") || name.startsWith("\\")) return true;
  if (name.includes("\\")) return true;
  return name.split("/").some((seg) => seg === "..");
}

function concatChunks(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Open a .vsdx package from an ArrayBuffer/Uint8Array.
 * Throws VsdxImportError for truncated archives, hostile archives,
 * traversal-style entry names, and valid ZIPs that are not VSDX packages.
 */
export function openVsdxPackage(bytes, limits = VSDX_LIMITS) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!(data.length > 0)) {
    throw new VsdxImportError("That file is empty — not a Visio drawing.", {
      code: "empty-file",
    });
  }

  const files = new Map();
  let entryCount = 0;
  let totalUncompressed = 0;
  let declaredUncompressed = 0;
  let failure = null;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (failure) return;
    try {
      if (isUnsafeName(file.name)) {
        throw new VsdxImportError(
          `Archive entry has an unsafe name ('${String(file.name).slice(0, 80)}').`,
          { code: "unsafe-entry-name" },
        );
      }
      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        throw new VsdxImportError(
          `Archive has more than ${limits.maxEntries} entries — refusing to expand it.`,
          { code: "entry-count-cap" },
        );
      }
      const name = file.name;
      // Directory entries carry no data.
      if (name.endsWith("/")) return;
      if (file.originalSize != null && file.originalSize > limits.maxEntryUncompressedBytes) {
        throw new VsdxImportError(
          `Archive entry '${name}' declares ${file.originalSize} uncompressed bytes (cap ${limits.maxEntryUncompressedBytes}).`,
          { code: "entry-size-cap" },
        );
      }
      if (file.compression !== 0 && file.compression !== 8) {
        throw new VsdxImportError(
          `Archive entry '${name}' uses unsupported compression method ${file.compression}.`,
          { code: "unsupported-compression" },
        );
      }
      // Pre-expansion ratio projection: the declared uncompressed size is
      // known before the entry's bytes are expanded, so a tiny archive
      // declaring an enormous expansion fails here — before decompression —
      // rather than after. (Entries using data descriptors declare 0 and
      // are covered by the streaming byte caps plus the final ratio check.)
      if (file.originalSize > 0) {
        declaredUncompressed += file.originalSize;
        const projected = declaredUncompressed / Math.max(1, data.length);
        if (projected > limits.maxCompressionRatio) {
          throw new VsdxImportError(
            `Archive declares ${declaredUncompressed} uncompressed bytes (~${projected.toFixed(0)}:1) — exceeding the ${limits.maxCompressionRatio}:1 compression ratio safety cap before expansion.`,
            { code: "compression-ratio-cap" },
          );
        }
      }
      const chunks = [];
      let size = 0;
      file.ondata = (err, chunk, final) => {
        if (failure) return;
        if (err) {
          failure = new VsdxImportError(`Could not decompress archive entry '${name}'.`, {
            code: "decompress-failed",
          });
          return;
        }
        size += chunk.length;
        totalUncompressed += chunk.length;
        if (
          size > limits.maxEntryUncompressedBytes ||
          totalUncompressed > limits.maxTotalUncompressedBytes
        ) {
          failure = new VsdxImportError(
            `Archive expands beyond the safety caps while decompressing '${name}'.`,
            { code: "expansion-cap" },
          );
          return;
        }
        chunks.push(chunk);
        if (final) files.set(name, concatChunks(chunks, size));
      };
      file.start();
    } catch (err) {
      failure = err instanceof VsdxImportError ? err : new VsdxImportError(String(err?.message || err), {
        code: "decompress-failed",
      });
    }
  };

  try {
    unzip.push(data, true);
  } catch (err) {
    throw new VsdxImportError("That file is not a readable ZIP archive.", {
      code: "bad-zip",
    });
  }
  if (failure) throw failure;
  if (files.size === 0 && entryCount === 0) {
    throw new VsdxImportError("That file is not a readable ZIP archive.", { code: "bad-zip" });
  }

  const ratio = totalUncompressed / Math.max(1, data.length);
  if (ratio > limits.maxCompressionRatio) {
    throw new VsdxImportError(
      `Archive compression ratio ${ratio.toFixed(1)}:1 exceeds the ${limits.maxCompressionRatio}:1 safety cap.`,
      { code: "compression-ratio-cap" },
    );
  }

  for (const required of REQUIRED_PARTS) {
    if (!files.has(required)) {
      throw new VsdxImportError(
        `That ZIP archive is not a Visio drawing (missing '${required}'). Only .vsdx files are supported — not legacy .vsd.`,
        { code: "not-a-vsdx" },
      );
    }
  }

  const textDecoder = new TextDecoder("utf-8");

  return {
    entryCount,
    totalUncompressedBytes: totalUncompressed,
    has: (path) => files.has(path),
    /** List entry paths under a prefix (e.g. "visio/pages/"). */
    list: (prefix) => {
      const out = [];
      for (const name of files.keys()) if (name.startsWith(prefix)) out.push(name);
      return out.sort();
    },
    /** Read an entry as UTF-8 text, enforcing the XML byte cap. */
    getText: (path) => {
      const entry = files.get(path);
      if (!entry) {
        throw new VsdxImportError(`Package is missing required part '${path}'.`, {
          code: "missing-part",
        });
      }
      if (entry.length > limits.maxXmlBytes) {
        throw new VsdxImportError(
          `Part '${path}' is ${entry.length} bytes (XML cap ${limits.maxXmlBytes}).`,
          { code: "xml-size-cap" },
        );
      }
      return textDecoder.decode(entry);
    },
    /** Raw bytes for an entry (used only for embedded binary parts). */
    getBytes: (path) => {
      const entry = files.get(path);
      if (!entry) {
        throw new VsdxImportError(`Package is missing required part '${path}'.`, {
          code: "missing-part",
        });
      }
      return entry;
    },
  };
}
