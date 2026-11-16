// FORGE Capture — PPTX video project manifest (ui/pptx-project-core.js).
//
// DOM-free pure logic for the Create-video Slice 1 project record.
// Runs unmodified under vitest (node) and in the Tauri webview; the
// Rust backend (pptx_video_* commands) owns the bytes on disk.
//
// Schema PptxVideoProjectV1 (brief §2.6). Slice 1 populates the source
// deck and slide records; the later-slice fields (steps, narration,
// voice, audio, output) are present as explicit not-started placeholders
// so Slice 2 needs no migration — they carry no behaviour in Slice 1.
export const PPTX_VIDEO_PROJECT_SCHEMA = "PptxVideoProjectV1";
export const PPTX_VIDEO_MANIFEST_FILE = "project.json";
export const PPTX_VIDEO_SOURCE_FILE = "source.pptx";

const TITLE_MAX_LENGTH = 200;

/** Plain-words title validation: non-empty, short, no path characters. */
export function validateProjectTitle(title) {
  if (typeof title !== "string" || title.trim().length === 0) {
    return "Give the project a name.";
  }
  if (title.trim().length > TITLE_MAX_LENGTH) {
    return `Keep the name under ${TITLE_MAX_LENGTH} characters.`;
  }
  if (/[/\\:*?"<>|\x00-\x1f]/.test(title)) {
    return "The name cannot contain / \\ : * ? \" < > or |.";
  }
  return null;
}

/** Project ids are minted by the Rust backend; validate the shape here. */
export function isValidProjectId(id) {
  return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id);
}

export function slideIdForIndex(index) {
  return `slide-${index + 1}`;
}

/** One warning, in the shape every warning in this slice uses. */
export function isWarning(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    typeof value.message === "string" &&
    value.message.length > 0
  );
}

/**
 * Drop repeated warnings (same code + message), keeping the first.
 * The same font-substitution warning is reported for every slide, so
 * the project warnings box would otherwise list it once per slide.
 */
