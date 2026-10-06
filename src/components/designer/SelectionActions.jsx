"use client";

import { ClipboardPaste, Copy, CopyPlus, FlipHorizontal2, FlipVertical2 } from "lucide-react";

// Copy, paste, duplicate, and flip for whatever is selected. Delete stays on
// each panel's own Delete button. Same actions as Ctrl+C / Ctrl+V / Ctrl+D.
const buttonClass = "flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-40";

export default function SelectionActions({ dispatch, canPaste = false }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" title="Copy (Ctrl+C)" aria-label="Copy"
        onClick={() => dispatch({ type: "COPY_SELECTION" })} className={buttonClass}>
        <Copy size={13} /> Copy
      </button>
      <button type="button" title="Paste (Ctrl+V)" aria-label="Paste" disabled={!canPaste}
        onClick={() => dispatch({ type: "PASTE_CLIPBOARD" })} className={buttonClass}>
        <ClipboardPaste size={13} /> Paste
      </button>
      <button type="button" title="Duplicate (Ctrl+D)" aria-label="Duplicate"
        onClick={() => dispatch({ type: "DUPLICATE_SELECTION" })} className={buttonClass}>
        <CopyPlus size={13} /> Duplicate
      </button>
      <button type="button" title="Flip left to right" aria-label="Flip left-right"
        onClick={() => dispatch({ type: "FLIP_SELECTION", axis: "horizontal" })} className={buttonClass}>
        <FlipHorizontal2 size={13} /> Flip left-right
      </button>
      <button type="button" title="Flip top to bottom" aria-label="Flip up-down"
        onClick={() => dispatch({ type: "FLIP_SELECTION", axis: "vertical" })} className={buttonClass}>
        <FlipVertical2 size={13} /> Flip up-down
      </button>
    </div>
  );
}
