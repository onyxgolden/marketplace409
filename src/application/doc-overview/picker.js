// FORGE Doc-to-Overview — slice A: the manual source picker.
//
// Application orchestration over the pure domain modules. The picker is
// the curator's selection flow: explicitly named documents in, a validated
// manifest out — or a named hold/rejection list, never a partial manifest
// and never a silent admission.
//
// Flow:
//   1. Set-level bounds (document count, total characters).
//   2. Per document: classification (admit / hold / reject).
//   3. A held document proceeds ONLY with an explicit, attributed human
//      decision ({ decision: "admit", classifier, reason }); a human
//      rejection is recorded as a rejection. No decision → the hold
//      blocks the manifest.
//   4. All admitted → manifest created (hashes computed from content).
//   5. Extraction (extractForManifest) re-verifies content hashes against
//      the manifest before slicing, so a changed source fails here with
//      STALE_SOURCE instead of producing citations to words that moved.
//
// The picker makes no network calls, writes no memory/knowledge store,
// and never changes an artifact's status — status changes live in
// artifacts.js behind explicit curator actions.

import {
  classifyDocument,
} from "@/domains/doc-overview/classification.js";
import {
  computeDocumentHash,
  createSourceSetManifest,
  recordHumanClassification,
} from "@/domains/doc-overview/sourceSets.js";
import {
  extractBounded,
} from "@/domains/doc-overview/extraction.js";
import {
  MAX_DOCUMENTS_PER_SET,
  MAX_TOTAL_CHARS,
} from "@/domains/doc-overview/limits.js";

/**
 * Runs the manual picker over explicitly selected documents.
 * Input documents: { documentId, title, sourceType, text, pages?,
 *   pageCount?, permissionGranted?, permissionBasis? }.
 * `humanDecisions` (optional): [{ documentId, decision: "admit"|"reject",
 *   classifier, reason }] resolving holds from a previous run.
 * Output: { ok: true, manifest } or
 *         { ok: false, manifest: null, holds, rejections }.
 */
export function pickSources(input, options = {}) {
  const holds = [];
  const rejections = [];
  const documents = input?.documents ?? [];

  if (!Array.isArray(input?.documents) || documents.length === 0) {
    return {
      ok: false,
      manifest: null,
      holds,
      rejections: [{ documentId: null, code: "INVALID_DOCUMENTS", message: "at least one document is required." }],
    };
  }
  if (documents.length > MAX_DOCUMENTS_PER_SET) {
    return {
      ok: false,
      manifest: null,
      holds,
      rejections: [{ documentId: null, code: "TOO_MANY_DOCUMENTS", message: `at most ${MAX_DOCUMENTS_PER_SET} documents per source set.` }],
    };
  }
  const totalChars = documents.reduce((sum, d) => sum + (typeof d?.text === "string" ? d.text.length : 0), 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return {
      ok: false,
      manifest: null,
      holds,
      rejections: [{ documentId: null, code: "TOTAL_OVERSIZED", message: `source set has ${totalChars} characters (limit ${MAX_TOTAL_CHARS}).` }],
    };
  }

  const decisions = new Map((input.humanDecisions ?? []).map((d) => [d.documentId, d]));
  const admitted = [];
  const heldDocIds = new Set();

  for (const doc of documents) {
    const classified = classifyDocument(doc);
    if (classified.decision === "admit") {
      admitted.push(doc);
      continue;
    }
    if (classified.decision === "hold") {
      const human = decisions.get(doc.documentId);
      if (human?.decision === "admit" && typeof human.classifier === "string" && human.classifier.trim() !== "" && typeof human.reason === "string" && human.reason.trim() !== "") {
        admitted.push(doc);
        heldDocIds.add(doc.documentId);
        continue;
      }
      if (human?.decision === "reject") {
        rejections.push({ documentId: doc.documentId, code: "HUMAN_REJECTED", message: `Human classification rejected this document: ${human.reason}` });
        continue;
      }
      holds.push({ documentId: doc.documentId, reasons: classified.reasons });
      continue;
    }
    for (const reason of classified.reasons) {
      rejections.push({ documentId: doc.documentId, code: reason.code, message: reason.message });
    }
  }

  if (holds.length > 0 || rejections.length > 0) {
    return { ok: false, manifest: null, holds, rejections };
  }

  const created = createSourceSetManifest(
    {
      name: input.name,
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      curator: input.curator,
      purpose: input.purpose,
      documents: admitted.map((doc) => ({
        documentId: doc.documentId,
        title: doc.title,
        sourceType: doc.sourceType,
        contentHash: computeDocumentHash(doc.text),
        ranges: doc.ranges,
        permission: { granted: true, basis: doc.permissionBasis },
        pageCount: doc.pages ? doc.pages.length : (doc.pageCount ?? null),
        charCount: doc.text.length,
      })),
    },
    options,
  );
  if (!created.ok) {
    return {
      ok: false,
      manifest: null,
      holds,
      rejections: created.errors.map((e) => ({ documentId: null, code: e.code, message: e.message })),
    };
  }

  // Record human admissions on the manifest (attributed, versioned) —
  // only for documents that were actually held; a human note attached
  // to a naturally admitted document is not a classification event.
  let manifest = created.manifest;
  for (const doc of admitted) {
    if (!heldDocIds.has(doc.documentId)) continue;
    const human = decisions.get(doc.documentId);
    if (human?.decision === "admit") {
      const recorded = recordHumanClassification(
        manifest,
        { documentId: doc.documentId, decision: "admit", classifier: human.classifier, reason: human.reason },
        options,
      );
      if (recorded.ok) manifest = recorded.manifest;
    }
  }
  return { ok: true, manifest, holds: [], rejections: [] };
}

/**
 * Extracts a manifest's allowed ranges from supplied document texts.
 * `textsById`: { [documentId]: { text, pages? } }. Each text's hash is
 * verified against the manifest first: a changed source fails with
 * STALE_SOURCE and extracts nothing, so citations can never point at
 * words that are no longer in the source.
 */
export function extractForManifest(manifest, textsById) {
  const allExtracts = [];
  for (const entry of manifest.documents) {
    const supplied = textsById[entry.documentId];
    if (!supplied || typeof supplied.text !== "string") {
      return { ok: false, extracts: [], error: { code: "MISSING_SOURCE", message: `no text supplied for ${entry.documentId}.` } };
    }
    if (computeDocumentHash(supplied.text) !== entry.contentHash) {
      return { ok: false, extracts: [], error: { code: "STALE_SOURCE", message: `source ${entry.documentId} changed since the manifest was created; re-create the manifest before extracting.` } };
    }
    const extracted = extractBounded({
      document: { id: entry.documentId, text: supplied.text, pages: supplied.pages },
      ranges: entry.ranges,
    });
    if (!extracted.ok) return { ok: false, extracts: [], error: extracted.error };
    allExtracts.push(...extracted.extracts);
  }
  return { ok: true, extracts: allExtracts, error: null };
}
