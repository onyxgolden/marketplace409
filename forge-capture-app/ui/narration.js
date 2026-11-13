// FORGE Capture — Narration mode UI driver (ui/narration.js).
//
// ES module (no bundler): loaded via <script type="module"> in index.html.
// Owns the Narration tab DOM: presenter + consent registry, script table,
// narration job create/poll/result, human acceptance, and the jobs list.
//
// All pure logic lives in narration-core.js (script validation, WebVTT,
// status labels — unit-tested under vitest); the Rust backend owns the
// consent registry, enrollment store, and job spool; the local runner
// owns TTS + FFmpeg assembly. Capture itself never touches the network
// and never uploads.
//
// Narration only: no face/avatar UI anywhere in this tab. A consent
// receipt is required before any job is created — the backend enforces
// the preflight; this tab surfaces its errors honestly.
//
// Save to FORGE: the existing opt-in upload (ui/forge-upload.js) has no
// file-path entry point — it uploads in-memory PNG/JPEG/WebM bytes
// (<=25 MB) and rejects MP4 — and there is no Tauri command to read the
// finished render's bytes back. So the finished output is shown with its
// local path and a plain note instead of a pretend upload button. Do not
// invent an upload path here.

import {
  NARRATION_POLL_MS,
  validateScriptSegments,
  formatSec,
  consentStatusLabel,
  enrollmentStatusLabel,
  acceptanceVerdictLabel,
} from "./narration-core.js";

function defaultInvoke(cmd, args) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

function errText(err) {
  return (err && err.message) || String(err);
}