export function dedupeWarnings(warnings) {
  const seen = new Set();
  const out = [];
  for (const warning of warnings || []) {
    const key = `${warning.code || ""}\n${warning.message || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(warning);
  }
  return out;
}

/**
 * Build the initial manifest for a freshly imported deck.
 * @param {object} args
 * @param {string} args.id — backend-minted project id.
 * @param {string} args.title — project title (deck file name by default).
 * @param {object} args.source — { fileName, sha256, sizeBytes, slideWidthPt,
 *   slideHeightPt, slideCount, importedAt }.
 * @param {Array} args.slides — per-slide records { id, index, partPath,
 *   title, text, speakerNotes, selected, render, warnings }.
 * @param {Array} [args.warnings] — project-level warnings: package
 *   warnings no slide owns (orphan media, or no part). Shown with the
 *   slide warnings and persisted the same way.
 */
export function createProjectManifest({ id, title, source, slides, warnings }) {
  const now = new Date().toISOString();
  return {
    schemaVersion: PPTX_VIDEO_PROJECT_SCHEMA,
    id,
    title,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    source: {
      fileName: source.fileName,
      sha256: source.sha256,
      sizeBytes: source.sizeBytes,
      slideWidthPt: source.slideWidthPt,
      slideHeightPt: source.slideHeightPt,
      slideCount: source.slideCount,
      importedAt: source.importedAt || now,
    },
    slides: slides.map((slide) => ({
      id: slide.id,
      index: slide.index,
      partPath: slide.partPath,
      title: slide.title || "",
      text: slide.text || [],
      speakerNotes: slide.speakerNotes || "",
      selected: slide.selected !== false,
      render: slide.render || null,
      warnings: slide.warnings || [],
    })),
    warnings: warnings || [],
    // Later slices (2-5). Present but empty: Slice 1 builds no narration,
    // voice, audio, or video output.
    steps: [],
    narration: { status: "not_started" },
    voice: { status: "not_started" },
    audio: { status: "not_started" },
    output: { status: "not_started" },
    events: [{ at: now, type: "imported", detail: `Imported ${source.slideCount} slides from ${source.fileName}.` }],
  };
}

/** Structural validation of a parsed manifest. Returns an array of errors. */
export function validateProjectManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") return ["The project file is not a project."];
  if (manifest.schemaVersion !== PPTX_VIDEO_PROJECT_SCHEMA) {
    errors.push(`This project was made by a different version (${manifest.schemaVersion || "unknown"}).`);
  }
  if (!isValidProjectId(manifest.id)) errors.push("The project id is not valid.");
  const titleError = validateProjectTitle(manifest.title);
  if (titleError) errors.push(titleError);
  if (!manifest.source || typeof manifest.source !== "object") {
    errors.push("The project is missing its source deck record.");
  } else {
    if (typeof manifest.source.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifest.source.sha256)) {
      errors.push("The source deck record has no valid file fingerprint.");
    }
    if (!Number.isInteger(manifest.source.slideCount) || manifest.source.slideCount < 1) {
      errors.push("The source deck record has no slide count.");
    }
  }
  // Project-level warnings are optional (older manifests predate them),
  // but when present they must be well-formed warnings.
  if (manifest.warnings !== undefined) {
    if (!Array.isArray(manifest.warnings) || manifest.warnings.some((w) => !isWarning(w))) {
      errors.push("The project has a warning record that is not valid.");
    }
  }
  if (!Array.isArray(manifest.slides) || manifest.slides.length === 0) {
    errors.push("The project has no slides.");
  } else {
    const ids = new Set();
    for (const slide of manifest.slides) {
      if (!slide || typeof slide.id !== "string" || ids.has(slide.id)) {
        errors.push("The project has a slide with a missing or repeated id.");
        break;
      }
      ids.add(slide.id);
      if (typeof slide.selected !== "boolean") {
        errors.push(`Slide ${slide.id} has no selection saved.`);
        break;
      }
      // Slide-level warnings are optional (older manifests predate them),
      // but when present they must be an array of well-formed warnings —
      // a malformed record would otherwise throw in renderWarnings()
      // while opening the project.
      if (slide.warnings !== undefined) {
        if (!Array.isArray(slide.warnings) || slide.warnings.some((w) => !isWarning(w))) {
          errors.push(`Slide ${slide.id} has a warning record that is not valid.`);
          break;
        }
      }
    }
  }
  return errors;
}

function touch(manifest, eventType, detail) {
  const now = new Date().toISOString();
  return {
    ...manifest,
    updatedAt: now,
    revision: (manifest.revision || 0) + 1,
    events: [...(manifest.events || []), { at: now, type: eventType, detail }],
  };
}

/** Set one slide's selection. At least one slide must stay selected. */
export function setSlideSelected(manifest, slideId, selected) {
  const slide = manifest.slides.find((s) => s.id === slideId);
  if (!slide) throw new Error(`There is no slide called ${slideId} in this project.`);
  if (!selected && manifest.slides.filter((s) => s.selected).length <= 1) {
    throw new Error("Keep at least one slide selected.");
  }
  const next = {
    ...manifest,
    slides: manifest.slides.map((s) => (s.id === slideId ? { ...s, selected } : s)),
  };
  return touch(next, "selection-changed", `Slide ${slideId} ${selected ? "selected" : "deselected"}.`);
}

export function selectAllSlides(manifest) {
  const next = { ...manifest, slides: manifest.slides.map((s) => ({ ...s, selected: true })) };
  return touch(next, "selection-changed", "All slides selected.");
}

export function clearSlideSelection(manifest) {
  // Clearing keeps the first slide selected: a project with no slides
  // selected cannot make a video, and the UI must never offer a dead end.
  const next = {
    ...manifest,
    slides: manifest.slides.map((s, i) => ({ ...s, selected: i === 0 })),
  };
  return touch(next, "selection-changed", "Selection cleared; the first slide stays selected.");
}

/** Rename; returns the updated manifest (throws on an invalid title). */
export function renameProject(manifest, title) {
  const error = validateProjectTitle(title);
  if (error) throw new Error(error);
  const next = { ...manifest, title: title.trim() };
  return touch(next, "renamed", `Renamed to “${title.trim()}”.`);
}

export function selectedSlides(manifest) {
  return manifest.slides.filter((s) => s.selected);
}

/** What deleting the project removes: its whole project folder, and only
 * that folder. The user's original deck file is never touched. */
export function projectDeletePlan(manifest) {
  return {
    projectId: manifest.id,
    removes: [`project folder ${manifest.id} (deck copy, slide pictures, project file)`],
    keeps: ["your original PowerPoint file"],
  };
}
