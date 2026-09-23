import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SchedulingInspector, { INSPECTOR_TABS, visibleInspectorTabs } from "./SchedulingInspector";

const board = { blocks: [], calendars: [], blackoutWindows: [], templateId: "template-1" };

function renderInspector(overrides = {}) {
  return renderToStaticMarkup(
    <SchedulingInspector activeTab="help" onSelectTab={() => {}} onCollapse={() => {}}
      isOwner board={board} projectId="project-1" {...overrides} />
  );
}

describe("SchedulingInspector", () => {
  it("declares eleven tabs", () => {
    expect(INSPECTOR_TABS).toHaveLength(11);
    expect(INSPECTOR_TABS.map((tab) => tab.id)).toEqual(
      ["help", "ask", "drift", "checks", "calendars", "baselines", "resources", "cost-accounts", "costs", "evm-dcma", "leveling"]
    );
  });

  it("shows every tab to owners", () => {
    const markup = renderInspector({ isOwner: true });
    for (const tab of INSPECTOR_TABS) {
      expect(markup).toContain(`id="scheduling-inspector-tab-${tab.id}"`);
    }
  });

  it("hides owner-only tabs from non-owners", () => {
    const markup = renderInspector({ isOwner: false });
    expect(markup).toContain('id="scheduling-inspector-tab-help"');
    expect(markup).toContain('id="scheduling-inspector-tab-ask"');
    expect(markup).toContain('id="scheduling-inspector-tab-drift"');
    expect(markup).toContain('id="scheduling-inspector-tab-calendars"');
    expect(markup).toContain('id="scheduling-inspector-tab-baselines"');
    expect(markup).not.toContain('id="scheduling-inspector-tab-resources"');
    expect(markup).not.toContain('id="scheduling-inspector-tab-cost-accounts"');
    expect(markup).not.toContain('id="scheduling-inspector-tab-costs"');
    expect(markup).not.toContain('id="scheduling-inspector-tab-evm-dcma"');
    expect(markup).not.toContain('id="scheduling-inspector-tab-leveling"');
  });

  it("visibleInspectorTabs filters by ownership", () => {
    expect(visibleInspectorTabs(true)).toHaveLength(11);
    expect(visibleInspectorTabs(false).map((tab) => tab.id)).toEqual(["help", "ask", "drift", "checks", "calendars", "baselines"]);
  });

  it("shows the drift badge on the Drift tab when drifted activities exist", () => {
    const markup = renderInspector({ driftBadge: { total: 3, major: 1 } });
    expect(markup).toContain('aria-label="3 drifted activities"');
    expect(markup).toContain(">3</span>");
  });

  it("hides the drift badge when nothing drifted or the badge is not loaded", () => {
    expect(renderInspector({ driftBadge: { total: 0, major: 0 } })).not.toContain("drifted activities");
    expect(renderInspector({})).not.toContain("drifted activities");
  });

  it("renders the active tab's panel and no other panel", () => {
    const help = renderInspector({ activeTab: "help" });
    expect(help).toContain("data-scheduling-help");
    expect(help).toContain("Gantt Chart guide");
    expect(help).not.toContain("data-scheduling-calendars");
    const calendars = renderInspector({ activeTab: "calendars" });
    expect(calendars).toContain("data-scheduling-calendars");
    expect(calendars).not.toContain("data-scheduling-help");
  });

  it("marks the active tab selected for assistive tech", () => {
    const markup = renderInspector({ activeTab: "calendars" });
    expect(markup).toContain('id="scheduling-inspector-tab-calendars"');
    expect(markup).toContain('aria-selected="true"');
  });

  it("falls back to the first visible tab when the active tab is not visible", () => {
    const markup = renderInspector({ isOwner: false, activeTab: "leveling" });
    expect(markup).toContain("data-scheduling-help");
    expect(markup).not.toContain("data-scheduling-leveling");
  });

  it("renders the rail chrome with a collapse control", () => {
    const markup = renderInspector();
    expect(markup).toContain("data-scheduling-inspector");
    expect(markup).toContain("Inspector");
    expect(markup).toContain('aria-label="Hide inspector"');
  });
});
