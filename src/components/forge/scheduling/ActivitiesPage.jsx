"use client";
import { useState } from "react";
import Link from "next/link";
import { usePersistedBoard } from "./usePersistedBoard";
import { addActivity, moveActivity, removeActivity, updateActivity, wbsChildren } from "./wbsState";

function NavTabs({ projectId, active }) {
  const tabs = [
    { key: "gantt", label: "Gantt Chart", href: `/forge/scheduling/${projectId}` },
    { key: "wbs", label: "WBS", href: `/forge/scheduling/${projectId}/wbs` },
    { key: "activities", label: "Activities", href: `/forge/scheduling/${projectId}/activities` },
  ];
  return (
    <div className="flex items-center gap-1" data-scheduling-wbs-nav>
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href}
          className={`rounded border px-3 py-1.5 text-sm font-bold ${tab.key === active
            ? "border-amber-500 bg-amber-500 text-slate-950" : "border-slate-700 text-white hover:bg-slate-800"}`}>
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

// Flat -- not indented by WBS depth -- since a project can have many WBS elements at
// varying depths; the WBS column says which element an activity belongs to without forcing
// the table itself into a tree layout. The WBS page is where the hierarchy lives.
function flattenWbsNodes(board, parentId = null, depth = 0) {
  return wbsChildren(board, parentId).flatMap((node) => [
    { id: node.id, name: node.name, depth },
    ...flattenWbsNodes(board, node.id, depth + 1),
  ]);
}

export default function ActivitiesPage({ projectId }) {
  const { board, setBoard, isOwner, loadError, saveStatus } = usePersistedBoard(projectId);
  const [draft, setDraft] = useState({ wbsId: "", name: "", durationWeeks: 1 });

  function mutate(fn) {
    setBoard((current) => fn(current));
  }

  function handleAddActivity() {
    if (!draft.wbsId || !draft.name.trim()) return;
    mutate((current) => addActivity(current, draft.wbsId, { name: draft.name, durationWeeks: draft.durationWeeks }));
    setDraft((current) => ({ ...current, name: "" }));
  }

  if (loadError) {
    return (
      <section className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white shadow-sm" data-scheduling-activities data-scheduling-load-error>
        <p className="text-sm font-bold text-slate-600">{loadError}</p>
        <Link href="/forge/scheduling" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100">Back to Projects</Link>
      </section>
    );
  }

  const wbsNodes = flattenWbsNodes(board);
  const wbsNameById = Object.fromEntries(wbsNodes.map((node) => [node.id, node.name]));
  const activities = [...board.wbs.activities].sort((a, b) => (wbsNameById[a.wbsId] || "").localeCompare(wbsNameById[b.wbsId] || "") || a.order - b.order);

  return (
    <section className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-scheduling-activities>
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
        <div className="mr-2">
          <h1 className="text-base font-black">{board.projectName}</h1>
          <span className="font-mono text-[11px] text-slate-400">activities</span>
        </div>
        <NavTabs projectId={projectId} active="activities" />
        <div className="flex-1" />
        <span role="status" className="min-w-[70px] font-mono text-xs text-emerald-400">{saveStatus}</span>
        {!isOwner && (
          <span title="A shared reference example -- your edits here won't be saved" data-scheduling-readonly-badge
            className="rounded-full bg-amber-900/60 px-2.5 py-1 text-[11px] font-bold text-amber-200">Read-only example</span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {wbsNodes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Activities are assigned to a WBS element. <Link href={`/forge/scheduling/${projectId}/wbs`} className="font-bold text-amber-700 hover:underline">Add one on the WBS page</Link> first.
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
              <label className="flex flex-col text-xs font-bold text-slate-600">
                WBS element
                <select value={draft.wbsId} onChange={(e) => setDraft((c) => ({ ...c, wbsId: e.target.value }))}
                  className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm font-normal">
                  <option value="">Select...</option>
                  {wbsNodes.map((node) => (<option key={node.id} value={node.id}>{"— ".repeat(node.depth)}{node.name}</option>))}
                </select>
              </label>
              <label className="flex flex-col text-xs font-bold text-slate-600">
                Activity name
                <input value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} placeholder="e.g. Pour footings"
                  className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm font-normal" />
              </label>
              <label className="flex flex-col text-xs font-bold text-slate-600">
                Duration (weeks)
                <input type="number" min={1} max={52} value={draft.durationWeeks} onChange={(e) => setDraft((c) => ({ ...c, durationWeeks: Number(e.target.value) }))}
                  className="mt-1 w-24 rounded border border-slate-300 px-2 py-1.5 text-sm font-normal" />
              </label>
              <button type="button" onClick={handleAddActivity} disabled={!draft.wbsId || !draft.name.trim()}
                className="rounded bg-slate-950 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">+ Add activity</button>
            </div>

            {activities.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                No activities yet. Add one above.
              </div>
            ) : (
              <table className="w-full table-fixed text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-black uppercase tracking-wide text-slate-500">
                    <th className="w-24 py-2">Activity ID</th>
                    <th className="w-1/4 py-2">WBS element</th>
                    <th className="w-1/3 py-2">Activity</th>
                    <th className="py-2">Duration (wks)</th>
                    <th className="py-2">% Complete</th>
                    <th className="w-10 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {activities.map((activity) => (
                    <tr key={activity.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3">
                        <span onDoubleClick={() => { const code = window.prompt("Activity ID", activity.code); if (code) mutate((current) => updateActivity(current, activity.id, { code })); }}
                          title="Double-click to edit the Activity ID" className="cursor-text rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-600">{activity.code}</span>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        <select value={activity.wbsId} onChange={(e) => mutate((current) => moveActivity(current, activity.id, e.target.value))}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs">
                          {wbsNodes.map((node) => (<option key={node.id} value={node.id}>{"— ".repeat(node.depth)}{node.name}</option>))}
                        </select>
                      </td>
                      <td className="py-2 pr-3 font-bold text-slate-950">
                        <span onDoubleClick={() => { const name = window.prompt("Rename activity", activity.name); if (name) mutate((current) => updateActivity(current, activity.id, { name })); }}
                          title="Double-click to rename" className="cursor-text">{activity.name}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <input type="number" min={1} max={52} value={activity.durationWeeks}
                          onChange={(e) => mutate((current) => updateActivity(current, activity.id, { durationWeeks: e.target.value }))}
                          className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" />
                      </td>
                      <td className="py-2 pr-3">
                        <input type="number" min={0} max={100} value={activity.percentComplete}
                          onChange={(e) => mutate((current) => updateActivity(current, activity.id, { percentComplete: e.target.value }))}
                          className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" />
                      </td>
                      <td className="py-2 text-right">
                        <button type="button" onClick={() => mutate((current) => removeActivity(current, activity.id))} title="Delete activity"
                          className="font-bold text-slate-400 hover:text-red-600">&#10005;</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </section>
  );
}
