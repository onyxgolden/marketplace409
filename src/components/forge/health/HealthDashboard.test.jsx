// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import HealthDashboard from "./HealthDashboard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function chain(result) {
  const node = { select: () => node, eq: () => node, order: () => Promise.resolve(result) };
  return node;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: () => chain({ data: [], error: null }), rpc: vi.fn() }),
}));

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount({ container, root }) {
  act(() => root.unmount());
  container.remove();
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("HealthDashboard", () => {
  let mounted;

  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
  });

  it("requires explicit private workspace setup", () => {
    const markup = renderToStaticMarkup(<HealthDashboard initialMembership={null} />);
    expect(markup).toContain("Create our private health workspace");
    expect(markup).toContain("Only the two explicitly added accounts");
  });

  it("renders the complete private health navigation", () => {
    const markup = renderToStaticMarkup(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    for (const label of ["Overview", "Labs", "Regimen", "Peptides", "Workouts", "Timeline"]) expect(markup).toContain(label);
  });

  it("renders a real workout logging form on the Workouts tab, not a placeholder", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();

    const workoutsTab = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Workouts");
    await act(async () => {
      workoutsTab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await flush();
    });

    expect(mounted.container.textContent).toContain("Log a workout");
    expect(mounted.container.textContent).toContain("Add exercise");
    expect(mounted.container.textContent).not.toContain("Record strength, cardio and mobility sessions with duration");
  });
});
