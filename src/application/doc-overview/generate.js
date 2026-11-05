// FORGE Doc-to-Overview — slice B: generation + review orchestration.
//
// Application layer over slice A's store/picker and slice B's domain
// modules. The curator's flow, end to end:
//
//   generate → draft (watermarked preview) → edit → submit → approve
//   → keep → export. Discard ends the draft from any non-terminal
//   status. Reload preserves retained artifacts and approval records
//   (the store is the record; nothing lives only in memory).
//
// Rules enforced here (not hoped for upstream):
// - Generation re-verifies source hashes through extractForManifest:
//   a changed source fails with STALE_SOURCE and generates nothing, so
//   citations can never point at words that moved.
// - Generated content passes the citation audit before it is stored;
//   a failed audit fails the generation (fail closed, never a draft
//   with broken provenance).
// - Approve and keep re-check freshness against the CURRENT manifest:
//   a stale artifact is invalidated (approved/kept drop back to
//   needs_review) and the action is refused with STALE_SOURCE.
// - Edits are explicit curator actions with an actor. Edited
//   assertions are re-audited against the citation index recorded at
//   generation time — an edit may only cite passages that were
//   admitted, verbatim. Reworded words cannot ride on a citation.
// - Approval with open NEEDS REVIEW items is allowed (a thin draft is
//   still a real draft — regeneration is deterministic, so refusing
//   would brick thin drafts forever), but the open items are recorded
//   on the approval record and stay visible in the artifact and its
//   export. Approval never hides an open NEEDS REVIEW.
// - Export is an explicit curator action on approved/kept artifacts
//   only. Drafts are previewed, never exported.
// - The actor is always the authenticated identity handed in by the
//   caller (the route layer derives it from the session); it is never
//   taken from document text or from an untrusted request field.
// - No network, no scheduler, no agent-memory write, no paid call:
//   this module only touches the local store it was given.

import path from "node:path";
import { createDraftStore } from "./draftStore.js";
import { extractForManifest } from "./picker.js";
import {
  auditCitations,
  generateExplainer,
  generateInfographicFindings,
} from "@/domains/doc-overview/generation.js";
import {
  describeInfographic,
  renderInfographicSvg,
} from "@/domains/doc-overview/infographic.js";
import {
  renderExplainerHtml,
  renderExplainerMarkdown,
  renderInfographicHtml,
} from "@/domains/doc-overview/preview.js";
import {
  canonicalJson,
  sha256Hex,
} from "@/domains/doc-overview/sourceSets.js";
import {
  checkFreshness,
  createDraftArtifact,
  invalidateIfStale,
  transitionArtifact,
} from "@/domains/doc-overview/artifacts.js";
import { MAX_CONTENT_CHARS, MAX_EDIT_CHARS, MAX_TOTAL_CHARS } from "@/domains/doc-overview/limits.js";

/** Store root: env override, else the repo's gitignored data/ directory. */
export function resolveDocOverviewRoot() {
  if (typeof process.env.DOC_OVERVIEW_ROOT === "string" && process.env.DOC_OVERVIEW_ROOT.trim() !== "") {
    return process.env.DOC_OVERVIEW_ROOT;
  }
  return path.join(process.cwd(), "data", "doc-overview");
}

export function createDocOverviewStore(principal, root = resolveDocOverviewRoot()) {
  return createDraftStore(root, principal);
}

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

