// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import HealthDashboard from "./HealthDashboard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { insertMock, getUserMock } = vi.hoisted(() => ({
  insertMock: vi.fn(() => Promise.resolve({ error: null })),
  getUserMock: vi.fn(() => Promise.resolve({ data: { user: { id: "user-1" } } })),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table) => {
      const node = {
        select: () => node,
        eq: () => node,
        order: () => Promise.resolve({
          data: table === "health_profiles" ? [{ id: "profile-1", display_name: "jasonmorgan99@gmail.com", profile_type: "self" }] : [],
          error: null,
        }),
        insert: (payload) => insertMock(table, payload),
      };
      return node;
    },
    auth: { getUser: getUserMock },
    rpc: vi.fn(),
  }),
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
    await Promise.resolve();
    await Promise.resolve();
  });
}
function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function goToWorkoutsTab(container) {
  const workoutsTab = [...container.querySelectorAll("button")].find((button) => button.textContent === "Workouts");
  await act(async () => {
    workoutsTab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
  });
}

describe("HealthDashboard", () => {
  let mounted;

  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    insertMock.mockClear();
    getUserMock.mockClear();
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
    await goToWorkoutsTab(mounted.container);

    expect(mounted.container.textContent).toContain("Log a workout");
    expect(mounted.container.textContent).toContain("Add exercise");
    expect(mounted.container.textContent).not.toContain("Record strength, cardio and mobility sessions with duration");
  });

  it("attributes a saved workout to the signed-in user (recorded_by)", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToWorkoutsTab(mounted.container);

    setInputValue(mounted.container.querySelector('[aria-label="Exercise 1"]'), "Treadmill");

    const saveButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Save workout");
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await flush();
    });

    expect(insertMock).toHaveBeenCalledWith("health_workouts", expect.objectContaining({
      recorded_by: "user-1",
      workspace_id: "health-1",
      profile_id: "profile-1",
      details: [expect.objectContaining({ exercise: "Treadmill" })],
    }));
  });
});
