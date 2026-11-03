// FORGE Capture — C2-P6A candidate-only review panel, DOM half (review.js).
//
// ES module (no bundler): loaded via <script type="module"> in index.html.
// Owns the DOM and the two Tauri commands this slice adds/uses:
//   - get_review_candidates (read-only; this slice's own new command)
//   - review_disposition_change (existing, already-reviewed GS-C6 command —
//     called unchanged; no new mutation/safety logic lives here)
// All pure logic (grouping, payload construction, error categorization,
// highlight geometry, request-generation binding) lives in review-core.js and
// is unit-tested under vitest with no DOM.
//
// Candidate-only, per the landed scope: no full editor/annotation/export UI,
// no OCR/pixel preview, no producer wiring — this panel takes a workspace
// root, a session-relative path, and a frame id entered directly (there is no
// session/frame picker yet; that's explicitly out of this slice), loads that
// one frame's candidates, and lets a reviewer choose Redact or Mark Not
// Sensitive for a Pending one.

import {
  DISPOSITIONS,
  ReviewError,
  groupCandidatesByDisposition,
  buildReviewActionPayload,
  buildSnapshotRequestPayload,
  buildLoadedViewState,
  categorizeError,
  describeErrorCategory,
  RequestGenerationTracker,
  boxToDisplayRect,
} from "./review-core.js";

function defaultInvoke(cmd, args) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

function defaultGenUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fallback for a test/host environment without crypto.randomUUID —
  // never used in the packaged app, where crypto is always available.
  return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultNowIso() {
  return new Date().toISOString();
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "hidden") node.hidden = !!v;
    else if (k === "disabled") node.disabled = !!v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    // Text-safe by construction: a string child becomes a text node, never
    // HTML — scope review "safe display": backend-controlled identifiers
    // and reason codes must render as text, including hostile fixtures.
    node.append(c);
  }
  return node;
}

const DISPOSITION_LABELS = {
  [DISPOSITIONS.PENDING]: "Pending",
  [DISPOSITIONS.REDACT]: "Redact",
  [DISPOSITIONS.MARK_NON_SENSITIVE]: "Marked not sensitive",
};

/**
 * Render the candidate-only review panel into `container`.
 * deps: { invoke, genUuid, nowIso } — all optional; production defaults
 * (real Tauri invoke, crypto.randomUUID, Date.now) are used otherwise.
 * Returns `{ destroy }`.
 */
