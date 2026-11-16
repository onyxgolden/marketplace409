// Slice 1 acceptance: bounded PPTX import (pptx-import-core.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  PPTX_CAPS,
  PptxReject,
  crc32,
  extractEntryBounded,
  mapPackageWarnings,
  readCentralDirectory,
  validateAndExtractPptx,
  validateZipEntries,
} from "../pptx-import-core.js";

const FIXTURES = new URL("./fixtures/pptx/", import.meta.url);

function fixtureBytes(name) {
  return new Uint8Array(readFileSync(new URL(name, FIXTURES)));
}

async function importFixture(name, options) {
  return validateAndExtractPptx(fixtureBytes(name), options);
}

describe("validateAndExtractPptx — good decks", () => {
  it("imports the fixed synthetic 4-slide deck: 4 slides, 16:9, in order", async () => {
    const pkg = await importFixture("synthetic-4-slide-16x9.pptx");
    expect(pkg.slideCount).toBe(4);
    expect(pkg.slideParts.map((s) => s.partPath)).toEqual([
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml",
      "ppt/slides/slide3.xml",
      "ppt/slides/slide4.xml",
    ]);
    expect(pkg.slideSize.widthPt).toBeCloseTo(960, 0);
    expect(pkg.slideSize.heightPt).toBeCloseTo(540, 0);
    expect(pkg.stats.inputBytes).toBe(fixtureBytes("synthetic-4-slide-16x9.pptx").length);
  });

  it("imports the real P6 training deck: 33 slides, 4:3, all with notes parts", async () => {
    const pkg = await importFixture("p6-report-wizard-training.pptx");
    expect(pkg.slideCount).toBe(33);
    expect(pkg.slideSize.widthPt).toBeCloseTo(720, 0);
    expect(pkg.slideSize.heightPt).toBeCloseTo(540, 0);
    expect(pkg.mediaInfo).toHaveLength(43);
    const wmf = pkg.mediaInfo.find((m) => m.name.endsWith(".wmf"));
    expect(wmf).toBeDefined();
    // WMF is a known render gap: warned, not rejected.
    expect(pkg.warnings.some((w) => w.code === "unsupported-image-format")).toBe(true);
  });

  it("imports the 4:3, table/chart, and mixed decks", async () => {
    for (const name of [
      "deck-4x3-notes-images.pptx",
      "deck-16x9-table-chart.pptx",
      "deck-mixed-placeholders-fonts.pptx",
    ]) {
      const pkg = await importFixture(name);
      expect(pkg.slideCount).toBeGreaterThan(0);
    }
    const fourByThree = await importFixture("deck-4x3-notes-images.pptx");
    expect(fourByThree.slideSize.widthPt).toBeCloseTo(720, 0);
    expect(fourByThree.slideSize.heightPt).toBeCloseTo(540, 0);
  });

  it("records image dimensions from headers without decoding pixels", async () => {
    const pkg = await importFixture("synthetic-4-slide-16x9.pptx");
    expect(pkg.mediaInfo).toHaveLength(1);
    expect(pkg.mediaInfo[0]).toMatchObject({ format: "png", width: 800, height: 600 });
  });

  it("accepts the deck with external relationships, macros and OLE — without touching them", async () => {
    const pkg = await importFixture("deck-external-rels-macro-ole.pptx");
    expect(pkg.slideCount).toBe(4);
    // The external hyperlink, the macro part and the OLE part are present
    // in the file but were never dereferenced or executed: the import
    // only reads the parts it needs.
    expect(pkg.parts.has("ppt/vbaProject.bin")).toBe(false);
  });
});

