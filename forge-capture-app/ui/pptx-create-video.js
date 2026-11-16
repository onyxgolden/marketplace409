// FORGE Capture — PPTX-to-video Slice 1 panel, DOM half (pptx-create-video.js).
//
// ES module (no bundler): loaded via <script type="module"> in index.html.
// Owns the DOM and the Tauri commands this slice adds:
//   - pptx_video_begin_upload / append_chunk / finish_upload / cancel_upload
//   - pptx_video_list_projects / get_project / save_project
//   - pptx_video_save_thumb / read_thumb / rename_project / delete_project
// All pure logic lives in pptx-import-core.js, pptx-extract-core.js,
// pptx-render-core.js and pptx-project-core.js and is unit-tested under
// vitest with no DOM.
//
// Slice 1 only: import a .pptx, preview its slides, pick which slides go
// in, and save that as a project. No narration, no voice, no video
// assembly, no export — the panel says so plainly at the bottom.
//
// The webview never fetches anything: parsing and rendering run locally
// (Pagus bundle + fflate, vendored under ui/vendor/), and the deck bytes
// travel to the backend only as invoke chunks.

import { validateAndExtractPptx, PptxReject } from "./pptx-import-core.js";
import { extractSlideNotes, extractSlideText } from "./pptx-extract-core.js";
import { renderPresentation } from "./pptx-render-core.js";
import {
  createProjectManifest,
  clearSlideSelection,
  projectDeletePlan,
  renameProject,
  selectAllSlides,
  selectedSlides,
  setSlideSelected,
  slideIdForIndex,
  validateProjectManifest,
  validateProjectTitle,
} from "./pptx-project-core.js";

const CHUNK_BYTES = 1024 * 1024; // 1 MiB, same as the media upload path.

function defaultInvoke(cmd, args) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

/** Plain-words message for an import/render failure. */
export function describePptxFailure(error) {
  if (error && error.name === "PptxReject") return error.message;
  if (error && error.name === "AbortError") return "Import was cancelled.";
  if (error instanceof Error) return error.message;
  return "Something went wrong while reading that file.";
}

/** File name without its extension, for the default project title. */
export function titleFromFileName(fileName) {
  return fileName.replace(/\.pptx?$/i, "").trim() || "Untitled video project";
}

/**
 * Mount the Create-video panel.
 * @param {object} deps — { invoke, root } — all optional; production
 *   defaults (real Tauri invoke, #pptx-create-video-mount) are used
 *   otherwise. Tests pass a fake invoke + a detached root element.
 */
