// Slice 2 acceptance: narration drafts and review/edit (pptx-narration-core.js).
import { describe, it, expect } from "vitest";
import { createProjectManifest, slideIdForIndex } from "../pptx-project-core.js";
import {
  NARRATION_SOURCE,
  STEP_KIND,
  allStepsHaveText,
  applyGeneratedDraft,
  buildInitialSteps,
  canRevertStep,
  cleanSpeakerNotes,
  determineSlideNarrationSource,
  findStep,
  hasUnsavedEditsSinceGeneration,
  hasUsableSlideText,
  markGenerationFailed,
  requestRegenerate,
  revertStepToOriginal,
  setInitialSteps,
  setStepText,
  stepsPendingGeneration,
  undoStepEdit,
} from "../pptx-narration-core.js";

function slide({ index, title, text, speakerNotes, selected = true }) {
  return {
    id: slideIdForIndex(index),
    index,
    partPath: `ppt/slides/slide${index + 1}.xml`,
    title: title || "",
    text: text || [],
    speakerNotes: speakerNotes || "",
    selected,
    render: null,
    warnings: [],
  };
}

function fourSlideManifest() {
  const slides = [
    slide({ index: 0, title: "Cover slide", text: ["Welcome"], speakerNotes: "Say hello warmly." }),
    slide({ index: 1, title: "Numbers", text: ["Revenue up 10%", "Costs flat"] }), // no notes, usable text
    slide({ index: 2, title: "Just a photo", text: [] }), // no notes, no text — manual
    slide({ index: 3, title: "Thanks", text: ["Questions?"], speakerNotes: "  \n\n  " }), // whitespace-only notes
  ];
  return createProjectManifest({
    id: "pptx-1",
    title: "Q3 Deck",
    source: { fileName: "q3.pptx", sha256: "a".repeat(64), sizeBytes: 100, slideCount: 4 },
    slides,
  });
}

describe("cleanSpeakerNotes", () => {
  it("trims and collapses excess blank lines without rewriting wording", () => {
    expect(cleanSpeakerNotes("  Hello there.  \n\n\n\nSecond line.  \n")).toBe("Hello there.\n\nSecond line.");
  });
  it("treats whitespace-only notes as empty", () => {
    expect(cleanSpeakerNotes("  \n\n  ")).toBe("");
  });
  it("is defensive against a non-string value", () => {
    expect(cleanSpeakerNotes(null)).toBe("");
    expect(cleanSpeakerNotes(undefined)).toBe("");
  });
});

describe("hasUsableSlideText", () => {
  it("is true when at least one paragraph is non-empty", () => {
    expect(hasUsableSlideText({ text: ["", "  ", "Real text"] })).toBe(true);
  });
  it("is false for an empty or whitespace-only array", () => {
    expect(hasUsableSlideText({ text: [] })).toBe(false);
    expect(hasUsableSlideText({ text: ["", "   "] })).toBe(false);
  });
  it("is false when text is missing entirely", () => {
    expect(hasUsableSlideText({})).toBe(false);
  });
});

describe("determineSlideNarrationSource — brief §2.3 precedence", () => {
  it("prefers speaker notes over everything else", () => {
    const r = determineSlideNarrationSource({ speakerNotes: "Use this exact wording.", text: ["also has text"] });
    expect(r.sourceKind).toBe(NARRATION_SOURCE.SPEAKER_NOTES);
    expect(r.initialText).toBe("Use this exact wording.");
    expect(r.needsGeneration).toBe(false);
  });
  it("falls back to a local model draft when there are no notes but usable text exists", () => {
    const r = determineSlideNarrationSource({ speakerNotes: "", text: ["Revenue up 10%"] });
    expect(r.sourceKind).toBe(NARRATION_SOURCE.LOCAL_MODEL_DRAFT);
    expect(r.initialText).toBe("");
    expect(r.needsGeneration).toBe(true);
  });
  it("requires manual narration when neither notes nor usable text exist", () => {
    const r = determineSlideNarrationSource({ speakerNotes: "", text: [] });
    expect(r.sourceKind).toBe(NARRATION_SOURCE.MANUAL);
    expect(r.needsGeneration).toBe(false);
  });
  it("treats whitespace-only notes as absent notes, not as the chosen source", () => {
    const r = determineSlideNarrationSource({ speakerNotes: "   \n  ", text: ["Questions?"] });
    expect(r.sourceKind).toBe(NARRATION_SOURCE.LOCAL_MODEL_DRAFT);
  });
});

