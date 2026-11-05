// FORGE Doc-to-Overview — slice A: bounded extraction with provenance.
//
// Pure, I/O-free domain logic. Extraction takes a classified document and
// the manifest's allowed ranges and returns the exact text slices the
// later slices may use, each with a section/page locator and a SHA-256
// checksum. Anything outside the allowed ranges is never extracted;
// anything that cannot be located fails loud (OUT_OF_RANGE), never
// silently truncated or hallucinated.
//
// Determinism: the same document + ranges always produce the same
// extracts byte-for-byte (no timestamps, no randomness in output).

import { sha256Hex } from "./sourceSets.js";
import {
  MAX_EXTRACTS_PER_DOCUMENT,
  MAX_EXTRACT_CHARS,
} from "./limits.js";

/**
 * Splits markdown-style text into named sections. A section starts at a
 * `#`/`##` heading line and runs until the next heading. Text before the
 * first heading is the unnamed preamble and is not addressable by a
 * section range (a section range must name a real heading).
 */
export function splitSections(text) {
  const sections = new Map();
  const lines = text.split(/\r?\n/);
  let current = null;
  let buffer = [];
  const flush = () => {
    if (current !== null) sections.set(current, buffer.join("\n").trim());
    buffer = [];
  };
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      current = heading[1];
      buffer = [line];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function fail(code, message) {
  return { ok: false, extracts: [], error: { code, message } };
}

/**
 * Extracts the manifest's allowed ranges from one document.
 * Input: { document: { id, text, pages? }, ranges }.
 * - Page ranges index into `pages` (required when page ranges are used);
 *   a page extract's text is that page's full text.
 * - Section ranges resolve against `##` headings in `text`.
 * Output: { ok, extracts: [{ documentId, locator, text, checksum }],
 *           skippedBlank } or { ok: false, error }.
 * Bounds: at most MAX_EXTRACTS_PER_DOCUMENT extracts and
 * MAX_EXTRACT_CHARS total characters — exceeding either fails the whole
 * extraction (no partial, silently clipped result).
 */
export function extractBounded({ document, ranges }) {
  if (!document || typeof document.text !== "string") {
    return fail("INVALID_DOCUMENT", "document.text is required.");
  }
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return fail("INVALID_RANGE", "at least one allowed range is required.");
  }
  const extracts = [];
  let skippedBlank = 0;
  const sections = ranges.some((r) => r?.type === "section")
    ? splitSections(document.text)
    : null;

  for (const range of ranges) {
    if (range?.type === "page") {
      if (!Array.isArray(document.pages)) {
        return fail("INVALID_DOCUMENT", "page ranges require document.pages.");
      }
      for (let page = range.start; page <= range.end; page += 1) {
        const pageText = document.pages[page - 1];
        if (pageText === undefined) {
          return fail("OUT_OF_RANGE", `page ${page} does not exist (document has ${document.pages.length} pages).`);
        }
        if (pageText.trim().length === 0) {
          skippedBlank += 1;
          continue;
        }
        extracts.push({
          documentId: document.id,
          locator: { type: "page", page },
          text: pageText,
          checksum: sha256Hex(pageText),
        });
      }
      continue;
    }
    if (range?.type === "section") {
      const sectionText = sections.get(range.name);
      if (sectionText === undefined) {
        return fail("OUT_OF_RANGE", `section "${range.name}" does not exist in the document.`);
      }
      if (sectionText.trim().length === 0) {
        skippedBlank += 1;
        continue;
      }
      extracts.push({
        documentId: document.id,
        locator: { type: "section", name: range.name },
        text: sectionText,
        checksum: sha256Hex(sectionText),
      });
      continue;
    }
    return fail("INVALID_RANGE", "range type must be \"page\" or \"section\".");
  }

  if (extracts.length > MAX_EXTRACTS_PER_DOCUMENT) {
    return fail("BOUND_EXCEEDED", `extraction produced ${extracts.length} extracts (limit ${MAX_EXTRACTS_PER_DOCUMENT}).`);
  }
  const totalChars = extracts.reduce((sum, e) => sum + e.text.length, 0);
  if (totalChars > MAX_EXTRACT_CHARS) {
    return fail("BOUND_EXCEEDED", `extraction produced ${totalChars} characters (limit ${MAX_EXTRACT_CHARS}).`);
  }
  return { ok: true, extracts, skippedBlank, error: null };
}
