import ForgeWorkspaceTile from "@/components/forge/workspace/ForgeWorkspaceTile";
import { WorkspaceModule } from "@/components/forge/workspace/composition/WorkspaceModule";

function SystemMetric({
  label,
  value,
  detail,
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>

      <div className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">
        {value}
      </div>

      <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        {detail}
      </div>
    </div>
  );
}

function renderForgeOperatingSystemWorkspaceTile({
  systemHealthItems,
  systemStatusItems,
}) {
  const monitoredRuntimeCount =
    Array.isArray(systemStatusItems)
      ? systemStatusItems.length
      : 0;

  const healthSignalCount =
    Array.isArray(systemHealthItems)
      ? systemHealthItems.length
      : 0;

  return (
    <ForgeWorkspaceTile
      eyebrow="Operating System"
      title="FORGE OS"
      detail="Runtime awareness for the services supporting this authenticated workspace."
      status="Active"
      span="wide"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SystemMetric
          label="Runtime services"
          value={monitoredRuntimeCount}
          detail="Registered status signals"
        />

        <SystemMetric
          label="Health checks"
          value={healthSignalCount}
          detail="Monitored system signals"
        />
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
        Detailed diagnostics remain outside the
        application-selection workspace.
      </p>
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
