// FORGE Doc-to-Overview — slice A: named, versioned source-set manifests.
//
// Pure, I/O-free domain logic. A manifest is the curator's explicit
// selection: named documents, exact content hashes, allowed page/section
// ranges, owner/workspace, curator identity, creation time and purpose.
// Nothing is discovered, crawled, or auto-ingested — every document in a
// manifest got there because a curator named it.
//
// A manifest is created only after every document passes classification
// (see classification.js); the picker in
// `src/application/doc-overview/picker.js` enforces that ordering. This
// module validates shape and computes hashes; it never decides admission.
//
// Hashing: SHA-256 over UTF-8 bytes. The source-set hash covers exactly
// the document identities, content hashes, allowed ranges, and page
// hashes, so a changed source (or a changed range, or a changed page
// binding) changes the hash and invalidates any artifact built on the
// manifest (see artifacts.js).

import { createHash, randomUUID } from "node:crypto";
import {
  MAX_DOCUMENTS_PER_SET,
  MAX_NAME_CHARS,
  MAX_PURPOSE_CHARS,
  MAX_TITLE_CHARS,
  MAX_SECTION_NAME_CHARS,
  MAX_BASIS_CHARS,
} from "./limits.js";

export const SOURCE_TYPES = Object.freeze(["forge-reference", "upload"]);

const SHA256_HEX = /^[0-9a-f]{64}$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeId(value) {
  // IDs are opaque identifiers, never filesystem paths: no separators,
  // no parent traversal, no leading dot (hidden files).
  return (
    isNonEmptyString(value) &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("..") &&
    !value.startsWith(".")
  );
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Deterministic JSON: object keys sorted recursively, so hashes are stable. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

export function computeDocumentHash(content) {
  return sha256Hex(content);
}

/**
 * One SHA-256 hash per page, in page order. The picker records these on
 * the manifest entry at pick time; extraction re-verifies supplied pages
 * against them, so page content is cryptographically bound to the
 * manifest and cannot be swapped independently of the document text.
 */
export function computePageHashes(pages) {
  if (!Array.isArray(pages)) {
    throw new Error("computePageHashes: pages must be an array.");
  }
  return pages.map((page) => {
    if (typeof page !== "string") {
      throw new Error("computePageHashes: every page must be a string.");
    }
    return sha256Hex(page);
  });
}

/**
 * Source-set hash: covers document identities, content hashes, allowed
 * ranges, and page hashes only. Permission basis, titles and curator
 * notes do not change it — a changed source (or range, or page binding)
 * must change the hash, a reworded permission note must not.
 */
export function computeSourceSetHash(documents) {
  const covered = documents.map((d) => ({
    documentId: d.documentId,
    contentHash: d.contentHash,
    ranges: d.ranges,
    pageHashes: d.pageHashes ?? null,
  }));
  return sha256Hex(canonicalJson(covered));
}

function validateRange(range, pageCount, errors, docLabel) {
  if (!range || typeof range !== "object") {
    errors.push({ code: "INVALID_RANGE", message: `${docLabel}: range must be an object.` });
    return;
  }
  if (range.type === "page") {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
      errors.push({ code: "INVALID_RANGE", message: `${docLabel}: page range start/end must be integers.` });
      return;
    }
    if (range.start < 1 || range.end < range.start) {
      errors.push({ code: "INVALID_RANGE", message: `${docLabel}: page range must satisfy 1 <= start <= end.` });
      return;
    }
    if (pageCount != null && range.end > pageCount) {
      errors.push({ code: "OUT_OF_RANGE", message: `${docLabel}: page range ends at ${range.end} but the document has ${pageCount} pages.` });
    }
    return;
  }
  if (range.type === "section") {
    if (!isNonEmptyString(range.name) || range.name.length > MAX_SECTION_NAME_CHARS) {
      errors.push({ code: "INVALID_RANGE", message: `${docLabel}: section range needs a non-empty name (max ${MAX_SECTION_NAME_CHARS} chars).` });
    }
    return;
  }
  errors.push({ code: "INVALID_RANGE", message: `${docLabel}: range type must be "page" or "section".` });
}

