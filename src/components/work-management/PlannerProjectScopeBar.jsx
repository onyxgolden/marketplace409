// PR B: the Planner-wide project-scope bar (Client -> Site -> Project
// selector + Unassigned inbox entry), rendered by the Planner layout
// above the nav bar. Picking a project navigates to the package list
// under that project; picking Unassigned opens the Unassigned packages
// inbox; clearing the selection opens the chooser. The current
// ?forgeProject= value is read from the URL — the server revalidates
// it on every load, so a stale or forged value never silently
// substitutes another project.
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import HierarchyProjectSelector from "./HierarchyProjectSelector.jsx";
import PlannerAddHierarchyButtons from "./PlannerAddHierarchyButtons.jsx";

export default function PlannerProjectScopeBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const forgeProject = searchParams.get("forgeProject") || "";
  // A just-created client/site has no forgeProject to select, so the
  // selector preselects it directly instead (PR #848 review, P1: the
  // planner must land on what was just created). refreshKey forces the
  // selector to refetch so the new record is actually there to pick.
  const [pendingSelection, setPendingSelection] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function handleSelect(value) {
    setPendingSelection(null);
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set("forgeProject", value);
    else next.delete("forgeProject");
    const query = next.toString();
    router.push(query ? `/forge/work?${query}` : "/forge/work");
  }

  function handleCreated(entity, saved) {
    if (entity === "project") return; // handled by onProjectCreated's navigation
    setRefreshKey((key) => key + 1);
    setPendingSelection(
      entity === "client" ? { clientId: saved.id, siteId: "" } : { clientId: saved.clientId, siteId: saved.id },
    );
  }

  return (
    <div className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-end gap-3 px-4 py-2">
        <HierarchyProjectSelector
          value={forgeProject}
          onSelect={handleSelect}
          idPrefix="planner-scope"
          pendingSelection={pendingSelection}
          refreshKey={refreshKey}
        />
        <PlannerAddHierarchyButtons onCreated={handleCreated} onProjectCreated={handleSelect} />
      </div>
    </div>
  );
}
