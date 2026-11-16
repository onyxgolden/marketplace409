// FORGE Capture — PPTX-to-video Slice 2 narration-draft manifest logic
// (ui/pptx-narration-core.js).
//
// DOM-free pure logic, runs unmodified under vitest and in the Tauri
// webview. Builds and edits the `steps`/`narration` sections of the
// PptxVideoProjectV1 manifest that Slice 1 reserved as empty placeholders.
// Calling the local model lives in the Rust backend
// (`pptx_video_generate_narration_draft`); this module only decides WHICH
// steps need a draft and HOW a step's text changes over editing, undo,
// revert and regenerate — never runs the model itself.

export const STEP_KIND = { COVER: "cover", SLIDE: "slide", ENDING: "ending" };

export const NARRATION_SOURCE = {
  SPEAKER_NOTES: "speaker_notes",
  LOCAL_MODEL_DRAFT: "local_model_draft",
  MANUAL: "manual",
};

const DEFAULT_OUTRO_TEXT = "Thanks for watching.";

/** Whitespace-only cleanup of speaker notes — brief §2.3: "cleaned only
 * for obvious whitespace and line breaks. Do not silently rewrite them."
 * Collapses runs of 3+ blank lines to one blank line, trims trailing
 * whitespace from each line, and trims the whole string. Never changes
 * wording. */
export function cleanSpeakerNotes(notes) {
  if (typeof notes !== "string") return "";
  return notes
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when a slide's extracted text array has any non-empty, non-
 * whitespace paragraph — the "usable slide text exists" test in brief
 * §2.3 precedence rule 2. */
export function hasUsableSlideText(slide) {
  return Array.isArray(slide?.text) && slide.text.some((p) => typeof p === "string" && p.trim().length > 0);
}

/** One slide's narration precedence, per brief §2.3:
 * 1. speaker notes present -> speaker_notes, text = cleaned notes.
 * 2. no notes, usable text -> local_model_draft, pending generation.
 * 3. neither -> manual, user must write it; never a hallucinated guess. */
export function determineSlideNarrationSource(slide) {
  const cleanedNotes = cleanSpeakerNotes(slide?.speakerNotes);
  if (cleanedNotes.length > 0) {
    return { sourceKind: NARRATION_SOURCE.SPEAKER_NOTES, initialText: cleanedNotes, needsGeneration: false };
  }
  if (hasUsableSlideText(slide)) {
    return { sourceKind: NARRATION_SOURCE.LOCAL_MODEL_DRAFT, initialText: "", needsGeneration: true };
  }
  return { sourceKind: NARRATION_SOURCE.MANUAL, initialText: "", needsGeneration: false };
}

function makeStep({ id, kind, slideId, title, sourceKind, currentText, needsGeneration }) {
  return {
    id,
    kind,
    slideId: slideId ?? null,
    title,
    sourceKind,
    // The immutable suggestion as first produced (speaker notes after
    // only whitespace cleanup, or the model's first draft). Never
    // rewritten by later edits — brief §2.6: "immutable generated
    // suggestion, current editable text" are separate fields.
    generatedSuggestion: currentText || null,
    currentText: currentText || "",
    needsGeneration: !!needsGeneration,
    // Single-level undo: the text immediately before the last edit.
    // Scope note: the brief asks for "undo"; this is one step of undo,
    // not a full history stack — revision history below is the durable
    // audit trail, not an unbounded undo buffer.
    previousText: null,
    revisionHistory: [],
  };
}

/**
 * Builds the initial six-or-more-step list for a project's currently
 * selected slides: cover, one step per selected slide in deck order,
 * ending. Pure — never calls the model. Steps needing a local draft are
 * marked `needsGeneration: true`; the caller generates them afterward
 * (brief §4 Slice 2 acceptance: "A 4-slide fixture yields exactly 6
 * ordered steps: cover + four slide steps + ending").
 */
export function buildInitialSteps(manifest) {
  const selected = manifest.slides.filter((s) => s.selected);
  const steps = [];
  steps.push(
    makeStep({
      id: "step-cover",
      kind: STEP_KIND.COVER,
      title: manifest.title || "Cover",
      sourceKind: NARRATION_SOURCE.MANUAL,
      currentText: manifest.title ? `Welcome to “${manifest.title}.”` : "",
      needsGeneration: false,
    })
  );
  for (const slide of selected) {
    const { sourceKind, initialText, needsGeneration } = determineSlideNarrationSource(slide);
    steps.push(
      makeStep({
        id: `step-${slide.id}`,
        kind: STEP_KIND.SLIDE,
        slideId: slide.id,
        title: slide.title || `Slide ${slide.index + 1}`,
        sourceKind,
        currentText: initialText,
        needsGeneration,
      })
    );
  }
  steps.push(
    makeStep({
      id: "step-ending",
      kind: STEP_KIND.ENDING,
      title: "Ending",
      sourceKind: NARRATION_SOURCE.MANUAL,
      currentText: DEFAULT_OUTRO_TEXT,
      needsGeneration: false,
    })
  );
  return steps;
}

/** Steps whose local-model draft has not been generated yet — what the
 * caller should send to `pptx_video_generate_narration_draft`, one at a
 * time, in order. */
export function stepsPendingGeneration(manifest) {
  return (manifest.steps || []).filter((s) => s.needsGeneration);
}

function touchManifest(manifest, eventType, detail) {
  const now = new Date().toISOString();
  return {
    ...manifest,
    updatedAt: now,
    revision: (manifest.revision || 0) + 1,
    events: [...(manifest.events || []), { at: now, type: eventType, detail }],
  };
}

function updateStep(manifest, stepId, updater) {
  const steps = manifest.steps || [];
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx === -1) throw new Error(`There is no narration step called ${stepId} in this project.`);
  const nextSteps = steps.slice();
  nextSteps[idx] = updater(steps[idx]);
  return { ...manifest, steps: nextSteps };
}

