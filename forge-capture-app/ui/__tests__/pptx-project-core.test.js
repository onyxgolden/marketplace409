// Slice 1 acceptance: PptxVideoProjectV1 persistence (pptx-project-core.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mapPackageWarnings, validateAndExtractPptx } from "../pptx-import-core.js";
import { extractSlideNotes, extractSlideText } from "../pptx-extract-core.js";
import { renderPresentation } from "../pptx-render-core.js";
import {
  PPTX_VIDEO_PROJECT_SCHEMA,
  clearSlideSelection,
  createProjectManifest,
  dedupeWarnings,
  isValidProjectId,
  projectDeletePlan,
  renameProject,
  selectAllSlides,
  selectedSlides,
  setSlideSelected,
  slideIdForIndex,
  validateProjectManifest,
  validateProjectTitle,
} from "../pptx-project-core.js";

const FIXTURES = new URL("./fixtures/pptx/", import.meta.url);

function buildManifest(name, pkg, fileName) {
  const slides = pkg.slideParts.map((part, i) => {
    const text = extractSlideText(pkg, part.partPath);
    const notes = extractSlideNotes(pkg, part.partPath);
    return {
      id: slideIdForIndex(i),
      index: i,
      partPath: part.partPath,
      title: text.title,
      text: text.paragraphs,
      speakerNotes: notes.notes,
      selected: true,
      render: null,
      warnings: [...text.warnings, ...notes.warnings],
    };
  });
  return createProjectManifest({
    id: "pptx-test-001",
    title: name,
    source: {
      fileName,
      sha256: "aa".repeat(32),
      sizeBytes: 123456,
      slideWidthPt: pkg.slideSize.widthPt,
      slideHeightPt: pkg.slideSize.heightPt,
      slideCount: pkg.slideParts.length,
    },
    slides,
  });
}

async function pkg(name) {
  return validateAndExtractPptx(new Uint8Array(readFileSync(new URL(name, FIXTURES))));
}

describe("createProjectManifest + validateProjectManifest", () => {
  it("creates a valid project from the synthetic deck, all slides selected", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const manifest = buildManifest("Synthetic deck", p, "synthetic-4-slide-16x9.pptx");
    expect(manifest.schemaVersion).toBe(PPTX_VIDEO_PROJECT_SCHEMA);
    expect(manifest.slides).toHaveLength(4);
    expect(manifest.slides.every((s) => s.selected)).toBe(true);
    expect(manifest.slides[0].title).toBe("Synthetic Deck");
    expect(manifest.slides[0].speakerNotes).toContain("Welcome to the synthetic deck.");
    // Later slices are present as not-started placeholders only.
    expect(manifest.narration.status).toBe("not_started");
    expect(manifest.voice.status).toBe("not_started");
    expect(manifest.audio.status).toBe("not_started");
    expect(manifest.output.status).toBe("not_started");
    expect(validateProjectManifest(manifest)).toEqual([]);
  });

  it("creates a valid project from the real P6 deck", async () => {
    const p = await pkg("p6-report-wizard-training.pptx");
    const manifest = buildManifest(
      "Report Wizard and Editor Training",
      p,
      "Report_Wizard_and_Editor_Training-2.pptx",
    );
    expect(manifest.slides).toHaveLength(33);
    expect(manifest.slides.filter((s) => s.speakerNotes.length > 0)).toHaveLength(31);
    expect(validateProjectManifest(manifest)).toEqual([]);
  });

  it("flags a manifest with the wrong schema version", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const manifest = buildManifest("Synthetic deck", p, "synthetic-4-slide-16x9.pptx");
    const bad = { ...manifest, schemaVersion: "PptxVideoProjectV2" };
    expect(validateProjectManifest(bad).join(" ")).toContain("different version");
  });

  it("flags a manifest with a bad SHA-256", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const manifest = buildManifest("Synthetic deck", p, "synthetic-4-slide-16x9.pptx");
    const bad = { ...manifest, source: { ...manifest.source, sha256: "not-a-sha" } };
    expect(validateProjectManifest(bad).join(" ")).toContain("fingerprint");
  });

  it("flags a manifest with a repeated slide id", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const manifest = buildManifest("Synthetic deck", p, "synthetic-4-slide-16x9.pptx");
    const bad = {
      ...manifest,
      slides: manifest.slides.map((s, i) => (i === 1 ? { ...s, id: "slide-1" } : s)),
    };
    expect(validateProjectManifest(bad).join(" ")).toContain("repeated id");
  });

  it("rejects bad project ids and bad titles", () => {
    expect(isValidProjectId("pptx-test-001")).toBe(true);
    expect(isValidProjectId("")).toBe(false);
    expect(isValidProjectId("../escape")).toBe(false);
    expect(validateProjectTitle("")).toBe("Give the project a name.");
    expect(validateProjectTitle("a/b")).toContain("cannot contain");
  });
});

