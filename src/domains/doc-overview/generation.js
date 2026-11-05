// FORGE Doc-to-Overview — slice B: local, extractive generation.
//
// Generation here is deliberately NOT a model call. No local LLM is
// guaranteed to be installed, and the brief requires every factual
// assertion to link to an admitted source with an exact hash — so slice B
// generates by selecting and arranging sentences that already exist in
// the admitted extracts, each carried with its citation (document,
// locator, extract checksum, quoted sentence). Nothing is paraphrased
// into a new claim, nothing is invented, and anything that cannot be
// grounded is recorded as NEEDS REVIEW instead of presented as fact.
//
// Document text is untrusted data, never instructions: sentences that
// read like embedded instructions ("ignore previous instructions…",
// "disregard…", "you are now…") are EXCLUDED from selection and listed
// in `excludedSentences` — the generator never follows them and never
// emits them as its own guidance. They may still be quoted as content
// only when a curator explicitly edits them in with a citation (see
// generate.js), never by generation itself.
//
// Determinism: the same manifest + extracts always produce the same
// content byte-for-byte (selection order is by document order, then
// position in the extract; no timestamps or randomness in output).
// `generatedAt` is stamped by the application layer, not here.

import { sha256Hex } from "./sourceSets.js";
import {
  MAX_CONCEPTS,
  MAX_CONTEXT_SENTENCES,
  MAX_EXPLAINER_SENTENCES,
  MAX_FINDING_CHARS,
  MAX_FINDINGS_PER_INFOGRAPHIC,
  MAX_GLOSSARY_ENTRIES,
  MAX_SUMMARY_SENTENCES,
  MIN_FINDING_CHARS,
  MIN_FINDINGS_PER_INFOGRAPHIC,
} from "./limits.js";

export const GENERATION_METHOD = "extractive-local-v1";

// Sentences that read like instructions embedded in a source document.
// These are inert data, never directions to this tool: generation skips
// them entirely (see module header) and records the exclusion.
const INSTRUCTION_LIKE = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /\bdisregard\b/i,
  /\byou\s+are\s+now\b/i,
  /\bas\s+an\s+ai\b/i,
  /\bsystem\s+prompt\b/i,
  /\bdo\s+not\s+(follow|obey|use)\b/i,
  /\bnew\s+instructions?:/i,
];

export function isInstructionLike(sentence) {
  return INSTRUCTION_LIKE.some((pattern) => pattern.test(sentence));
}

/**
 * Splits text into sentences on terminal punctuation. A period only
 * ends a sentence when the next word starts with an uppercase letter
 * (or the text ends) — so decimals ("3.5") and initials do not split.
 * Abbreviations such as "Dr." still split (a known rough edge: the
 * following fragment loses its title); sentences are quoted verbatim
 * and cited, so nothing is misattributed by the split.
 */
export function splitSentences(text) {
  if (typeof text !== "string") return [];
  const sentences = [];
  let start = 0;
  const boundary = /[.!?]+["')\]]*(?=\s+(?:["'(]*[A-Z])|\s*$)/g;
  let match;
  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const sentence = text.slice(start, end).trim();
    if (sentence.length > 0) sentences.push(sentence);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) sentences.push(tail);
  return sentences;
}

function locatorLabel(locator) {
  if (locator?.type === "page") return `page ${locator.page}`;
  if (locator?.type === "section") return `section "${locator.name}"`;
  return "unknown location";
}

export function citationFor(extract, quote) {
  return {
    documentId: extract.documentId,
    locator: extract.locator,
    locatorLabel: locatorLabel(extract.locator),
    checksum: extract.checksum,
    quote,
  };
}

