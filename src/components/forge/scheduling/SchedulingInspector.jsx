"use client";
import { SchedulingHelpPanel } from "./SchedulingHelpModal";
import { SchedulingCalendarsPanel } from "./SchedulingCalendarsModal";
import { SchedulingBaselinesPanel } from "./SchedulingBaselinesModal";
import { SchedulingResourcesPanel } from "./SchedulingResourcesModal";
import { SchedulingCostAccountsPanel } from "./SchedulingCostAccountsModal";
import { SchedulingCostsPanel } from "./SchedulingCostsModal";
import { SchedulingEvmDcmaPanel } from "./SchedulingEvmDcmaModal";
import { SchedulingLevelingPanel } from "./SchedulingLevelingModal";
import { AskSchedulePanel } from "./AskSchedulePanel";
import { DriftAlertsPanel } from "./DriftAlertsPanel";
import { SchedulingChecksPanel } from "./SchedulingCheckPackPanel";

// The docked inspector rail: one fixed-width right-side panel with a tab per
// scheduling workspace (previously eight separate centered modals). The board
// timeline keeps the remaining width beside it instead of being covered.
// ownerOnly mirrors the toolbar gating in SchedulingBoard -- non-owners never
// see those tabs because the buttons that open them are owner-only there too.
export const INSPECTOR_TABS = [
  { id: "help", label: "Help" },
  { id: "ask", label: "Ask" },
  { id: "drift", label: "Drift" },
  { id: "checks", label: "Checks" },
  { id: "calendars", label: "Calendars" },
  { id: "baselines", label: "Baselines" },
  { id: "resources", label: "Resources", ownerOnly: true },
  { id: "cost-accounts", label: "Cost Accounts", ownerOnly: true },
  { id: "costs", label: "Costs", ownerOnly: true },
  { id: "evm-dcma", label: "EVM/DCMA", ownerOnly: true },
  { id: "leveling", label: "Leveling", ownerOnly: true },
];

export function visibleInspectorTabs(isOwner) {
  return INSPECTOR_TABS.filter((tab) => isOwner || !tab.ownerOnly);
}

function InspectorPanel({ activeTab, onCollapse, isOwner, board, projectId,
  onAddCalendar, onRemoveCalendar, onSetDefaultCalendar, onAddBlackout, onRemoveBlackout,
  onResourcesChanged, onCostAccountsChanged, onBaselineCaptured }) {
  switch (activeTab) {
    case "help":
      return <SchedulingHelpPanel onClose={onCollapse} />;
    case "ask":
      // Read-only dates/CPM/baselines -- visible to non-owners too, matching the
      // existing convention that non-owners see schedule data but not cost data.
      return <AskSchedulePanel projectId={projectId} onClose={onCollapse} />;
    case "drift":
      // Same read-only convention as Ask: drift is computed from dates/CPM, so
      // non-owners see it too.
      return <DriftAlertsPanel projectId={projectId} onClose={onCollapse} />;
    case "checks":
      // Same read-only convention as Drift: the check pack is computed from
      // dates/CPM/dependencies, so non-owners see it too. Pure client-side --
      // no fetch, no writes.
      return <SchedulingChecksPanel board={board} onClose={onCollapse} />;
    case "calendars":
      return (
        <SchedulingCalendarsPanel board={board} onClose={onCollapse}
          onAddCalendar={onAddCalendar} onRemoveCalendar={onRemoveCalendar}
          onSetDefaultCalendar={onSetDefaultCalendar} onAddBlackout={onAddBlackout}
          onRemoveBlackout={onRemoveBlackout} />
      );
    case "baselines":
      return <SchedulingBaselinesPanel projectId={projectId} isOwner={isOwner} blocks={board.blocks} onClose={onCollapse} onBaselineCaptured={onBaselineCaptured} />;
    case "resources":
      return <SchedulingResourcesPanel isOwner={isOwner} onClose={onCollapse} onChanged={onResourcesChanged} templateId={board.templateId} />;
    case "cost-accounts":
      return <SchedulingCostAccountsPanel isOwner={isOwner} onClose={onCollapse} onChanged={onCostAccountsChanged} />;
    case "costs":
      return <SchedulingCostsPanel projectId={projectId} blocks={board.blocks} onClose={onCollapse} />;
    case "evm-dcma":
      return <SchedulingEvmDcmaPanel projectId={projectId} onClose={onCollapse} />;
    case "leveling":
      return <SchedulingLevelingPanel projectId={projectId} blocks={board.blocks} onClose={onCollapse} />;
    default:
      return null;
  }
}

export default function SchedulingInspector({ activeTab, onSelectTab, onCollapse, isOwner, driftBadge, ...panelProps }) {
  const tabs = visibleInspectorTabs(isOwner);
  const effectiveTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0].id;
  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-slate-200 bg-white" data-scheduling-inspector>
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-500">Inspector</h2>
        <button type="button" onClick={onCollapse} title="Hide inspector"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-lg font-black text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-label="Hide inspector">
          &times;
        </button>
      </div>
      <div role="tablist" aria-label="Inspector panels" className="flex flex-wrap gap-1 border-b border-slate-200 p-2">
        {tabs.map((tab) => {
          const selected = tab.id === effectiveTab;
          const showBadge = tab.id === "drift" && driftBadge && driftBadge.total > 0;
          return (
            <button key={tab.id} type="button" role="tab" id={`scheduling-inspector-tab-${tab.id}`}
              aria-selected={selected} aria-controls="scheduling-inspector-panel"
              onClick={() => onSelectTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold ${selected ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {tab.label}
              {showBadge && (
                <span aria-label={`${driftBadge.total} drifted activities`}
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${driftBadge.major > 0 ? "bg-red-600 text-white" : "bg-slate-200 text-slate-800"}`}>
                  {driftBadge.total}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div id="scheduling-inspector-panel" role="tabpanel" aria-labelledby={`scheduling-inspector-tab-${effectiveTab}`}
        className="flex-1 overflow-y-auto">
        <InspectorPanel activeTab={effectiveTab} onCollapse={onCollapse} isOwner={isOwner} {...panelProps} />
      </div>
    </aside>
  );
}
