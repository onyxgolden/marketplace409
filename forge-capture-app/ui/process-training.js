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
  $("pt-preview-discard-btn").addEventListener("click", () => {
    session.discard();
    renderStep();
  });

  const reviewBanner = $("pt-review-banner");
  const sumEvents = $("pt-sum-events");
  const sumWithheld = $("pt-sum-withheld");
  const sumRedacted = $("pt-sum-redacted");
  const sumProceed = $("pt-sum-proceed");
  const sumGaps = $("pt-sum-gaps");
  const lossList = $("pt-loss-list");
  const eventList = $("pt-event-list");

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
  }

  $("pt-review-discard-btn").addEventListener("click", () => {
    session.discard();
    renderStep();
  });
  $("pt-new-session-btn").addEventListener("click", () => {
    session.reset();
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