function flattenSentences(extracts) {
  const out = [];
  for (const extract of extracts) {
    // Section extracts include their markdown heading line (slice A
    // keeps it as part of the section text). Headings are structure,
    // not sentences: strip them before splitting, or the heading
    // glues onto the first sentence ("## Overview Photosynthesis
    // is…"). Quotes remain verbatim substrings of the extract text.
    const body = extract.text
      .split(/\r?\n/)
      .filter((line) => !/^#{1,6}\s/.test(line))
      .join("\n");
    for (const sentence of splitSentences(body)) {
      out.push({ sentence, extract });
    }
  }
  return out;
}

function isUsableSentence(sentence) {
  const trimmed = sentence.trim();
  if (trimmed.length < 20 || trimmed.length > 600) return false;
  if (isInstructionLike(trimmed)) return false;
  return true;
}

function pickSummary(candidates, used) {
  // Prefer the opening sentence of each extract (usually the topic
  // sentence), in document order, then fill from the front.
  const picked = [];
  const byExtract = new Map();
  for (const candidate of candidates) {
    if (!byExtract.has(candidate.extract)) byExtract.set(candidate.extract, []);
    byExtract.get(candidate.extract).push(candidate);
  }
  for (const list of byExtract.values()) {
    const first = list[0];
    if (first && !used.has(first.sentence)) {
      picked.push(first);
      used.add(first.sentence);
      if (picked.length >= MAX_SUMMARY_SENTENCES) return picked;
    }
  }
  for (const candidate of candidates) {
    if (picked.length >= MAX_SUMMARY_SENTENCES) break;
    if (!used.has(candidate.sentence)) {
      picked.push(candidate);
      used.add(candidate.sentence);
    }
  }
  return picked;
}

const DEFINITIONAL = /^([A-Z][A-Za-z0-9 '’&,-]{1,48}?)\s+(is|are|refers to|means|describes)\b/i;

function pickConcepts(candidates, used) {
  const picked = [];
  for (const candidate of candidates) {
    if (picked.length >= MAX_CONCEPTS) break;
    if (used.has(candidate.sentence)) continue;
    const match = candidate.sentence.match(DEFINITIONAL);
    if (!match) continue;
    picked.push(candidate);
    used.add(candidate.sentence);
  }
  return picked;
}

function glossaryFrom(concepts) {
  const entries = [];
  const seen = new Set();
  for (const concept of concepts) {
    const match = concept.sentence.match(DEFINITIONAL);
    if (!match) continue;
    const term = match[1].trim();
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      term,
      definition: concept.sentence,
      citations: [citationFor(concept.extract, concept.sentence)],
    });
    if (entries.length >= MAX_GLOSSARY_ENTRIES) break;
  }
  return entries;
}

function toAssertion(candidate) {
  return { text: candidate.sentence, citations: [citationFor(candidate.extract, candidate.sentence)] };
}

function collectReferences(assertions) {
  // A reference identifies one quoted passage, not one extract: several
  // sentences can come from the same extract, and collapsing them
  // would lose all but the first quote (the citation index audits
  // edits against this list, so it must hold every quoted passage).
  const seen = new Set();
  const references = [];
  for (const assertion of assertions) {
    for (const citation of assertion.citations ?? []) {
      const key = `${citation.documentId}|${JSON.stringify(citation.locator)}|${citation.checksum}|${citation.quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push(citation);
    }
  }
  return references;
}

/**
 * Generates a written explainer draft from admitted extracts.
 * Input: { manifest, extracts } — extracts as returned by
 * extractForManifest (each with documentId, locator, text, checksum).
 * Output: content object (see module header) — every assertion carries
 * a citation; thin material yields NEEDS REVIEW entries, never invented
 * claims. `title` comes from the manifest name; the curator may rename
 * it on edit.
 */
export function generateExplainer({ manifest, extracts }) {
  const needsReview = [];
  const excludedSentences = [];
  const flat = flattenSentences(extracts ?? []);
  for (const { sentence } of flat) {
    if (isInstructionLike(sentence.trim())) {
      excludedSentences.push({ text: sentence.trim(), reason: "INSTRUCTION_LIKE" });
    }
  }
  const candidates = flat.filter(({ sentence }) => isUsableSentence(sentence));
  const used = new Set();

  // Definitional sentences are claimed for key concepts FIRST: they
  // are the most valuable sentences in a reference, and letting the
  // summary take them would leave the concepts (and glossary) thin.
  const conceptCandidates = pickConcepts(candidates, used);
  const keyConcepts = conceptCandidates.map(toAssertion);
  const glossary = glossaryFrom(conceptCandidates);
  const summary = pickSummary(candidates, used).map(toAssertion);

  const context = [];
  for (const candidate of candidates) {
    if (context.length >= MAX_CONTEXT_SENTENCES) break;
    if (used.has(candidate.sentence)) continue;
    context.push(toAssertion(candidate));
    used.add(candidate.sentence);
  }

  const totalAssertions = summary.length + keyConcepts.length + context.length;
  if (totalAssertions === 0) {
    needsReview.push({
      code: "INSUFFICIENT_GROUNDED_MATERIAL",
      message: "No usable source sentences were found in the admitted ranges; the explainer cannot state anything grounded. Add material or narrow the ranges.",
    });
  } else if (totalAssertions < 3) {
    needsReview.push({
      code: "THIN_GROUNDED_MATERIAL",
      message: `Only ${totalAssertions} grounded assertion(s) could be drawn from the admitted ranges; the explainer is thin and should be reviewed before approval.`,
    });
  }
  if ((extracts ?? []).length === 0) {
    needsReview.push({
      code: "NO_EXTRACTS",
      message: "The manifest produced no extracts (all admitted ranges were blank); nothing is grounded.",
    });
  }
  if (summary.length === 0 && totalAssertions > 0) {
    needsReview.push({
      code: "NO_SUMMARY",
      message: "No opening sentence could be selected for the summary; the summary section is empty.",
    });
  }

  // Glossary citations count as used citations too: they must appear
  // in References, or the audit would flag them as missing.
  const allAssertions = [
    ...summary,
    ...keyConcepts,
    ...context,
    ...glossary.map((entry) => ({ text: entry.definition, citations: entry.citations })),
  ];
  const references = collectReferences(allAssertions);
  const title = typeof manifest?.name === "string" && manifest.name.trim().length > 0
    ? manifest.name.trim()
    : "Untitled overview";
  return {
    kind: "explainer",
    title,
    summary,
    keyConcepts,
    context,
    glossary,
    caveats: [
      {
        text: "Every claim in this explainer is a sentence taken verbatim from the admitted source ranges listed under References; nothing has been paraphrased into a new claim. Sentences are shown in source order, not ranked by importance.",
        citations: [],
      },
      {
        text: "This draft covers only the admitted ranges. Material outside those ranges — including later pages or sections — is not represented here.",
        citations: [],
      },
    ],
    references,
    needsReview,
    excludedSentences,
    method: GENERATION_METHOD,
    sourceSetHash: manifest?.sourceSetHash ?? null,
  };
}

/**
 * Selects 3–7 infographic findings from admitted extracts. A finding
 * is one concise source sentence (40–240 chars), drawn from as many
 * different documents as possible. Fewer than 3 groundable findings
 * yields NEEDS REVIEW — findings are never invented to fill the page.
 */
export function generateInfographicFindings({ manifest, extracts }) {
  const needsReview = [];
  const excludedSentences = [];
  const flat = flattenSentences(extracts ?? []);
  for (const { sentence } of flat) {
    if (isInstructionLike(sentence.trim())) {
      excludedSentences.push({ text: sentence.trim(), reason: "INSTRUCTION_LIKE" });
    }
  }
  const concise = flat.filter(({ sentence }) => {
    const trimmed = sentence.trim();
    return trimmed.length >= MIN_FINDING_CHARS
      && trimmed.length <= MAX_FINDING_CHARS
      && !isInstructionLike(trimmed);
  });

  // Diversity first: one finding per document in order, then fill.
  const findings = [];
  const usedDocs = new Set();
  const usedSentences = new Set();
  for (const candidate of concise) {
    if (findings.length >= MAX_FINDINGS_PER_INFOGRAPHIC) break;
    if (usedDocs.has(candidate.extract.documentId)) continue;
    findings.push(toAssertion(candidate));
    usedDocs.add(candidate.extract.documentId);
    usedSentences.add(candidate.sentence);
  }
  for (const candidate of concise) {
    if (findings.length >= MAX_FINDINGS_PER_INFOGRAPHIC) break;
    if (usedSentences.has(candidate.sentence)) continue;
    findings.push(toAssertion(candidate));
    usedSentences.add(candidate.sentence);
  }

  if (findings.length < MIN_FINDINGS_PER_INFOGRAPHIC) {
    needsReview.push({
      code: "INSUFFICIENT_GROUNDED_MATERIAL",
      message: `Only ${findings.length} concise grounded finding(s) could be drawn from the admitted ranges (3–7 required); the infographic is incomplete and must not be approved as a full overview.`,
    });
  }
  const references = collectReferences(findings);
  const title = typeof manifest?.name === "string" && manifest.name.trim().length > 0
    ? manifest.name.trim()
    : "Untitled overview";
  return {
    kind: "infographic",
    title,
    findings,
    references,
    needsReview,
    excludedSentences,
    method: GENERATION_METHOD,
    sourceSetHash: manifest?.sourceSetHash ?? null,
  };
}

/**
 * Audits generated (or curator-edited) content against the admitted
 * extracts. Every assertion must carry at least one citation, and every
 * citation must resolve: the document must be in the manifest, the
 * locator must match an extract from that document, the checksum must
 * equal that extract's checksum, and the quoted sentence must appear
 * verbatim in the extract text. Caveats are editorial (about the
 * artifact itself) and are not audited for citations.
 * Returns { ok, issues: [{ code, message }] } — fail closed on any
 * issue. `citationIndex` (optional) audits against a recorded
 * reference list instead of live extracts (used for edits, where the
 * extracts are not re-supplied; see generate.js).
 */
export function auditCitations({ content, manifest, extracts, citationIndex }) {
  const issues = [];
  const sections = [];
  if (content?.kind === "explainer") {
    sections.push(...(content.summary ?? []), ...(content.keyConcepts ?? []), ...(content.context ?? []));
    for (const entry of content.glossary ?? []) {
      sections.push({ text: entry.definition ?? "", citations: entry.citations ?? [] });
    }
  } else if (content?.kind === "infographic") {
    sections.push(...(content.findings ?? []));
  } else {
    return { ok: false, issues: [{ code: "INVALID_CONTENT", message: "content.kind must be explainer or infographic." }] };
  }

  const manifestDocs = new Map((manifest?.documents ?? []).map((d) => [d.documentId, d]));
  const extractByKey = new Map();
  for (const extract of extracts ?? []) {
    extractByKey.set(`${extract.documentId}|${JSON.stringify(extract.locator)}`, extract);
  }
  const indexByKey = new Map();
  for (const citation of citationIndex ?? []) {
    // Several sentences can come from one extract, so several recorded
    // citations share a document+locator. The index groups by locator;
    // the quote disambiguates within the group (see checkCitation).
    const key = `${citation.documentId}|${JSON.stringify(citation.locator)}`;
    if (!indexByKey.has(key)) indexByKey.set(key, []);
    indexByKey.get(key).push(citation);
  }

  const checkCitation = (citation, where) => {
    if (!citation || typeof citation.documentId !== "string") {
      issues.push({ code: "INVALID_CITATION", message: `${where}: citation is missing a documentId.` });
      return;
    }
    if (manifest && !manifestDocs.has(citation.documentId)) {
      issues.push({ code: "INVALID_CITATION", message: `${where}: citation names document ${citation.documentId}, which is not in the source set.` });
      return;
    }
    const key = `${citation.documentId}|${JSON.stringify(citation.locator)}`;
    if (citationIndex) {
      const recordedAtLocator = indexByKey.get(key);
      if (!recordedAtLocator || recordedAtLocator.length === 0) {
        issues.push({ code: "LOCATOR_MISMATCH", message: `${where}: citation locator does not match any passage admitted for ${citation.documentId}.` });
        return;
      }
      // The locator alone does not identify a passage (one extract
      // holds many sentences): the quote must match a recorded
      // passage at that locator, verbatim.
      const recorded = recordedAtLocator.find((r) => r.quote === citation.quote);
      if (!recorded) {
        issues.push({ code: "QUOTE_MISMATCH", message: `${where}: quoted text does not match any admitted passage at that locator for ${citation.documentId}.` });
        return;
      }
      if (recorded.checksum !== citation.checksum) {
        issues.push({ code: "CHECKSUM_MISMATCH", message: `${where}: citation checksum does not match the admitted passage for ${citation.documentId}.` });
      }
      return;
    }
    const extract = extractByKey.get(key);
    if (!extract) {
      issues.push({ code: "LOCATOR_MISMATCH", message: `${where}: citation locator does not match any admitted extract for ${citation.documentId}.` });
      return;
    }
    if (extract.checksum !== citation.checksum) {
      issues.push({ code: "CHECKSUM_MISMATCH", message: `${where}: citation checksum does not match the admitted extract for ${citation.documentId}.` });
    }
    if (typeof citation.quote === "string" && citation.quote.length > 0 && !extract.text.includes(citation.quote)) {
      issues.push({ code: "QUOTE_MISMATCH", message: `${where}: quoted text does not appear verbatim in the admitted extract for ${citation.documentId}.` });
    }
  };

  sections.forEach((assertion, i) => {
    const where = `assertion ${i + 1}`;
    if (!Array.isArray(assertion?.citations) || assertion.citations.length === 0) {
      issues.push({ code: "UNSOURCED_ASSERTION", message: `${where} carries no citation; every factual assertion must cite an admitted source.` });
      return;
    }
    // A cited assertion must present the quoted source sentence, not
    // reworded words under a real citation: the assertion text must
    // equal at least one of its citations' quotes. Rewording without
    // re-quoting is an unsourced editorial claim, not a sourced fact.
    const quotes = assertion.citations.map((c) => c?.quote).filter((q) => typeof q === "string");
    if (typeof assertion.text === "string" && assertion.text.length > 0 && !quotes.includes(assertion.text)) {
      issues.push({ code: "QUOTE_MISMATCH", message: `${where}: assertion text does not match any of its quoted source passages; reworded words cannot ride on a citation.` });
    }
    for (const citation of assertion.citations) checkCitation(citation, where);
  });

  // The references list must cover every citation actually used — a
  // reference that is listed but unused, or used but unlisted, means
  // the provenance record does not describe the content. Keys include
  // the quote: several passages share one document+locator.
  const usedKeys = new Set();
  for (const assertion of sections) {
    for (const citation of assertion.citations ?? []) {
      usedKeys.add(`${citation.documentId}|${JSON.stringify(citation.locator)}|${citation.checksum}|${citation.quote}`);
    }
  }
  for (const reference of content.references ?? []) {
    const key = `${reference.documentId}|${JSON.stringify(reference.locator)}|${reference.checksum}|${reference.quote}`;
    if (!usedKeys.has(key)) {
      issues.push({ code: "UNUSED_REFERENCE", message: `reference to ${reference.documentId} is listed but no assertion cites it.` });
    }
  }
  for (const key of usedKeys) {
    const listed = (content.references ?? []).some(
      (r) => `${r.documentId}|${JSON.stringify(r.locator)}|${r.checksum}|${r.quote}` === key,
    );
    if (!listed) {
      issues.push({ code: "MISSING_REFERENCE", message: "an assertion cites a passage that is not listed in References." });
      break;
    }
  }

  // Source-set hash recorded on the content must match the manifest it
  // was built on; a mismatch means the content predates a source change.
  if (manifest && content.sourceSetHash != null && content.sourceSetHash !== manifest.sourceSetHash) {
    issues.push({ code: "SOURCE_SET_CHANGED", message: "content was generated on a different source-set hash than the current manifest." });
  }
  if (content.sourceSetHash == null) {
    issues.push({ code: "MISSING_SOURCE_HASH", message: "content carries no source-set hash." });
  }

  return { ok: issues.length === 0, issues };
}

export { sha256Hex };
