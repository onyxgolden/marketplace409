// FORGE Doc-to-Overview — slice B: deterministic infographic rendering.
//
// One-page static SVG: title, 3–7 concise source-grounded findings,
// citation legend, alt-text description. Layout is fixed and computed
// from the findings (no auto-layout library, no network fonts, no
// external images): width 800, findings stacked vertically, each with a
// numbered badge and its citation reference. All text is HTML-escaped
// before embedding, and the finished SVG is passed through
// sanitizeSvg (slice A) as defense in depth — a finding sentence that
// contains markup from a source document can never execute in a preview.
//
// No quantitative scales are drawn: findings are sentences, not charts,
// so there is no axis or bar that could mislead. Numbers that appear
// are quoted source words, each cited.

import { escapeHtml, sanitizeSvg } from "./sanitize.js";
import { MAX_FINDINGS_PER_INFOGRAPHIC } from "./limits.js";

export const INFOGRAPHIC_WIDTH = 800;
const MARGIN = 48;
const TITLE_SIZE = 30;
const FINDING_SIZE = 17;
const LINE_HEIGHT = 24;
const CHARS_PER_LINE = 78;
const BADGE_RADIUS = 16;
const ROW_GAP = 22;
const SECTION_GAP = 28;

function wrapText(text, charsPerLine) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line.length === 0 ? word : `${line} ${word}`;
    if (next.length > charsPerLine && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function findingLines(finding) {
  return wrapText(finding.text, CHARS_PER_LINE);
}

/** Plain-text description of the infographic (alt text / accessibility). */
export function describeInfographic({ title, findings }) {
  const lines = [`Infographic titled "${title}".`];
  if (!findings || findings.length === 0) {
    lines.push("No findings could be grounded in the admitted sources.");
  } else {
    lines.push(`${findings.length} source-grounded finding${findings.length === 1 ? "" : "s"}:`);
    findings.forEach((finding, i) => {
      lines.push(`${i + 1}. ${finding.text}`);
    });
  }
  lines.push("Each finding cites its source document and location; see the legend.");
  return lines.join(" ");
}

/**
 * Renders the infographic SVG. `watermark` adds a DRAFT — NOT VERIFIED
 * banner (drafts and needs_review artifacts); approved/kept artifacts
 * render without it. Every finding line and legend entry is escaped and
 * the result is sanitized before return.
 */
export function renderInfographicSvg({ title, findings, references, watermark }) {
  const safeTitle = escapeHtml(title ?? "Untitled overview");
  const safeFindings = (findings ?? []).slice(0, MAX_FINDINGS_PER_INFOGRAPHIC);
  const wrapped = safeFindings.map((finding) => findingLines(finding));

  // Height is computed from content: title block + one row per finding
  // (badge + wrapped lines) + legend + footer. Nothing is clipped.
  let height = MARGIN + 44 + SECTION_GAP;
  const rowTops = [];
  for (const lines of wrapped) {
    rowTops.push(height);
    height += Math.max(lines.length, 1) * LINE_HEIGHT + ROW_GAP;
  }
  height += SECTION_GAP;
  const legendTop = height;
  const legendLines = (references ?? []).map(
    (ref, i) => `[${i + 1}] ${ref.documentId} · ${ref.locatorLabel} · sha ${String(ref.checksum ?? "").slice(0, 12)}`,
  );
  height += Math.max(legendLines.length, 1) * 20 + 16;
  const footerTop = height;
  height += 40 + MARGIN;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${INFOGRAPHIC_WIDTH}" height="${height}" viewBox="0 0 ${INFOGRAPHIC_WIDTH} ${height}" role="img">`,
  );
  parts.push(`<title>${safeTitle}</title>`);
  parts.push(`<desc>${escapeHtml(describeInfographic({ title, findings: safeFindings }))}</desc>`);
  parts.push(`<rect x="0" y="0" width="${INFOGRAPHIC_WIDTH}" height="${height}" fill="#ffffff"/>`);
  if (watermark) {
    parts.push(`<rect x="0" y="0" width="${INFOGRAPHIC_WIDTH}" height="30" fill="#b91c1c"/>`);
    parts.push(`<text x="${MARGIN}" y="20" font-family="sans-serif" font-size="14" font-weight="bold" fill="#ffffff">DRAFT — NOT VERIFIED</text>`);
  }
  parts.push(`<text x="${MARGIN}" y="${MARGIN + 44}" font-family="sans-serif" font-size="${TITLE_SIZE}" font-weight="bold" fill="#0f172a">${safeTitle}</text>`);
  parts.push(`<line x1="${MARGIN}" y1="${MARGIN + 58}" x2="${INFOGRAPHIC_WIDTH - MARGIN}" y2="${MARGIN + 58}" stroke="#0f172a" stroke-width="2"/>`);

  safeFindings.forEach((finding, i) => {
    const top = rowTops[i];
    const centerY = top + BADGE_RADIUS;
    parts.push(`<circle cx="${MARGIN + BADGE_RADIUS}" cy="${centerY}" r="${BADGE_RADIUS}" fill="#1d4ed8"/>`);
    parts.push(
      `<text x="${MARGIN + BADGE_RADIUS}" y="${centerY + 6}" font-family="sans-serif" font-size="16" font-weight="bold" fill="#ffffff" text-anchor="middle">${i + 1}</text>`,
    );
    const lines = wrapped[i];
    lines.forEach((line, j) => {
      // The citation number is the index of the reference for this
      // finding's own passage (quote included): several findings can
      // share one document+locator. A finding without citations
      // renders without a number instead of throwing: the edit schema
      // refuses citation-less findings before they can be stored, and
      // this guard keeps a malformed stored draft from turning a
      // render into a 500.
      const firstCitation = finding.citations?.[0];
      const refIndex = firstCitation
        ? (references ?? []).findIndex((r) => r.documentId === firstCitation.documentId
          && JSON.stringify(r.locator) === JSON.stringify(firstCitation.locator)
          && r.quote === firstCitation.quote)
        : -1;
      const ref = j === lines.length - 1 && refIndex >= 0 ? ` [${refIndex + 1}]` : "";
      parts.push(
        `<text x="${MARGIN + 48}" y="${top + 6 + j * LINE_HEIGHT}" font-family="sans-serif" font-size="${FINDING_SIZE}" fill="#1e293b">${escapeHtml(line)}${ref ? escapeHtml(ref) : ""}</text>`,
      );
    });
  });

  parts.push(`<text x="${MARGIN}" y="${legendTop + 16}" font-family="sans-serif" font-size="14" font-weight="bold" fill="#0f172a">Sources</text>`);
  legendLines.forEach((line, i) => {
    parts.push(
      `<text x="${MARGIN}" y="${legendTop + 40 + i * 20}" font-family="sans-serif" font-size="13" fill="#475569">${escapeHtml(line)}</text>`,
    );
  });
  parts.push(
    `<text x="${MARGIN}" y="${footerTop + 16}" font-family="sans-serif" font-size="12" fill="#64748b">Generated locally from admitted source ranges only. Every finding cites its source passage; check the legend before quoting.</text>`,
  );
  parts.push("</svg>");
  return sanitizeSvg(parts.join(""));
}