describe("validateAndExtractPptx — rejections", () => {
  it.each([
    ["bad-not-a-zip.pptx", "not-a-zip"],
    ["bad-legacy.ppt", "legacy-ppt"],
    ["p6-resource-leveling-legacy.ppt", "legacy-ppt"],
    ["bad-traversal.pptx", "path-traversal"],
    ["bad-malformed.pptx", "missing-part"],
    ["deck-101-slides.pptx", "too-many-slides"],
    ["deck-oversized-image.pptx", "oversized-image"],
  ])("rejects %s with code %s", async (name, code) => {
    await expect(importFixture(name)).rejects.toMatchObject({ name: "PptxReject", code });
  });

  it("rejects the ZIP bomb from the central directory without expanding it", async () => {
    // The bomb declares a 600 MB entry. The refusal must come from the
    // declared sizes (validateZipEntries), before any inflation happens:
    // prove it by calling the directory validator directly.
    const bytes = fixtureBytes("bad-zip-bomb.pptx");
    const entries = readCentralDirectory(bytes);
    expect(entries).toHaveLength(1);
    expect(entries[0].uncompressedSize).toBe(600 * 1024 * 1024);
    expect(() => validateZipEntries(entries)).toThrowError(PptxReject);
    await expect(importFixture("bad-zip-bomb.pptx")).rejects.toMatchObject({
      code: "entry-too-large",
    });
  });

  it("enforces caps from the caller's overrides, not just fixture luck", async () => {
    const bytes = fixtureBytes("synthetic-4-slide-16x9.pptx");
    await expect(
      validateAndExtractPptx(bytes, { caps: { ...PPTX_CAPS, maxSlides: 2 } }),
    ).rejects.toMatchObject({ code: "too-many-slides" });
    await expect(
      validateAndExtractPptx(bytes, { caps: { ...PPTX_CAPS, maxInputBytes: 100 } }),
    ).rejects.toMatchObject({ code: "too-large" });
  });

  it("rejects a deck whose bytes were tampered with (checksum)", async () => {
    const bytes = new Uint8Array(fixtureBytes("synthetic-4-slide-16x9.pptx"));
    // Flip one byte inside the compressed data of the first slide part
    // (past the local header's file name + extra fields).
    const entries = readCentralDirectory(bytes);
    const slide1 = entries.find((e) => e.name === "ppt/slides/slide1.xml");
    const nameLen = bytes[slide1.localHeaderOffset + 26] | (bytes[slide1.localHeaderOffset + 27] << 8);
    const extraLen = bytes[slide1.localHeaderOffset + 28] | (bytes[slide1.localHeaderOffset + 29] << 8);
    bytes[slide1.localHeaderOffset + 30 + nameLen + extraLen + 12] ^= 0xff;
    await expect(validateAndExtractPptx(bytes)).rejects.toMatchObject({ name: "PptxReject" });
  });

  it("honours cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      importFixture("p6-report-wizard-training.pptx", { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("mapPackageWarnings — warnings reach their owning slide", () => {
  it("maps the P6 WMF warning to slide 13 (index 12), the slide that shows the picture", async () => {
    const pkg = await importFixture("p6-report-wizard-training.pptx");
    const { bySlide, project } = mapPackageWarnings(pkg);
    expect(project).toEqual([]);
    const slide13 = bySlide.get(12);
    expect(slide13).toHaveLength(1);
    expect(slide13[0]).toMatchObject({
      code: "unsupported-image-format",
      part: "ppt/media/image18.wmf",
    });
    // No other slide owns a package warning.
    expect([...bySlide.keys()]).toEqual([12]);
  });

  it("maps nothing for a clean deck", async () => {
    const pkg = await importFixture("synthetic-4-slide-16x9.pptx");
    const { bySlide, project } = mapPackageWarnings(pkg);
    expect(bySlide.size).toBe(0);
    expect(project).toEqual([]);
  });

  it("sends orphan-media and part-less warnings to the project collection, never drops them", async () => {
    const pkg = await importFixture("synthetic-4-slide-16x9.pptx");
    const orphaned = {
      ...pkg,
      warnings: [
        {
          code: "unsupported-image-format",
          message: "Picture ppt/media/orphan.wmf is in a format Capture cannot render fully; the slide may look different.",
          part: "ppt/media/orphan.wmf",
        },
        { code: "other", message: "A warning with no part at all." },
      ],
    };
    const { bySlide, project } = mapPackageWarnings(orphaned);
    expect(bySlide.size).toBe(0);
    expect(project).toHaveLength(2);
    expect(project.map((w) => w.code)).toEqual(["unsupported-image-format", "other"]);
  });
});

describe("central directory + bounded extraction", () => {
  it("crc32 matches the known check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("extractEntryBounded inflates a stored and a deflated entry exactly", async () => {
    const bytes = fixtureBytes("synthetic-4-slide-16x9.pptx");
    const entries = readCentralDirectory(bytes);
    for (const entry of entries.slice(0, 5)) {
      const out = extractEntryBounded(bytes, entry);
      expect(out.length).toBe(entry.uncompressedSize);
      expect(crc32(out)).toBe(entry.crc);
    }
  });

  it("extractEntryBounded refuses an entry that expands past the cap", async () => {
    const bytes = fixtureBytes("bad-zip-bomb.pptx");
    const entries = readCentralDirectory(bytes);
    // Bypass the declared-size check to prove the streaming cap itself:
    // the inflater must stop, not allocate 600 MB.
    expect(() =>
      extractEntryBounded(bytes, entries[0], { ...PPTX_CAPS, maxEntryBytes: 1024 }),
    ).toThrowError(PptxReject);
  });
});
