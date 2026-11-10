import { Suspense } from "react";
import WorkspaceShell from "@/components/workspace-shell";
import PlannerNavBar from "@/components/work-management/PlannerNavBar";

// /forge/work-packages is the takeoff-page sibling of /forge/work (see
// src/lib/workspaces.js:89-98 — both belong to the same Planner workspace;
// the list/detail pages live under /forge/work, takeoff pages live here).
// PROMOTED_PREFIXES in ForgeApplicationRail.jsx already lists
// "/forge/work-packages" alongside "/forge/work", so the rail steps aside
// for this subtree too — and it had no nested layout of its own, so a
// takeoff page rendered with no cross-workspace chrome and no way out,
// same gap src/app/forge/work/layout.jsx just closed for the list/detail
// pages. This closes it the same way, for the same reason.
export default function WorkPackagesPlannerLayout({ children }) {
  return (
    <WorkspaceShell forgeCommandPalette>
      <Suspense fallback={null}>
        <PlannerNavBar />
      </Suspense>
      {children}
    </WorkspaceShell>
  );
}