describe("warnings — persisted on the slide that owns them, visible on reopen", () => {
  // Mirrors the panel's importFile(): text/notes warnings + mapped
  // package warnings, then rendered warnings merged in, then the
  // manifest is saved. A JSON round-trip stands in for closing and
  // reopening the project.
  async function buildManifestWithWarnings(name, fileName, { render = false } = {}) {
    const p = await pkg(fileName);
    const { bySlide, project: projectWarnings } = mapPackageWarnings(p);
    const slides = p.slideParts.map((part, i) => {
      const text = extractSlideText(p, part.partPath);
      const notes = extractSlideNotes(p, part.partPath);
      return {
        id: slideIdForIndex(i),
        index: i,
        partPath: part.partPath,
        title: text.title,
        text: text.paragraphs,
        speakerNotes: notes.notes,
        selected: true,
        render: null,
        warnings: [...text.warnings, ...notes.warnings, ...(bySlide.get(i) || [])],
      };
    });
    if (render) {
      const rendered = await renderPresentation(p, {
        fontAvailable: (font) => font !== "ZzMissing Font 123",
      });
      for (let i = 0; i < rendered.slides.length; i += 1) {
        slides[i].warnings = dedupeWarnings([...slides[i].warnings, ...rendered.slides[i].warnings]);
      }
    }
    const manifest = createProjectManifest({
      id: "pptx-test-001",
      title: name,
      source: {
        fileName,
        sha256: "aa".repeat(32),
        sizeBytes: 123456,
        slideWidthPt: p.slideSize.widthPt,
        slideHeightPt: p.slideSize.heightPt,
        slideCount: p.slideParts.length,
      },
      slides,
      warnings: projectWarnings,
    });
    return { manifest, reopened: JSON.parse(JSON.stringify(manifest)) };
  }

  it("keeps the P6 WMF warning on slide 13 through save and reopen", async () => {
    const { manifest, reopened } = await buildManifestWithWarnings(
      "Report Wizard and Editor Training",
      "p6-report-wizard-training.pptx",
    );
    expect(validateProjectManifest(manifest)).toEqual([]);
    expect(validateProjectManifest(reopened)).toEqual([]);
    const slide13 = reopened.slides[12];
    expect(slide13.warnings.some((w) => w.code === "unsupported-image-format")).toBe(true);
    expect(slide13.warnings.find((w) => w.code === "unsupported-image-format").part).toBe(
      "ppt/media/image18.wmf",
    );
    // No other slide carries a package warning.
    expect(
      reopened.slides.filter((s) => s.warnings.some((w) => w.code === "unsupported-image-format")),
    ).toHaveLength(1);
  });

  it("keeps the missing-font warning on the rendered slides through save and reopen", async () => {
    const { manifest, reopened } = await buildManifestWithWarnings(
      "Mixed placeholders and fonts",
      "deck-mixed-placeholders-fonts.pptx",
      { render: true },
    );
    expect(validateProjectManifest(manifest)).toEqual([]);
    expect(validateProjectManifest(reopened)).toEqual([]);
    // Every rendered slide reports the missing font (the substitution
    // is deck-wide); check the warning itself survives the round-trip.
    const warned = reopened.slides.filter((s) =>
      s.warnings.some((w) => w.code === "font-substituted"),
    );
    expect(warned.length).toBeGreaterThan(0);
    const fontWarning = warned[0].warnings.find((w) => w.code === "font-substituted");
    expect(fontWarning.message).toContain("ZzMissing Font 123");
  });

  it("stores project-level warnings and accepts manifests that predate them", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const manifest = buildManifest("Synthetic deck", p, "synthetic-4-slide-16x9.pptx");
    expect(manifest.warnings).toEqual([]);
    expect(validateProjectManifest(manifest)).toEqual([]);
    const old = { ...manifest };
    delete old.warnings;
    expect(validateProjectManifest(old)).toEqual([]);
    const bad = { ...manifest, warnings: [{ code: 1, message: "nope" }] };
    expect(validateProjectManifest(bad).join(" ")).toContain("warning record");
  });

  it("rejects malformed slide warnings but accepts slides that predate them", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const manifest = buildManifest("Synthetic deck", p, "synthetic-4-slide-16x9.pptx");
    expect(validateProjectManifest(manifest)).toEqual([]);
    // A null record on a slide must not pass: renderWarnings() would
    // throw on it while opening the project.
    const nullWarning = JSON.parse(JSON.stringify(manifest));
    nullWarning.slides[0].warnings = [null];
    expect(validateProjectManifest(nullWarning).join(" ")).toContain("warning record");
    // A malformed warning object on a slide must not pass either.
    const badRecord = JSON.parse(JSON.stringify(manifest));
    badRecord.slides[1].warnings = [{ code: 1, message: "nope" }];
    expect(validateProjectManifest(badRecord).join(" ")).toContain("warning record");
    // A non-array warnings field on a slide must not pass.
    const notArray = JSON.parse(JSON.stringify(manifest));
    notArray.slides[2].warnings = "unsupported-image-format";
    expect(validateProjectManifest(notArray).join(" ")).toContain("warning record");
    // Older manifests have no warnings field on slides at all.
    const old = JSON.parse(JSON.stringify(manifest));
    for (const slide of old.slides) delete slide.warnings;
    expect(validateProjectManifest(old)).toEqual([]);
    // A well-formed slide warning still passes.
    const good = JSON.parse(JSON.stringify(manifest));
    good.slides[3].warnings = [{ code: "font-substituted", message: "Font X was replaced." }];
    expect(validateProjectManifest(good)).toEqual([]);
  });

  it("dedupeWarnings drops repeats but keeps distinct warnings in order", () => {
    expect(
      dedupeWarnings([
        { code: "a", message: "same" },
        { code: "a", message: "same" },
        { code: "b", message: "other" },
        { code: "a", message: "different" },
      ]),
    ).toEqual([
      { code: "a", message: "same" },
      { code: "b", message: "other" },
      { code: "a", message: "different" },
    ]);
  });
});