/** Records the initial steps onto the manifest (call once, right after
 * `buildInitialSteps`, before any generation has run). */
export function setInitialSteps(manifest, steps) {
  const next = { ...manifest, steps, narration: { status: "drafting" } };
  return touchManifest(next, "narration-steps-built", `Built ${steps.length} narration steps.`);
}

/** Applies a freshly generated local-model draft to a step that was
 * pending generation. Sets BOTH the immutable suggestion and the current
 * editable text (brief §4 Slice 2: "Generated suggestions remain
 * separately recoverable" — recoverable via `generatedSuggestion`, never
 * silently merged away by a later edit).
 *
 * Fix round 1 (non-blocking observation): a REGENERATION (the step
 * already had a `generatedSuggestion` from a prior draft) pushes that
 * prior suggestion into `revisionHistory` before it's overwritten, so
 * every past generation stays recoverable, not just the most recent
 * one. The first draft for a step (no prior suggestion) has nothing to
 * archive yet. */
export function applyGeneratedDraft(manifest, stepId, draftText) {
  const trimmed = (draftText || "").trim();
  const next = updateStep(manifest, stepId, (step) => ({
    ...step,
    generatedSuggestion: trimmed,
    currentText: trimmed,
    needsGeneration: false,
    previousText: step.currentText,
    revisionHistory:
      step.generatedSuggestion !== null
        ? [...step.revisionHistory, { at: new Date().toISOString(), generatedSuggestion: step.generatedSuggestion }]
        : step.revisionHistory,
  }));
  return touchManifest(next, "narration-drafted", `Generated a narration draft for “${findStep(next, stepId).title}.”`);
}

/** Records that generation failed for a step — the step stays
 * `needsGeneration: false` (no retry loop) but visibly empty/manual, per
 * the brief's "Model absent, OOM, timeout, or invalid output yields a
 * clear local-only error/manual path, never a cloud call." The plain-
 * words error message itself is supplied by the Rust command's
 * `user_message()`; this function only records that manual writing is
 * now required and why. */
