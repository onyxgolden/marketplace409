// Slice 1 acceptance: Pagus render qualification (pptx-render-core.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateAndExtractPptx } from "../pptx-import-core.js";
import {
  letterboxRect,
  rasterizeSvgToPng,
  renderPresentation,
  renderScaleForSlide,
  resolveFontSubstitutes,
  sha256Hex,
} from "../pptx-render-core.js";

const FIXTURES = new URL("./fixtures/pptx/", import.meta.url);

// In tests every font counts as installed except the known-missing one.
const testFontAvailable = (name) => name !== "ZzMissing Font 123";

async function pkg(name) {
  return validateAndExtractPptx(new Uint8Array(readFileSync(new URL(name, FIXTURES))));
}

describe("renderPresentation — synthetic deck (positive control)", () => {
  it("renders 4 slides in deck order, 16:9, with their titles in the SVG", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const rendered = await renderPresentation(p, { fontAvailable: testFontAvailable });
    expect(rendered.slides).toHaveLength(4);
    expect(rendered.slides.map((s) => s.widthPx)).toEqual([1920, 1920, 1920, 1920]);
    // python-pptx writes 13.333in as 12191695 EMU (959.976 pt, not 960),
    // so the height lands at 1080.03 rather than exactly 1080.
    for (const slide of rendered.slides) {
      expect(slide.heightPx).toBeCloseTo(1080, 0);
    }
    expect(rendered.slides[0].svg).toContain("Synthetic Deck");
    expect(rendered.slides[1].svg).toContain("Key points");
    expect(rendered.slides[2].svg).toContain("Picture slide");
    expect(rendered.slides[3].svg).toContain("Quarterly figures");
    // Every slide has a recorded SVG fingerprint.
    for (const slide of rendered.slides) {
      expect(slide.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("renders the same slide byte-identically on repeat (deterministic goldens)", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const first = await renderPresentation(p, { fontAvailable: testFontAvailable });
    const second = await renderPresentation(p, { fontAvailable: testFontAvailable });
    for (let i = 0; i < 4; i += 1) {
      expect(second.slides[i].svg).toBe(first.slides[i].svg);
      expect(second.slides[i].sha256).toBe(first.slides[i].sha256);
    }
  });
});

describe("renderPresentation — varied decks", () => {
  it("renders the 4:3 deck letterboxed (1920 wide, 1440 tall SVG)", async () => {
    const p = await pkg("deck-4x3-notes-images.pptx");
    const rendered = await renderPresentation(p, { fontAvailable: testFontAvailable });
    expect(rendered.slides).toHaveLength(3);
    for (const slide of rendered.slides) {
      expect(slide.widthPx).toBe(1920);
      expect(slide.heightPx).toBe(1440);
    }
  });

  it("renders tables and charts without dropping the slide", async () => {
    const p = await pkg("deck-16x9-table-chart.pptx");
    const rendered = await renderPresentation(p, { fontAvailable: testFontAvailable });
    expect(rendered.slides).toHaveLength(3);
    expect(rendered.slides[0].svg).toContain("Widgets");
    // The chart renders (bars + axis labels A/B/C + values), but Pagus
    // 0.1.1 does NOT draw the chart title — a recorded fidelity gap
    // (docs/pptx-video-slice1.md). The title is still captured by text
    // extraction (see pptx-extract-core.test.js), so it is not lost.
    expect(rendered.slides[1].svg).toContain(">A<");
    expect(rendered.slides[1].svg).toContain(">C<");
    expect(rendered.slides[1].svg).toContain(">30<");
  });

  it("renders all 33 slides of the real P6 deck, 4:3, in order", async () => {
    const p = await pkg("p6-report-wizard-training.pptx");
    const rendered = await renderPresentation(p, { fontAvailable: testFontAvailable });
    expect(rendered.slides).toHaveLength(33);
    expect(rendered.slides[0].svg).toContain("P6 Report");
    for (const slide of rendered.slides) {
      expect(slide.widthPx).toBe(1920);
      expect(slide.heightPx).toBe(1440);
      expect(slide.svg.length).toBeGreaterThan(500);
    }
  });
});

describe("font fallback (local only)", () => {
  it("maps a missing font to Segoe UI and reports it", () => {
    const { substitutes, unresolved } = resolveFontSubstitutes(
      ["Calibri", "ZzMissing Font 123"],
      testFontAvailable,
    );
    expect(substitutes).toEqual({ "ZzMissing Font 123": "Segoe UI" });
    expect(unresolved).toEqual(["ZzMissing Font 123"]);
  });

  it("warns on the mixed deck's missing font during render", async () => {
    const p = await pkg("deck-mixed-placeholders-fonts.pptx");
    const rendered = await renderPresentation(p, { fontAvailable: testFontAvailable });
    expect(rendered.fonts.unresolved).toContain("ZzMissing Font 123");
    expect(rendered.slides[1].warnings[0].code).toBe("font-substituted");
  });

  it("never produces a Google Fonts URL", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const rendered = await renderPresentation(p, { fontAvailable: testFontAvailable });
    for (const slide of rendered.slides) {
      expect(slide.svg).not.toContain("googleapis");
      expect(slide.svg).not.toContain("fonts.g");
    }
  });
});

describe("renderScaleForSlide + letterboxRect", () => {
  it("scales 16:9 to 1920 wide and 4:3 to 1920 wide", () => {
    expect(renderScaleForSlide({ width: 960, height: 540 })).toBeCloseTo(1.5, 5);
    expect(renderScaleForSlide({ width: 720, height: 540 })).toBeCloseTo(2, 5);
  });

  it("letterboxes 4:3 into 1920x1080 with side bars, no stretch", () => {
    expect(letterboxRect(1920, 1440, 1920, 1080)).toEqual({ x: 240, y: 0, width: 1440, height: 1080 });
    expect(letterboxRect(1920, 1080, 1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});

describe("rasterizeSvgToPng (stub factories)", () => {
  function stubFactories() {
    const draws = [];
    const fills = [];
    const image = {
      _src: "",
      set src(value) {
        this._src = value;
        queueMicrotask(() => this.onload && this.onload());
      },
      get src() {
        return this._src;
      },
    };
    const ctx = {
      fillStyle: "",
      fillRect: (x, y, w, h) => fills.push([x, y, w, h]),
      drawImage: (img, x, y, w, h) => draws.push([img, x, y, w, h]),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb) => cb(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" })),
    };
    const revoked = [];
    return {
      factories: {
        createImage: () => image,
        createCanvas: () => canvas,
        createObjectUrl: () => "blob:fake",
        revokeObjectUrl: (url) => revoked.push(url),
      },
      draws,
      fills,
      revoked,
      image,
    };
  }

  it("draws the slide letterboxed onto a 1920x1080 canvas and revokes the object URL", async () => {
    const { factories, draws, fills, revoked } = stubFactories();
    const out = await rasterizeSvgToPng("<svg></svg>", 1920, 1440, factories);
    expect(fills).toEqual([[0, 0, 1920, 1080]]);
    expect(draws).toHaveLength(1);
    expect(draws[0].slice(1)).toEqual([240, 0, 1440, 1080]);
    expect(out.width).toBe(1920);
    expect(out.height).toBe(1080);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(revoked).toEqual(["blob:fake"]);
  });

  it("sha256Hex matches the known empty-string digest", async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
