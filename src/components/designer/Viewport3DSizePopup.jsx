"use client";

import { useRef, useState } from "react";
import { feetInchesLabel } from "@/domains/roomDesigner/designerGeometry";
import { sizeEditAction, sizeFieldsForSelection } from "@/domains/roomDesigner/designer3DEditing";

/**
 * P1-B: the "change size" popup pinned to the selected entity in 3D.
 *
 * Shows the entity's dimensions and lets the user type a new one (12'6",
 * 150", 150). The viewport owns WHERE it sits (it projects the anchor every
 * frame and moves this element directly); this component owns only WHAT it
 * shows. Validation and the resulting action come from the pure domain
 * layer (sizeEditAction), so nothing out-of-range ever reaches the reducer.
 */
export default function Viewport3DSizePopup({ selection, design, dispatch }) {
  const info = sizeFieldsForSelection(selection, design);
  if (!info) return null;
  return (
    <div
      data-testid="viewport3d-size-popup"
      className="rounded-md border border-emerald-500/60 bg-gray-900/95 px-2.5 py-2 text-xs text-gray-200 shadow-lg"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 font-semibold text-emerald-300">{info.title}</div>
      {info.fields.map((field) => (
        // Keyed on the committed value: when the design changes (a drag, an
        // undo, an edit in 2D) the field resets to show the new dimension.
        <SizeField
          key={`${selection.kind}:${selection.id}:${field.key}:${field.valueIn}`}
          field={field}
          onCommit={(text) => sizeEditAction(selection, design, field.key, text)}
          dispatch={dispatch}
        />
      ))}
    </div>
  );
}

function SizeField({ field, onCommit, dispatch }) {
  const initial = feetInchesLabel(field.valueIn);
  const [text, setText] = useState(initial);
  const [error, setError] = useState(null);
  // Escape blurs the input, and blur commits — but with the pre-reset text
  // still in this render's closure. The flag makes that blur a no-op.
  const cancelledRef = useRef(false);

  const commit = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    // The label rounds to whole inches; re-committing it unchanged would
    // silently round a 120.5" wall to 120". Only a real edit dispatches.
    if (text.trim() === initial) {
      setError(null);
      return;
    }
    const result = onCommit(text);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    dispatch?.(result.action);
  };

  return (
    <label className="mb-1 block last:mb-0">
      <span className="mr-2 inline-block w-12 text-gray-400">{field.label}</span>
      <input
        aria-label={field.label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            cancelledRef.current = true;
            setText(initial);
            setError(null);
            e.currentTarget.blur();
          }
        }}
        className="w-20 rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-gray-100 focus:border-emerald-500 focus:outline-none"
      />
      {error && <span role="alert" className="mt-1 block max-w-[14rem] text-[11px] text-red-400">{error}</span>}
    </label>
  );
}
