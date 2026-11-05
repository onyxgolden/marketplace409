// FORGE Doc-to-Overview — slice B: preview + Markdown rendering tests.

import { describe, expect, it } from "vitest";
import { generateExplainer, generateInfographicFindings } from "./generation.js";
import { extractBounded } from "./extraction.js";
import { sha256Hex } from "./sourceSets.js";
import { describeInfographic, renderInfographicSvg } from "./infographic.js";
import {
  renderExplainerHtml,
  renderExplainerMarkdown,
  renderInfographicHtml,
} from "./preview.js";

const DOC_TEXT = [
  "# Photosynthesis",
  "",
  "## Overview",
  "",
  "Photosynthesis is the process by which green plants convert sunlight, water, and carbon dioxide into oxygen and glucose. This process takes place primarily in the leaves of plants, inside organelles called chloroplasts.",
  "",
  "## Process",
  "",
  "The light-dependent reactions occur in the thylakoid membranes of the chloroplast. The Calvin cycle then fixes carbon dioxide into sugar molecules using energy captured from sunlight.",
  "",
].join("\n");

function fixture() {
  const manifest = {
    id: "manifest_1",
    name: "Energy in living cells",
    sourceSetHash: "a".repeat(64),
    documents: [{ documentId: "doc_a", title: "Photosynthesis", contentHash: sha256Hex(DOC_TEXT) }],
  };
  const extracts = [];
  for (const section of ["Overview", "Process"]) {
    const result = extractBounded({ document: { id: "doc_a", text: DOC_TEXT }, ranges: [{ type: "section", name: section }] });
    if (!result.ok) throw new Error(result.error.message);
    extracts.push(...result.extracts);
  }
  return { manifest, extracts };
}

function infographicContent() {
  const { manifest, extracts } = fixture();
  const findings = generateInfographicFindings({ manifest, extracts });
  return {
    ...findings,
    svg: renderInfographicSvg({
      title: findings.title,
      findings: findings.findings,
      references: findings.references,
      watermark: false,
    }),
    altText: describeInfographic(findings),
  };
}

describe("renderExplainerMarkdown", () => {
  it("exports sections, inline citations and full-checksum references", () => {
    const { manifest, extracts } = fixture();
    const content = generateExplainer({ manifest, extracts });
    const md = renderExplainerMarkdown(content);
    expect(md).toContain("# Energy in living cells");
    expect(md).toContain("## Summary");
    expect(md).toContain("## Key concepts");
    expect(md).toContain("## References");
    expect(md).toMatch(/\[1\]/);
    expect(md).toContain("sha256 ");
    expect(md).toContain(content.references[0].checksum);
  });
});

describe("renderExplainerHtml", () => {
  it("shows a DRAFT banner for unreviewed drafts and none once approved", () => {
    const { manifest, extracts } = fixture();
    const content = generateExplainer({ manifest, extracts });
    expect(renderExplainerHtml(content, { watermark: true })).toContain("DRAFT — NOT VERIFIED");
    expect(renderExplainerHtml(content, { watermark: false })).not.toContain("DRAFT — NOT VERIFIED");
  });

  it("shows a STALE banner instead of presenting changed sources as current", () => {
    const { manifest, extracts } = fixture();
    const content = generateExplainer({ manifest, extracts });
    const html = renderExplainerHtml(content, { watermark: true, stale: true });
    expect(html).toContain("STALE");
    expect(html).not.toContain("DRAFT — NOT VERIFIED");
  });

  it("escapes markup smuggled in through source text", () => {
    const hostileText = "# Notes\n\n## Overview\n\n<script>alert(\"pwned\")</script> Plants make food from sunlight and water in the leaves. <img src=x onerror=alert(1)> The Calvin cycle fixes carbon dioxide.\n";
    const manifest = {
      id: "manifest_1",
      name: "Hostile",
      sourceSetHash: "a".repeat(64),
      documents: [{ documentId: "doc_a", title: "Notes", contentHash: sha256Hex(hostileText) }],
    };
    const result = extractBounded({ document: { id: "doc_a", text: hostileText }, ranges: [{ type: "section", name: "Overview" }] });
    const content = generateExplainer({ manifest, extracts: result.extracts });
    const html = renderExplainerHtml(content, { watermark: true });
    // The hostile markup is rendered as visible escaped text, never as
    // markup: no real <script> or <img> element exists in the output.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("renders citation superscripts with locator titles", () => {
    const { manifest, extracts } = fixture();
    const content = generateExplainer({ manifest, extracts });
    const html = renderExplainerHtml(content, { watermark: false });
    expect(html).toContain("<sup");
    expect(html).toContain("doc_a");
  });
});

describe("renderInfographicHtml", () => {
  it("wraps the SVG with alt text and a DRAFT banner when watermarked", () => {
    const content = infographicContent();
    const html = renderInfographicHtml(content, { watermark: true });
    expect(html).toContain("DRAFT — NOT VERIFIED");
    expect(html).toContain("<svg");
    // Alt text is HTML-escaped in the preview (quotes become &quot;),
    // so assert on the unquoted fragments.
    expect(html).toContain("Energy in living cells");
    expect(html).toContain("source-grounded findings");
  });

  it("renders without a banner once reviewed", () => {
    const content = infographicContent();
    expect(renderInfographicHtml(content, { watermark: false })).not.toContain("DRAFT — NOT VERIFIED");
  });
});