/** File name portion of a path (either separator). */
export function fileNameOf(path) {
  const p = String(path || "");
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

/**
 * Turn a local file path into a <video> src the Tauri webview can load.
 * Tauri v2 exposes convertFileSrc on __TAURI_INTERNALS__ (no
 * @tauri-apps/api dependency in this app). Returns null when the bridge
 * cannot do it — the caller then shows the path as text instead.
 */
function previewSrcForPath(path) {
  try {
    const internals = window.__TAURI_INTERNALS__;
    if (internals && typeof internals.convertFileSrc === "function") {
      return internals.convertFileSrc(path);
    }
  } catch {
    /* fall through to the text-only fallback */
  }
  return null;
}

export function renderNarrationControls(container, deps = {}) {
  const invoke = deps.invoke || defaultInvoke;

  container.innerHTML = `
    <div class="palette narration">
      <p id="narration-root" class="hint"></p>

      <section aria-label="Presenter">
        <h2>Presenter</h2>
        <div class="row">
          <label class="field">Presenter
            <select id="narration-presenter"><option value="">Loading presenters…</option></select>
          </label>
          <button id="narration-refresh-presenters" class="ghost-btn small" type="button">Refresh</button>
        </div>
        <div id="narration-presenter-status" class="status" role="status"></div>
        <div id="narration-consent-detail" class="status" role="status"></div>
        <div class="row">
          <button id="narration-revoke" class="ghost-btn small" type="button">Revoke consent</button>
        </div>
        <div id="narration-revoke-status" class="status" role="status"></div>

        <h3>Register consent</h3>
        <p class="hint">Consent is a self-recorded statement from the presenter — a
        filename or checkbox is not consent. The artifact path must point at
        the recording itself; the backend hashes it and files the receipt.</p>
        <div class="row">
          <label class="field">Presenter id
            <input id="narration-consent-id" type="text" placeholder="e.g. tyler-welch" autocomplete="off" />
          </label>
          <label class="field">Display name
            <input id="narration-consent-name" type="text" placeholder="e.g. Tyler Welch" autocomplete="off" />
          </label>
        </div>
        <div class="row">
          <label class="field">Consent artifact path
            <input id="narration-consent-artifact" type="text" placeholder="Full path to the self-recorded consent video" autocomplete="off" />
          </label>
        </div>
        <div class="row">
          <label class="field">Recorded at
            <input id="narration-consent-recorded-at" type="datetime-local" />
          </label>
          <label class="field">Reviewed by
            <input id="narration-consent-reviewed-by" type="text" placeholder="Who checked the artifact" autocomplete="off" />
          </label>
        </div>
        <div class="row">
          <button id="narration-register-consent" class="ghost-btn" type="button">Register consent</button>
        </div>
        <div id="narration-consent-status" class="status" role="status"></div>
      </section>

      <section aria-label="Script">
        <h2>Script</h2>
        <div class="row">
          <label class="field">Capture path
            <input id="narration-capture-path" type="text" placeholder="Full path to the recorded capture (video)" autocomplete="off" />
          </label>
          <label class="field">Capture duration (seconds)
            <input id="narration-capture-duration" type="number" min="0" step="0.1" value="0" />
          </label>
        </div>
        <table id="narration-segments-table">
          <thead>
            <tr><th>Step id</th><th>Text</th><th>Start (s)</th><th>End (s)</th><th></th></tr>
          </thead>
          <tbody id="narration-segments-body"></tbody>
        </table>
        <div class="row">
          <button id="narration-add-step" class="ghost-btn small" type="button">Add step</button>
        </div>
        <div id="narration-script-status" class="status" role="status"></div>
      </section>

      <section aria-label="Narration job">
        <h2>Job</h2>
        <div class="row">
          <button id="narration-create-job" class="capture-btn" type="button">Create narration job</button>
        </div>
        <div id="narration-job-status" class="status" role="status"></div>
        <div id="narration-job-result"></div>
      </section>

      <section aria-label="Acceptance">
        <h2>Acceptance</h2>
        <p class="hint">The presenter and an independent reviewer both sign off on the
        exact finished output. No evidence, no PASS — the verdict comes from
        the receipt the backend returns, not from this form.</p>
        <div class="row">
          <label class="field">Presenter decision
            <select id="narration-presenter-decision">
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label class="field">Presenter name
            <input id="narration-presenter-by" type="text" placeholder="Presenter who reviewed the output" autocomplete="off" />
          </label>
        </div>
        <div class="row">
          <label class="field">Reviewer decision
            <select id="narration-reviewer-decision">
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label class="field">Reviewer name
            <input id="narration-reviewer-by" type="text" placeholder="Reviewer who checked the output" autocomplete="off" />
          </label>
        </div>
        <div class="row">
          <label class="field">Notes
            <input id="narration-acceptance-notes" type="text" placeholder="What was checked, any mismatch" autocomplete="off" />
          </label>
        </div>
        <div class="row">
          <button id="narration-record-acceptance" class="ghost-btn" type="button" disabled>Record acceptance</button>
        </div>
        <div id="narration-acceptance-status" class="status" role="status"></div>
      </section>

      <section aria-label="Jobs">
        <h2>Jobs</h2>
        <div class="row">
          <button id="narration-refresh-jobs" class="ghost-btn small" type="button">Refresh jobs</button>
        </div>
        <div id="narration-jobs-status" class="status" role="status"></div>
        <ul id="narration-jobs" class="captures"></ul>
      </section>
    </div>`;

  const $ = (id) => container.querySelector("#" + id);
  const rootEl = $("narration-root");
  const presenterSel = $("narration-presenter");
  const presenterStatusEl = $("narration-presenter-status");
  const consentDetailEl = $("narration-consent-detail");
  const revokeBtn = $("narration-revoke");
  const revokeStatusEl = $("narration-revoke-status");
  const consentStatusEl = $("narration-consent-status");
  const capturePathInput = $("narration-capture-path");
  const captureDurationInput = $("narration-capture-duration");
  const segmentsBody = $("narration-segments-body");
  const scriptStatusEl = $("narration-script-status");
  const createJobBtn = $("narration-create-job");
  const jobStatusEl = $("narration-job-status");
  const jobResultEl = $("narration-job-result");
  const acceptanceBtn = $("narration-record-acceptance");
  const acceptanceStatusEl = $("narration-acceptance-status");
  const jobsListEl = $("narration-jobs");
  const jobsStatusEl = $("narration-jobs-status");

  // --- state ---------------------------------------------------------------
  let segments = [
    { stepId: "step-1", text: "", captureStartSec: 0, captureEndSec: 5 },
  ];
  let currentJobId = null;
  let currentResult = null;
  let pollTimer = null;

  function setStatus(el, text, kind) {
    el.textContent = text || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function captureDurationSec() {
    const v = Number(captureDurationInput.value);
    return Number.isFinite(v) ? v : 0;
  }

  // --- presenter -----------------------------------------------------------

  async function loadPresenters() {
    try {
      const list = await invoke("narration_list_presenters");
      const prev = presenterSel.value;
      presenterSel.innerHTML = "";
      const rows = Array.isArray(list) ? list : [];
      if (rows.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No presenters yet — register consent below.";
        presenterSel.appendChild(opt);
        setStatus(presenterStatusEl, "", "");
        setStatus(consentDetailEl, "", "");
        return;
      }
      for (const p of rows) {
        const opt = document.createElement("option");
        opt.value = p.presenter_id;
        opt.textContent = `${p.display_name} (${p.presenter_id})`;
        presenterSel.appendChild(opt);
      }
      if ([...presenterSel.options].some((o) => o.value === prev)) {
        presenterSel.value = prev;
      }
      setStatus(presenterStatusEl, "", "");
      await loadPresenterDetail();
    } catch (err) {
      setStatus(presenterStatusEl, `Could not list presenters: ${errText(err)}`, "error");
    }
  }

  async function loadPresenterDetail() {
    const presenterId = presenterSel.value;
    if (!presenterId) {
      setStatus(consentDetailEl, "", "");
      return;
    }
    try {
      const detail = await invoke("narration_get_presenter", { presenterId });
      const receipt = detail && detail.receipt;
      const enrollment = detail && detail.enrollment;
      const consent = consentStatusLabel(receipt);
      const enrolled = enrollmentStatusLabel(enrollment);
      setStatus(
        consentDetailEl,
        `Consent: ${consent} · Voice enrollment: ${enrolled}` +
          (receipt && receipt.consent_artifact_path ? ` · Consent artifact: ${receipt.consent_artifact_path}` : ""),
        consent === "Active" && enrolled === "Active" ? "ok" : "",
      );
    } catch (err) {
      setStatus(consentDetailEl, `Could not load presenter: ${errText(err)}`, "error");
    }
  }

  presenterSel.addEventListener("change", () => void loadPresenterDetail());
  $("narration-refresh-presenters").addEventListener("click", () => void loadPresenters());

  $("narration-register-consent").addEventListener("click", async () => {
    const presenterId = $("narration-consent-id").value.trim();
    const displayName = $("narration-consent-name").value.trim();
    const artifactPath = $("narration-consent-artifact").value.trim();
    const recordedAtRaw = $("narration-consent-recorded-at").value;
    const reviewedBy = $("narration-consent-reviewed-by").value.trim();
    if (!presenterId || !displayName || !artifactPath || !recordedAtRaw || !reviewedBy) {
      setStatus(consentStatusEl, "Fill in every consent field — presenter id, display name, artifact path, recorded-at, and reviewed-by.", "error");
      return;
    }
    const recordedAt = new Date(recordedAtRaw);
    if (Number.isNaN(recordedAt.getTime())) {
      setStatus(consentStatusEl, "Recorded-at is not a valid date and time.", "error");
      return;
    }
    try {
      const receipt = await invoke("narration_register_consent", {
        presenterId,
        displayName,
        artifactPath,
        recordedAt: recordedAt.toISOString(),
        reviewedBy,
      });
      setStatus(
        consentStatusEl,
        `Consent registered — status: ${receipt.status}, artifact SHA-256: ${receipt.artifact_sha256}.`,
        "ok",
      );
      await loadPresenters();
      presenterSel.value = presenterId;
      await loadPresenterDetail();
    } catch (err) {
      setStatus(consentStatusEl, `Could not register consent: ${errText(err)}`, "error");
    }
  });

  revokeBtn.addEventListener("click", async () => {
    const presenterId = presenterSel.value;
    if (!presenterId) {
      setStatus(revokeStatusEl, "Pick a presenter first.", "error");
      return;
    }
    if (
      !window.confirm(
        `Revoke consent for ${presenterId}? This deletes their derived voice assets, ` +
          `blocks their queued jobs, and unpublishes their managed outputs. ` +
          `Files already exported outside managed storage cannot be recalled.`,
      )
    ) {
      return;
    }
    const reason = window.prompt("Reason for revoking consent:");
    if (reason === null || !reason.trim()) {
      setStatus(revokeStatusEl, "Revocation cancelled — a reason is required.", "");
      return;
    }
    try {
      const receipt = await invoke("narration_revoke_consent", {
        presenterId,
        reason: reason.trim(),
      });
      const deleted = Array.isArray(receipt.deleted_assets) ? receipt.deleted_assets.length : 0;
      const blocked = Array.isArray(receipt.blocked_jobs) ? receipt.blocked_jobs.length : 0;
      const unpublished = Array.isArray(receipt.unpublished_outputs) ? receipt.unpublished_outputs.length : 0;
      setStatus(
        revokeStatusEl,
        `Consent revoked for ${presenterId} at ${receipt.revoked_at}. ` +
          `Deleted ${deleted} derived asset(s), blocked ${blocked} job(s), unpublished ${unpublished} output(s). ` +
          `Note: files already exported outside managed storage cannot be recalled.`,
        "ok",
      );
      await loadPresenterDetail();
    } catch (err) {
      setStatus(revokeStatusEl, `Could not revoke consent: ${errText(err)}`, "error");
    }
  });

  // --- script ---------------------------------------------------------------

  function readSegmentsFromTable() {
    // State is the source of truth; inputs write into it on every change.
    return segments;
  }

  function validateScript() {
    const errors = validateScriptSegments(readSegmentsFromTable(), captureDurationSec());
    if (errors.length === 0) {
      setStatus(scriptStatusEl, "Script looks valid.", "ok");
    } else {
      setStatus(scriptStatusEl, errors.join(" "), "error");
    }
    createJobBtn.disabled = errors.length > 0;
    return errors;
  }

  function renderSegmentsTable() {
    segmentsBody.innerHTML = "";
    segments.forEach((seg, i) => {
      const tr = document.createElement("tr");

      const stepCell = document.createElement("td");
      const stepInput = document.createElement("input");
      stepInput.type = "text";
      stepInput.value = seg.stepId;
      stepInput.setAttribute("aria-label", `Step ${i + 1} id`);
      stepInput.addEventListener("input", () => {
        seg.stepId = stepInput.value;
        validateScript();
      });
      stepCell.appendChild(stepInput);
      tr.appendChild(stepCell);

      const textCell = document.createElement("td");
      const textInput = document.createElement("input");
      textInput.type = "text";
      textInput.value = seg.text;
      textInput.placeholder = "What the presenter says for this step";
      textInput.setAttribute("aria-label", `Step ${i + 1} text`);
      textInput.addEventListener("input", () => {
        seg.text = textInput.value;
        validateScript();
      });
      textCell.appendChild(textInput);
      tr.appendChild(textCell);

      const startCell = document.createElement("td");
      const startInput = document.createElement("input");
      startInput.type = "number";
      startInput.min = "0";
      startInput.step = "0.1";
      startInput.value = String(seg.captureStartSec);
      startInput.setAttribute("aria-label", `Step ${i + 1} start seconds`);
      startInput.addEventListener("input", () => {
        seg.captureStartSec = Number(startInput.value);
        validateScript();
      });
      startCell.appendChild(startInput);
      tr.appendChild(startCell);

      const endCell = document.createElement("td");
      const endInput = document.createElement("input");
      endInput.type = "number";
      endInput.min = "0";
      endInput.step = "0.1";
      endInput.value = String(seg.captureEndSec);
      endInput.setAttribute("aria-label", `Step ${i + 1} end seconds`);
      endInput.addEventListener("input", () => {
        seg.captureEndSec = Number(endInput.value);
        validateScript();
      });
      endCell.appendChild(endInput);
      tr.appendChild(endCell);

      const removeCell = document.createElement("td");
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "ghost-btn small";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        segments.splice(i, 1);
        renderSegmentsTable();
        validateScript();
      });
      removeCell.appendChild(removeBtn);
      tr.appendChild(removeCell);

      segmentsBody.appendChild(tr);
    });
  }

  $("narration-add-step").addEventListener("click", () => {
    const last = segments[segments.length - 1];
    const start = last && Number.isFinite(Number(last.captureEndSec)) ? Number(last.captureEndSec) : 0;
    segments.push({
      stepId: `step-${segments.length + 1}`,
      text: "",
      captureStartSec: start,
      captureEndSec: start + 5,
    });
    renderSegmentsTable();
    validateScript();
  });

  capturePathInput.addEventListener("input", validateScript);
  captureDurationInput.addEventListener("input", validateScript);

  // --- job --------------------------------------------------------------------

  function renderJobResult(result) {
    jobResultEl.innerHTML = "";
    if (!result) return;

    const heading = document.createElement("h3");
    heading.textContent = "Result";
    jobResultEl.appendChild(heading);

    const segList = document.createElement("ul");
    for (const seg of result.segments || []) {
      const li = document.createElement("li");
      li.textContent =
        `${seg.step_id}: ${formatSec(seg.duration_sec)} audio` +
        (seg.real_time_factor != null ? ` · ${Number(seg.real_time_factor).toFixed(2)}× real-time` : "") +
        (seg.audio_file ? ` · ${seg.audio_file}` : "");
      segList.appendChild(li);
    }
    jobResultEl.appendChild(segList);

    const render = result.render || {};
    const resources = result.resources || {};
    const summary = document.createElement("p");
    summary.textContent =
      `Output: ${formatBytes(render.output_bytes)}` +
      (render.render_sec != null ? ` · rendered in ${formatSec(render.render_sec)}` : "") +
      (resources.peak_vram_mib != null ? ` · peak VRAM ${resources.peak_vram_mib} MiB` : "") +
      (resources.peak_ram_mib != null ? ` · peak RAM ${resources.peak_ram_mib} MiB` : "") +
      (resources.gpu ? ` · GPU: ${resources.gpu}` : "");
    jobResultEl.appendChild(summary);

    if (render.ffmpeg_command) {
      const cmdLabel = document.createElement("p");
      cmdLabel.textContent = "FFmpeg command:";
      jobResultEl.appendChild(cmdLabel);
      const code = document.createElement("code");
      code.textContent = render.ffmpeg_command;
      jobResultEl.appendChild(code);
    }

    if (render.output_file) {
      const outLabel = document.createElement("p");
      outLabel.textContent = `Narrated output: ${render.output_file}`;
      jobResultEl.appendChild(outLabel);

      // Preview mirrors record.js: a <video> element fed from the local
      // file. No blob exists here (the render lives on disk), so the path
      // goes through Tauri's file-URL conversion; when the bridge cannot
      // do that, the path above is the honest fallback.
      const src = previewSrcForPath(render.output_file);
      if (src) {
        const video = document.createElement("video");
        video.controls = true;
        video.preload = "metadata";
        video.style.maxWidth = "100%";
        video.src = src;
        jobResultEl.appendChild(video);
      } else {
        const note = document.createElement("p");
        note.className = "hint";
        note.textContent =
          "In-app preview is unavailable for this file path in this build — open the file above in your video player.";
        jobResultEl.appendChild(note);
      }

      // Save to FORGE does not fit the finished render: the existing
      // opt-in upload takes in-memory PNG/JPEG/WebM bytes (<=25 MB) and
      // rejects MP4, and no command reads the render's bytes back. Plain
      // note, no pretend button.
      const forgeNote = document.createElement("p");
      forgeNote.className = "hint";
      forgeNote.textContent =
        "Save to FORGE is not available for narrated output yet — the FORGE upload only accepts " +
        "PNG/JPEG/WebM captures, not a finished MP4 file on disk. The narrated file stays at the path above.";
      jobResultEl.appendChild(forgeNote);
    }

    if (render.captions_file) {
      const cap = document.createElement("p");
      cap.textContent = `Captions: ${render.captions_file}`;
      jobResultEl.appendChild(cap);
    }
    if (result.outbound_requests != null) {
      const outbound = document.createElement("p");
      outbound.textContent = `Outbound model/voice requests during the job: ${result.outbound_requests} (local-first: expect 0).`;
      jobResultEl.appendChild(outbound);
    }
  }

  async function pollJobOnce(jobId) {
    let res;
    try {
      res = await invoke("narration_poll_job", { jobId });
    } catch (err) {
      stopPolling();
      setStatus(jobStatusEl, `Could not poll job ${jobId}: ${errText(err)}`, "error");
      return null;
    }
    const status = res && res.status;
    if (status === "done") {
      stopPolling();
      currentResult = res.result || null;
      setStatus(jobStatusEl, `Job ${jobId} done.`, "ok");
      renderJobResult(currentResult);
      acceptanceBtn.disabled = false;
      void refreshJobs();
    } else if (status === "failed") {
      stopPolling();
      const reason =
        (res.result && res.result.failure_reason) || (res.result && res.result.status) || "the runner reported a failure";
      setStatus(jobStatusEl, `Job ${jobId} failed: ${reason}`, "error");
    } else {
      setStatus(jobStatusEl, `Job ${jobId}: ${status || "working"}…`, "");
    }
    return res;
  }

  createJobBtn.addEventListener("click", async () => {
    const errors = validateScript();
    if (errors.length > 0) return;
    const presenterId = presenterSel.value;
    if (!presenterId) {
      setStatus(jobStatusEl, "Pick a presenter first.", "error");
      return;
    }
    const capturePath = capturePathInput.value.trim();
    if (!capturePath) {
      setStatus(jobStatusEl, "Enter the capture path first.", "error");
      return;
    }
    stopPolling();
    currentResult = null;
    jobResultEl.innerHTML = "";
    acceptanceBtn.disabled = true;
    setStatus(acceptanceStatusEl, "", "");
    setStatus(jobStatusEl, "Creating narration job…", "");
    try {
      const job = await invoke("narration_create_job", {
        presenterId,
        capturePath,
        captureFile: fileNameOf(capturePath),
        captureDurationSec: captureDurationSec(),
        segments: segments.map((seg) => ({
          stepId: seg.stepId,
          text: seg.text,
          sourceEvidence: "manual",
          captureStartSec: Number(seg.captureStartSec),
          captureEndSec: Number(seg.captureEndSec),
        })),
      });
      currentJobId = job.jobId;
      setStatus(jobStatusEl, `Job ${currentJobId} ${job.status || "created"} — polling every 2 s…`, "");
      pollTimer = setInterval(() => void pollJobOnce(currentJobId), NARRATION_POLL_MS);
      await pollJobOnce(currentJobId);
      void refreshJobs();
    } catch (err) {
      setStatus(jobStatusEl, `Could not create the narration job: ${errText(err)}`, "error");
    }
  });

  // --- acceptance ---------------------------------------------------------------

  acceptanceBtn.addEventListener("click", async () => {
    if (!currentJobId || !currentResult) {
      setStatus(acceptanceStatusEl, "Finish a narration job first — there is no output to accept yet.", "error");
      return;
    }
    const presenterDecision = $("narration-presenter-decision").value;
    const presenterBy = $("narration-presenter-by").value.trim();
    const reviewerDecision = $("narration-reviewer-decision").value;
    const reviewerBy = $("narration-reviewer-by").value.trim();
    const notes = $("narration-acceptance-notes").value.trim();
    if (!presenterBy || !reviewerBy) {
      setStatus(acceptanceStatusEl, "Enter both the presenter name and the reviewer name.", "error");
      return;
    }
    try {
      const receipt = await invoke("narration_accept_output", {
        jobId: currentJobId,
        presenterDecision,
        presenterBy,
        reviewerDecision,
        reviewerBy,
        notes,
      });
      // The verdict is computed from the returned receipt, never assumed.
      const verdict = acceptanceVerdictLabel(receipt);
      setStatus(
        acceptanceStatusEl,
        `Acceptance recorded for job ${currentJobId} — verdict: ${verdict} ` +
          `(presenter: ${receipt.presenter_decision}, reviewer: ${receipt.reviewer_decision}).`,
        verdict === "PASS" ? "ok" : "error",
      );
    } catch (err) {
      setStatus(acceptanceStatusEl, `Could not record acceptance: ${errText(err)}`, "error");
    }
  });

  // --- jobs list ------------------------------------------------------------------

  async function refreshJobs() {
    try {
      const jobs = await invoke("narration_list_jobs");
      jobsListEl.innerHTML = "";
      const rows = Array.isArray(jobs) ? jobs : [];
      if (rows.length === 0) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "No narration jobs yet.";
        jobsListEl.appendChild(li);
        setStatus(jobsStatusEl, "", "");
        return;
      }
      for (const job of rows) {
        const li = document.createElement("li");
        li.className = "capture-item";
        const name = document.createElement("span");
        name.className = "capture-name";
        name.textContent = job.jobId;
        li.appendChild(name);
        const state = document.createElement("span");
        state.className = "capture-state";
        state.textContent = `${job.presenterId} · ${job.status}`;
        li.appendChild(state);
        const pollBtn = document.createElement("button");
        pollBtn.type = "button";
        pollBtn.className = "ghost-btn small";
        pollBtn.textContent = "Poll";
        pollBtn.addEventListener("click", async () => {
          try {
            const res = await invoke("narration_poll_job", { jobId: job.jobId });
            state.textContent = `${job.presenterId} · ${res.status}`;
            if (res.status === "done" && job.jobId === currentJobId) {
              currentResult = res.result || null;
              renderJobResult(currentResult);
              acceptanceBtn.disabled = false;
            }
            if (res.status === "done" || res.status === "failed") {
              setStatus(jobsStatusEl, `Job ${job.jobId}: ${res.status}.`, res.status === "done" ? "ok" : "error");
            } else {
              setStatus(jobsStatusEl, `Job ${job.jobId}: ${res.status}…`, "");
            }
          } catch (err) {
            setStatus(jobsStatusEl, `Could not poll job ${job.jobId}: ${errText(err)}`, "error");
          }
        });
        li.appendChild(pollBtn);
        jobsListEl.appendChild(li);
      }
      setStatus(jobsStatusEl, "", "");
    } catch (err) {
      setStatus(jobsStatusEl, `Could not list jobs: ${errText(err)}`, "error");
    }
  }

  $("narration-refresh-jobs").addEventListener("click", () => void refreshJobs());

  // --- init -------------------------------------------------------------------------

  async function init() {
    try {
      const root = await invoke("narration_root_path");
      rootEl.textContent = root ? `Narration files live under: ${root}` : "";
    } catch (err) {
      rootEl.textContent = `Could not read the narration root path: ${errText(err)}`;
    }
    renderSegmentsTable();
    validateScript();
    await loadPresenters();
    await refreshJobs();
  }

  void init();

  return {
    get jobId() {
      return currentJobId;
    },
    dispose() {
      stopPolling();
    },
  };
}

// Auto-mount when loaded as a page script next to index.html.
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const mount = document.getElementById("narration-mount");
    if (mount && !mount.dataset.mounted) {
      mount.dataset.mounted = "1";
      try {
        renderNarrationControls(mount, {});
      } catch (e) {
        mount.textContent = `Narration could not start: ${e.message || e}`;
      }
    }
  });
}
