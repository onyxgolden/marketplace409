// Slice 1 acceptance: PptxVideoProjectV1 persistence (pptx-project-core.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateAndExtractPptx } from "../pptx-import-core.js";
import { extractSlideNotes, extractSlideText } from "../pptx-extract-core.js";
import {
  PPTX_VIDEO_PROJECT_SCHEMA,
  clearSlideSelection,
  createProjectManifest,
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