export function mountPptxCreateVideo(deps = {}) {
  const invoke = deps.invoke || defaultInvoke;
  const root = deps.root || document.getElementById("pptx-create-video-mount");
  if (!root) return null;

  let manifest = null; // the open project's PptxVideoProjectV1, or null
  let thumbUrls = new Map(); // slide id -> blob: URL for the card picture
  let busy = false;
  let currentAbort = null; // AbortController for the in-flight import, if any

  root.innerHTML = `
    <div class="pptx-panel">
      <p class="pptx-intro">Turn a PowerPoint into a video project. Pick the slides, and later steps will add the narration and the video itself.</p>
      <div id="pptx-status" class="status" role="status" aria-live="polite"></div>
      <div id="pptx-list-view">
        <div id="pptx-dropzone" class="pptx-dropzone" tabindex="0" role="button" aria-label="Choose a PowerPoint file">
          <p><strong>Drop a PowerPoint here</strong> or <button type="button" id="pptx-browse" class="primary-btn">Choose a file</button></p>
          <p class="pptx-hint">.pptx files up to 100 MB. Old .ppt files are turned away with a plain message — save them as .pptx in PowerPoint first.</p>
          <input type="file" id="pptx-file" accept=".pptx,.ppt" hidden />
        </div>
        <div id="pptx-progress" hidden>
          <progress id="pptx-progress-bar" max="100" value="0"></progress>
          <span id="pptx-progress-text"></span>
          <button type="button" id="pptx-cancel" class="ghost-btn small">Cancel</button>
        </div>
        <h3>Your video projects</h3>
        <ul id="pptx-project-list" class="pptx-project-list"></ul>
        <p id="pptx-no-projects" class="pptx-hint" hidden>No video projects yet — import a PowerPoint to start one.</p>
      </div>
      <div id="pptx-project-view" hidden>
        <div class="row pptx-project-head">
          <button type="button" id="pptx-back" class="ghost-btn">← Back to projects</button>
          <span class="pptx-project-count" id="pptx-project-count"></span>
        </div>
        <div class="row pptx-rename-row">
          <label class="field">Project name
            <input type="text" id="pptx-title" maxlength="200" />
          </label>
          <button type="button" id="pptx-rename" class="primary-btn">Save name</button>
        </div>
        <div class="row pptx-select-row">
          <button type="button" id="pptx-select-all" class="ghost-btn small">Select all</button>
          <button type="button" id="pptx-clear" class="ghost-btn small">Clear selection</button>
          <span id="pptx-selection-count" class="pptx-hint"></span>
        </div>
        <div id="pptx-warnings" class="pptx-warnings" hidden></div>
        <div id="pptx-slide-grid" class="pptx-slide-grid"></div>
        <div class="row pptx-danger-row">
          <button type="button" id="pptx-delete" class="ghost-btn">Delete this project…</button>
        </div>
        <p class="pptx-hint">Narration, voice and video export come in later steps — this step only imports the deck and picks the slides.</p>
      </div>
    </div>`;

  const $ = (id) => root.querySelector(`#${id}`);
  const statusEl = $("pptx-status");
  const listView = $("pptx-list-view");
  const projectView = $("pptx-project-view");

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function setProgress(fraction, text) {
    $("pptx-progress").hidden = false;
    $("pptx-progress-bar").value = Math.round(fraction * 100);
    $("pptx-progress-text").textContent = text;
  }

  function hideProgress() {
    $("pptx-progress").hidden = true;
    $("pptx-progress-bar").value = 0;
  }

  function showList() {
    manifest = null;
    for (const url of thumbUrls.values()) URL.revokeObjectURL(url);
    thumbUrls = new Map();
    projectView.hidden = true;
    listView.hidden = false;
  }

  async function refreshList() {
    let projects = [];
    try {
      projects = await invoke("pptx_video_list_projects");
    } catch (e) {
      setStatus(`Could not list your video projects: ${describePptxFailure(e)}`, "error");
      return;
    }
    const list = $("pptx-project-list");
    list.innerHTML = "";
    $("pptx-no-projects").hidden = projects.length > 0;
    for (const project of projects) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pptx-project-item";
      button.textContent = `${project.title} — ${project.slideCount} slides`;
      button.addEventListener("click", () => openProject(project.projectId));
      li.appendChild(button);
      list.appendChild(li);
    }
  }

  // -- Import ---------------------------------------------------------------

  async function importFile(file) {
    if (busy) return;
    busy = true;
    hideProgress();
    setStatus(`Reading ${file.name}…`);
    let uploadId = null;
    const abort = new AbortController();
    currentAbort = abort;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setProgress(0.05, "Checking the file…");
      const pkg = await validateAndExtractPptx(bytes, { signal: abort.signal });
      if (pkg.warnings.length > 0) {
        // Warnings travel with the project; the list is shown on the
        // project page, not as a blocking error.
        console.info("pptx import warnings", pkg.warnings);
      }
      setProgress(0.2, "Reading slide text and speaker notes…");
      const slideRecords = pkg.slideParts.map((part, i) => {
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
      setProgress(0.35, "Drawing slide pictures…");
      const rendered = await renderPresentation(pkg, { signal: abort.signal });
      setProgress(0.55, "Saving your file…");
      const upload = await uploadDeck(invoke, bytes, file.name, abort.signal, (done, total) => {
        setProgress(0.55 + 0.2 * (done / total), `Saving your file… ${done} of ${total} bytes`);
      });
      uploadId = upload.projectId;
      const project = createProjectManifest({
        id: upload.projectId,
        title: titleFromFileName(file.name),
        source: {
          fileName: file.name,
          sha256: upload.sha256,
          sizeBytes: upload.sizeBytes,
          slideWidthPt: pkg.slideSize.widthPt,
          slideHeightPt: pkg.slideSize.heightPt,
          slideCount: pkg.slideParts.length,
        },
        slides: slideRecords,
      });
      setProgress(0.8, "Saving slide pictures…");
      // Thumbnails are the rendered SVGs themselves, not PNG rasters:
      // Pagus draws all slide text inside <foreignObject>, and Chromium
      // taints any canvas an SVG-with-foreignObject is drawn onto, so
      // canvas.toBlob() throws for every real slide. The SVG displays
      // directly in an <img> (no script execution there) and is the
      // faithful thumbnail. PNG rasterization is a Slice 4 problem.
      for (let i = 0; i < rendered.slides.length; i += 1) {
        if (abort.signal.aborted) {
          throw new DOMException("Import was cancelled.", "AbortError");
        }
        const slide = rendered.slides[i];
        const svgBytes = new TextEncoder().encode(slide.svg);
        const thumbSha = await invoke("pptx_video_save_thumb", {
          projectId: upload.projectId,
          slideIndex: i,
          thumbBytes: Array.from(svgBytes),
        });
        project.slides[i].render = { thumbSha256: thumbSha, renderSha256: slide.sha256 };
        project.slides[i].thumbPath = `thumbs/slide-${String(i + 1).padStart(4, "0")}.svg`;
        setProgress(0.8 + 0.2 * ((i + 1) / rendered.slides.length), `Saving slide pictures… ${i + 1} of ${rendered.slides.length}`);
      }
      const errors = validateProjectManifest(project);
      if (errors.length > 0) throw new Error(errors.join(" "));
      await invoke("pptx_video_save_project", {
        projectId: upload.projectId,
        manifestJson: JSON.stringify(project),
      });
      uploadId = null; // saved: the project now owns the upload
      hideProgress();
      manifest = project;
      await openProjectView(project, rendered);
      const withNotes = project.slides.filter((s) => s.speakerNotes.length > 0).length;
      setStatus(
        `Saved — “${project.title}” is ready. ${project.slides.length} slides, ${withNotes} with speaker notes. Pick the slides for your video below.`,
        "ok",
      );
    } catch (e) {
      hideProgress();
      if (uploadId) {
        // The upload finished before the failure: the project folder
        // already exists (source deck, no manifest). Cancel only clears
        // the in-flight upload, so remove the folder instead — otherwise
        // a failed import leaves a partial project on disk.
        try {
          await invoke("pptx_video_delete_project", { projectId: uploadId });
        } catch {
          try {
            await invoke("pptx_video_cancel_upload", { uploadId });
          } catch {
            /* best effort — a failed import must leave nothing behind */
          }
        }
      }
      setStatus(`Could not import that file: ${describePptxFailure(e)}`, "error");
    } finally {
      currentAbort = null;
      busy = false;
    }
  }

  async function uploadDeck(invokeFn, bytes, fileName, signal, onProgress) {
    const uploadId = await invokeFn("pptx_video_begin_upload", {
      dto: { fileName, totalBytes: bytes.length },
    });
    try {
      for (let off = 0; off < bytes.length; off += CHUNK_BYTES) {
        if (signal && signal.aborted) {
          throw new DOMException("Import was cancelled.", "AbortError");
        }
        const chunk = bytes.subarray(off, off + CHUNK_BYTES);
        await invokeFn("pptx_video_append_chunk", {
          dto: { uploadId, offset: off, bytes: Array.from(chunk) },
        });
        if (onProgress) onProgress(Math.min(bytes.length, off + chunk.length), bytes.length);
      }
      return await invokeFn("pptx_video_finish_upload", { uploadId });
    } catch (e) {
      try {
        await invokeFn("pptx_video_cancel_upload", { uploadId });
      } catch {
        /* best effort */
      }
      throw e;
    }
  }

  // -- Project view -----------------------------------------------------------

  async function openProject(projectId) {
    setStatus("Opening…");
    try {
      const json = await invoke("pptx_video_get_project", { projectId });
      const project = JSON.parse(json);
      const errors = validateProjectManifest(project);
      if (errors.length > 0) throw new Error(errors.join(" "));
      manifest = project;
      await openProjectView(project, null);
      setStatus(`Opened “${project.title}”.`, "ok");
    } catch (e) {
      setStatus(`Could not open that project: ${describePptxFailure(e)}`, "error");
    }
  }

  async function openProjectView(project, rendered) {
    listView.hidden = true;
    projectView.hidden = false;
    $("pptx-title").value = project.title;
    $("pptx-project-count").textContent = `${project.slides.length} slides`;
    renderWarnings(project);
    const grid = $("pptx-slide-grid");
    grid.innerHTML = "";
    for (let i = 0; i < project.slides.length; i += 1) {
      const slide = project.slides[i];
      const card = document.createElement("article");
      card.className = "pptx-slide-card";
      const img = document.createElement("img");
      img.alt = `Slide ${i + 1}: ${slide.title || "untitled"}`;
      img.className = "pptx-thumb";
      if (rendered) {
        // Fresh import: reuse the rendered SVG as the card picture until
        // the saved PNG is read back; the PNG is the stored thumbnail.
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered.slides[i].svg)}`;
      } else {
        img.src = "";
        loadThumb(project.id, i).then((url) => {
          if (url) img.src = url;
        });
      }
      const label = document.createElement("label");
      label.className = "pptx-slide-check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = slide.selected;
      checkbox.setAttribute("aria-label", `Include slide ${i + 1} in the video`);
      checkbox.addEventListener("change", () => onToggleSlide(slide.id, checkbox.checked));
      const checkText = document.createElement("span");
      checkText.textContent = `Slide ${i + 1} — ${slide.title || "untitled"}`;
      label.append(checkbox, checkText);
      const notes = document.createElement("p");
      notes.className = "pptx-notes";
      notes.textContent = slide.speakerNotes
        ? slide.speakerNotes.slice(0, 160) + (slide.speakerNotes.length > 160 ? "…" : "")
        : "No speaker notes on this slide.";
      const warnings = document.createElement("p");
      warnings.className = "pptx-hint";
      warnings.textContent = slide.warnings.map((w) => w.message).join(" ");
      card.append(img, label, notes, warnings);
      grid.appendChild(card);
    }
    updateSelectionCount();
  }

  async function loadThumb(projectId, index) {
    try {
      const bytes = await invoke("pptx_video_read_thumb", { projectId, slideIndex: index });
      const slide = manifest && manifest.slides[index];
      const type = slide && slide.thumbPath && slide.thumbPath.endsWith(".png")
        ? "image/png"
        : "image/svg+xml";
      const blob = new Blob([new Uint8Array(bytes)], { type });
      const url = URL.createObjectURL(blob);
      thumbUrls.set(`slide-${index + 1}`, url);
      return url;
    } catch {
      return null;
    }
  }

  function renderWarnings(project) {
    const box = $("pptx-warnings");
    const all = project.slides.flatMap((s) => s.warnings);
    if (all.length === 0) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = "";
    const heading = document.createElement("strong");
    heading.textContent = "A few things to know about this deck:";
    box.appendChild(heading);
    const list = document.createElement("ul");
    for (const warning of all) {
      const li = document.createElement("li");
      li.textContent = warning.message;
      list.appendChild(li);
    }
    box.appendChild(list);
  }

  function updateSelectionCount() {
    if (!manifest) return;
    const selected = selectedSlides(manifest).length;
    $("pptx-selection-count").textContent = `${selected} of ${manifest.slides.length} slides selected for the video.`;
  }

  async function saveManifest(statusText) {
    try {
      const errors = validateProjectManifest(manifest);
      if (errors.length > 0) throw new Error(errors.join(" "));
      await invoke("pptx_video_save_project", {
        projectId: manifest.id,
        manifestJson: JSON.stringify(manifest),
      });
      setStatus(statusText, "ok");
    } catch (e) {
      setStatus(`Could not save: ${describePptxFailure(e)}`, "error");
    }
  }

  async function onToggleSlide(slideId, checked) {
    if (!manifest) return;
    try {
      manifest = setSlideSelected(manifest, slideId, checked);
    } catch (e) {
      // Deselecting the last slide is refused — restore the checkbox.
      setStatus(describePptxFailure(e), "error");
      await openProjectView(manifest, null);
      return;
    }
    updateSelectionCount();
    await saveManifest(
      `Selection saved — ${selectedSlides(manifest).length} of ${manifest.slides.length} slides will be in your video.`,
    );
  }

  async function onSelectAll() {
    if (!manifest) return;
    manifest = selectAllSlides(manifest);
    await openProjectView(manifest, null);
    updateSelectionCount();
    await saveManifest(`Selection saved — all ${manifest.slides.length} slides will be in your video.`);
  }

  async function onClear() {
    if (!manifest) return;
    manifest = clearSlideSelection(manifest);
    await openProjectView(manifest, null);
    updateSelectionCount();
    await saveManifest("Selection saved — only the first slide is selected.");
  }

  async function onRename() {
    if (!manifest) return;
    const title = $("pptx-title").value;
    const error = validateProjectTitle(title);
    if (error) {
      setStatus(error, "error");
      return;
    }
    try {
      const summary = await invoke("pptx_video_rename_project", { projectId: manifest.id, title });
      manifest = renameProject(manifest, title);
      $("pptx-title").value = summary.title;
      setStatus(`Saved — the project is now called “${summary.title}”.`, "ok");
      await refreshList();
    } catch (e) {
      setStatus(`Could not rename: ${describePptxFailure(e)}`, "error");
    }
  }

  async function onDelete() {
    if (!manifest) return;
    const title = manifest.title;
    const plan = projectDeletePlan(manifest);
    const ok = window.confirm(
      `Delete “${title}”?\n\nThis removes ${plan.removes[0]}. ${plan.keeps[0][0].toUpperCase() + plan.keeps[0].slice(1)} stays where it is.`,
    );
    if (!ok) return;
    try {
      await invoke("pptx_video_delete_project", { projectId: manifest.id });
      showList();
      await refreshList();
      setStatus(`Deleted — “${title}” is gone. Your original PowerPoint file was not touched.`, "ok");
    } catch (e) {
      setStatus(`Could not delete: ${describePptxFailure(e)}`, "error");
    }
  }

  // -- Wiring ---------------------------------------------------------------

  $("pptx-browse").addEventListener("click", () => $("pptx-file").click());
  $("pptx-file").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) importFile(file);
    event.target.value = "";
  });
  const dropzone = $("pptx-dropzone");
  dropzone.addEventListener("click", (event) => {
    if (event.target === dropzone) $("pptx-file").click();
  });
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      $("pptx-file").click();
    }
  });
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) importFile(file);
  });
  $("pptx-cancel").addEventListener("click", () => {
    if (currentAbort) currentAbort.abort();
  });
  $("pptx-back").addEventListener("click", async () => {
    showList();
    await refreshList();
  });
  $("pptx-select-all").addEventListener("click", onSelectAll);
  $("pptx-clear").addEventListener("click", onClear);
  $("pptx-rename").addEventListener("click", onRename);
  $("pptx-delete").addEventListener("click", onDelete);

  refreshList();
  return { root, refreshList, openProject, importFile };
}

// Auto-mount when loaded as a module script in the app page.
if (typeof document !== "undefined" && document.getElementById("pptx-create-video-mount")) {
  mountPptxCreateVideo();
}