export function renderReviewPanel(container, deps = {}) {
  const invoke = deps.invoke || defaultInvoke;
  const genUuid = deps.genUuid || defaultGenUuid;
  const nowIso = deps.nowIso || defaultNowIso;

  const generations = new RequestGenerationTracker();
  let view = null; // the current loaded view (frozen), or null before any load.
  let busy = false; // single-flight: true while a load or action is in flight.
  let actingReason = ""; // the in-progress Mark-Not-Sensitive reason draft, per candidate.
  let actingCandidateId = null; // which candidate's reason input is open, if any.

  const section = el("section", { class: "card" });
  section.append(
    el("h2", {}, "Review candidates (C2-P6A)"),
    el(
      "p",
      { class: "hint" },
      "Candidate-only review for one frame of an existing SOP capture session. Loads redaction candidates and lets you Redact or Mark Not Sensitive — the same guarded, native-dialog-confirmed action already used elsewhere in this app.",
    ),
  );

  const workspaceInput = el("input", { id: "review-workspace", type: "text", placeholder: "Workspace root, e.g. C:\\captures\\sop-1" });
  const sessionInput = el("input", { id: "review-session", type: "text", placeholder: "Session file, e.g. session.json", value: "session.json" });
  const frameInput = el("input", { id: "review-frame", type: "text", placeholder: "Frame id, e.g. f1" });
  const loadBtn = el("button", { id: "review-load", class: "primary" }, "Load");
  const contextRow = el(
    "div",
    { class: "row" },
    el("label", { class: "field" }, "Workspace root ", workspaceInput),
    el("label", { class: "field" }, "Session file ", sessionInput),
    el("label", { class: "field" }, "Frame id ", frameInput),
    loadBtn,
  );
  section.append(contextRow);

  const status = el("p", { class: "status", role: "status", id: "review-status" });
  section.append(status);

  const contextDisplay = el("p", { class: "hint", id: "review-context-display", hidden: true });
  section.append(contextDisplay);

  const diagram = el("div", { id: "review-diagram", class: "review-diagram", hidden: true });
  const diagramLabel = el("p", { class: "hint" }, "Coordinate view — box positions only, not a pixel preview.");
  section.append(diagramLabel, diagram);

  const groupsEl = {
    PENDING: el("ul", { class: "review-candidate-list", "aria-label": "Pending candidates" }),
    REDACT: el("ul", { class: "review-candidate-list", "aria-label": "Redacted candidates" }),
    MARK_NON_SENSITIVE: el("ul", { class: "review-candidate-list", "aria-label": "Marked not sensitive candidates" }),
    UNKNOWN: el("ul", { class: "review-candidate-list", "aria-label": "Candidates with an unrecognized disposition" }),
  };
  // Muse review 2026-11-02 (fix-before-merge): groupCandidatesByDisposition
  // parks an unrecognized disposition in its own UNKNOWN bucket rather than
  // silently sorting it into a real one — but that bucket must actually be
  // rendered, or such a candidate is counted in "Loaded N candidate(s)" and
  // then vanishes from every list with no row and no error. This section
  // stays hidden whenever there is nothing in it.
  const unknownSection = el(
    "div",
    { id: "review-unknown-section", hidden: true },
    el("h3", {}, "Unrecognized disposition — action disabled"),
    el("p", { class: "status error", role: "status" }, "This app version does not recognize this candidate's disposition. No action is available; reload after updating."),
    groupsEl.UNKNOWN,
  );
  const listWrap = el(
    "div",
    { id: "review-candidates" },
    el("h3", {}, "Pending"),
    groupsEl.PENDING,
    el("h3", {}, "Redact"),
    groupsEl.REDACT,
    el("h3", {}, "Marked not sensitive"),
    groupsEl.MARK_NON_SENSITIVE,
    unknownSection,
  );
  section.append(listWrap);

  container.append(section);

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = "status" + (kind ? " " + kind : "");
  }

  function setBusy(v) {
    busy = v;
    loadBtn.disabled = v;
    for (const btn of section.querySelectorAll("button[data-action]")) btn.disabled = v;
  }

  function renderDiagram() {
    diagram.innerHTML = "";
    if (!view || view.candidates.length === 0) {
      diagram.hidden = true;
      return;
    }
    diagram.hidden = false;
    const displayW = 320;
    const displayH = Math.max(80, Math.round((displayW * view.frameHeight) / Math.max(1, view.frameWidth)));
    diagram.style.width = `${displayW}px`;
    diagram.style.height = `${displayH}px`;
    for (const c of view.candidates) {
      const rect = boxToDisplayRect(c.expandedBox, view.frameWidth, view.frameHeight, displayW, displayH);
      if (!rect) continue;
      const box = el("div", { class: "review-diagram-box", title: `${c.candidateId} (${c.detectorId})` });
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${Math.max(1, rect.width)}px`;
      box.style.height = `${Math.max(1, rect.height)}px`;
      diagram.append(box);
    }
  }

  function renderCandidateRow(c) {
    const idEl = el("span", { class: "review-candidate-id" }, c.candidateId);
    const metaEl = el("span", { class: "review-candidate-meta" }, ` — ${c.detectorId} (${c.reasonCode})`);
    const row = el("li", {}, idEl, metaEl);

    if (c.disposition === DISPOSITIONS.PENDING) {
      const redactBtn = el(
        "button",
        {
          type: "button",
          "data-action": "redact",
          onclick: () => void onRedact(c.candidateId),
        },
        "Redact",
      );
      const markBtn = el(
        "button",
        {
          type: "button",
          "data-action": "mark-non-sensitive",
          onclick: () => {
            actingCandidateId = actingCandidateId === c.candidateId ? null : c.candidateId;
            actingReason = "";
            renderCandidates();
          },
        },
        "Mark not sensitive…",
      );
      row.append(" ", redactBtn, " ", markBtn);

      if (actingCandidateId === c.candidateId) {
        const reasonInput = el("input", {
          type: "text",
          placeholder: "Reason (required)",
          "aria-label": `Reason for marking ${c.candidateId} not sensitive`,
          value: actingReason,
          oninput: (e) => {
            actingReason = e.target.value;
          },
        });
        const submitBtn = el(
          "button",
          { type: "button", "data-action": "submit-mark-non-sensitive", onclick: () => void onMarkNonSensitive(c.candidateId) },
          "Confirm reason",
        );
        const cancelBtn = el(
          "button",
          {
            type: "button",
            "data-action": "cancel-mark-non-sensitive",
            onclick: () => {
              actingCandidateId = null;
              actingReason = "";
              renderCandidates();
            },
          },
          "Cancel",
        );
        row.append(el("div", { class: "review-reason-row" }, reasonInput, submitBtn, cancelBtn));
      }
    } else {
      row.append(el("span", { class: "review-candidate-disposition" }, ` [${DISPOSITION_LABELS[c.disposition] || c.disposition}]`));
    }
    return row;
  }

  function renderCandidates() {
    for (const key of Object.keys(groupsEl)) groupsEl[key].innerHTML = "";
    if (!view) return;
    if (view.candidates.length === 0) {
      groupsEl.PENDING.append(el("li", { class: "hint" }, "No candidates in this frame."));
      renderDiagram();
      return;
    }
    const groups = groupCandidatesByDisposition(view.candidates);
    for (const key of ["PENDING", "REDACT", "MARK_NON_SENSITIVE"]) {
      if (groups[key].length === 0) {
        groupsEl[key].append(el("li", { class: "hint" }, "None."));
      } else {
        for (const c of groups[key]) groupsEl[key].append(renderCandidateRow(c));
      }
    }
    // Muse review 2026-11-02 (fix-before-merge): the UNKNOWN group is
    // only ever shown — never silently included in the loaded count with
    // nothing to show for it — when it actually has something in it; the
    // backend's Disposition enum is closed, so this cannot happen with
    // today's sessions, but a future app build talking to an older one
    // (or vice versa) must still make this visible rather than disappear.
    unknownSection.hidden = groups.UNKNOWN.length === 0;
    if (groups.UNKNOWN.length > 0) {
      for (const c of groups.UNKNOWN) groupsEl.UNKNOWN.append(renderCandidateRow(c));
    }
    renderDiagram();
  }

  async function onLoad() {
    if (busy) return;
    const workspaceRoot = workspaceInput.value.trim();
    const sessionRelativePath = sessionInput.value.trim();
    const frameId = frameInput.value.trim();
    if (!workspaceRoot || !sessionRelativePath || !frameId) {
      setStatus("Enter a workspace root, session file, and frame id to load.", "error");
      return;
    }
    const generation = generations.begin();
    setBusy(true);
    setStatus("Loading…");
    try {
      const payload = buildSnapshotRequestPayload({ workspaceRoot, sessionRelativePath, frameId });
      const snapshot = await invoke("get_review_candidates", payload);
      // Scope review item 2: a response for an old selection must not
      // replace a newer panel or enable actions on it.
      if (!generations.isCurrent(generation)) return;
      view = buildLoadedViewState({ workspaceRoot, sessionRelativePath, snapshot });
      actingCandidateId = null;
      actingReason = "";
      contextDisplay.hidden = false;
      contextDisplay.textContent = `Showing ${workspaceRoot} / ${sessionRelativePath} / frame ${frameId} (revision ${view.sessionRevision}).`;
      renderCandidates();
      setStatus(view.candidates.length === 0 ? "Loaded — no candidates in this frame." : `Loaded ${view.candidates.length} candidate(s).`, "ok");
    } catch (e) {
      if (!generations.isCurrent(generation)) return;
      const category = categorizeError(e && e.message ? e.message : e);
      setStatus(describeErrorCategory(category), "error");
    } finally {
      if (generations.isCurrent(generation)) setBusy(false);
    }
  }

  async function submitAction(candidateId, newDisposition, reason) {
    if (busy || !view) return;
    let payload;
    try {
      payload = buildReviewActionPayload({
        snapshot: view,
        candidateId,
        newDisposition,
        reason,
        eventId: genUuid(),
        localTimestamp: nowIso(),
      });
    } catch (e) {
      if (e instanceof ReviewError) {
        setStatus(describeErrorCategory(e.category), "error");
        return;
      }
      throw e;
    }
    const generation = generations.begin();
    setBusy(true);
    setStatus(newDisposition === DISPOSITIONS.MARK_NON_SENSITIVE ? "Waiting for confirmation…" : "Submitting…");
    try {
      await invoke("review_disposition_change", payload);
      if (!generations.isCurrent(generation)) return;
      // Scope review: never an optimistic update — reload the real
      // snapshot (the new current revision) rather than locally
      // flipping this candidate's disposition.
      actingCandidateId = null;
      actingReason = "";
      setStatus("Action applied. Reloading…");
      await reloadAfterAction(generation);
    } catch (e) {
      if (!generations.isCurrent(generation)) return;
      const category = categorizeError(e && e.message ? e.message : e);
      // Scope review: on stale revision, require a refreshed snapshot
      // plus a new deliberate submission — never auto-retry.
      setStatus(describeErrorCategory(category), "error");
      if (generations.isCurrent(generation)) setBusy(false);
    }
  }

  async function reloadAfterAction(generation) {
    try {
      const payload = buildSnapshotRequestPayload({ workspaceRoot: view.workspaceRoot, sessionRelativePath: view.sessionRelativePath, frameId: view.frameId });
      const snapshot = await invoke("get_review_candidates", payload);
      if (!generations.isCurrent(generation)) return;
      view = buildLoadedViewState({ workspaceRoot: view.workspaceRoot, sessionRelativePath: view.sessionRelativePath, snapshot });
      contextDisplay.textContent = `Showing ${view.workspaceRoot} / ${view.sessionRelativePath} / frame ${view.frameId} (revision ${view.sessionRevision}).`;
      renderCandidates();
      setStatus(`Action applied — now at revision ${view.sessionRevision}.`, "ok");
    } catch (e) {
      if (!generations.isCurrent(generation)) return;
      setStatus("Action applied, but the updated snapshot could not be reloaded — reload manually.", "warning");
    } finally {
      if (generations.isCurrent(generation)) setBusy(false);
    }
  }

  async function onRedact(candidateId) {
    await submitAction(candidateId, DISPOSITIONS.REDACT, "");
  }

  async function onMarkNonSensitive(candidateId) {
    await submitAction(candidateId, DISPOSITIONS.MARK_NON_SENSITIVE, actingReason);
  }

  loadBtn.addEventListener("click", () => void onLoad());

  return {
    destroy() {
      section.remove();
    },
  };
}

// Auto-mount when loaded as a page script next to index.html.
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const mount = document.getElementById("review-mount");
    if (mount && !mount.dataset.mounted) {
      mount.dataset.mounted = "1";
      try {
        renderReviewPanel(mount, {});
      } catch (e) {
        mount.textContent = `Review panel could not start: ${e.message || e}`;
      }
    }
  });
}
