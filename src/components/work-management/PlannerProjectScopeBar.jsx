// PR B: the Planner-wide project-scope bar (Client -> Site -> Project
// selector + Unassigned inbox entry), rendered by the Planner layout
// above the nav bar. Picking a project navigates to the package list
// under that project; picking Unassigned opens the Unassigned packages
// inbox; clearing the selection opens the chooser. The current
// ?forgeProject= value is read from the URL — the server revalidates
// it on every load, so a stale or forged value never silently
// substitutes another project.
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import HierarchyProjectSelector from "./HierarchyProjectSelector.jsx";

export default function PlannerProjectScopeBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const forgeProject = searchParams.get("forgeProject") || "";

  function handleSelect(value) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set("forgeProject", value);
    else next.delete("forgeProject");
    const query = next.toString();
    router.push(query ? `/forge/work?${query}` : "/forge/work");
  }

  return (
    <div className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="mx-auto w-full max-w-7xl px-4 py-2">
        <HierarchyProjectSelector value={forgeProject} onSelect={handleSelect} idPrefix="planner-scope" />
      </div>
    </div>
  );
}