/**
 * Validates one manifest document entry. `pageCount` is required when the
 * entry uses page ranges (so out-of-range pages fail here, not silently
 * during extraction). Returns { ok, errors } in the repo's validator
 * convention; errors carry stable codes for the picker and tests.
 */
export function validateDocumentEntry(entry, pageCount) {
  const errors = [];
  const label = entry?.documentId ? `document ${entry.documentId}` : "document";
  if (!isSafeId(entry?.documentId)) {
    errors.push({ code: "INVALID_DOCUMENT_ID", message: "documentId is required and must not contain path separators, traversal, or a leading dot." });
  }
  if (!isNonEmptyString(entry?.title) || entry.title.length > MAX_TITLE_CHARS) {
    errors.push({ code: "INVALID_TITLE", message: `${label}: title is required (max ${MAX_TITLE_CHARS} chars).` });
  }
  if (!SOURCE_TYPES.includes(entry?.sourceType)) {
    errors.push({ code: "INVALID_SOURCE_TYPE", message: `${label}: sourceType must be one of: ${SOURCE_TYPES.join(", ")}.` });
  }
  if (!SHA256_HEX.test(entry?.contentHash ?? "")) {
    errors.push({ code: "INVALID_CONTENT_HASH", message: `${label}: contentHash must be a 64-hex SHA-256 digest.` });
  }
  if (!entry?.permission || entry.permission.granted !== true) {
    errors.push({ code: "MISSING_PERMISSION", message: `${label}: explicit source permission/licensing is required (permission.granted must be true).` });
  } else if (!isNonEmptyString(entry.permission.basis) || entry.permission.basis.length > MAX_BASIS_CHARS) {
    errors.push({ code: "MISSING_PERMISSION", message: `${label}: permission.basis must name the permission/license (max ${MAX_BASIS_CHARS} chars).` });
  }
  if (!Array.isArray(entry?.ranges) || entry.ranges.length === 0) {
    errors.push({ code: "INVALID_RANGE", message: `${label}: at least one allowed page/section range is required.` });
  } else {
    const pageRanges = entry.ranges.filter((r) => r?.type === "page");
    if (pageRanges.length > 0 && pageCount == null) {
      errors.push({ code: "INVALID_RANGE", message: `${label}: pageCount is required when page ranges are used.` });
    } else if (pageRanges.length > 0) {
      // Page ranges are only meaningful with a cryptographic binding of
      // the page content: one SHA-256 hash per page, recorded at pick
      // time. Without it, extraction-time pages would be independently
      // mutable (same document text, swapped pages).
      const hashesOk =
        Array.isArray(entry.pageHashes) &&
        entry.pageHashes.length === pageCount &&
        entry.pageHashes.every((h) => SHA256_HEX.test(h ?? ""));
      if (!hashesOk) {
        errors.push({ code: "INVALID_PAGE_HASHES", message: `${label}: page ranges require pageHashes — one SHA-256 hash per page (${pageCount} pages).` });
      }
    } else if (entry.pageHashes != null) {
      // Section-only entries may still carry recorded page hashes (pages
      // supplied at pick time); when present they must be well-formed.
      const hashesOk =
        Array.isArray(entry.pageHashes) &&
        entry.pageHashes.every((h) => SHA256_HEX.test(h ?? ""));
      if (!hashesOk) {
        errors.push({ code: "INVALID_PAGE_HASHES", message: `${label}: pageHashes must be an array of SHA-256 hex digests.` });
      }
    }
    for (const range of entry.ranges) validateRange(range, pageCount, errors, label);
    // Overlapping page ranges would make extraction ambiguous (the same
    // page extracted twice under one manifest) — fail loud instead.
    const sorted = [...pageRanges].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].start <= sorted[i - 1].end) {
        errors.push({ code: "OVERLAPPING_RANGES", message: `${label}: page ranges must not overlap.` });
        break;
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

/**
 * Creates a validated manifest. `documents` are already-classified entries
 * (see picker.js); this function validates shape and hashes but does not
 * re-decide admission. `now` and `uuid` are injectable so tests are
 * deterministic; production callers omit them.
 */
export function createSourceSetManifest(input, options = {}) {
  const errors = [];
  if (!isNonEmptyString(input?.name) || input.name.length > MAX_NAME_CHARS) {
    errors.push({ code: "INVALID_NAME", message: `name is required (max ${MAX_NAME_CHARS} chars).` });
  }
  if (!isSafeId(input?.ownerId)) {
    errors.push({ code: "INVALID_OWNER", message: "ownerId is required and must be a safe identifier (no separators or traversal)." });
  }
  if (!isNonEmptyString(input?.curator?.id)) {
    errors.push({ code: "INVALID_CURATOR", message: "curator.id is required." });
  }
  if (input?.purpose != null && (typeof input.purpose !== "string" || input.purpose.length > MAX_PURPOSE_CHARS)) {
    errors.push({ code: "INVALID_PURPOSE", message: `purpose must be a string (max ${MAX_PURPOSE_CHARS} chars).` });
  }
  if (!Array.isArray(input?.documents) || input.documents.length === 0) {
    errors.push({ code: "INVALID_DOCUMENTS", message: "at least one document is required." });
  } else if (input.documents.length > MAX_DOCUMENTS_PER_SET) {
    errors.push({ code: "TOO_MANY_DOCUMENTS", message: `at most ${MAX_DOCUMENTS_PER_SET} documents per source set.` });
  } else {
    const seen = new Set();
    for (const entry of input.documents) {
      if (seen.has(entry?.documentId)) {
        errors.push({ code: "DUPLICATE_DOCUMENT", message: `document ${entry.documentId} appears more than once.` });
      }
      seen.add(entry?.documentId);
      const checked = validateDocumentEntry(entry, entry?.pageCount ?? null);
      errors.push(...checked.errors);
    }
  }
  if (errors.length > 0) return { ok: false, errors, manifest: null };

  const now = options.now ?? new Date().toISOString();
  const id = `manifest_${options.uuid ?? randomUUID()}`;
  const documents = input.documents.map((d) => ({
    documentId: d.documentId,
    title: d.title,
    sourceType: d.sourceType,
    contentHash: d.contentHash,
    ranges: d.ranges,
    pageHashes: d.pageHashes ?? null,
    permission: { granted: true, basis: d.permission.basis },
    pageCount: d.pageCount ?? null,
    charCount: d.charCount ?? null,
  }));
  const manifest = {
    id,
    name: input.name,
    version: 1,
    ownerId: input.ownerId,
    workspaceId: input.workspaceId ?? null,
    curator: { id: input.curator.id, displayName: input.curator.displayName ?? null },
    purpose: input.purpose ?? null,
    createdAt: now,
    updatedAt: now,
    documents,
    sourceSetHash: computeSourceSetHash(documents),
    humanClassifications: [],
  };
  return { ok: true, errors: [], manifest };
}

/**
 * Records an explicit human classification decision on a manifest (the
 * brief's human-classification path for held documents). The decision is
 * attributed and reasoned — never silent — and bumps the manifest
 * version, which changes nothing about the source-set hash (hash covers
 * sources and ranges only).
 */
export function recordHumanClassification(manifest, decision, options = {}) {
  const errors = [];
  if (!["admit", "reject"].includes(decision?.decision)) {
    errors.push({ code: "INVALID_DECISION", message: "decision.decision must be 'admit' or 'reject'." });
  }
  if (!isNonEmptyString(decision?.documentId)) {
    errors.push({ code: "INVALID_DECISION", message: "decision.documentId is required." });
  }
  if (!isNonEmptyString(decision?.classifier)) {
    errors.push({ code: "INVALID_DECISION", message: "decision.classifier (who classified) is required." });
  }
  if (!isNonEmptyString(decision?.reason)) {
    errors.push({ code: "INVALID_DECISION", message: "decision.reason is required." });
  }
  if (errors.length > 0) return { ok: false, errors, manifest: null };
  const now = options.now ?? new Date().toISOString();
  return {
    ok: true,
    errors: [],
    manifest: {
      ...manifest,
      version: manifest.version + 1,
      updatedAt: now,
      humanClassifications: [
        ...manifest.humanClassifications,
        {
          documentId: decision.documentId,
          decision: decision.decision,
          classifier: decision.classifier,
          reason: decision.reason,
          at: now,
        },
      ],
    },
  };
}
