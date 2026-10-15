/**
 * resolver.js — fixture Git-object resolution, quoted-span verification,
 * read-permission checks and the per-task budget.
 *
 * The resolver independently verifies repo/path at commit resolves to the
 * pinned blob: it recomputes the Git blob SHA-1 using the Git blob header
 * ("blob <len>\0"), never plain SHA-1. Quoted spans are located by exact
 * byte search; offsets are UTF-8 byte offsets. A candidate's own metadata
 * is never trusted as truth — every pin is re-derived from fixture bytes.
 * Pure Node 24 ESM, zero dependencies.
 */

import { gitBlobId, HEX40 } from "./canonical.js";
import { validateSourceRef, SchemaError } from "./schemas.js";

export const BUDGET_LIMITS = {
  maxPayloadBytes: 262144, // 256 KiB total UTF-8 data per task
  maxObjects: 64, // source object resolutions
  maxSpans: 512, // evidence span checks
  maxConsultedObjects: 4096, // consulted registry/ledger objects
  maxOutputRecords: 256, // output records
  maxOutputBytes: 262144, // 256 KiB output
};

export class BudgetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BudgetError";
    this.code = code;
  }
}

export class ResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ResolutionError";
    this.code = code;
  }
}

/** Per-task budget: every object resolution, span check, payload and
 *  consulted object is charged. */
export function makeBudget() {
  const used = { objects: 0, spans: 0, payloadBytes: 0, consulted: 0 };
  return {
    used,
    countPayload(bytes, what) {
      used.payloadBytes += Buffer.byteLength(bytes, "utf8");
      if (used.payloadBytes > BUDGET_LIMITS.maxPayloadBytes) {
        throw new BudgetError("INPUT_LIMIT", `${what ?? "payload"} exceeds ${BUDGET_LIMITS.maxPayloadBytes} bytes`);
      }
    },
    countObject() {
      used.objects += 1;
      if (used.objects > BUDGET_LIMITS.maxObjects) {
        throw new BudgetError("BUDGET_EXCEEDED", `object resolutions exceed ${BUDGET_LIMITS.maxObjects}`);
      }
    },
    countSpan() {
      used.spans += 1;
      if (used.spans > BUDGET_LIMITS.maxSpans) {
        throw new BudgetError("BUDGET_EXCEEDED", `span checks exceed ${BUDGET_LIMITS.maxSpans}`);
      }
    },
    countConsulted(what) {
      used.consulted += 1;
      if (used.consulted > BUDGET_LIMITS.maxConsultedObjects) {
        throw new BudgetError("BUDGET_EXCEEDED", `consulted ${what ?? "registry objects"} exceed ${BUDGET_LIMITS.maxConsultedObjects}`);
      }
    },
  };
}

export function sourceKeyOf(ref) {
  return `${ref.repo}|${ref.path}`;
}

/**
 * Resolve a SourceRef through the fixture Git object store. Verifies:
 * the source key is registered; the commit is a registered revision; the
 * recomputed Git blob ID equals the pinned blob. Returns {bytes, text}.
 * Throws ResolutionError (SOURCE_UNVERIFIED / HASH_MISMATCH).
 */
export function resolveSourceRef(ref, sources, budget) {
  budget.countObject();
  try {
    validateSourceRef(ref, "source pin");
  } catch (e) {
    if (e instanceof SchemaError) {
      throw new ResolutionError("SOURCE_UNVERIFIED", `pin failed validation: ${e.message}`);
    }
    throw e;
  }
  const key = sourceKeyOf(ref);
  const entry = sources[key];
  if (!entry || typeof entry !== "object") {
    throw new ResolutionError("SOURCE_UNVERIFIED", `source key not registered: ${ref.repo}/${ref.path}`);
  }
  const revisions = entry.revisions;
  if (!revisions || typeof revisions !== "object") {
    throw new ResolutionError("SOURCE_UNVERIFIED", `no revisions registered for ${ref.repo}/${ref.path}`);
  }
  const rev = revisions[ref.commit];
  if (!rev || typeof rev !== "object") {
    throw new ResolutionError("SOURCE_UNVERIFIED", `commit ${ref.commit} not registered for ${ref.repo}/${ref.path}`);
  }
  if (typeof rev.text !== "string") {
    throw new ResolutionError("SOURCE_UNVERIFIED", `revision bytes missing for ${ref.repo}/${ref.path}@${ref.commit.slice(0, 8)}`);
  }
  const bytes = Buffer.from(rev.text, "utf8");
  budget.countPayload(rev.text, `source ${ref.repo}/${ref.path}`);
  const actualBlob = gitBlobId(bytes);
  if (actualBlob !== ref.blob) {
    throw new ResolutionError("HASH_MISMATCH", `blob mismatch for ${ref.repo}/${ref.path}@${ref.commit.slice(0, 8)}: pinned ${ref.blob.slice(0, 12)}… recomputed ${actualBlob.slice(0, 12)}…`);
  }
  return { bytes, text: rev.text, kind: entry.kind };
}

/** Exact read-grant check: grants are exact repo+path, never prefixes. */
export function hasReadGrant(ref, readGrants) {
  return readGrants.some((g) => g.repo === ref.repo && g.path === ref.path);
}

/**
 * Verify a quoted span against resolved bytes: exact byte search,
 * offsets are UTF-8 byte offsets, quoted text must match exactly.
 * Returns {start_byte, end_byte, quoted_text}. Throws ResolutionError
 * (SPAN_MISMATCH).
 */
export function verifySpan(bytes, quotedText, startByte, endByte, what, budget) {
  budget.countSpan();
  const want = Buffer.from(quotedText, "utf8");
  if (endByte - startByte !== want.length) {
    throw new ResolutionError("SPAN_MISMATCH", `${what}: byte range does not match quoted_text length`);
  }
  const actual = bytes.subarray(startByte, endByte);
  if (!actual.equals(want)) {
    throw new ResolutionError("SPAN_MISMATCH", `${what}: quoted_text not found at [${startByte}, ${endByte})`);
  }
  return { start_byte: startByte, end_byte: endByte, quoted_text: quotedText };
}

/** Split text into lines with their UTF-8 byte start offsets. */
export function lineIndex(text) {
  const lines = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const byteLen = Buffer.byteLength(line, "utf8");
    lines.push({ text: line, start_byte: offset, end_byte: offset + byteLen });
    offset += byteLen + 1; // +1 for the \n
  }
  return lines;
}

/** Find the line index containing a byte offset (line start <= off < line end). */
export function lineIndexOf(lines, byteOffset) {
  for (let i = 0; i < lines.length; i++) {
    if (byteOffset >= lines[i].start_byte && byteOffset < lines[i].end_byte) return i;
  }
  return lines.length - 1;
}
