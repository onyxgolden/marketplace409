// Generate golden SVGs for the Slice 1 render fixtures.
// Run: node forge-capture-app/ui/__tests__/generate-goldens.mjs
// Writes fixtures/golden/*.svg + golden-manifest.json (sha256 per slide).
// Goldens are deterministic (render-core test proves byte-identical
// re-renders); the manifest is the reviewed tolerance: a render that
// differs from its golden fails the golden test.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { validateAndExtractPptx } from "../pptx-import-core.js";
import { renderPresentation } from "../pptx-render-core.js";

const FIXTURES = new URL("./fixtures/pptx/", import.meta.url);
const GOLDEN_DIR = new URL("./fixtures/golden/", import.meta.url);

const fontAvailable = (name) => name !== "ZzMissing Font 123";

const DECKS = [
  { file: "synthetic-4-slide-16x9.pptx", prefix: "synthetic", slides: [0, 1, 2, 3] },
  { file: "deck-16x9-table-chart.pptx", prefix: "chart", slides: [0, 1, 2] },
  { file: "p6-report-wizard-training.pptx", prefix: "p6-report-wizard", slides: [0, 2] },
];

mkdirSync(GOLDEN_DIR, { recursive: true });
const manifest = { generatedBy: "generate-goldens.mjs", goldens: [] };

for (const deck of DECKS) {
  const bytes = new Uint8Array(readFileSync(new URL(deck.file, FIXTURES)));
  const pkg = await validateAndExtractPptx(bytes);
  const rendered = await renderPresentation(pkg, { fontAvailable });
  for (const i of deck.slides) {
    const slide = rendered.slides[i];
    const name = `${deck.prefix}-slide-${i + 1}.svg`;
    writeFileSync(new URL(name, GOLDEN_DIR), slide.svg);
    const sha256 = createHash("sha256").update(slide.svg, "utf8").digest("hex");
    if (sha256 !== slide.sha256) throw new Error(`sha mismatch for ${name}`);
    manifest.goldens.push({
      file: name,
      deck: deck.file,
      slideIndex: i,
      widthPx: slide.widthPx,
      heightPx: slide.heightPx,
      sha256,
      warnings: slide.warnings,
    });
    console.log(`${name}: ${slide.widthPx}x${slide.heightPx} sha256=${sha256.slice(0, 16)}…`);
  }
}

writeFileSync(new URL("golden-manifest.json", GOLDEN_DIR), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${manifest.goldens.length} goldens + golden-manifest.json`);
