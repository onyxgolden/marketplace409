// Golden render comparison (pptx-render-core.js).
// The manifest under fixtures/golden/ is the reviewed reference: re-renders
// must match byte-for-byte (renders are deterministic — see the
// determinism test in pptx-render-core.test.js). A mismatch means the
// renderer or the fixture changed and a human must re-review the golden.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateAndExtractPptx } from "../pptx-import-core.js";
import { renderPresentation } from "../pptx-render-core.js";

const FIXTURES = new URL("./fixtures/pptx/", import.meta.url);
const GOLDEN = new URL("./fixtures/golden/", import.meta.url);

const fontAvailable = (name) => name !== "ZzMissing Font 123";

describe("golden renders", () => {
  it("re-renders match the reviewed goldens byte-for-byte", async () => {
    const manifest = JSON.parse(readFileSync(new URL("golden-manifest.json", GOLDEN), "utf8"));
    expect(manifest.goldens.length).toBeGreaterThan(0);
    const renderedByDeck = new Map();
    for (const golden of manifest.goldens) {
      if (!renderedByDeck.has(golden.deck)) {
        const pkg = await validateAndExtractPptx(
          new Uint8Array(readFileSync(new URL(golden.deck, FIXTURES))),
        );
        renderedByDeck.set(golden.deck, await renderPresentation(pkg, { fontAvailable }));
      }
      const rendered = renderedByDeck.get(golden.deck);
      const slide = rendered.slides[golden.slideIndex];
      expect(slide, `golden ${golden.file} refers to a slide that no longer renders`).toBeDefined();
      expect(slide.sha256, `golden ${golden.file} changed — re-review before updating`).toBe(golden.sha256);
      expect(slide.widthPx).toBe(golden.widthPx);
      expect(slide.heightPx).toBeCloseTo(golden.heightPx, 0);
      // The stored file itself matches the manifest too.
      const stored = readFileSync(new URL(golden.file, GOLDEN), "utf8");
      expect(stored).toBe(slide.svg);
    }
  });
});