export function markGenerationFailed(manifest, stepId, plainErrorMessage) {
  const next = updateStep(manifest, stepId, (step) => ({
    ...step,
    sourceKind: NARRATION_SOURCE.MANUAL,
    needsGeneration: false,
    generationError: plainErrorMessage || "The local narration helper could not draft this slide.",
  }));
  return touchManifest(next, "narration-draft-failed", `Could not draft “${findStep(next, stepId).title}”; needs manual narration.`);
}

/** User edits a step's current text. Keeps one level of undo. */
export function setStepText(manifest, stepId, text) {
  const next = updateStep(manifest, stepId, (step) => ({
    ...step,
    previousText: step.currentText,
    currentText: text,
  }));
  return touchManifest(next, "narration-edited", `Edited “${findStep(next, stepId).title}.”`);
}

/** Undoes the single most recent edit to a step (back to its
 * `previousText`). A second consecutive undo is a no-op (one level, by
 * design — see `makeStep`'s `previousText` note). */
export function undoStepEdit(manifest, stepId) {
  const step = findStep(manifest, stepId);
  if (step.previousText === null) return manifest;
  const next = updateStep(manifest, stepId, (s) => ({
    ...s,
    currentText: s.previousText,
    previousText: null,
  }));
  return touchManifest(next, "narration-undo", `Undid the last edit to “${step.title}.”`);
}

/** Reverts a step's current text back to its original generated
 * suggestion (speaker notes as cleaned, or the model's first draft).
 * A manual-only step (no suggestion was ever generated) has nothing to
 * revert to and throws, so the UI never offers a dead "Revert" button
 * for it without checking first — see `canRevertStep`. */
export function revertStepToOriginal(manifest, stepId) {
  const step = findStep(manifest, stepId);
  if (step.generatedSuggestion === null) {
    throw new Error(`“${step.title}” has no original draft to revert to.`);
  }
  const next = updateStep(manifest, stepId, (s) => ({
    ...s,
    previousText: s.currentText,
    currentText: s.generatedSuggestion,
  }));
  return touchManifest(next, "narration-reverted", `Reverted “${step.title}” to its original draft.`);
}

export function canRevertStep(step) {
  return step.generatedSuggestion !== null && step.currentText !== step.generatedSuggestion;
}

/** True when a step has unsaved edits relative to its generated
 * suggestion — the UI must confirm before regenerating over this (brief
 * §3: "Never regenerate over user edits without confirmation"). A step
 * that was never generated (manual) or whose text still matches the
 * original suggestion can regenerate without asking. */
export function hasUnsavedEditsSinceGeneration(step) {
  return step.generatedSuggestion !== null && step.currentText !== step.generatedSuggestion;
}

/** Marks a step for regeneration — the caller still must get user
 * confirmation first when `hasUnsavedEditsSinceGeneration` is true; this
 * function only flips the manifest state once that's settled, and only
 * for a step whose source is actually model-generated (asking to
 * "regenerate" a speaker-notes or manual step is not a valid action). */
export function requestRegenerate(manifest, stepId) {
  const step = findStep(manifest, stepId);
  if (step.sourceKind !== NARRATION_SOURCE.LOCAL_MODEL_DRAFT) {
    throw new Error(`“${step.title}” is not a model-drafted step and cannot be regenerated.`);
  }
  const next = updateStep(manifest, stepId, (s) => ({ ...s, needsGeneration: true, generationError: null }));
  return touchManifest(next, "narration-regenerate-requested", `Requested a new draft for “${step.title}.”`);
}

export function findStep(manifest, stepId) {
  const step = (manifest.steps || []).find((s) => s.id === stepId);
  if (!step) throw new Error(`There is no narration step called ${stepId} in this project.`);
  return step;
}

/** True once every step has non-empty current text — later slices gate
 * on this before voice/video work begins. */
export function allStepsHaveText(manifest) {
  return (manifest.steps || []).length > 0 && (manifest.steps || []).every((s) => s.currentText.trim().length > 0);
}