function contentHashFor(content) {
  return sha256Hex(canonicalJson(content));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function publicArtifact(artifact) {
  return artifact;
}

function artifactSummary(artifact) {
  return {
    id: artifact.id,
    sourceSetId: artifact.sourceSetId,
    type: artifact.type,
    status: artifact.status,
    version: artifact.version,
    stale: artifact.stale,
    createdBy: artifact.createdBy,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    reviewHistory: artifact.reviewHistory,
  };
}

/**
 * Generates explainer + infographic drafts on a saved manifest.
 * `documents` is the texts map extractForManifest expects:
 * { [documentId]: { text, pages? } }. `curator` is the authenticated
 * curator identity (id string). Returns { ok, artifacts } with one
 * summary per created draft, or { ok: false, error }.
 */
export function generateDrafts({ store, manifestId, documents, curator }, options = {}) {
  if (!isNonEmptyString(manifestId)) return fail("INVALID_MANIFEST", "manifestId is required.");
  if (!isNonEmptyString(curator)) return fail("INVALID_ACTOR", "curator identity is required.");
  const manifest = store.getSourceSet(manifestId);
  if (!manifest) return fail("NOT_FOUND", `no source set ${manifestId} for this owner.`);
  if (!documents || typeof documents !== "object") {
    return fail("INVALID_DOCUMENTS", "documents (texts by document id) are required.");
  }
  // Defense in depth: the picker bounds total size at manifest time,
  // but generation re-checks the supplied texts before hashing or
  // extracting — a caller must never be able to push an unbounded
  // body through this path.
  const suppliedChars = Object.values(documents).reduce(
    (sum, doc) => sum + (typeof doc?.text === "string" ? doc.text.length : 0),
    0,
  );
  if (suppliedChars > MAX_TOTAL_CHARS) {
    return fail("TOTAL_OVERSIZED", `supplied source texts have ${suppliedChars} characters (limit ${MAX_TOTAL_CHARS}).`);
  }
  const extracted = extractForManifest(manifest, documents);
  if (!extracted.ok) return { ok: false, error: extracted.error };

  const now = options.now ?? new Date().toISOString();
  const explainerContent = generateExplainer({ manifest, extracts: extracted.extracts });
  const findings = generateInfographicFindings({ manifest, extracts: extracted.extracts });
  const infographicContent = {
    ...findings,
    svg: renderInfographicSvg({
      title: findings.title,
      findings: findings.findings,
      references: findings.references,
      watermark: true,
    }),
    altText: describeInfographic(findings),
  };

  for (const [label, content] of [["explainer", explainerContent], ["infographic", infographicContent]]) {
    const audit = auditCitations({ content, manifest, extracts: extracted.extracts });
    if (!audit.ok) {
      return {
        ok: false,
        error: {
          code: "CITATION_AUDIT_FAILED",
          message: `${label} draft failed its citation audit and was not stored: ${audit.issues.map((i) => i.code).join(", ")}`,
          issues: audit.issues,
        },
      };
    }
    if (JSON.stringify(content).length > MAX_CONTENT_CHARS) {
      return fail("CONTENT_TOO_LARGE", `${label} content exceeds ${MAX_CONTENT_CHARS} characters.`);
    }
  }

  const created = [];
  for (const [type, content] of [["explainer", explainerContent], ["infographic", infographicContent]]) {
    const shell = createDraftArtifact({ sourceSet: manifest, type, createdBy: curator }, options);
    if (!shell.ok) return { ok: false, error: shell.errors[0] };
    const artifact = {
      ...shell.artifact,
      ownerId: store.boundOwner,
      content,
      contentHash: contentHashFor(content),
      generatedAt: now,
    };
    store.saveDraft(artifact);
    created.push(artifactSummary(artifact));
  }
  return { ok: true, artifacts: created };
}

/** Lists the owner's drafts (summaries, no content). */
export function listArtifacts({ store }) {
  const artifacts = store.listDrafts()
    .map((id) => store.getDraft(id))
    .filter((artifact) => artifact !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return { ok: true, artifacts: artifacts.map(artifactSummary) };
}

/**
 * Returns one draft with its watermarked preview HTML. Freshness is
 * reported, not hidden: a stale draft previews with a STALE banner.
 */
export function getArtifactPreview({ store, artifactId }) {
  if (!isNonEmptyString(artifactId)) return fail("INVALID_ARTIFACT", "artifactId is required.");
  const artifact = store.getDraft(artifactId);
  if (!artifact) return fail("NOT_FOUND", `no draft ${artifactId} for this owner.`);
  const manifest = store.getSourceSet(artifact.sourceSetId);
  const { fresh } = manifest ? checkFreshness(artifact, manifest) : { fresh: false };
  const watermark = artifact.status === "draft" || artifact.status === "needs_review";
  const html = artifact.type === "explainer"
    ? renderExplainerHtml(artifact.content, { watermark, stale: !fresh })
    : renderInfographicHtml(artifact.content, { watermark, stale: !fresh });
  return { ok: true, artifact: publicArtifact(artifact), stale: !fresh, html };
}

function rebuildReferences(content) {
  const sections = content.kind === "explainer"
    ? [...(content.summary ?? []), ...(content.keyConcepts ?? []), ...(content.context ?? []),
      ...(content.glossary ?? []).map((entry) => ({ text: entry.definition, citations: entry.citations }))]
    : [...(content.findings ?? [])];
  const seen = new Set();
  const references = [];
  for (const assertion of sections) {
    for (const citation of assertion.citations ?? []) {
      // Keyed by passage (quote included), like collectReferences in
      // generation.js: several passages share one document+locator.
      const key = `${citation.documentId}|${JSON.stringify(citation.locator)}|${citation.checksum}|${citation.quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push(citation);
    }
  }
  return references;
}

function validateEditedContent(edited, artifact) {
  const errors = [];
  if (!edited || typeof edited !== "object") {
    return [{ code: "INVALID_EDIT", message: "editedContent is required." }];
  }
  if (edited.kind !== artifact.type) {
    errors.push({ code: "INVALID_EDIT", message: `editedContent.kind must be ${artifact.type}.` });
  }
  const sections = edited.kind === "explainer"
    ? ["summary", "keyConcepts", "context", "glossary"]
    : ["findings"];
  for (const section of sections) {
    if (edited[section] !== undefined && !Array.isArray(edited[section])) {
      errors.push({ code: "INVALID_EDIT", message: `editedContent.${section} must be an array.` });
    }
  }
  if (edited.title !== undefined && typeof edited.title !== "string") {
    errors.push({ code: "INVALID_EDIT", message: "editedContent.title must be a string." });
  }
  if (JSON.stringify(edited).length > MAX_EDIT_CHARS) {
    errors.push({ code: "EDIT_TOO_LARGE", message: `editedContent exceeds ${MAX_EDIT_CHARS} characters.` });
  }
  return errors;
}

function applyEdit(artifact, edited, { actor, now }) {
  // Whitelist the editable fields: an edit can change the words and
  // their citations, never the provenance, status, or identity.
  const current = artifact.content;
  const next = {
    ...current,
    kind: artifact.type,
    title: typeof edited.title === "string" && edited.title.trim() !== "" ? edited.title.trim() : current.title,
    sourceSetHash: current.sourceSetHash,
    needsReview: current.needsReview ?? [],
    excludedSentences: current.excludedSentences ?? [],
  };
  if (artifact.type === "explainer") {
    next.summary = edited.summary ?? current.summary ?? [];
    next.keyConcepts = edited.keyConcepts ?? current.keyConcepts ?? [];
    next.context = edited.context ?? current.context ?? [];
    next.glossary = edited.glossary ?? current.glossary ?? [];
    next.caveats = current.caveats ?? [];
  } else {
    next.findings = edited.findings ?? current.findings ?? [];
    next.svg = renderInfographicSvg({
      title: next.title,
      findings: next.findings,
      references: rebuildReferences(next),
      watermark: true,
    });
    next.altText = describeInfographic(next);
  }
  next.references = rebuildReferences(next);
  return {
    ...artifact,
    content: next,
    contentHash: contentHashFor(next),
    version: artifact.version + 1,
    updatedAt: now,
    reviewHistory: [
      ...artifact.reviewHistory,
      { action: "edit", actor, reason: "curator edit", fromStatus: artifact.status, toStatus: artifact.status, at: now },
    ],
  };
}

/**
 * Applies one curator review action: edit, submit, approve, revise,
 * keep, discard. `actor` is the authenticated identity. Approve and
 * keep first re-check freshness against the current manifest; a stale
 * artifact is invalidated and the action refused. Returns the updated
 * artifact summary, or { ok: false, error }.
 */
export function reviewArtifact({ store, artifactId, action, actor, reason, editedContent }, options = {}) {
  if (!isNonEmptyString(artifactId)) return fail("INVALID_ARTIFACT", "artifactId is required.");
  if (!isNonEmptyString(actor)) return fail("INVALID_ACTOR", "actor is required for every review action.");
  const artifact = store.getDraft(artifactId);
  if (!artifact) return fail("NOT_FOUND", `no draft ${artifactId} for this owner.`);
  const now = options.now ?? new Date().toISOString();

  if (action === "edit") {
    if (artifact.status !== "draft" && artifact.status !== "needs_review") {
      return fail("ILLEGAL_TRANSITION", `cannot edit an artifact in status ${artifact.status}.`);
    }
    const errors = validateEditedContent(editedContent, artifact);
    if (errors.length > 0) return { ok: false, error: errors[0] };
    const manifest = store.getSourceSet(artifact.sourceSetId);
    // An edit on a needs_review artifact sends it back to draft (the
    // revise transition) before the edit lands; a draft stays a draft.
    // Two recorded actions in the revise case, one version bump each —
    // both visible in the review history.
    let base = artifact;
    if (artifact.status === "needs_review") {
      const revised = transitionArtifact(artifact, { action: "revise", actor, reason: reason ?? "curator edit" }, { now });
      if (!revised.ok) return { ok: false, error: revised.errors[0] };
      base = revised.artifact;
    }
    const edited = applyEdit(base, editedContent, { actor, now });
    const audit = auditCitations({
      content: edited.content,
      manifest,
      citationIndex: artifact.content.references ?? [],
    });
    if (!audit.ok) {
      return {
        ok: false,
        error: {
          code: "CITATION_AUDIT_FAILED",
          message: `edited content failed its citation audit and was not stored: ${audit.issues.map((i) => i.code).join(", ")}`,
          issues: audit.issues,
        },
      };
    }
    store.saveDraft(edited);
    return { ok: true, artifact: artifactSummary(edited) };
  }

  if (!["submit", "approve", "revise", "keep", "discard"].includes(action)) {
    return fail("INVALID_ACTION", `action must be one of: edit, submit, approve, revise, keep, discard.`);
  }

  if (action === "approve" || action === "keep") {
    const manifest = store.getSourceSet(artifact.sourceSetId);
    const { fresh, staleReasons } = manifest
      ? checkFreshness(artifact, manifest)
      : { fresh: false, staleReasons: [{ code: "MANIFEST_MISSING", message: "the source set is gone." }] };
    if (!fresh) {
      const invalidated = invalidateIfStale(artifact, manifest, { actor }, { now });
      if (invalidated.ok && invalidated.invalidated) store.saveDraft(invalidated.artifact);
      return {
        ok: false,
        error: {
          code: "STALE_SOURCE",
          message: `a source changed since this draft was generated (${staleReasons.map((r) => r.code).join(", ")}); regenerate and re-review before ${action}.`,
          staleReasons,
        },
        artifact: invalidated.ok ? artifactSummary(invalidated.artifact) : undefined,
      };
    }
  }

  const openNeedsReview = (artifact.content?.needsReview ?? []).map((item) => item.code);
  const transition = transitionArtifact(
    artifact,
    {
      action,
      actor,
      reason: reason ?? (action === "approve" && openNeedsReview.length > 0
        ? `approved with open NEEDS REVIEW items: ${openNeedsReview.join(", ")}`
        : null),
    },
    { now },
  );
  if (!transition.ok) return { ok: false, error: transition.errors[0] };
  store.saveDraft(transition.artifact);
  return { ok: true, artifact: artifactSummary(transition.artifact) };
}

/**
 * Exports an approved or kept artifact. Drafts are previewed, never
 * exported; a stale artifact is invalidated and refused. Returns
 * { ok, filename, mimeType, content }.
 */
export function exportArtifact({ store, artifactId }, options = {}) {
  if (!isNonEmptyString(artifactId)) return fail("INVALID_ARTIFACT", "artifactId is required.");
  const artifact = store.getDraft(artifactId);
  if (!artifact) return fail("NOT_FOUND", `no draft ${artifactId} for this owner.`);
  const actor = options.actor ?? artifact.createdBy;
  const now = options.now ?? new Date().toISOString();
  const manifest = store.getSourceSet(artifact.sourceSetId);
  const { fresh, staleReasons } = manifest
    ? checkFreshness(artifact, manifest)
    : { fresh: false, staleReasons: [{ code: "MANIFEST_MISSING", message: "the source set is gone." }] };
  // Freshness is checked before the status gate: an approved artifact
  // whose sources changed reports the actionable reason (regenerate)
  // rather than a generic export refusal.
  if (!fresh) {
    const invalidated = invalidateIfStale(artifact, manifest, { actor }, { now });
    if (invalidated.ok && invalidated.invalidated) store.saveDraft(invalidated.artifact);
    return {
      ok: false,
      error: {
        code: "STALE_SOURCE",
        message: `a source changed since this artifact was approved (${staleReasons.map((r) => r.code).join(", ")}); regenerate and re-review before export.`,
        staleReasons,
      },
    };
  }
  if (artifact.status !== "approved" && artifact.status !== "kept") {
    return fail("NOT_EXPORTABLE", `only approved or kept artifacts can be exported (status is ${artifact.status}).`);
  }
  if (artifact.type === "explainer") {
    return {
      ok: true,
      filename: `${artifact.id}.md`,
      mimeType: "text/markdown; charset=utf-8",
      content: renderExplainerMarkdown(artifact.content),
    };
  }
  return {
    ok: true,
    filename: `${artifact.id}.svg`,
    mimeType: "image/svg+xml; charset=utf-8",
    content: artifact.content.svg,
  };
}
