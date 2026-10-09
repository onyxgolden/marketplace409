// FORGE Capture — Process Training PT-1C UI driver (ui/process-training.js).
//
// ES module (no bundler), same pattern as meeting.js/record.js: owns the
// Process Training tab's DOM, mounted into a container by index.html.
// All state-machine/fixture logic lives in process-training-core.js
// (unit-tested under vitest); this file only renders it and wires DOM
// events.
//
// NO LIVE CAPTURE. This file never calls the Tauri IPC bridge to start or
// stop a real capture session (the two backend commands that exist for
// that live in app/src/main.rs) — there is no IPC bridge import here at
// all. Every button here previews fixture/demo data; the disabled-
// capture banner is shown unconditionally, in every state, so nothing
// ever implies a press starts recording.

import {
  ConsentSession,
  ConsentError,
  CAPTURE_DISABLED_NOTICE,
  QUEUE_OVERFLOW_STAGES,
  buildFixtureEvidence,
  toEvidenceViewModel,
  summarizeEvidence,
} from "./process-training-core.js";
import { compileGuide, GuideCompileError } from "./process-guide-compiler.js";
import {
  GuideMarkupOverlay,
  MarkupError,
  MARKUP_CANVAS,
  MAX_TEXT_LENGTH,
  resolveMarkupDrawOps,
} from "./process-guide-markup.js";
// Reused exactly as-is (see process-guide-markup.js's own header comment
// for the full reuse audit): drawOpsToCanvas is already decoupled from
// where its `ops` came from, so it draws PT-3's markup ops unmodified.
import { drawOpsToCanvas } from "./annotations-render.js";

// Example targets only — PT-1C ships no live window enumeration (that
// would be new native wiring, out of scope for this slice). A real
// target picker is a future slice's concern.
const EXAMPLE_TARGETS = [
  { label: "Notepad", exeName: "notepad.exe" },
  { label: "Google Chrome", exeName: "chrome.exe" },
  { label: "Microsoft Excel", exeName: "excel.exe" },
];

const LOSS_STAGE_LABELS = {
  "hook-to-capture": "Hook → capture queue overflow",
  "capture-to-evidence": "Capture → evidence queue overflow",
  "hook-trylock-miss": "Hook callback lock contention",
  "capture-failure": "Capture attempt failed",
  "capture-capacity-exhausted": "PrintWindow helper capacity exhausted",
};

function openDialog(dialogEl) {
  // Real Tauri webviews (Chromium-based) support <dialog>.showModal();
  // some test/DOM environments do not implement it at all. Falling back
  // to a plain `open` attribute keeps the same visible state either way
  // rather than letting an unsupported call throw past this point.
  try {
    dialogEl.showModal();
  } catch {
    dialogEl.setAttribute("open", "");
  }
}

