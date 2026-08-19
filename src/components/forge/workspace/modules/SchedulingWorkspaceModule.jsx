import ForgeWorkspaceTile from "@/components/forge/workspace/ForgeWorkspaceTile";
import { WorkspaceModule } from "@/components/forge/workspace/composition/WorkspaceModule";
import { PROJECT_TEMPLATES } from "@/components/forge/scheduling/schedulingBoardState";

function renderSchedulingWorkspaceTile() {
  return (
    <ForgeWorkspaceTile
      eyebrow="Scheduling Application"
      title="Scheduling"
      detail="Gantt chart wall-boards for capital projects, home remodels, new construction, and commercial builds -- calendars, blackout windows, and dependency tracking included."
      href="/forge/scheduling"
      actionLabel="Open scheduling workspace"
      status={`${PROJECT_TEMPLATES.length} templates`}
    >
      <p className="text-sm leading-6 text-slate-600">
        Pick a project template, drag starter activities onto the board,
        and link dependencies to see the critical path.
      </p>
    </ForgeWorkspaceTile>
  );
}

export const SchedulingWorkspaceModule =
  new WorkspaceModule({
    moduleIdentity: "scheduling",
    displayName: "Scheduling",
    category: "scheduling",
    priority: 35,
    renderTile:
      renderSchedulingWorkspaceTile,
  });
