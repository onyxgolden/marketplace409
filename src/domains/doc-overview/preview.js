// FORGE Doc-to-Overview — slice B: preview and export rendering.
//
// Two renderings of the same artifact content:
//
// - Markdown: the explainer export format (and the text a curator
//   copies out). Citations are inline as [n] references to a numbered
//   References section carrying document, locator and full checksum.
// - HTML: the in-app preview. Every piece of source-derived text is
//   HTML-escaped before it is placed in the document — the preview can
//   never execute markup smuggled in through a source document.
//   Drafts and needs_review artifacts carry a DRAFT — NOT VERIFIED
//   banner; a stale artifact carries a STALE banner instead of being
//   presented as current.
//
// Neither renderer fetches anything and neither interprets document text
// as instructions: text is data to display, nothing more.

import { escapeHtml } from "./sanitize.js";

function referenceIndex(references) {
  const index = new Map();
  (references ?? []).forEach((ref, i) => {
    // Keyed by passage (quote included): several references share one
    // document+locator, and each passage gets its own number.
    index.set(`${ref.documentId}|${JSON.stringify(ref.locator)}|${ref.checksum}|${ref.quote}`, i + 1);
  });
  return index;
}

function citationNumbers(assertion, index) {
  const numbers = [];
  for (const citation of assertion.citations ?? []) {
    const n = index.get(`${citation.documentId}|${JSON.stringify(citation.locator)}|${citation.checksum}|${citation.quote}`);
    if (n != null) numbers.push(n);
  }
  return numbers;
}

function formatLocator(citation) {
  return citation.locatorLabel ?? citation.locator?.type ?? "unknown location";
}

