// Work Package Planner editable grid — shared grid-edit cell (Maximo
// Grid edit pattern).
//
// Double-click a cell to edit it (single-click selects the row).
// Dropdown where the value is fixed, text/number/date input where it
// isn't. Enter/Tab/blur commits; Esc cancels; an unchanged value never
// commits. A failed commit reverts the cell and reports the message to
// the grid (onError) — the cell never shows a stale value.
//
// Read-only cells never enter edit mode: the ID columns (package #,
// step #) and computed columns (budget, % complete) render as plain
// text through this component with readOnly set.
"use client";

import { useRef, useState } from "react";

function inputValueFor(value, editor) {
  if (value == null) return "";
  if (editor === "date") return String(value).slice(0, 10);
  return String(value);
}

export default function EditableGridCell({
  value,
  display,
  editor = "text",
  options = [],
  placeholder = "",
  readOnly = false,
  ariaLabel,
  onCommit,
  onError,
  validate,
  formatValue,
  className = "",
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const cancelRef = useRef(false);
  const committedRef = useRef(false);

  function startEdit() {
    if (readOnly) return;
    cancelRef.current = false;
    committedRef.current = false;
    setDraft(inputValueFor(value, editor));
    setEditing(true);
  }

  function exit() {
    setEditing(false);
    setSaving(false);
  }

  async function commit(nextDraft) {
    if (committedRef.current) return;
    committedRef.current = true;
    const raw = nextDraft ?? draft;
    const next = formatValue ? formatValue(raw) : raw;
    // Unchanged (including clearing to the same empty) — exit quietly.
    const current = inputValueFor(value, editor);
    if (next === current || (next == null && current === "")) {
      exit();
      return;
    }
    if (validate) {
      const problem = validate(next);
      if (problem) {
        if (onError) onError(problem);
        exit();
        return;
      }
    }
    setSaving(true);
    try {
      await onCommit(next);
      exit();
    } catch (e) {
      if (onError) onError(e?.message || "Could not save this change.");
      exit();
    }
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      cancelRef.current = true;
      exit();
      event.stopPropagation();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  }

  function onBlur() {
    // Esc sets the flag before blur fires; a second blur after a
    // select already committed must not commit again.
    if (cancelRef.current) return;
    commit();
  }

  if (!editing) {
    return (
      <div
        role="gridcell"
        tabIndex={readOnly ? undefined : 0}
        aria-label={ariaLabel}
        title={readOnly ? undefined : "Double-click to edit"}
        onDoubleClick={startEdit}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !readOnly) {
            event.preventDefault();
            startEdit();
          }
        }}
        className={`min-w-0 truncate ${readOnly ? "" : "cursor-pointer"} ${className}`}
      >
        {display}
      </div>
    );
  }

  const shared = {
    autoFocus: true,
    disabled: saving,
    "aria-label": ariaLabel,
    onKeyDown,
    onBlur,
    className: "w-full min-w-0 rounded border border-blue-600 bg-white px-1 py-0.5 text-sm text-slate-900",
  };

  if (editor === "select") {
    return (
      <div role="gridcell" className={`min-w-0 ${className}`}>
        <select
          {...shared}
          value={draft}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            commit(next);
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div role="gridcell" className={`min-w-0 ${className}`}>
      <input
        {...shared}
        type={editor === "number" ? "number" : editor === "date" ? "date" : "text"}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
      />
    </div>
  );
}
