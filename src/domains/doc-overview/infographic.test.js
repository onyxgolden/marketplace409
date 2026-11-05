// FORGE Doc-to-Overview — slice B: infographic rendering tests.

import { describe, expect, it } from "vitest";
import { describeInfographic, renderInfographicSvg } from "./infographic.js";

function finding(text, documentId = "doc_a") {
  return {
    text,
    citations: [{
      documentId,
      locator: { type: "section", name: "Overview" },
      locatorLabel: 'section "Overview"',
      checksum: "a".repeat(64),
      quote: text,
    }],
  };
}

const REFERENCES = [
  {
    documentId: "doc_a",
    locator: { type: "section", name: "Overview" },
    locatorLabel: 'section "Overview"',
    checksum: "a".repeat(64),
    quote: "Photosynthesis is the process by which green plants make food.",
  },
];

describe("renderInfographicSvg", () => {
  it("renders title, findings, legend and a deterministic layout", () => {
    const findings = [
      finding("Photosynthesis is the process by which green plants make food."),
      finding("The Calvin cycle fixes carbon dioxide into sugar molecules."),
      finding("Oxygen is released as a byproduct of the light reactions."),
    ];
    const first = renderInfographicSvg({ title: "Energy in cells", findings, references: REFERENCES, watermark: false });
    const second = renderInfographicSvg({ title: "Energy in cells", findings, references: REFERENCES, watermark: false });
    expect(first).toBe(second);
    expect(first).toContain("Energy in cells");
    expect(first).toContain("Photosynthesis is the process");
    expect(first).toContain("Sources");
    expect(first).toContain("doc_a");
    expect(first).not.toContain("DRAFT");
    expect(first).toMatch(/<svg[^>]*width="800"/);
  });

  it("adds a DRAFT — NOT VERIFIED banner when watermarked", () => {
    const svg = renderInfographicSvg({
      title: "Energy in cells",
      findings: [finding("Photosynthesis is the process by which green plants make food.")],
      references: REFERENCES,
      watermark: true,
    });
    expect(svg).toContain("DRAFT — NOT VERIFIED");
  });

  it("never emits markup smuggled in through source text", () => {
    const hostile = finding("<script>alert(\"pwned\")</script> Plants make food from sunlight and water.");
    const svg = renderInfographicSvg({
      title: "Energy <script>alert(1)</script> cells",
      findings: [hostile, finding("The Calvin cycle fixes carbon dioxide into sugar molecules.")],
      references: REFERENCES,
      watermark: false,
    });
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("alert(\"pwned\")");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("strips event handlers and external references from hostile input", () => {
    const hostile = finding("Plants make food. <img src=x onerror=alert(1)> Sunlight drives the process.");
    const svg = renderInfographicSvg({
      title: "Energy in cells",
      findings: [hostile],
      references: REFERENCES,
      watermark: false,
    });
    expect(svg).not.toContain("onerror");
    expect(svg).not.toContain("<img");
  });
});

describe("describeInfographic", () => {
  it("produces a plain-text description listing the findings", () => {
    const alt = describeInfographic({
      title: "Energy in cells",
      findings: [
        finding("Photosynthesis is the process by which green plants make food."),
        finding("The Calvin cycle fixes carbon dioxide into sugar molecules."),
      ],
    });
    expect(alt).toContain("Energy in cells");
    expect(alt).toContain("2 source-grounded findings");
    expect(alt).toContain("Photosynthesis is the process");
  });

  it("says so plainly when nothing could be grounded", () => {
    expect(describeInfographic({ title: "Empty", findings: [] })).toContain("No findings could be grounded");
  });
});