/** Markdown export of an explainer artifact's content. */
export function renderExplainerMarkdown(content) {
  const index = referenceIndex(content.references);
  const lines = [];
  lines.push(`# ${content.title ?? "Untitled overview"}`);
  lines.push("");
  lines.push(`> Draft explainer generated locally from admitted source ranges. Every claim cites its source passage; see References.`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  if ((content.summary ?? []).length === 0) lines.push("_No summary could be grounded in the admitted ranges._");
  for (const assertion of content.summary ?? []) {
    lines.push(`- ${assertion.text}${citationNumbers(assertion, index).map((n) => ` [${n}]`).join("")}`);
  }
  lines.push("");
  lines.push("## Key concepts");
  lines.push("");
  if ((content.keyConcepts ?? []).length === 0) lines.push("_No definitional passages were found in the admitted ranges._");
  for (const assertion of content.keyConcepts ?? []) {
    lines.push(`- ${assertion.text}${citationNumbers(assertion, index).map((n) => ` [${n}]`).join("")}`);
  }
  lines.push("");
  lines.push("## Context");
  lines.push("");
  if ((content.context ?? []).length === 0) lines.push("_No further grounded context was selected._");
  for (const assertion of content.context ?? []) {
    lines.push(`- ${assertion.text}${citationNumbers(assertion, index).map((n) => ` [${n}]`).join("")}`);
  }
  lines.push("");
  if ((content.glossary ?? []).length > 0) {
    lines.push("## Glossary");
    lines.push("");
    for (const entry of content.glossary) {
      lines.push(`- **${entry.term}** — ${entry.definition}${citationNumbers(entry, index).map((n) => ` [${n}]`).join("")}`);
    }
    lines.push("");
  }
  lines.push("## Caveats");
  lines.push("");
  for (const caveat of content.caveats ?? []) lines.push(`- ${caveat.text}`);
  if ((content.needsReview ?? []).length > 0) {
    lines.push("");
    lines.push("## Needs review");
    lines.push("");
    for (const item of content.needsReview) lines.push(`- **${item.code}**: ${item.message}`);
  }
  lines.push("");
  lines.push("## References");
  lines.push("");
  (content.references ?? []).forEach((ref, i) => {
    lines.push(`${i + 1}. ${ref.documentId} · ${formatLocator(ref)} · sha256 ${ref.checksum}`);
    lines.push(`   > "${ref.quote}"`);
  });
  return lines.join("\n");
}

/** HTML preview of an explainer artifact's content. Watermarked unless reviewed. */
export function renderExplainerHtml(content, { watermark, stale } = {}) {
  const index = referenceIndex(content.references);
  const parts = [];
  if (stale) {
    parts.push(`<div data-preview-banner="stale" style="background:#7c2d12;color:#fff;padding:8px 12px;font-weight:bold;">STALE — a source changed since this draft was generated. Regenerate and re-review before use.</div>`);
  } else if (watermark) {
    parts.push(`<div data-preview-banner="draft" style="background:#b91c1c;color:#fff;padding:8px 12px;font-weight:bold;">DRAFT — NOT VERIFIED. Review every claim against its citation before approval.</div>`);
  }
  parts.push(`<article data-doc-overview-preview="explainer">`);
  parts.push(`<h1>${escapeHtml(content.title ?? "Untitled overview")}</h1>`);

  const section = (heading, assertions, emptyNote) => {
    parts.push(`<h2>${escapeHtml(heading)}</h2>`);
    if (!assertions || assertions.length === 0) {
      parts.push(`<p><em>${escapeHtml(emptyNote)}</em></p>`);
      return;
    }
    parts.push("<ul>");
    for (const assertion of assertions) {
      const sups = citationNumbers(assertion, index)
        .map((n) => {
          const ref = (content.references ?? [])[n - 1];
          const title = ref ? `${escapeHtml(ref.documentId)} · ${escapeHtml(formatLocator(ref))} · sha ${escapeHtml(String(ref.checksum ?? "").slice(0, 12))}` : "";
          return `<sup title="${title}">[${n}]</sup>`;
        })
        .join(" ");
      parts.push(`<li>${escapeHtml(assertion.text)} ${sups}</li>`);
    }
    parts.push("</ul>");
  };

  section("Summary", content.summary, "No summary could be grounded in the admitted ranges.");
  section("Key concepts", content.keyConcepts, "No definitional passages were found in the admitted ranges.");
  section("Context", content.context, "No further grounded context was selected.");
  if ((content.glossary ?? []).length > 0) {
    parts.push("<h2>Glossary</h2><dl>");
    for (const entry of content.glossary) {
      const sups = citationNumbers(entry, index).map((n) => `<sup>[${n}]</sup>`).join(" ");
      parts.push(`<dt><strong>${escapeHtml(entry.term)}</strong></dt><dd>${escapeHtml(entry.definition)} ${sups}</dd>`);
    }
    parts.push("</dl>");
  }
  parts.push("<h2>Caveats</h2><ul>");
  for (const caveat of content.caveats ?? []) parts.push(`<li>${escapeHtml(caveat.text)}</li>`);
  parts.push("</ul>");
  if ((content.needsReview ?? []).length > 0) {
    parts.push(`<h2>Needs review</h2><ul>`);
    for (const item of content.needsReview) {
      parts.push(`<li><strong>${escapeHtml(item.code)}</strong>: ${escapeHtml(item.message)}</li>`);
    }
    parts.push("</ul>");
  }
  if ((content.excludedSentences ?? []).length > 0) {
    parts.push(`<h2>Excluded source sentences</h2><p>These sentences were left out of the draft because they read like embedded instructions, not reference content:</p><ul>`);
    for (const excluded of content.excludedSentences) {
      parts.push(`<li><code>${escapeHtml(excluded.reason)}</code>: ${escapeHtml(excluded.text)}</li>`);
    }
    parts.push("</ul>");
  }
  parts.push("<h2>References</h2><ol>");
  (content.references ?? []).forEach((ref) => {
    parts.push(
      `<li>${escapeHtml(ref.documentId)} · ${escapeHtml(formatLocator(ref))} · <code>sha256 ${escapeHtml(ref.checksum ?? "")}</code><br><q>${escapeHtml(ref.quote ?? "")}</q></li>`,
    );
  });
  parts.push("</ol></article>");
  return parts.join("\n");
}

/** HTML preview wrapper for an infographic artifact's content. */
export function renderInfographicHtml(content, { watermark, stale } = {}) {
  const parts = [];
  if (stale) {
    parts.push(`<div data-preview-banner="stale" style="background:#7c2d12;color:#fff;padding:8px 12px;font-weight:bold;">STALE — a source changed since this draft was generated. Regenerate and re-review before use.</div>`);
  } else if (watermark) {
    parts.push(`<div data-preview-banner="draft" style="background:#b91c1c;color:#fff;padding:8px 12px;font-weight:bold;">DRAFT — NOT VERIFIED. Review every finding against its citation before approval.</div>`);
  }
  parts.push(`<article data-doc-overview-preview="infographic">`);
  parts.push(`<p>${escapeHtml(content.altText ?? "")}</p>`);
  // The SVG itself was rendered by infographic.js (escaped + sanitized
  // at render time). It is inserted as markup, never re-escaped.
  parts.push(content.svg ?? "");
  if ((content.needsReview ?? []).length > 0) {
    parts.push(`<h2>Needs review</h2><ul>`);
    for (const item of content.needsReview) {
      parts.push(`<li><strong>${escapeHtml(item.code)}</strong>: ${escapeHtml(item.message)}</li>`);
    }
    parts.push("</ul>");
  }
  parts.push("</article>");
  return parts.join("\n");
}
