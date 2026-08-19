"use client";
import Link from "next/link";
import { usePersistedBoard } from "./usePersistedBoard";
import {
  MAX_WBS_DEPTH, activitiesForWbsNode, addWbsNode, deleteWbsNode, moveWbsNode, renameWbsNode, renameWbsNodeCode,
  reorderWbsNode, wbsTree,
} from "./wbsState";

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

export default function WbsPage({ projectId }) {
  const { board, setBoard, isOwner, loadError, saveStatus } = usePersistedBoard(projectId);

  function mutate(fn) {
    setBoard((current) => fn(current));
  }

  function handleAddRootNode() {
    const name = window.prompt("New WBS element name", "New Phase");
    if (name) mutate((current) => addWbsNode(current, { name, parentId: null }));
  }
  function handleAddChildNode(parentId) {
    const name = window.prompt("New WBS element name", "New Sub-phase");
    if (name) mutate((current) => addWbsNode(current, { name, parentId }));
  }
  function handleRenameNode(node) {
    const name = window.prompt("Rename WBS element", node.name);
    if (name) mutate((current) => renameWbsNode(current, node.id, name));
  }
  function handleEditCode(node) {
    const code = window.prompt("WBS code (e.g. 1.2, or your own scheme)", node.code);
    if (code) mutate((current) => renameWbsNodeCode(current, node.id, code));
  }
  function handleDeleteNode(node) {
    const activityCount = activitiesForWbsNode(board, node.id).length;
    const warning = activityCount > 0
      ? ` This also deletes ${activityCount} activit${activityCount === 1 ? "y" : "ies"} under it (and any of its sub-elements).`
      : " This also deletes any of its sub-elements.";
    if (window.confirm(`Delete "${node.name}"?${warning}`)) mutate((current) => deleteWbsNode(current, node.id));
  }
  function handleIndent(node, precedingSiblingId) {
    if (!precedingSiblingId) return;
    mutate((current) => moveWbsNode(current, node.id, precedingSiblingId));
  }
  function handleOutdent(node, grandparentId) {
    mutate((current) => moveWbsNode(current, node.id, grandparentId));
  }

  if (loadError) {
    return (
      <section className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white shadow-sm" data-scheduling-wbs data-scheduling-load-error>
        <p className="text-sm font-bold text-slate-600">{loadError}</p>
        <Link href="/forge/scheduling" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100">Back to Projects</Link>
      </section>
    );
  }

  const tree = wbsTree(board);

  return (
    <section className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-scheduling-wbs>
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
        <div className="mr-2">
          <h1 className="text-base font-black">{board.projectName}</h1>
          <span className="font-mono text-[11px] text-slate-400">work breakdown structure</span>
        </div>
        <NavTabs projectId={projectId} active="wbs" />
        <div className="flex-1" />
        <span role="status" className="min-w-[70px] font-mono text-xs text-emerald-400">{saveStatus}</span>
        {!isOwner && (
          <span title="A shared reference example -- your edits here won't be saved" data-scheduling-readonly-badge
            className="rounded-full bg-amber-900/60 px-2.5 py-1 text-[11px] font-bold text-amber-200">Read-only example</span>
        )}
        <button type="button" onClick={handleAddRootNode} className="rounded bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm font-bold hover:bg-slate-800">+ Add WBS element</button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tree.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No WBS elements yet. Click "+ Add WBS element" to start breaking the project down into phases.
          </div>
        )}
        <ul>
          {tree.map((node, index) => (
            <WbsNodeRow key={node.id} node={node} depth={0} precedingSiblingId={index > 0 ? tree[index - 1].id : null} grandparentId={null}
              onAddChild={handleAddChildNode} onRename={handleRenameNode} onEditCode={handleEditCode} onDelete={handleDeleteNode}
              onReorder={(n, direction) => mutate((current) => reorderWbsNode(current, n.id, direction))}
              onIndent={handleIndent} onOutdent={handleOutdent} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function WbsNodeRow({ node, depth, precedingSiblingId, grandparentId, onAddChild, onRename, onEditCode, onDelete, onReorder, onIndent, onOutdent }) {
  const activityCount = node.activities.length;
  const atMaxDepth = depth + 1 >= MAX_WBS_DEPTH;
  return (
    <li>
      <div className="flex items-center gap-1.5 rounded px-2 py-1.5 text-sm hover:bg-slate-50" style={{ paddingLeft: depth * 24 + 8 }}>
        <span className="inline-block h-2 w-2 shrink-0 rotate-45 rounded-sm bg-indigo-500" />
        <span onDoubleClick={() => onEditCode(node)} title="Double-click to edit the WBS code"
          className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-600">{node.code}</span>
        <span onDoubleClick={() => onRename(node)} title="Double-click to rename" className="flex-1 cursor-text font-bold text-slate-950">
          {node.name}
        </span>
        {activityCount > 0 && (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">{activityCount} activit{activityCount === 1 ? "y" : "ies"}</span>
        )}
        <button type="button" onClick={() => onOutdent(node, grandparentId)} disabled={depth === 0} title="Outdent (move up a level)"
          className="rounded px-1.5 text-xs font-bold text-slate-400 hover:text-slate-700 disabled:opacity-30">&larr;</button>
        <button type="button" onClick={() => onIndent(node, precedingSiblingId)} disabled={!precedingSiblingId} title="Indent (move under the element above)"
          className="rounded px-1.5 text-xs font-bold text-slate-400 hover:text-slate-700 disabled:opacity-30">&rarr;</button>
        <button type="button" onClick={() => onReorder(node, -1)} title="Move up" className="rounded px-1.5 text-xs font-bold text-slate-400 hover:text-slate-700">&uarr;</button>
        <button type="button" onClick={() => onReorder(node, 1)} title="Move down" className="rounded px-1.5 text-xs font-bold text-slate-400 hover:text-slate-700">&darr;</button>
        <button type="button" onClick={() => onAddChild(node.id)} disabled={atMaxDepth} title={atMaxDepth ? `Sub-elements are limited to ${MAX_WBS_DEPTH} levels deep` : "Add sub-element"}
          className="rounded px-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-50 disabled:opacity-30">+</button>
        <button type="button" onClick={() => onDelete(node)} title="Delete" className="rounded px-1.5 text-xs font-bold text-red-500 hover:bg-red-50">&#10005;</button>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child, index) => (
            <WbsNodeRow key={child.id} node={child} depth={depth + 1}
              precedingSiblingId={index > 0 ? node.children[index - 1].id : null} grandparentId={node.parentId}
              onAddChild={onAddChild} onRename={onRename} onEditCode={onEditCode} onDelete={onDelete}
              onReorder={onReorder} onIndent={onIndent} onOutdent={onOutdent} />
          ))}
        </ul>
      )}
    </li>
  );
}
