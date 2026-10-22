"use client";

// Systems UI: the Systems manager (side panel, nothing selected) and the
// System / Color / Underground section of the pipe and equipment
// inspectors. Validation lives in designSystems; these panels only offer
// valid input and the reducer fails soft as the backstop.

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { SYSTEM_PALETTE, effectiveColor } from "@/domains/roomDesigner/designSystems";

const inputClass = "mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-xs text-white";
const smallButton = "rounded bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-40";

function nameTaken(systems, name, exceptId) {
  const key = name.trim().toLowerCase();
  return systems.some((s) => s.id !== exceptId && s.name.toLowerCase() === key);
}

function nextPaletteColor(systems) {
  const used = new Set(systems.map((s) => s.color));
  return SYSTEM_PALETTE.find((c) => !used.has(c)) || SYSTEM_PALETTE[systems.length % SYSTEM_PALETTE.length];
}

/** Inline "name + color + Add" form; onAdd(name, color). */
function NewSystemForm({ systems, onAdd, onCancel, autoFocus = false }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(() => nextPaletteColor(systems));
  const taken = name.trim() !== "" && nameTaken(systems, name);
  const ok = name.trim() !== "" && !taken;
  const submit = (e) => {
    e.preventDefault();
    if (!ok) return;
    onAdd(name.trim(), color);
    setName("");
    setColor(nextPaletteColor([...systems, { color }]));
  };
  return (
    <form onSubmit={submit} className="mt-2 space-y-1" aria-label="New system">
      <div className="flex gap-1">
        <input
          type="text" value={name} maxLength={60} autoFocus={autoFocus}
          placeholder="e.g. Cooling water" aria-label="New system name"
          onChange={(e) => setName(e.target.value)}
          className="block w-full rounded bg-gray-800 px-2 py-1 text-xs text-white placeholder:text-gray-600"
        />
        <input type="color" value={color} aria-label="New system color" onChange={(e) => setColor(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded bg-gray-800" />
      </div>
      <div className="flex flex-wrap gap-1" aria-label="Palette">
        {SYSTEM_PALETTE.map((c) => (
          <button key={c} type="button" aria-label={`Use ${c}`} onClick={() => setColor(c)}
            className={`h-4 w-4 rounded-sm ${c === color ? "ring-2 ring-white" : ""}`} style={{ background: c }} />
        ))}
      </div>
      {taken && <p className="text-[11px] text-amber-300">A system with that name already exists.</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={!ok} className={smallButton}><Plus size={12} className="inline" /> Add system</button>
        {onCancel && <button type="button" onClick={onCancel} className="text-[11px] text-gray-400 hover:text-gray-200">Cancel</button>}
      </div>
    </form>
  );
}

/** Side-panel manager: list, rename, recolor, delete, add. */
export function SystemsSection({ design, dispatch }) {
  const systems = design.systems || [];
  const members = (id) => [...(design.pipes || []), ...(design.symbols || [])].filter((m) => m.systemId === id).length;
  return (
    <div className="mt-4 border-t border-gray-800 pt-3" data-testid="systems-section">
      <h2 className="mb-1 text-sm font-semibold text-white">Systems</h2>
      <p className="mb-2 text-[11px] leading-relaxed text-gray-500">
        Group pipes and equipment into systems (cooling water, steam…). Everything in a system draws in its color;
        any item can still take its own color from its inspector.
      </p>
      <ul className="space-y-1">
        {systems.map((s) => (
          <li key={s.id} className="flex items-center gap-1">
            <input type="color" value={s.color} aria-label={`Color of ${s.name}`}
              onChange={(e) => dispatch({ type: "UPDATE_SYSTEM", systemId: s.id, fields: { color: e.target.value }, coalesce: `system-color:${s.id}` })}
              className="h-6 w-8 cursor-pointer rounded bg-gray-800" />
            <input type="text" defaultValue={s.name} key={s.name} maxLength={60} aria-label={`Name of ${s.name}`}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== s.name && !nameTaken(systems, v, s.id)) dispatch({ type: "UPDATE_SYSTEM", systemId: s.id, fields: { name: v } });
                else e.target.value = s.name;
              }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              className="block w-full rounded bg-gray-800 px-2 py-1 text-xs text-white" />
            <span className="w-6 text-right text-[11px] text-gray-500" title="Items in this system">{members(s.id)}</span>
            <button type="button" aria-label={`Delete system ${s.name}`} title="Delete system (its items stay, unassigned)"
              onClick={() => dispatch({ type: "DELETE_SYSTEM", systemId: s.id })}
              className="rounded p-1 text-gray-400 hover:bg-red-900/60 hover:text-red-200">
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ul>
      <NewSystemForm systems={systems} onAdd={(name, color) => dispatch({ type: "ADD_SYSTEM", name, color })} />
    </div>
  );
}

/**
 * Inspector section for a pipe run (kind "pipe") or symbol (kind "symbol"):
 * system membership, own color (with reset), and — pipes only — underground.
 */
export function SystemMembershipSection({ design, kind, member, fallbackColor, dispatch }) {
  const [creating, setCreating] = useState(false);
  const systems = design.systems || [];
  const target = { kind, id: member.id };
  const shown = effectiveColor(design, member, fallbackColor);
  return (
    <div className="space-y-2 border-t border-gray-800 pt-2" data-testid="system-membership">
      <label className="block text-xs text-gray-400">
        System
        <select
          value={creating ? "__new" : member.systemId || ""}
          onChange={(e) => {
            if (e.target.value === "__new") return setCreating(true);
            setCreating(false);
            dispatch({ type: "SET_MEMBER_SYSTEM", target, systemId: e.target.value || null });
          }}
          className={inputClass}
        >
          <option value="">— none —</option>
          {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="__new">+ New system…</option>
        </select>
      </label>
      {creating && (
        <NewSystemForm systems={systems} autoFocus onCancel={() => setCreating(false)}
          onAdd={(name, color) => { dispatch({ type: "ADD_SYSTEM", name, color, assignTo: target }); setCreating(false); }} />
      )}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span>Color</span>
        <input type="color" value={shown} aria-label="Item color"
          onChange={(e) => dispatch({ type: "SET_MEMBER_COLOR", target, color: e.target.value, coalesce: `color:${member.id}` })}
          className="h-6 w-8 cursor-pointer rounded bg-gray-800" />
        <span className="text-[11px] text-gray-500">
          {member.color ? "own color" : member.systemId ? "from system" : "default"}
        </span>
        {member.color && (
          <button type="button" onClick={() => dispatch({ type: "SET_MEMBER_COLOR", target, color: null })}
            className="text-[11px] text-emerald-300 underline">
            Reset
          </button>
        )}
      </div>
      {kind === "pipe" && (
        <label className="flex items-center gap-2 text-xs text-gray-300">
          <input type="checkbox" checked={!!member.underground}
            onChange={(e) => dispatch({ type: "SET_PIPE_UNDERGROUND", pipeId: member.id, underground: e.target.checked })} />
          Underground (dashed, tagged UG)
        </label>
      )}
    </div>
  );
}
