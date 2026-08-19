"use client";
import { useEffect, useRef, useState } from "react";
import { defaultBoardState } from "./schedulingBoardState";

// Loads and autosaves a scheduling project's board via /api/forge/scheduling/[projectId],
// shared by every view onto the same project (the Gantt chart, the WBS outline, the
// activities table) so the load/save behavior -- including the read-only handling for a
// project the caller doesn't own, and the Strict-Mode-safe "don't save what was just
// loaded" check -- lives in exactly one place rather than being re-implemented (and
// re-debugged) per view. See SchedulingBoard.jsx's git history for why the skip-on-load
// check compares board identity instead of using a one-shot consumed flag.
export function usePersistedBoard(projectId) {
  const [board, setBoard] = useState(() => defaultBoardState(projectId));
  const [isOwner, setIsOwner] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const saveTimer = useRef(null);
  const lastLoadedBoardRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/forge/scheduling/${projectId}`);
        if (cancelled) return;
        if (!response.ok) {
          setLoadError(response.status === 404 ? "Project not found." : "Unable to load this project.");
          return;
        }
        const body = await response.json();
        if (cancelled) return;
        lastLoadedBoardRef.current = body.board;
        setBoard(body.board);
        setIsOwner(body.isOwner);
      } catch {
        if (!cancelled) setLoadError("Unable to load this project.");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (loadError) return;
    if (!lastLoadedBoardRef.current || board === lastLoadedBoardRef.current) return;
    if (!isOwner) return;
    setSaveStatus("Saving…");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/forge/scheduling/${board.id}`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(board),
        });
        if (!response.ok) throw new Error("save failed");
        setSaveStatus("Saved");
        setTimeout(() => setSaveStatus((current) => (current === "Saved" ? "" : current)), 1800);
      } catch {
        setSaveStatus("Save failed");
      }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [board, isOwner, loadError]);

  return { board, setBoard, isOwner, loadError, saveStatus };
}
