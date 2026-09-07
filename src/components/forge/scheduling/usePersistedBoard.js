"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultBoardState } from "./schedulingBoardState";

// SCHED-20: the exact user-facing message required when a save is rejected for a stale
// revision -- surfaced by the conflict banner, kept here (not just in the API route) so the
// hook's own tests can assert against the same string the UI actually shows.
export const SAVE_CONFLICT_MESSAGE = "This schedule changed elsewhere; reload before saving.";

// Loads and autosaves a scheduling project's board via /api/forge/scheduling/[projectId],
// shared by every view onto the same project (the Gantt chart, the WBS outline, the
// activities table) so the load/save behavior -- including the read-only handling for a
// project the caller doesn't own, and the Strict-Mode-safe "don't save what was just
// loaded" check -- lives in exactly one place rather than being re-implemented (and
// re-debugged) per view. See SchedulingBoard.jsx's git history for why the skip-on-load
// check compares board identity instead of using a one-shot consumed flag.
//
// SCHED-20: save_schedule_project_board (see the migration by that name) now enforces
// optimistic concurrency -- a save whose expectedRevision doesn't match the server's current
// board_revision comes back as 409 rather than silently overwriting someone else's save.
// revisionRef is the token tracked for that check: intentionally a ref, not board state,
// because a save's own revision bump must never race a concurrent local edit to `board`
// (see the save handler below) -- if it lived on `board` itself, bumping it after a
// successful save would risk clobbering an edit the user made while that save was in
// flight, or silently reverting to a stale value if it didn't.
export function usePersistedBoard(projectId) {
  const [board, setBoard] = useState(() => defaultBoardState(projectId));
  const [isOwner, setIsOwner] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  // Set the instant the server reports a stale-revision (409) save -- another tab or user
  // saved this project first. Autosave stops entirely once this is true and stays stopped
  // (it is never cleared by a timer or a later edit) until `reload()` runs, matching the
  // explicit requirement that autosave must not retry indefinitely after a conflict.
  const [conflict, setConflict] = useState(false);
  const saveTimer = useRef(null);
  const lastLoadedBoardRef = useRef(null);
  const revisionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    // Nested (not a useCallback reference) so this call sits directly in the effect body,
    // matching the shape every other data-loading effect in this file already uses -- a
    // useCallback'd reference here trips react-hooks/set-state-in-effect's conservative
    // analysis even though nothing here runs before the first await. reload() below covers
    // the same fetch for the conflict banner's manual retry, which -- run from a click
    // handler, never inside an effect -- isn't subject to that rule at all.
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
        revisionRef.current = Number.isInteger(body.board?.boardRevision) ? body.board.boardRevision : 0;
        setBoard(body.board);
        setIsOwner(body.isOwner);
        setLoadError(null);
        setConflict(false);
      } catch {
        if (!cancelled) setLoadError("Unable to load this project.");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (loadError || conflict) return;
    if (!lastLoadedBoardRef.current || board === lastLoadedBoardRef.current) return;
    if (!isOwner) return;
    setSaveStatus("Saving…");
    clearTimeout(saveTimer.current);
    const boardToSave = board;
    saveTimer.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/forge/scheduling/${boardToSave.id}`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...boardToSave, boardRevision: revisionRef.current }),
        });
        if (response.status === 409) {
          setConflict(true);
          setSaveStatus("Save failed");
          return;
        }
        if (!response.ok) throw new Error("save failed");
        const result = await response.json();
        revisionRef.current = Number.isInteger(result.boardRevision) ? result.boardRevision : revisionRef.current + 1;
        setSaveStatus("Saved");
        setTimeout(() => setSaveStatus((current) => (current === "Saved" ? "" : current)), 1800);
      } catch {
        setSaveStatus("Save failed");
      }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [board, isOwner, loadError, conflict]);

  const reload = useCallback(async () => {
    try {
      const response = await fetch(`/api/forge/scheduling/${projectId}`);
      if (!response.ok) {
        setLoadError(response.status === 404 ? "Project not found." : "Unable to load this project.");
        return;
      }
      const body = await response.json();
      lastLoadedBoardRef.current = body.board;
      revisionRef.current = Number.isInteger(body.board?.boardRevision) ? body.board.boardRevision : 0;
      setBoard(body.board);
      setIsOwner(body.isOwner);
      setLoadError(null);
      setConflict(false);
    } catch {
      setLoadError("Unable to load this project.");
    }
  }, [projectId]);

  return { board, setBoard, isOwner, loadError, saveStatus, conflict, conflictMessage: SAVE_CONFLICT_MESSAGE, reload };
}
