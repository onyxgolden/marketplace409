// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import ForgeMetricTile from "./ForgeMetricTile.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmount({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}

describe("ForgeMetricTile", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } });

  it("renders as a real button and navigates on click when a destination and onNavigate are given", () => {
    let navigated = null;
    mounted = mount(<ForgeMetricTile label="Vacancies" value="2" destination="setup" onNavigate={(id) => { navigated = id; }} />);
    const button = mounted.container.querySelector("button");
    expect(button).toBeTruthy();
    act(() => { button.click(); });
    expect(navigated).toBe("setup");
  });

  it("renders as a non-interactive tile labelled Informational when marked informational, even with a destination", () => {
    mounted = mount(<ForgeMetricTile label="Occupancy" value="80%" destination="setup" onNavigate={() => {}} informational />);
    expect(mounted.container.querySelector("button")).toBeNull();
    expect(mounted.container.textContent).toContain("Informational");
  });

  it("renders as a non-interactive tile when no destination is supplied, without falsely offering a click-through", () => {
    mounted = mount(<ForgeMetricTile label="Occupancy" value="80%" onNavigate={() => {}} />);
    expect(mounted.container.querySelector("button")).toBeNull();
    expect(mounted.container.textContent).not.toContain("View details");
  });

  it("tags the tile with a stable data-metric-tile key for downstream test targeting", () => {
    mounted = mount(<ForgeMetricTile label="Overdue" value="$0.00" metricKey="overdue-forge" destination="charges" onNavigate={() => {}} />);
    expect(mounted.container.querySelector('[data-metric-tile="overdue-forge"]')).toBeTruthy();
  });
});
