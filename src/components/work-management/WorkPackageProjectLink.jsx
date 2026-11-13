// PR B: the package -> FORGE project assignment block on the package
// detail Overview tab. The link never travels through the generic
// package PATCH — it goes through POST project-link (the
// forge_work_package_set_project RPC: capability conjunction,
// optimistic version CAS, request-id idempotency, audit receipt).
// The user picks a target in the cascading selector, sees the move in
// plain words, and confirms before anything is saved. A stale version
// is a 409 with a refresh prompt, never a silent overwrite.
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import HierarchyProjectSelector, { UNASSIGNED_VALUE } from "./HierarchyProjectSelector.jsx";
import { withWorkspaceQuery } from "./workspaceQuery.js";

function chainName(selection) {
  if (!selection) return "Unassigned";
  const parts = [selection.client?.name, selection.site?.name, selection.project?.name].filter(Boolean);
  return parts.length > 0 ? parts.join(" › ") : "Unassigned";
}

export default function WorkPackageProjectLink({
  packageId,
  packageCode,
  currentForgeProjectId = null,
  version,
  onLinked,
}) {
  const router = useRouter();
  const [currentName, setCurrentName] = useState(currentForgeProjectId ? "Loading…" : "Unassigned");
  const [picked, setPicked] = useState("");
  const [pickedName, setPickedName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // The current project's display name (Client › Site › Project) comes
  // from the validated selection endpoint — never from a stored label.
  // The name resets during render when the linked project changes
  // (React's derived-state-from-props pattern); the fetch only runs
  // while a project is actually linked.
  const [prevProjectId, setPrevProjectId] = useState(currentForgeProjectId);
  if (prevProjectId !== currentForgeProjectId) {
    setPrevProjectId(currentForgeProjectId);
    setCurrentName(currentForgeProjectId ? "Loading…" : "Unassigned");
  }
  useEffect(() => {
    if (!currentForgeProjectId) return undefined;
    let cancelled = false;
    fetch(withWorkspaceQuery(`/api/forge/hierarchy?projectId=${encodeURIComponent(currentForgeProjectId)}`))
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Could not load the project.");
        return body.selection;
      })
      .then((selection) => { if (!cancelled) setCurrentName(chainName(selection)); })
      .catch(() => { if (!cancelled) setCurrentName("Project (no longer available)"); });
    return () => { cancelled = true; };
  }, [currentForgeProjectId]);

  function handleSelect(nextPicked, chain) {
    setPicked(nextPicked);
    setPickedName(nextPicked === UNASSIGNED_VALUE ? "Unassigned" : chainName(chain));
    setConfirming(false);
    setMessage("");
    setError("");
  }

  const pickedTarget = picked === UNASSIGNED_VALUE ? null : picked || null;
  const changed = picked !== ""
    && (pickedTarget ?? null) !== (currentForgeProjectId ?? null);

  async function save() {
    if (!changed || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        withWorkspaceQuery(`/api/work-packages/${encodeURIComponent(packageId)}/project-link`),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            forgeProjectId: pickedTarget,
            expectedVersion: version,
            requestId: crypto.randomUUID(),
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not save the project link.");
      const nextPackage = body.package || null;
      setMessage(
        pickedTarget
          ? `${packageCode} is now assigned to ${pickedName}.`
          : `${packageCode} is now unassigned.`,
      );
      setConfirming(false);
      setPicked("");
      if (onLinked) onLinked(nextPackage);
      // The package now lives under a different scope: move the page
      // there so the detail view and its panels keep reading the same
      // scope the package belongs to.
      const search = new URLSearchParams(window.location.search);
      const currentScope = search.get("forgeProject");
      const nextScope = pickedTarget || UNASSIGNED_VALUE;
      if (currentScope !== nextScope) {
        search.set("forgeProject", nextScope);
        router.push(`/forge/work/${encodeURIComponent(packageId)}?${search.toString()}`);
        router.refresh();
      }
    } catch (caught) {
      setError(caught?.message || "Could not save the project link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Project assignment" data-testid="work-package-project-link"
      className="mt-6 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Project assignment</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Currently assigned to: <span className="font-medium text-slate-900 dark:text-slate-100">{currentName}</span>
      </p>
      <div className="mt-3">
        <HierarchyProjectSelector
          value=""
          onSelect={handleSelect}
          idPrefix="work-package-project-link"
        />
      </div>
      {picked !== "" && !confirming && (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => setConfirming(true)} disabled={!changed || busy}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {pickedTarget ? `Assign to ${pickedName}` : "Unassign from project"}
          </button>
          <button type="button" onClick={() => { setPicked(""); setPickedName(""); }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            Cancel
          </button>
          {!changed && <span className="text-sm text-slate-500">That is already the current assignment.</span>}
        </div>
      )}
      {confirming && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/30">
          <p className="text-sm text-slate-800 dark:text-slate-100">
            {pickedTarget
              ? `Move ${packageCode} from ${currentName} to ${pickedName}? Its steps, schedule, and budget move with it — nothing else changes.`
              : `Remove ${packageCode} from ${currentName}? It will appear in the Unassigned packages inbox.`}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={save} disabled={busy}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
              {busy ? "Saving…" : "Confirm"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              Back
            </button>
          </div>
        </div>
      )}
      {message && <p role="status" className="mt-3 text-sm font-medium text-emerald-700">{message}</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}{" "}
          {error.includes("changed while you were editing") && (
            <button type="button" onClick={() => router.refresh()} className="font-medium underline">
              Refresh the page and try again
            </button>
          )}
        </p>
      )}
    </section>
  );
}