function closeDialog(dialogEl) {
  try {
    dialogEl.close();
  } catch {
    dialogEl.removeAttribute("open");
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

export function renderProcessTrainingControls(container, deps = {}) {
  const session = deps.session || new ConsentSession();
  const buildEvidence = deps.buildFixtureEvidence || buildFixtureEvidence;

  container.innerHTML = `
    <div class="palette process-training">
      <div class="status warning pt-disabled-banner" role="status">${escapeHtml(
        CAPTURE_DISABLED_NOTICE
      )}</div>

      <div id="pt-setup" class="pt-step">
        <h2>Process Training (preview)</h2>
        <p class="dialog-sub">
          Choose a target app or window to see what consent and session
          review would look like. Nothing here records real input.
        </p>
        <label class="field">Target app or window
          <select id="pt-target-select">
            <option value="">Choose a target…</option>
            ${EXAMPLE_TARGETS.map(
              (t, i) => `<option value="${i}">${escapeHtml(t.label)}</option>`
            ).join("")}
            <option value="custom">Other (type an executable name)…</option>
          </select>
        </label>
        <label class="field" id="pt-target-custom-row" hidden>Executable name
          <input id="pt-target-custom" type="text" placeholder="e.g. myapp.exe" autocomplete="off" />
        </label>
        <button id="pt-begin-btn" type="button" class="primary-btn" disabled>Continue</button>
      </div>

      <dialog id="pt-consent-dialog" aria-labelledby="pt-consent-title">
        <h2 id="pt-consent-title">Before you preview a session</h2>
        <p class="dialog-sub">
          This explains exactly what a real session would record for
          <strong id="pt-consent-target-name"></strong>. Choosing a scope
          here only configures this preview — no input is captured.
        </p>
        <fieldset class="pt-trust-fieldset">
          <legend>Trust scope</legend>
          <label class="pt-radio-row">
            <input type="radio" name="pt-trust-scope" value="default" checked />
            <span><strong>Default</strong> — screenshots are withheld automatically. Nothing from this app would be kept.</span>
          </label>
          <label class="pt-radio-row">
            <input type="radio" name="pt-trust-scope" value="author_trusted" />
            <span><strong>Author-trusted (this session only)</strong> — may proceed when no sensitive signal is detected. Detection still runs every time and can still redact or withhold.</span>
          </label>
        </fieldset>
        <label class="field block pt-disclosure-row" id="pt-disclosure-row" hidden>
          <input type="checkbox" id="pt-disclosure-ack" />
          I understand author-trusted scope applies only to this one app, only for this session, is never saved, and that sensitive content can still be withheld or redacted even so.
        </label>
        <div id="pt-consent-status" class="status" role="status"></div>
        <div class="dialog-actions">
          <button id="pt-consent-cancel" type="button" class="ghost-btn">Cancel</button>
          <button id="pt-consent-confirm" type="button" class="primary-btn">Start preview</button>
        </div>
      </dialog>

      <div id="pt-preview" class="pt-step" hidden>
        <div class="status warning">Preview only — fixture/demo data, not a live recording.</div>
        <p>Target: <strong id="pt-preview-target"></strong> · Scope: <span id="pt-preview-scope"></span></p>
        <button id="pt-load-review-btn" type="button" class="capture-btn">Load demo session evidence</button>
        <button id="pt-preview-discard-btn" type="button" class="ghost-btn">Discard</button>
      </div>

      <section id="pt-review" class="pt-step" hidden aria-label="Session evidence (demo)">
        <div id="pt-review-banner" class="status" role="status"></div>
        <dl class="pt-summary">
          <div><dt>Events</dt><dd id="pt-sum-events"></dd></div>
          <div><dt>Withheld</dt><dd id="pt-sum-withheld"></dd></div>
          <div><dt>Redacted</dt><dd id="pt-sum-redacted"></dd></div>
          <div><dt>Proceeded</dt><dd id="pt-sum-proceed"></dd></div>
          <div><dt>Sequence gaps</dt><dd id="pt-sum-gaps"></dd></div>
        </dl>
        <h3>Loss / overflow</h3>
        <ul id="pt-loss-list" class="pt-loss-list"></ul>
        <h3>Events</h3>
        <ul id="pt-event-list" class="captures pt-event-list"></ul>

        <h3>Compiled guide preview</h3>
        <div id="pt-guide-badge" class="status warning pt-guide-badge" role="status">DEMO · DRAFT · NOT VERIFIED</div>
        <div id="pt-guide-error" class="status error" role="status" hidden></div>
        <ol id="pt-guide-steps" class="pt-guide-steps"></ol>
        <ul id="pt-guide-warnings" class="pt-guide-warnings"></ul>

        <section id="pt-markup-panel" class="pt-markup-panel" hidden aria-label="Markup this step">
          <h3>Markup — <span id="pt-markup-step-label"></span></h3>
          <p class="dialog-sub">Demo annotations only — an author-added overlay, never evidence. Never a real screenshot.</p>
          <canvas id="pt-markup-canvas" width="640" height="480" aria-label="Markup preview (placeholder, no image)"></canvas>
          <div class="status">No image in fixture guide — placeholder only.</div>

          <div class="row pt-markup-toolbar">
            <button id="pt-markup-add-rect" type="button" class="ghost-btn small">Add rectangle</button>
            <button id="pt-markup-add-arrow" type="button" class="ghost-btn small">Add arrow</button>
            <button id="pt-markup-add-text" type="button" class="ghost-btn small">Add text label</button>
            <button id="pt-markup-undo" type="button" class="ghost-btn small" disabled>Undo</button>
            <button id="pt-markup-redo" type="button" class="ghost-btn small" disabled>Redo</button>
          </div>

          <form id="pt-markup-shape-form" hidden>
            <div id="pt-markup-shape-fields" class="pt-markup-shape-fields"></div>
            <div id="pt-markup-shape-status" class="status" role="status"></div>
            <div class="dialog-actions">
              <button id="pt-markup-shape-cancel" type="button" class="ghost-btn">Cancel</button>
              <button id="pt-markup-shape-save" type="submit" class="primary-btn">Save</button>
            </div>
          </form>

          <h4>Shapes on this step</h4>
          <ul id="pt-markup-shape-list" class="pt-markup-shape-list"></ul>

          <div class="dialog-actions">
            <button id="pt-markup-close" type="button" class="ghost-btn">Close — back to guide</button>
          </div>
        </section>

        <div class="dialog-actions">
          <button id="pt-review-discard-btn" type="button" class="ghost-btn">Discard this demo session</button>
        </div>
      </section>

      <div id="pt-discarded" class="pt-step" hidden>
        <div class="status ok">Demo session discarded. No fixture data remains.</div>
        <button id="pt-new-session-btn" type="button" class="primary-btn">Start another preview</button>
      </div>
    </div>
  `;

  const $ = (id) => container.querySelector(`#${id}`);

  const targetSelect = $("pt-target-select");
  const customRow = $("pt-target-custom-row");
  const customInput = $("pt-target-custom");
  const beginBtn = $("pt-begin-btn");
  const consentDialog = $("pt-consent-dialog");
  const consentTargetName = $("pt-consent-target-name");
  const disclosureRow = $("pt-disclosure-row");
  const disclosureAck = $("pt-disclosure-ack");
  const consentStatus = $("pt-consent-status");
  const consentCancel = $("pt-consent-cancel");
  const consentConfirm = $("pt-consent-confirm");

  function setConsentStatus(text, kind) {
    consentStatus.textContent = text || "";
    consentStatus.className = "status" + (kind ? " " + kind : "");
  }

  function pendingTarget() {
    const val = targetSelect.value;
    if (val === "") return null;
    if (val === "custom") {
      const exe = customInput.value.trim();
      return exe ? { label: exe, exeName: exe } : null;
    }
    const idx = Number(val);
    return EXAMPLE_TARGETS[idx] || null;
  }

  function refreshBeginEnabled() {
    beginBtn.disabled = !pendingTarget();
  }

  targetSelect.addEventListener("change", () => {
    customRow.hidden = targetSelect.value !== "custom";
    refreshBeginEnabled();
  });
  customInput.addEventListener("input", refreshBeginEnabled);

  function selectedTrustScope() {
    const checked = container.querySelector('input[name="pt-trust-scope"]:checked');
    return checked ? checked.value : "default";
  }

  container.querySelectorAll('input[name="pt-trust-scope"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      disclosureRow.hidden = selectedTrustScope() !== "author_trusted";
      if (disclosureRow.hidden) disclosureAck.checked = false;
      setConsentStatus("");
    });
  });

  beginBtn.addEventListener("click", () => {
    const target = pendingTarget();
    if (!target) return;
    session.beginPreflight(target);
    consentTargetName.textContent = target.label;
    // Every time the consent dialog opens, it opens on Default with the
    // disclosure unacknowledged — a prior choice (for a different
    // target, or an earlier cancel) is never carried forward silently.
    const defaultRadio = container.querySelector('input[name="pt-trust-scope"][value="default"]');
    if (defaultRadio) defaultRadio.checked = true;
    disclosureRow.hidden = true;
    disclosureAck.checked = false;
    setConsentStatus("");
    openDialog(consentDialog);
  });

  consentCancel.addEventListener("click", () => {
    // Cancelling leaves the session in `preflight` with no consent
    // granted — picking a target is not itself consent.
    closeDialog(consentDialog);
  });

  consentConfirm.addEventListener("click", () => {
    const trustScope = selectedTrustScope();
    try {
      session.grantConsent({ trustScope, disclosureAcknowledged: disclosureAck.checked === true });
    } catch (e) {
      setConsentStatus(e instanceof ConsentError ? e.message : String(e), "error");
      return;
    }
    closeDialog(consentDialog);
    renderStep();
  });

  const previewTarget = $("pt-preview-target");
  const previewScope = $("pt-preview-scope");
  $("pt-load-review-btn").addEventListener("click", () => {
    const evidence = buildEvidence({ trustScope: session.trustScope, target: session.target });
    session.startReview(evidence);
    renderReview();
    renderStep();
  });
  // pt-preview-discard-btn's listener is registered further down,
  // alongside pt-review-discard-btn/pt-new-session-btn, once
  // clearGuidePreview (and the guide DOM refs it uses) exist.

  const reviewBanner = $("pt-review-banner");
  const sumEvents = $("pt-sum-events");
  const sumWithheld = $("pt-sum-withheld");
  const sumRedacted = $("pt-sum-redacted");
  const sumProceed = $("pt-sum-proceed");
  const sumGaps = $("pt-sum-gaps");
  const lossList = $("pt-loss-list");
  const eventList = $("pt-event-list");
  const guideError = $("pt-guide-error");
  const guideSteps = $("pt-guide-steps");
  const guideWarnings = $("pt-guide-warnings");

  // PT-3: one markup overlay per ConsentSession lifetime -- cleared (not
  // just hidden) alongside the guide preview on every discard/reset/
  // target-change, same as clearGuidePreview() below. Never persisted.
  const markupOverlay = new GuideMarkupOverlay();
  let lastCompiledGuide = null;
  let activeMarkupSequenceId = null;
  let activeShapeFormMode = null; // { kind, editingShapeId } | null

  function renderGuidePreview() {
    guideError.hidden = true;
    guideError.textContent = "";
    guideSteps.innerHTML = "";
    guideWarnings.innerHTML = "";

    // Compiled fresh from session.evidence every time review is (re-)
    // rendered -- never cached across a discard/reset/new-session, and
    // never attempted outside the review state (renderStep hides this
    // whole section otherwise).
    let guide;
    try {
      guide = compileGuide(session.evidence, {
        target: session.target,
        trustScope: session.trustScope,
      });
    } catch (e) {
      guideError.hidden = false;
      guideError.textContent =
        e instanceof GuideCompileError
          ? `Guide could not be compiled: ${e.message}`
          : `Guide could not be compiled: ${e.message || e}`;
      // Review finding (round 1): a failed compile must clear the
      // markup OVERLAY DATA too, not just hide the panel --
      // closeMarkupPanel() alone deliberately preserves annotations
      // (that's what makes ordinary close/reopen retain them), so it
      // cannot by itself satisfy "compile failure clears annotations."
      // Stale shapes must never survive editing a guide that no longer
      // compiles.
      lastCompiledGuide = null;
      markupOverlay.clearAll();
      closeMarkupPanel();
      return;
    }
    lastCompiledGuide = guide;

    for (const step of guide.steps) {
      const li = document.createElement("li");
      li.innerHTML = `
        <div class="meta">
          <strong>${escapeHtml(step.action)}</strong>
          <span>${escapeHtml(step.processName)} — ${escapeHtml(step.targetLabel)}</span>
        </div>
      `;
      const markupBtn = document.createElement("button");
      markupBtn.type = "button";
      markupBtn.className = "ghost-btn small";
      markupBtn.textContent = "Markup this step";
      markupBtn.addEventListener("click", () => openMarkupFor(step.sequenceId));
      li.appendChild(markupBtn);
      guideSteps.appendChild(li);
      // A warning whose position is actually known from the evidence
      // (never guessed) renders right after the step it follows.
      for (const w of guide.warnings) {
        if (w.type === "gap" && w.stepIndexHint === step.stepIndex) {
          guideWarnings.appendChild(guideWarningItem(w, true));
        }
      }
    }

    for (const w of guide.warnings) {
      if (w.type === "gap" && w.stepIndexHint !== null) continue; // already placed above
      guideWarnings.appendChild(guideWarningItem(w, false));
    }
  }

  function guideWarningItem(w, stepAdjacent) {
    const li = document.createElement("li");
    li.className = "pt-guide-warning" + (stepAdjacent ? " pt-guide-warning-adjacent" : "");
    if (w.type === "gap") {
      li.textContent = `Sequence gap (ids ${w.firstMissing}–${w.lastMissing}) — evidence missing, not invented.`;
    } else if (w.type === "loss") {
      li.textContent = `${LOSS_STAGE_LABELS[w.stage] || w.stage}: ${w.droppedCount} dropped.`;
    } else if (w.type === "uncertain") {
      li.textContent = `Shutdown reconciliation uncertain (last processed sequence: ${
        w.lastProcessedSeq ?? "none"
      }).`;
    } else {
      li.textContent = `Unrecognized warning: ${JSON.stringify(w)}`;
    }
    return li;
  }

  // ---------------------------------------------------------------------
  // PT-3: markup panel (add/select/edit/delete/undo/redo annotations for
  // one selected guide step). Form-based, not drag-based, by design --
  // labeled numeric/text inputs are inherently keyboard-operable, which
  // is the "simple non-pointer editing path" the brief requires, without
  // needing a second separate interaction mode alongside it.
  // ---------------------------------------------------------------------

  const markupPanel = $("pt-markup-panel");
  const markupStepLabel = $("pt-markup-step-label");
  const markupCanvas = $("pt-markup-canvas");
  const markupUndoBtn = $("pt-markup-undo");
  const markupRedoBtn = $("pt-markup-redo");
  const markupShapeList = $("pt-markup-shape-list");
  const shapeForm = $("pt-markup-shape-form");
  const shapeFields = $("pt-markup-shape-fields");
  const shapeStatus = $("pt-markup-shape-status");

  function openMarkupFor(sequenceId) {
    activeMarkupSequenceId = sequenceId;
    markupPanel.hidden = false;
    closeShapeForm();
    renderMarkupPanel();
    // A pure UX nicety -- not implemented in every environment (e.g. the
    // jsdom test environment used here), so it is never allowed to break
    // the actual panel-opening behavior above it.
    try {
      markupPanel.scrollIntoView({ block: "nearest" });
    } catch {
      /* no-op */
    }
  }

  function closeMarkupPanel() {
    activeMarkupSequenceId = null;
    markupPanel.hidden = true;
    closeShapeForm();
    // Clears the rendered list too, not just hides the panel -- it is
    // always correctly rebuilt from the overlay (the real data) the next
    // time a step's markup is opened, so this never loses anything; it
    // only prevents a prior step's shapes from sitting stale in the DOM.
    markupShapeList.innerHTML = "";
  }

  function shapeSummary(shape) {
    if (shape.kind === "rect") return `Rectangle (${shape.x}, ${shape.y}, ${shape.w}×${shape.h})`;
    if (shape.kind === "arrow") return `Arrow (${shape.x1},${shape.y1}) → (${shape.x2},${shape.y2})`;
    return `Text: "${shape.text}"`;
  }

  function renderMarkupPanel() {
    if (activeMarkupSequenceId === null) return;
    const step = lastCompiledGuide?.steps.find((s) => s.sequenceId === activeMarkupSequenceId);
    markupStepLabel.textContent = step
      ? `#${step.sequenceId} ${step.action}`
      : `#${activeMarkupSequenceId}`;

    const shapes = markupOverlay.shapesFor(activeMarkupSequenceId);

    // Neutral placeholder only -- never a real/fabricated screenshot,
    // regardless of this step's hasScreenshot value. Markup shapes are
    // then drawn on top via the reused drawOpsToCanvas (see this file's
    // own import comment and process-guide-markup.js's header for the
    // reuse audit).
    const ctx = markupCanvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, MARKUP_CANVAS.width, MARKUP_CANVAS.height);
      ctx.fillStyle = "#23262c";
      ctx.fillRect(0, 0, MARKUP_CANVAS.width, MARKUP_CANVAS.height);
      drawOpsToCanvas(ctx, resolveMarkupDrawOps(shapes));
    }

    markupUndoBtn.disabled = !markupOverlay.canUndo(activeMarkupSequenceId);
    markupRedoBtn.disabled = !markupOverlay.canRedo(activeMarkupSequenceId);

    markupShapeList.innerHTML = "";
    if (shapes.length === 0) {
      const li = document.createElement("li");
      li.className = "pt-markup-empty";
      li.textContent = "No markup on this step yet.";
      markupShapeList.appendChild(li);
    }
    for (const shape of shapes) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = shapeSummary(shape); // textContent only -- never HTML, per the brief
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "ghost-btn small";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openShapeForm(shape.kind, shape));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "ghost-btn small";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => {
        markupOverlay.deleteShape(activeMarkupSequenceId, shape.id);
        renderMarkupPanel();
      });
      li.appendChild(label);
      li.appendChild(editBtn);
      li.appendChild(delBtn);
      markupShapeList.appendChild(li);
    }
  }

  function numberField(id, labelText, value) {
    const wrap = document.createElement("label");
    wrap.className = "field inline";
    const span = document.createElement("span");
    span.textContent = labelText;
    const input = document.createElement("input");
    input.type = "number";
    input.id = id;
    input.value = String(value ?? 0);
    wrap.appendChild(span);
    wrap.appendChild(input);
    shapeFields.appendChild(wrap);
    return input;
  }

  function openShapeForm(kind, existing) {
    shapeForm.hidden = false;
    activeShapeFormMode = { kind, editingShapeId: existing ? existing.id : null };
    shapeFields.innerHTML = "";
    shapeStatus.textContent = "";
    shapeStatus.className = "status";

    if (kind === "rect") {
      numberField("pt-markup-field-x", "X", existing?.x ?? 10);
      numberField("pt-markup-field-y", "Y", existing?.y ?? 10);
      numberField("pt-markup-field-w", "Width", existing?.w ?? 50);
      numberField("pt-markup-field-h", "Height", existing?.h ?? 50);
    } else if (kind === "arrow") {
      numberField("pt-markup-field-x1", "From X", existing?.x1 ?? 10);
      numberField("pt-markup-field-y1", "From Y", existing?.y1 ?? 10);
      numberField("pt-markup-field-x2", "To X", existing?.x2 ?? 100);
      numberField("pt-markup-field-y2", "To Y", existing?.y2 ?? 100);
    } else {
      numberField("pt-markup-field-x", "X", existing?.x ?? 10);
      numberField("pt-markup-field-y", "Y", existing?.y ?? 10);
      const wrap = document.createElement("label");
      wrap.className = "field block";
      const span = document.createElement("span");
      span.textContent = "Text";
      const input = document.createElement("input");
      input.type = "text";
      input.id = "pt-markup-field-text";
      input.maxLength = MAX_TEXT_LENGTH;
      input.value = existing?.text ?? "";
      wrap.appendChild(span);
      wrap.appendChild(input);
      shapeFields.appendChild(wrap);
    }
    const firstInput = shapeFields.querySelector("input");
    if (firstInput) firstInput.focus();
  }

  function closeShapeForm() {
    shapeForm.hidden = true;
    activeShapeFormMode = null;
    shapeFields.innerHTML = "";
    shapeStatus.textContent = "";
  }

  function readShapeFormData(kind) {
    const num = (id) => Number(container.querySelector(`#${id}`).value);
    if (kind === "rect") {
      return {
        x: num("pt-markup-field-x"),
        y: num("pt-markup-field-y"),
        w: num("pt-markup-field-w"),
        h: num("pt-markup-field-h"),
      };
    }
    if (kind === "arrow") {
      return {
        x1: num("pt-markup-field-x1"),
        y1: num("pt-markup-field-y1"),
        x2: num("pt-markup-field-x2"),
        y2: num("pt-markup-field-y2"),
      };
    }
    return {
      x: num("pt-markup-field-x"),
      y: num("pt-markup-field-y"),
      text: container.querySelector("#pt-markup-field-text").value,
    };
  }

  shapeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activeShapeFormMode || activeMarkupSequenceId === null) return;
    const data = readShapeFormData(activeShapeFormMode.kind);
    try {
      if (activeShapeFormMode.editingShapeId) {
        markupOverlay.updateShape(activeMarkupSequenceId, activeShapeFormMode.editingShapeId, data);
      } else {
        markupOverlay.addShape(activeMarkupSequenceId, activeShapeFormMode.kind, data);
      }
    } catch (err) {
      shapeStatus.textContent = err instanceof MarkupError ? err.message : String(err.message || err);
      shapeStatus.className = "status error";
      return;
    }
    closeShapeForm();
    renderMarkupPanel();
  });

  $("pt-markup-add-rect").addEventListener("click", () => openShapeForm("rect", null));
  $("pt-markup-add-arrow").addEventListener("click", () => openShapeForm("arrow", null));
  $("pt-markup-add-text").addEventListener("click", () => openShapeForm("text", null));
  $("pt-markup-shape-cancel").addEventListener("click", () => closeShapeForm());
  $("pt-markup-undo").addEventListener("click", () => {
    if (activeMarkupSequenceId !== null) markupOverlay.undo(activeMarkupSequenceId);
    renderMarkupPanel();
  });
  $("pt-markup-redo").addEventListener("click", () => {
    if (activeMarkupSequenceId !== null) markupOverlay.redo(activeMarkupSequenceId);
    renderMarkupPanel();
  });
  $("pt-markup-close").addEventListener("click", () => closeMarkupPanel());

  // Escape closes markup mode without discarding the session -- never a
  // keyboard shortcut that steals focus from an input while typing (only
  // acts when the markup panel is actually open).
  container.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !markupPanel.hidden) {
      closeMarkupPanel();
    }
  });

  function renderReview() {
    const viewModels = session.evidence.map(toEvidenceViewModel);
    const summary = summarizeEvidence(viewModels);

    reviewBanner.className = "status" + (summary.isComplete ? "" : " warning");
    reviewBanner.textContent = summary.isComplete
      ? "Demo evidence shown below. (This preview always includes at least one gap or uncertainty — real sessions report exactly the same way.)"
      : "Not verified: this demo session has a sequence gap and/or unresolved shutdown reconciliation. Treat it as incomplete, not as a finished recording.";

    sumEvents.textContent = String(summary.totalEvents);
    sumWithheld.textContent = String(summary.withheldCount);
    sumRedacted.textContent = String(summary.redactedCount);
    sumProceed.textContent = String(summary.proceedCount);
    sumGaps.textContent = String(summary.gapCount);

    lossList.innerHTML = "";
    for (const stage of QUEUE_OVERFLOW_STAGES) {
      const li = document.createElement("li");
      const count = summary.lossByStage[stage] || 0;
      li.textContent = `${LOSS_STAGE_LABELS[stage] || stage}: ${count}`;
      if (count > 0) li.className = "pt-loss-nonzero";
      lossList.appendChild(li);
    }
    if (summary.reconciliationUncertain) {
      const li = document.createElement("li");
      li.className = "pt-loss-nonzero";
      li.textContent = `Shutdown reconciliation uncertain (last processed sequence: ${
        summary.lastProcessedSeq ?? "none"
      })`;
      lossList.appendChild(li);
    }

    eventList.innerHTML = "";
    for (const vm of viewModels) {
      if (vm.kind !== "event") continue;
      const li = document.createElement("li");
      const why = vm.withheld
        ? "withheld — no screenshot kept"
        : vm.redacted
          ? "redacted — sensitive region blanked"
          : "proceeded — author-trusted, no sensitive signal";
      li.innerHTML = `
        <div class="meta">
          <strong>#${vm.sequenceId} ${escapeHtml(vm.eventKind)}</strong>
          <span>${escapeHtml(vm.processName)} — ${escapeHtml(vm.targetLabel)}</span>
          <span>${escapeHtml(vm.trust)} / ${escapeHtml(vm.decision)} (${escapeHtml(why)})</span>
        </div>
      `;
      eventList.appendChild(li);
    }

    renderGuidePreview();
  }

  // Per the PT-2 brief: discard/reset clears the compiled guide with the
  // session -- not just visually, via the parent section's `hidden`
  // (relying on that alone would leave a prior session's compiled guide
  // sitting in the DOM, merely out of view, rather than actually gone).
  function clearGuidePreview() {
    guideError.hidden = true;
    guideError.textContent = "";
    guideSteps.innerHTML = "";
    guideWarnings.innerHTML = "";
    lastCompiledGuide = null;
    // PT-3: discard/reset/target-change clears every step's markup, not
    // just hides it -- same discipline as the guide preview itself.
    markupOverlay.clearAll();
    closeMarkupPanel();
  }

  $("pt-preview-discard-btn").addEventListener("click", () => {
    session.discard();
    clearGuidePreview();
    renderStep();
  });
  $("pt-review-discard-btn").addEventListener("click", () => {
    session.discard();
    clearGuidePreview();
    renderStep();
  });
  $("pt-new-session-btn").addEventListener("click", () => {
    session.reset();
    clearGuidePreview();
    targetSelect.value = "";
    customRow.hidden = true;
    customInput.value = "";
    refreshBeginEnabled();
    renderStep();
  });

  function renderStep() {
    const state = session.state;
    $("pt-setup").hidden = !(state === "idle" || state === "preflight");
    $("pt-preview").hidden = state !== "consented_preview";
    $("pt-review").hidden = state !== "review";
    $("pt-discarded").hidden = state !== "discarded";

    if (state === "consented_preview" || state === "review") {
      previewTarget.textContent = session.target?.label || "";
      previewScope.textContent =
        session.trustScope === "author_trusted" ? "Author-trusted (this session only)" : "Default (withheld)";
    }
  }

  renderStep();

  return {
    /** For tests / embedding hosts. */
    get session() {
      return session;
    },
    /**
     * For tests only: direct access to the markup overlay and the
     * compile/render function itself, so the compile-failure lifecycle
     * path (markupOverlay.clearAll() on a failed recompile) can be
     * pinned directly -- the current UI has no second, user-reachable
     * compile action to exercise it through a click sequence alone.
     */
    get markupOverlay() {
      return markupOverlay;
    },
    renderGuidePreview,
  };
}

// Auto-mount when loaded as a page script next to index.html.
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const mount = document.getElementById("process-training-mount");
    if (mount && !mount.dataset.mounted) {
      mount.dataset.mounted = "1";
      try {
        renderProcessTrainingControls(mount, {});
      } catch (e) {
        mount.textContent = `Process Training preview could not start: ${e.message || e}`;
      }
    }
  });
}