describe("selection", () => {
  it("deselects and reselects a slide; selection survives a round-trip", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const manifest = buildManifest("Synthetic deck", p, "synthetic-4-slide-16x9.pptx");
    const deselected = setSlideSelected(manifest, "slide-2", false);
    expect(selectedSlides(deselected)).toHaveLength(3);
    expect(validateProjectManifest(deselected)).toEqual([]);
    // A saved selection survives close/reopen: serialise and re-read.
    const reopened = JSON.parse(JSON.stringify(deselected));
    expect(validateProjectManifest(reopened)).toEqual([]);
    expect(selectedSlides(reopened).map((s) => s.id)).toEqual(["slide-1", "slide-3", "slide-4"]);
    const back = setSlideSelected(reopened, "slide-2", true);
    expect(selectedSlides(back)).toHaveLength(4);
  });

  it("select-all restores the full selection", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const manifest = buildManifest("Synthetic deck", p, "synthetic-4-slide-16x9.pptx");
    const cleared = clearSlideSelection(manifest);
    expect(selectedSlides(cleared)).toHaveLength(1);
    const all = selectAllSlides(cleared);
    expect(selectedSlides(all)).toHaveLength(4);
  });

  it("clear keeps the first slide selected; deselecting the last one throws", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const manifest = buildManifest("Synthetic deck", p, "synthetic-4-slide-16x9.pptx");
    const cleared = clearSlideSelection(manifest);
    expect(selectedSlides(cleared).map((s) => s.id)).toEqual(["slide-1"]);
    expect(() => setSlideSelected(cleared, "slide-1", false)).toThrow("at least one slide");
  });

  it("throws for an unknown slide id", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const manifest = buildManifest("Synthetic deck", p, "synthetic-4-slide-16x9.pptx");
    expect(() => setSlideSelected(manifest, "slide-99", false)).toThrow("no slide called");
  });
});

describe("renameProject", () => {
  it("renames, trims, and bumps the revision", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const manifest = buildManifest("Synthetic deck", p, "synthetic-4-slide-16x9.pptx");
    const renamed = renameProject(manifest, "  New name  ");
    expect(renamed.title).toBe("New name");
    expect(renamed.revision).toBe(manifest.revision + 1);
    expect(renamed.events.at(-1).type).toBe("renamed");
  });

  it("rejects an empty name", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const manifest = buildManifest("Synthetic deck", p, "synthetic-4-slide-16x9.pptx");
    expect(() => renameProject(manifest, "   ")).toThrow("Give the project a name.");
  });
});

describe("projectDeletePlan", () => {
  it("removes only the project folder and keeps the original deck", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const manifest = buildManifest("Synthetic deck", p, "synthetic-4-slide-16x9.pptx");
    const plan = projectDeletePlan(manifest);
    expect(plan.projectId).toBe("pptx-test-001");
    expect(plan.removes.join(" ")).toContain("pptx-test-001");
    expect(plan.keeps).toContain("your original PowerPoint file");
  });
});
