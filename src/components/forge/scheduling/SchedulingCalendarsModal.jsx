"use client";
import { useState } from "react";
import { WEEKDAY_LABELS } from "./schedulingBoardState";

export default function SchedulingCalendarsModal({
  board, onClose, onAddCalendar, onRemoveCalendar, onSetDefaultCalendar, onAddBlackout, onRemoveBlackout,
}) {
  const [draftName, setDraftName] = useState("");
  const [draftDays, setDraftDays] = useState(() => new Set([1, 2, 3, 4, 5]));
  const [blackoutDraft, setBlackoutDraft] = useState({ label: "", startDate: "", endDate: "" });

  function toggleDraftDay(day) {
    setDraftDays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  }

  function handleAddCalendar() {
    if (!draftName.trim() || draftDays.size === 0) return;
    onAddCalendar({ name: draftName, workingDays: [...draftDays] });
    setDraftName("");
    setDraftDays(new Set([1, 2, 3, 4, 5]));
  }

  function handleAddBlackout() {
    if (!blackoutDraft.label.trim() || !blackoutDraft.startDate || !blackoutDraft.endDate) return;
    onAddBlackout(blackoutDraft);
    setBlackoutDraft({ label: "", startDate: "", endDate: "" });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose} data-scheduling-calendars>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 text-slate-950 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-amber-700">Scheduling</p>
            <h2 className="mt-1 text-xl font-black">Calendars &amp; blackout windows</h2>
            <p className="mt-1 text-sm text-slate-500">Assign a work calendar per lane on the board. TA blackout windows gray out every lane, regardless of calendar.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100">Close</button>
        </div>

        <div className="mt-5">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Work calendars</h3>
          <ul className="mt-2 space-y-1.5">
            {board.calendars.map((calendar) => {
              const isDefault = calendar.id === board.defaultCalendarId;
              return (
                <li key={calendar.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                  <div>
                    <p className="text-sm font-bold">
                      {calendar.name}
                      {isDefault && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">DEFAULT</span>}
                    </p>
                    <p className="text-xs text-slate-500">{calendar.workingDays.map((d) => WEEKDAY_LABELS[d]).join(", ")}</p>
                  </div>
                  {!isDefault && (
                    <div className="flex shrink-0 items-center gap-2">
                      <button type="button" onClick={() => onSetDefaultCalendar(calendar.id)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-bold hover:bg-slate-100">Set default</button>
                      <button type="button" onClick={() => onRemoveCalendar(calendar.id)}
                        className="rounded border border-red-300 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50">Delete</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-600">Add a custom calendar</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Calendar name (e.g. 3-12s)"
                className="rounded border border-slate-300 px-2 py-1 text-sm" />
              {WEEKDAY_LABELS.map((label, day) => (
                <label key={label} className="flex items-center gap-1 text-xs font-semibold text-slate-600">
                  <input type="checkbox" checked={draftDays.has(day)} onChange={() => toggleDraftDay(day)} />
                  {label}
                </label>
              ))}
              <button type="button" onClick={handleAddCalendar} disabled={!draftName.trim() || draftDays.size === 0}
                className="rounded bg-slate-950 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Add calendar</button>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">TA blackout windows</h3>
          <p className="mt-1 text-xs text-slate-500">Date ranges no lane works, regardless of calendar -- grayed out across the whole board.</p>
          <ul className="mt-2 space-y-1.5">
            {board.blackoutWindows.length === 0 && <p className="text-xs text-slate-400">No blackout windows yet.</p>}
            {board.blackoutWindows.map((blackout) => (
              <li key={blackout.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                <div>
                  <p className="text-sm font-bold">{blackout.label}</p>
                  <p className="text-xs text-slate-500">{blackout.startDate} &rarr; {blackout.endDate}</p>
                </div>
                <button type="button" onClick={() => onRemoveBlackout(blackout.id)}
                  className="rounded border border-red-300 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50">Delete</button>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
            <label className="flex flex-col text-xs font-bold text-slate-600">
              Label
              <input value={blackoutDraft.label} onChange={(e) => setBlackoutDraft((c) => ({ ...c, label: e.target.value }))}
                placeholder="e.g. Contract blackout" className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm font-normal" />
            </label>
            <label className="flex flex-col text-xs font-bold text-slate-600">
              Start
              <input type="date" value={blackoutDraft.startDate} onChange={(e) => setBlackoutDraft((c) => ({ ...c, startDate: e.target.value }))}
                className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm font-normal" />
            </label>
            <label className="flex flex-col text-xs font-bold text-slate-600">
              End
              <input type="date" value={blackoutDraft.endDate} onChange={(e) => setBlackoutDraft((c) => ({ ...c, endDate: e.target.value }))}
                className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm font-normal" />
            </label>
            <button type="button" onClick={handleAddBlackout} disabled={!blackoutDraft.label.trim() || !blackoutDraft.startDate || !blackoutDraft.endDate}
              className="rounded bg-slate-950 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Add blackout</button>
          </div>
        </div>
      </div>
    </div>
  );
}
