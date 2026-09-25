// FORGE Capture — Meeting mode UI driver (ui/meeting.js).
//
// ES module (no bundler): loaded via <script type="module"> in index.html.
// Owns the Meeting tab DOM: microphone picker, language hint, Record/Stop,
// live timer, status, crash-recovery notices, the session recording list,
// and the transcript view (timestamped segments, search, copy, and a
// disabled Save-to-FORGE stub).
//
// All recording/transcription logic lives in meeting-core.js
// (MeetingSession, unit-tested under vitest); the Rust backend owns the
// audio file writes and the transcription spool (see
// forge-capture-app/docs/meeting-mode.md).

import {
  MeetingSession,
  formatTimestamp,
  transcriptText,
  searchSegments,
} from "./meeting-core.js";

function defaultInvoke(cmd, args) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

const SAVE_FORGE_TITLE = "Coming soon — save transcripts to your FORGE library";

export function renderMeetingControls(container, deps = {}) {
  const invoke = deps.invoke || defaultInvoke;

  container.innerHTML = `
    <div class="palette meeting">
      <div class="row">
        <label class="field">Microphone
          <select id="meeting-device"><option value="">System default</option></select>
        </label>
        <label class="field">Language
          <select id="meeting-language">
            <option value="auto">Auto-detect</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
          </select>
        </label>
      </div>
      <button id="meeting-record-btn" class="capture-btn" type="button">● Record</button>
      <div id="meeting-timer" class="meeting-timer" hidden>0:00</div>
      <div id="meeting-status" class="status" role="status"></div>
      <div id="meeting-recovered" class="meeting-recovered"></div>
      <section class="library" aria-label="Meeting recordings">
        <h2>Recordings</h2>
        <ul id="meeting-list" class="captures"></ul>
      </section>
      <div id="meeting-transcript" class="meeting-transcript" hidden>
        <h2>Transcript <span id="meeting-transcript-name" class="transcript-name"></span></h2>
        <div class="row transcript-tools">
          <label class="field">Search
            <input id="meeting-search" type="search" placeholder="Search transcript…" autocomplete="off" />
          </label>
          <button id="meeting-copy" class="ghost-btn small" type="button">Copy text</button>
          <button id="meeting-save-forge" class="ghost-btn small" type="button" disabled title="${SAVE_FORGE_TITLE}">Save to FORGE</button>
        </div>
        <ol id="meeting-segments" class="transcript"></ol>
      </div>
    </div>`;

  const $ = (id) => container.querySelector("#" + id);
  const deviceSel = $("meeting-device");
  const languageSel = $("meeting-language");
  const recordBtn = $("meeting-record-btn");
  const timerEl = $("meeting-timer");
  const statusEl = $("meeting-status");
  const recoveredEl = $("meeting-recovered");
  const listEl = $("meeting-list");
  const transcriptEl = $("meeting-transcript");
  const transcriptNameEl = $("meeting-transcript-name");
  const searchInput = $("meeting-search");
  const segmentsEl = $("meeting-segments");

  // --- session records -------------------------------------------------------
  // One record per recording this session (live or adopted from recovery).
  const records = new Map(); // jobId -> { fileName, session, transcript }
  let liveSession = null;
  let timerId = null;
  let currentTranscriptKey = null;

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function newSession() {
    const session = new MeetingSession({
      invoke,
      onEvent: (evt) => onSessionEvent(session, evt),
    });
    return session;
  }

  function onSessionEvent(session, evt) {
    // Route the event to the record owning this session.
    for (const [key, rec] of records) {
      if (rec.session === session) {
        if (session.fileName && rec.fileName !== session.fileName) {
          rec.fileName = session.fileName;
        }
        if (evt.state === "imported") {
          rec.transcript = session.transcript;
          renderList();
          showTranscript(key);
        } else {
          renderRecord(key, rec, evt);
        }
        break;
      }
    }
    if (session === liveSession) {
      renderLive(evt);
    }
  }

  function renderLive(evt) {
    const recording = evt.state === "recording";
    const busy = ["starting", "stopping"].includes(evt.state);
    recordBtn.disabled = busy;
    recordBtn.textContent = recording ? "■ Stop" : "● Record";
    recordBtn.classList.toggle("stopping", recording);
    timerEl.hidden = !(recording || evt.state === "stopping");
    if (recording) startTimer();
    else stopTimer();
    if (evt.state === "failed" || evt.state === "cancelled") {
      setStatus(evt.text, evt.state === "failed" ? "error" : "");
    } else if (["queued", "processing", "importing"].includes(evt.state)) {
      setStatus(evt.text, "");
    } else if (evt.state === "imported") {
      setStatus("", "");
    } else if (recording) {
      setStatus("", "");
    }
    deviceSel.disabled = recording || busy;
    languageSel.disabled = recording || busy;
  }

  function startTimer() {
    stopTimer();
    const tick = () => {
      const ms = liveSession && liveSession.startedAt ? Date.now() - liveSession.startedAt : 0;
      timerEl.textContent = formatTimestamp(ms / 1000);
    };
    tick();
    timerId = setInterval(tick, 250);
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  // --- recordings list -------------------------------------------------------

  function addRecord({ jobId, fileName, session, recovered }) {
    const key = jobId || `pending-${Date.now()}`;
    records.set(key, { fileName, session, transcript: null, recovered: !!recovered });
    renderList();
    return key;
  }

  function renderList() {
    listEl.innerHTML = "";
    if (records.size === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No recordings yet this session.";
      listEl.appendChild(li);
      return;
    }
    for (const [key, rec] of records) {
      const li = document.createElement("li");
      li.className = "capture-item";
      li.dataset.key = key;
      const name = document.createElement("span");
      name.className = "capture-name";
      name.textContent = rec.fileName || "Recording…";
      li.appendChild(name);
      const state = document.createElement("span");
      state.className = "capture-state";
      state.textContent = rec.transcript
        ? "Transcript ready"
        : rec.session
          ? rec.session.statusText()
          : "…";
      li.appendChild(state);
      if (rec.transcript) {
        const view = document.createElement("button");
        view.type = "button";
        view.className = "ghost-btn small";
        view.textContent = "View transcript";
        view.addEventListener("click", () => showTranscript(key));
        li.appendChild(view);
      }
      listEl.appendChild(li);
    }
  }

  function renderRecord(key, rec, evt) {
    // Targeted per-event refresh: the list row's name + state.
    const li = listEl.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!li) {
      renderList();
      return;
    }
    const nameEl = li.querySelector(".capture-name");
    const stateEl = li.querySelector(".capture-state");
    if (nameEl && rec.fileName) nameEl.textContent = rec.fileName;
    if (stateEl) stateEl.textContent = rec.transcript ? "Transcript ready" : evt.text;
  }

  // --- transcript view -------------------------------------------------------

  function showTranscript(key) {
    const rec = records.get(key);
    if (!rec || !rec.transcript) return;
    currentTranscriptKey = key;
    transcriptNameEl.textContent = rec.fileName ? `— ${rec.fileName}` : "";
    searchInput.value = "";
    renderSegments(rec.transcript.segments, searchSegments(rec.transcript.segments, ""));
    transcriptEl.hidden = false;
    transcriptEl.scrollIntoView({ block: "nearest" });
  }

  function renderSegments(segments, indices) {
    segmentsEl.innerHTML = "";
    if (indices.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = segments.length === 0 ? "No speech detected in this recording." : "No segments match the search.";
      segmentsEl.appendChild(li);
      return;
    }
    for (const i of indices) {
      const seg = segments[i];
      const li = document.createElement("li");
      li.className = "segment";
      const time = document.createElement("button");
      time.type = "button";
      time.className = "segment-time";
      time.textContent = formatTimestamp(seg.start);
      time.title = `Jump to ${formatTimestamp(seg.start)}`;
      li.appendChild(time);
      const text = document.createElement("span");
      text.className = "segment-text";
      text.textContent = seg.text;
      li.appendChild(text);
      segmentsEl.appendChild(li);
    }
  }

  searchInput.addEventListener("input", () => {
    const rec = records.get(currentTranscriptKey);
    if (!rec || !rec.transcript) return;
    renderSegments(
      rec.transcript.segments,
      searchSegments(rec.transcript.segments, searchInput.value)
    );
  });

  $("meeting-copy").addEventListener("click", async () => {
    const rec = records.get(currentTranscriptKey);
    if (!rec || !rec.transcript) return;
    const text = transcriptText(rec.transcript.segments);
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Transcript copied to the clipboard.", "");
    } catch {
      setStatus("Could not copy: clipboard access was denied.", "error");
    }
  });

  // --- record / stop ----------------------------------------------------------

  recordBtn.addEventListener("click", async () => {
    if (liveSession && liveSession.state === "recording") {
      try {
        await liveSession.stopRecording();
      } catch (err) {
        setStatus(`Could not save the recording: ${(err && err.message) || err}`, "error");
      }
      return;
    }
    liveSession = newSession();
    // Register the record early so a fast stop still has somewhere to land.
    const key = addRecord({ jobId: null, fileName: "Recording…", session: liveSession });
    liveSession._recordKey = key;
    try {
      await liveSession.startRecording({
        deviceId: deviceSel.value,
        languageHint: languageSel.value,
      });
      await refreshDevices(false);
    } catch {
      // startRecording already moved the session to failed and emitted;
      // the record row shows the error.
    }
  });

  // --- microphone picker -------------------------------------------------------
  // Labels are empty until permission is granted; after a successful
  // getUserMedia the list refreshes with real microphone names.

  async function refreshDevices(announce) {
    try {
      const probe = newSession();
      const devices = await probe.listInputDevices();
      probe.dispose();
      const prev = deviceSel.value;
      deviceSel.innerHTML = "";
      const def = document.createElement("option");
      def.value = "";
      def.textContent = devices.length > 0 ? "System default" : "System default";
      deviceSel.appendChild(def);
      for (const d of devices) {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `Microphone ${deviceSel.length}`;
        deviceSel.appendChild(opt);
      }
      if ([...deviceSel.options].some((o) => o.value === prev)) {
        deviceSel.value = prev;
      }
      if (announce && devices.length === 0) {
        setStatus("No microphones listed — the browser will ask for permission when you record.", "");
      }
    } catch {
      /* best effort: the picker keeps its default */
    }
  }

  deviceSel.addEventListener("change", () => {
    // Applied on the next recording.
  });

  // --- crash recovery ----------------------------------------------------------
  // Runs once at startup: any `.meeting.part` file left by a crash is
  // finalized by the backend and handed back with a fresh transcription
  // job, which we adopt and poll like a normal recording.

  async function recover() {
    let found = [];
    try {
      found = await invoke("meeting_recover", {});
    } catch (err) {
      setStatus(`Recovery check failed: ${(err && err.message) || err}`, "error");
      return;
    }
    if (!found || found.length === 0) return;
    for (const item of found) {
      const session = newSession();
      const key = addRecord({
        jobId: item.jobId,
        fileName: item.fileName,
        session,
        recovered: true,
      });
      session._recordKey = key;
      const note = document.createElement("div");
      note.className = "recovered-note";
      note.textContent = `Recovered an interrupted recording (${item.fileName}) — transcription queued.`;
      recoveredEl.appendChild(note);
      session.adoptJob(item.jobId, item.fileName);
    }
  }

  refreshDevices(true).finally(() => recover());

  return {
    /** For tests / embedding hosts. */
    get sessions() {
      return [...records.values()].map((r) => r.session);
    },
    dispose() {
      stopTimer();
      for (const rec of records.values()) {
        try {
          rec.session.dispose();
        } catch {
          /* best effort */
        }
      }
    },
  };
}

// Auto-mount when loaded as a page script next to index.html.
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const mount = document.getElementById("meeting-mount");
    if (mount && !mount.dataset.mounted) {
      mount.dataset.mounted = "1";
      try {
        renderMeetingControls(mount, {});
      } catch (e) {
        mount.textContent = `Meeting mode could not start: ${e.message || e}`;
      }
    }
  });
}
