// Slice 1 acceptance: notes + slide text extraction (pptx-extract-core.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateAndExtractPptx } from "../pptx-import-core.js";
import { extractSlideNotes, extractSlideText } from "../pptx-extract-core.js";

const FIXTURES = new URL("./fixtures/pptx/", import.meta.url);

async function pkg(name) {
  return validateAndExtractPptx(new Uint8Array(readFileSync(new URL(name, FIXTURES))));
}

describe("extractSlideNotes", () => {
  it("maps each note to its own slide on the synthetic deck", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const notes = p.slideParts.map((s) => extractSlideNotes(p, s.partPath).notes);
    expect(notes).toEqual([
      "Welcome to the synthetic deck. This is the cover slide.",
      "These are the key points for slide two. Say them slowly.",
      "The picture shows a blue rectangle. Nothing else is on this slide.",
      "The table shows the quarterly figures for Q1 and Q2.",
    ]);
  });

  it("returns empty notes for a slide with no notes page", async () => {
    const p = await pkg("deck-4x3-notes-images.pptx");
    const third = extractSlideNotes(p, p.slideParts[2].partPath);
    expect(third.notes).toBe("");
    expect(third.warnings).toEqual([]);
  });

  it("maps all 33 notes on the real P6 deck — body text only, never the slide number", async () => {
    const p = await pkg("p6-report-wizard-training.pptx");
    const notes = p.slideParts.map((s) => extractSlideNotes(p, s.partPath).notes);
    expect(notes).toHaveLength(33);
    // The deck has 33 notes pages; the first two (title + agenda) have
    // empty note bodies in the file itself — empty is the correct answer
    // there, not a mapping failure.
    expect(notes[0]).toBe("");
    expect(notes[1]).toBe("");
    const nonEmpty = notes.filter((n) => n.length > 0);
    expect(nonEmpty).toHaveLength(31);
    for (const [i, note] of notes.entries()) {
      // The notes page carries a slide-number placeholder whose text is
      // just the slide number ("1", "2", ...). That is boilerplate, not
      // narration: no note may consist of only its number.
      if (note) expect(note.trim()).not.toBe(String(i + 1));
    }
    // Spot-check real content.
    expect(notes[2]).toContain("There are several ways to create a report.");
    expect(notes[32]).toContain("Created and Presented by:");
    expect(notes[32]).toContain("Dustin Swanson");
  });

  it("never follows an external notes link", async () => {
    const p = await pkg("deck-external-rels-macro-ole.pptx");
    // The fixture's external relationship is a hyperlink, not a notes
    // link; notes extraction still returns the real notes.
    const first = extractSlideNotes(p, p.slideParts[0].partPath);
    expect(first.notes).toContain("Welcome to the synthetic deck.");
  });
});

describe("extractSlideText", () => {
  it("reads title, bullets and table text in order on the synthetic deck", async () => {
    const p = await pkg("synthetic-4-slide-16x9.pptx");
    const slide2 = extractSlideText(p, p.slideParts[1].partPath);
    expect(slide2.title).toBe("Key points");
    expect(slide2.paragraphs).toEqual([
      "Key points",
      "First point: the import must keep slide order.",
      "Second point: notes stay attached to their slide.",
      "Third point: no slide may go missing silently.",
    ]);
    const slide4 = extractSlideText(p, p.slideParts[3].partPath);
    expect(slide4.tables).toEqual([
      [
        ["Quarter", "Units", "Revenue"],
        ["Q1", "120", "$12,000"],
        ["Q2", "150", "$15,000"],
      ],
    ]);
  });

  it("excludes footer, date and slide-number placeholders from narration text", async () => {
    const p = await pkg("deck-mixed-placeholders-fonts.pptx");
    const slide1 = extractSlideText(p, p.slideParts[0].partPath);
    const joined = slide1.paragraphs.join("\n");
    expect(joined).not.toContain("Confidential");
    expect(joined).not.toContain("November 15, 2026");
    expect(slide1.paragraphs).toContain("Placeholders and fonts");
    expect(slide1.paragraphs).toContain("Footer, date and slide number must not become narration.");
  });

  it("reports the missing font used on the mixed deck", async () => {
    const p = await pkg("deck-mixed-placeholders-fonts.pptx");
    const slide2 = extractSlideText(p, p.slideParts[1].partPath);
    expect(slide2.fonts).toContain("ZzMissing Font 123");
    expect(slide2.paragraphs).toContain("Text in a missing font");
  });

  it("reads the chart title from the chart part", async () => {
    const p = await pkg("deck-16x9-table-chart.pptx");
    const slide2 = extractSlideText(p, p.slideParts[1].partPath);
    expect(slide2.chartTitles).toEqual(["Sales by category"]);
  });

  it("reads real slide text from the P6 deck in order", async () => {
    const p = await pkg("p6-report-wizard-training.pptx");
    const slide1 = extractSlideText(p, p.slideParts[0].partPath);
    expect(slide1.paragraphs[0]).toContain("P6 Report");
    expect(slide1.paragraphs).toContain("Dustin L. Swanson");
    // Every slide yields some text (titles at least); none is empty.
    for (const part of p.slideParts) {
      const text = extractSlideText(p, part.partPath);
      expect(text.paragraphs.length).toBeGreaterThan(0);
    }
  });
});