describe("buildInitialSteps — the four-slide fixture yields exactly six ordered steps", () => {
  it("builds cover + one step per selected slide + ending, in deck order", () => {
    const manifest = fourSlideManifest();
    const steps = buildInitialSteps(manifest);
    expect(steps).toHaveLength(6);
    expect(steps.map((s) => s.kind)).toEqual([
      STEP_KIND.COVER,
      STEP_KIND.SLIDE,
      STEP_KIND.SLIDE,
      STEP_KIND.SLIDE,
      STEP_KIND.SLIDE,
      STEP_KIND.ENDING,
    ]);
    // Each slide step maps to the correct slide id, in order.
    expect(steps.slice(1, 5).map((s) => s.slideId)).toEqual(["slide-1", "slide-2", "slide-3", "slide-4"]);
  });

  it("picks the right narration source per slide, matching brief §2.3", () => {
    const manifest = fourSlideManifest();
    const steps = buildInitialSteps(manifest);
    const [, s1, s2, s3, s4] = steps;
    expect(s1.sourceKind).toBe(NARRATION_SOURCE.SPEAKER_NOTES);
    expect(s1.currentText).toBe("Say hello warmly.");
    expect(s2.sourceKind).toBe(NARRATION_SOURCE.LOCAL_MODEL_DRAFT);
    expect(s2.needsGeneration).toBe(true);
    expect(s3.sourceKind).toBe(NARRATION_SOURCE.MANUAL); // "Just a photo", no text, no notes
    expect(s3.needsGeneration).toBe(false);
    expect(s4.sourceKind).toBe(NARRATION_SOURCE.LOCAL_MODEL_DRAFT); // whitespace-only notes -> treated as absent
  });

  it("only includes currently-selected slides", () => {
    const manifest = fourSlideManifest();
    manifest.slides[2].selected = false; // deselect "Just a photo"
    const steps = buildInitialSteps(manifest);
    expect(steps).toHaveLength(5);
    expect(steps.map((s) => s.slideId)).not.toContain("slide-3");
  });

  it("never fabricates a description for an image-only slide", () => {
    const manifest = fourSlideManifest();
    const steps = buildInitialSteps(manifest);
    const imageOnlyStep = steps.find((s) => s.slideId === "slide-3");
    expect(imageOnlyStep.currentText).toBe("");
    expect(imageOnlyStep.sourceKind).toBe(NARRATION_SOURCE.MANUAL);
  });
});

describe("stepsPendingGeneration", () => {
  it("lists exactly the steps needing a local draft", () => {
    const manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    const pending = stepsPendingGeneration(manifest);
    expect(pending.map((s) => s.slideId)).toEqual(["slide-2", "slide-4"]);
  });
});

describe("applyGeneratedDraft", () => {
  it("sets both the immutable suggestion and the editable current text", () => {
    let manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    manifest = applyGeneratedDraft(manifest, "step-slide-2", "  Revenue grew ten percent this quarter.  ");
    const step = findStep(manifest, "step-slide-2");
    expect(step.generatedSuggestion).toBe("Revenue grew ten percent this quarter.");
    expect(step.currentText).toBe("Revenue grew ten percent this quarter.");
    expect(step.needsGeneration).toBe(false);
  });

  it("keeps the original suggestion recoverable after the user edits the text", () => {
    let manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    manifest = applyGeneratedDraft(manifest, "step-slide-2", "Original draft.");
    manifest = setStepText(manifest, "step-slide-2", "User's rewritten version.");
    const step = findStep(manifest, "step-slide-2");
    expect(step.generatedSuggestion).toBe("Original draft."); // unchanged by the edit
    expect(step.currentText).toBe("User's rewritten version.");
  });
});

describe("markGenerationFailed — model absent/timeout/invalid output never falls back to a cloud call", () => {
  it("routes the step to manual with a plain error, and clears needsGeneration so there is no retry loop", () => {
    let manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    manifest = markGenerationFailed(manifest, "step-slide-2", "The local narration helper took too long to respond.");
    const step = findStep(manifest, "step-slide-2");
    expect(step.sourceKind).toBe(NARRATION_SOURCE.MANUAL);
    expect(step.needsGeneration).toBe(false);
    expect(step.generationError).toMatch(/took too long/);
  });
});

