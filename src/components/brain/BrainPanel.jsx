// FORGE Brain conversation harness — panel (Q1, minimal).
//
// Chat, history, and memory controls only. Collapsible, with a persistent
// icon visible app-wide that the owner can drag to any screen position;
// the position persists per owner as a stored preference and survives
// sessions (saved on pointer-up; loaded on mount).
//
// The icon renders on first paint so the panel is present app-wide; if the
// preferences fetch answers 401 (signed out), the panel hides itself, so
// signed-out visitors end up seeing nothing. All data fetching happens in
// effects, so the initial render never touches the network.

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { dragDistancePixels, dragPosition, DRAG_TAP_THRESHOLD_PIXELS } from "@/domains/brain-conversation/panelLogic";
import { renderMemoryPlainWords, redactIds, formatPlainDate } from "@/domains/brain-conversation/plainWords";

export default function BrainPanel({
  enabled = false,
  initialCollapsed = true,
  initialPosition = { x: 92, y: 85 },
}) {
  const [hidden, setHidden] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [position, setPositionState] = useState(initialPosition);
  const [memories, setMemories] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [chatMessage, setChatMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [workingSetText, setWorkingSetText] = useState("");
  const reactId = useId();

  const positionRef = useRef(initialPosition);
  const collapsedRef = useRef(initialCollapsed);
  const dragRef = useRef(null);

  function setPosition(next) {
    positionRef.current = next;
    setPositionState(next);
  }

  function setCollapsedBoth(next) {
    collapsedRef.current = next;
    setCollapsed(next);
  }

  async function savePosition(nextPosition, nextCollapsed) {
    try {
      await fetch("/api/brain/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: "brain_icon_position",
          value: { ...nextPosition, collapsed: nextCollapsed },
        }),
      });
    } catch {
      // Position still holds for this session; the next load retries.
    }
  }

  async function loadData() {
    try {
      const memoriesResponse = await fetch("/api/brain/memories");
      if (memoriesResponse.ok) {
        const data = await memoriesResponse.json();
        setMemories(data.entries ?? []);
      }
      const episodesResponse = await fetch("/api/brain/episodes");
      if (episodesResponse.ok) {
        const data = await episodesResponse.json();
        setEpisodes(data.episodes ?? []);
      }
    } catch {
      // Panel stays usable for chat; lists simply stay empty.
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/brain/preferences");
        if (response.status === 401) {
          if (!cancelled) setHidden(true);
          return;
        }
        if (response.ok) {
          const data = await response.json();
          const stored = data.preferences?.brain_icon_position;
          if (stored && typeof stored.x === "number" && typeof stored.y === "number") {
            if (!cancelled) {
              setPosition({ x: stored.x, y: stored.y });
              setCollapsedBoth(stored.collapsed === true);
            }
          }
        }
        if (!cancelled) await loadData();
      } catch {
        // Offline or unreachable: keep defaults; the icon still renders.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function onIconPointerDown(event) {
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      position: { ...positionRef.current },
      dragged: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works without it.
    }
  }

  function onIconPointerMove(event) {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (dragDistancePixels(deltaX, deltaY) > DRAG_TAP_THRESHOLD_PIXELS) {
      drag.dragged = true;
    }
    if (!drag.dragged) return;
    setPosition(
      dragPosition({
        startX: drag.position.x,
        startY: drag.position.y,
        deltaXPixels: deltaX,
        deltaYPixels: deltaY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    );
  }

  function onIconPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.dragged) {
      savePosition(positionRef.current, collapsedRef.current);
      return;
    }
    // A tap toggles expand/collapse.
    const next = !collapsedRef.current;
    setCollapsedBoth(next);
    savePosition(positionRef.current, next);
  }

  async function sendChat(event) {
    event.preventDefault();
    const message = chatMessage.trim();
    if (!message) return;
    setChatMessage("");
    try {
      const response = await fetch("/api/brain/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, sessionId: `brain-session-${reactId}` }),
      });
      const data = await response.json().catch(() => ({}));
      setNotice(data.notice ?? data.error ?? "Your message was saved.");
      setWorkingSetText(data.workingSetPlainWords ?? "");
      await loadData();
    } catch {
      setNotice("Your message could not be saved. Please try again.");
    }
  }

  async function editMemory(entry) {
    if (typeof window === "undefined" || typeof window.prompt !== "function") return;
    const next = window.prompt("Edit memory", entry.content);
    if (next === null || next.trim() === "") return;
    try {
      const response = await fetch(`/api/brain/memories/${encodeURIComponent(entry.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: next.trim() }),
      });
      if (response.ok) await loadData();
    } catch {
      // Edit failed; the list still shows the saved text.
    }
  }

  async function deleteMemory(entry) {
    try {
      const response = await fetch(`/api/brain/memories/${encodeURIComponent(entry.id)}`, {
        method: "DELETE",
      });
      if (response.ok) await loadData();
    } catch {
      // Delete failed; the list still shows the memory.
    }
  }

  if (!enabled || hidden) return null;

  const fixedStyle = {
    position: "fixed",
    left: `${position.x}%`,
    top: `${position.y}%`,
    zIndex: 1000,
  };

  if (collapsed) {
    return (
      <button
        type="button"
        aria-label="Open Brain"
        style={fixedStyle}
        onPointerDown={onIconPointerDown}
        onPointerMove={onIconPointerMove}
        onPointerUp={onIconPointerUp}
      >
        Brain
      </button>
    );
  }

  return (
    <section aria-label="Brain panel" style={{ ...fixedStyle, width: 360, maxHeight: "80vh", overflow: "auto" }}>
      <button type="button" aria-label="Collapse Brain" onClick={() => {
        setCollapsedBoth(true);
        savePosition(positionRef.current, true);
      }}>
        Collapse
      </button>
      <h2>Brain</h2>
      <form onSubmit={sendChat}>
        <label>
          Message
          <input value={chatMessage} onChange={(event) => setChatMessage(event.target.value)} />
        </label>
        <button type="submit">Send</button>
      </form>
      {notice ? <p>{notice}</p> : null}
      {workingSetText ? <p>{workingSetText}</p> : null}
      <h3>History</h3>
      <ul>
        {episodes.map((episode) => (
          <li key={episode.id}>
            {redactIds(episode.content ?? "")} — {formatPlainDate(episode.createdAt)}
          </li>
        ))}
      </ul>
      <h3>Memories</h3>
      <ul>
        {memories.map((entry) => (
          <li key={entry.id}>
            {renderMemoryPlainWords(entry)}{" "}
            <button type="button" onClick={() => editMemory(entry)}>Edit</button>{" "}
            <button type="button" onClick={() => deleteMemory(entry)}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
