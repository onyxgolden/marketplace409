import ForgeSystemHealth from "@/components/forge/ForgeSystemHealth";
import ForgeSystemStatus from "@/components/forge/ForgeSystemStatus";
import ForgeWorkspaceTile from "@/components/forge/workspace/ForgeWorkspaceTile";
import { WorkspaceModule } from "@/components/forge/workspace/composition/WorkspaceModule";

function renderForgeOperatingSystemWorkspaceTile({
  systemHealthItems,
  systemStatusItems,
}) {
  return (
    <ForgeWorkspaceTile
      eyebrow="Operating System"
      title="FORGE OS"
      detail="Runtime status and system health supporting the authenticated workbench."
      status="Active"
      span="wide"
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <ForgeSystemStatus
            statusItems={systemStatusItems}
            variant="embedded"
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <ForgeSystemHealth
            healthItems={systemHealthItems}
            variant="embedded"
          />
        </div>
      </div>
    </ForgeWorkspaceTile>
  );
}

export const ForgeOperatingSystemWorkspaceModule =
  new WorkspaceModule({
    moduleIdentity: "forge-operating-system",
    displayName: "FORGE OS",
    category: "operating-system",
    priority: 40,
    renderTile:
      renderForgeOperatingSystemWorkspaceTile,
  });
