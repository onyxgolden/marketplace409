import { Suspense } from "react";
import WorkspaceShell from "@/components/workspace-shell";
import PlannerNavBar from "@/components/work-management/PlannerNavBar";
import PlannerProjectScopeBar from "@/components/work-management/PlannerProjectScopeBar";

// Promoted out of Forge's own ForgeApplicationRail into its own sibling
// workspace (PROMOTED_PREFIXES in ForgeApplicationRail.jsx already includes
// "/forge/work" and "/forge/work-packages") the same way /forge/rental and
// /forge/scheduling were — but, unlike every other promoted app, this
// subtree never got its own nested layout supplying WorkspaceShell. The
// rail steps aside as designed; nothing replaced it, so every Planner page
// rendered with no cross-workspace chrome at all (no sidebar, no header, no
// account menu, no "All apps" link) — a real gap, not a deliberate minimal
// design. This closes it the same way Rental/Scheduling/Designer/Developer
// already did.
//
// PlannerNavBar adds the within-Planner persistent nav (Work Packages,
// Document library, Admin, New package) that WorkspaceShell doesn't know
// about — it only handles cross-app chrome, not a single app's own views.
export default function WorkPackagePlannerLayout({ children }) {
  return (
    <WorkspaceShell forgeCommandPalette>
      <Suspense fallback={null}>
        <PlannerProjectScopeBar />
      </Suspense>
      <Suspense fallback={null}>
        <PlannerNavBar />
      </Suspense>
      {children}
    </WorkspaceShell>
  );
}
