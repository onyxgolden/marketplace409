"use client";

import { useState } from "react";
import { detailedVersionFor } from "@/domains/roomDesigner/temaExchangerCatalog";
import { instanceDrawingMode } from "@/domains/roomDesigner/temaInstances";
import {
  TEMA_FRONT_HEADS,
  TEMA_PRESETS,
  TEMA_REAR_HEADS,
  TEMA_SHELLS,
  TEMA_TUBE_PASSES,
  normalizeTemaConfig,
  temaDesignation,
  validateTemaConfig,
} from "@/domains/roomDesigner/temaTypes";
import { drawTemaSymbol } from "./temaDrawRoutine";

// Inspector section for TEMA exchangers (and the simple symbols that have a
// detailed version). The picker edits a DRAFT configuration with a live
// preview; Apply saves it through SET_SYMBOL_TEMA. Blocked combinations
// explain why and cannot be applied; unusual ones show a warning.

const selectClass = "mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-xs text-white";
const PREVIEW_W = 240;

function TemaPreview({ symbol, instance }) {
  const widthIn = instance.widthIn ?? symbol.widthIn;
  const depthIn = instance.depthIn ?? symbol.depthIn;
  const scale = PREVIEW_W / widthIn;
  const h = depthIn * scale;
  const toScreen = () => ({ x: PREVIEW_W / 2 + 4, y: h / 2 + 4 });
  return (
    <svg data-testid="tema-preview" width="100%" viewBox={`0 0 ${PREVIEW_W + 8} ${h + 8}`} className="rounded bg-gray-950">
      {drawTemaSymbol({ symbol, instance: { ...instance, id: "preview", x: 0, y: 0, rotationDeg: 0, tag: undefined }, toScreen, scale, highlighted: false })}
    </svg>
  );
}

function TemaPicker({ symbol, instance, dispatch }) {
  const saved = normalizeTemaConfig(instance.tema) || { ...symbol.tema.defaultConfig };
  const [draft, setDraft] = useState(saved);
  const result = validateTemaConfig(draft);
  const changed = temaDesignation(draft) !== temaDesignation(saved) || draft.tubePasses !== saved.tubePasses;
  const set = (field) => (e) => setDraft({ ...draft, [field]: field === "tubePasses" ? Number(e.target.value) : e.target.value });
  const letterSelect = (label, field, types) => (
    <label className="block text-xs text-gray-400">
      {label}
      <select aria-label={label} value={draft[field]} onChange={set(field)} className={selectClass}>
        {types.map((t) => (
          <option key={t.letter} value={t.letter} title={t.description}>{t.letter} — {t.name}</option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-gray-400">TEMA type</span>
        <span data-testid="tema-designation" className="text-sm font-bold text-amber-300">
          {temaDesignation(draft)} · {draft.tubePasses} tube pass{draft.tubePasses === 1 ? "" : "es"}
        </span>
      </div>
      <div className="flex flex-wrap gap-1" aria-label="TEMA presets">
        {Object.entries(TEMA_PRESETS).map(([code, preset]) => (
          <button key={code} type="button" onClick={() => setDraft({ ...preset })}
            className="rounded bg-gray-800 px-2 py-0.5 text-xs text-white hover:bg-gray-700">
            {code}
          </button>
        ))}
      </div>
      {letterSelect("Front head", "front", TEMA_FRONT_HEADS)}
      {letterSelect("Shell", "shell", TEMA_SHELLS)}
      {letterSelect("Rear head", "rear", TEMA_REAR_HEADS)}
      <label className="block text-xs text-gray-400">
        Tube passes
        <select aria-label="Tube passes" value={String(draft.tubePasses)} onChange={set("tubePasses")} className={selectClass}>
          {TEMA_TUBE_PASSES.map((n) => <option key={n} value={String(n)}>{n}</option>)}
        </select>
      </label>
      <TemaPreview symbol={symbol} instance={{ ...instance, tema: draft }} />
      {result.errors.length > 0 && (
        <div role="alert" className="rounded bg-red-950/60 p-2 text-[11px] text-red-200">
          {result.errors.map((e) => <p key={e.rule} title={e.basis}>{e.message} {e.basis}</p>)}
        </div>
      )}
      {result.warnings.length > 0 && (
        <div data-testid="tema-warnings" className="rounded bg-amber-950/50 p-2 text-[11px] text-amber-200">
          {result.warnings.map((w) => <p key={w.rule}>{w.message} {w.basis}</p>)}
        </div>
      )}
      <button type="button" disabled={!result.valid || !changed}
        onClick={() => result.valid && dispatch({ type: "SET_SYMBOL_TEMA", symbolId: instance.id, config: normalizeTemaConfig(draft) })}
        className="w-full rounded bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40">
        Apply
      </button>
    </div>
  );
}

function SizeField({ label, value, onCommit }) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n > 0 && n !== value) onCommit(n);
    else setText(String(value));
  };
  return (
    <label className="block text-xs text-gray-400">
      {label}
      <input aria-label={label} type="number" min="1" value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        className={selectClass} />
    </label>
  );
}

export default function TemaSymbolSection({ symbol, instance, dispatch }) {
  if (!symbol || !instance) return null;
  if (!symbol.tema) {
    if (!detailedVersionFor(instance.domain, instance.symbolId)) return null;
    return (
      <div className="rounded border border-gray-700 p-2">
        <button type="button" onClick={() => dispatch({ type: "REPLACE_WITH_DETAILED", symbolId: instance.id })}
          className="w-full rounded bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700">
          Replace with detailed version
        </button>
        <p className="mt-1 text-[11px] text-gray-500">Swaps in the configurable TEMA exchanger; keeps position, rotation, size, tag and layer. Undo reverts it.</p>
      </div>
    );
  }
  const mode = instanceDrawingMode(symbol, instance);
  const widthIn = instance.widthIn ?? symbol.widthIn;
  const depthIn = instance.depthIn ?? symbol.depthIn;
  const t = symbol.tema;
  const pickerKey = `${instance.id}:${temaDesignation(instance.tema)}:${instance.tema?.tubePasses}`;
  return (
    <section aria-label="TEMA exchanger" className="space-y-2 rounded border border-gray-700 p-2">
      <div className="flex gap-1" role="group" aria-label="Drawing">
        {[["detailed", "Detailed"], ["pid", "P&ID"]].map(([value, label]) => (
          <button key={value} type="button" aria-pressed={mode === value}
            onClick={() => mode !== value && dispatch({ type: "SET_SYMBOL_DRAWING_MODE", symbolId: instance.id, mode: value })}
            className={`flex-1 rounded px-2 py-1 text-xs ${mode === value ? "bg-emerald-800 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
            {label}
          </button>
        ))}
      </div>
      {t.kind === "assembly" && <TemaPicker key={pickerKey} symbol={symbol} instance={instance} dispatch={dispatch} />}
      <div className="grid grid-cols-2 gap-2" key={`${instance.id}:${widthIn}:${depthIn}`}>
        <SizeField label="Length (in)" value={widthIn}
          onCommit={(n) => dispatch({ type: "SET_SYMBOL_SIZE", symbolId: instance.id, widthIn: n })} />
        <SizeField label="Diameter envelope (in)" value={depthIn}
          onCommit={(n) => dispatch({ type: "SET_SYMBOL_SIZE", symbolId: instance.id, depthIn: n })} />
      </div>
      <p className="text-[11px] text-gray-500">Original FORGE drawing based on TEMA nomenclature; planning layout only, not a certified design.</p>
    </section>
  );
}