describe("undo / revert", () => {
  it("undoStepEdit restores the text from immediately before the last edit, once", () => {
    let manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    manifest = setStepText(manifest, "step-slide-3", "First manual draft.");
    manifest = setStepText(manifest, "step-slide-3", "Second manual draft.");
    manifest = undoStepEdit(manifest, "step-slide-3");
    expect(findStep(manifest, "step-slide-3").currentText).toBe("First manual draft.");
  });

  it("a second consecutive undo is a no-op (single-level undo)", () => {
    let manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    manifest = setStepText(manifest, "step-slide-3", "Only draft.");
    manifest = undoStepEdit(manifest, "step-slide-3");
    const once = findStep(manifest, "step-slide-3").currentText;
    manifest = undoStepEdit(manifest, "step-slide-3");
    expect(findStep(manifest, "step-slide-3").currentText).toBe(once);
  });

  it("revertStepToOriginal restores the original generated suggestion, not just the last edit", () => {
    let manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    manifest = applyGeneratedDraft(manifest, "step-slide-2", "Original model draft.");
    manifest = setStepText(manifest, "step-slide-2", "Edit one.");
    manifest = setStepText(manifest, "step-slide-2", "Edit two.");
    manifest = revertStepToOriginal(manifest, "step-slide-2");
    expect(findStep(manifest, "step-slide-2").currentText).toBe("Original model draft.");
  });

  it("revertStepToOriginal throws for a step that was never generated (nothing to revert to)", () => {
    const manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    expect(() => revertStepToOriginal(manifest, "step-slide-3")).toThrow(/no original draft/);
  });

  it("canRevertStep is false once current text already equals the suggestion", () => {
    let manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    manifest = applyGeneratedDraft(manifest, "step-slide-2", "Draft.");
    expect(canRevertStep(findStep(manifest, "step-slide-2"))).toBe(false);
    manifest = setStepText(manifest, "step-slide-2", "Changed.");
    expect(canRevertStep(findStep(manifest, "step-slide-2"))).toBe(true);
  });
});

describe("requestRegenerate — never silently overwrites edits", () => {
  it("flags unsaved edits so the caller can confirm before regenerating", () => {
    let manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    manifest = applyGeneratedDraft(manifest, "step-slide-2", "Draft.");
    manifest = setStepText(manifest, "step-slide-2", "User changed this.");
    expect(hasUnsavedEditsSinceGeneration(findStep(manifest, "step-slide-2"))).toBe(true);
  });

  it("marks a model-drafted step as needing generation again once confirmed", () => {
    let manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    manifest = applyGeneratedDraft(manifest, "step-slide-2", "Draft.");
    manifest = requestRegenerate(manifest, "step-slide-2");
    expect(findStep(manifest, "step-slide-2").needsGeneration).toBe(true);
  });

  it("refuses to regenerate a speaker-notes or manual step", () => {
    const manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    expect(() => requestRegenerate(manifest, "step-slide-1")).toThrow(/cannot be regenerated/);
    expect(() => requestRegenerate(manifest, "step-slide-3")).toThrow(/cannot be regenerated/);
  });
});

describe("allStepsHaveText", () => {
  it("is false while a pending or manual step is still empty", () => {
    const manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    expect(allStepsHaveText(manifest)).toBe(false); // slide-2/4 pending, slide-3 manual-empty
  });

  it("is true once every step has text", () => {
    let manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    manifest = applyGeneratedDraft(manifest, "step-slide-2", "Draft 2.");
    manifest = applyGeneratedDraft(manifest, "step-slide-4", "Draft 4.");
    manifest = setStepText(manifest, "step-slide-3", "Manual narration for the photo.");
    expect(allStepsHaveText(manifest)).toBe(true);
  });
});

describe("persistence round trip (save/close/reopen)", () => {
  it("steps survive a JSON round trip exactly", () => {
    let manifest = setInitialSteps(fourSlideManifest(), buildInitialSteps(fourSlideManifest()));
    manifest = applyGeneratedDraft(manifest, "step-slide-2", "Draft 2.");
    const roundTripped = JSON.parse(JSON.stringify(manifest));
    expect(roundTripped.steps).toEqual(manifest.steps);
  });
});
