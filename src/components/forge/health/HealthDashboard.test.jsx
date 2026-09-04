// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import HealthDashboard from "./HealthDashboard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { insertMock, updateMock, deleteMock, getUserMock } = vi.hoisted(() => ({
  insertMock: vi.fn(() => Promise.resolve({ error: null })),
  updateMock: vi.fn(() => Promise.resolve({ error: null })),
  deleteMock: vi.fn(() => Promise.resolve({ error: null })),
  getUserMock: vi.fn(() => Promise.resolve({ data: { user: { id: "user-1", email: "jasonmorgan99@gmail.com" } } })),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table) => {
      const node = {
        select: () => node,
        eq: () => node,
        order: () => Promise.resolve({
          data: table === "health_profiles" ? [
              { id: "profile-1", display_name: "jasonmorgan99@gmail.com", profile_type: "self" },
              { id: "profile-2", display_name: "spouse@example.com", profile_type: "self" },
            ]
            : table === "health_lab_results" ? [
              { id: "lab-2", profile_id: "profile-1", marker_name: "LDL cholesterol", collected_on: "2026-08-10", value_numeric: 310, unit: "mg/dL", flag: "high", reference_low: null, reference_high: null },
              { id: "lab-1", profile_id: "profile-1", marker_name: "LDL cholesterol", collected_on: "2026-05-01", value_numeric: 140, unit: "mg/dL", flag: "high", reference_low: null, reference_high: null },
              { id: "lab-3", profile_id: "profile-2", marker_name: "Hemoglobin A1c", collected_on: "2026-08-10", value_numeric: 5.4, unit: "%", flag: "normal", reference_low: null, reference_high: null },
            ] : table === "health_workouts" ? [
              { id: "workout-1", profile_id: "profile-1", workout_type: "Strength & Cardio", performed_at: "2026-09-03T00:00:00.000Z", duration_minutes: 30, perceived_exertion: null, notes: null, details: [] },
            ] : table === "health_regimen_items" ? [
              { id: "regimen-1", profile_id: "profile-1", category: "prescription", name: "Testosterone Cypionate", dose: "200 mg/mL", route: "Subcutaneous", frequency: "Twice weekly", status: "active" },
              { id: "regimen-2", profile_id: "profile-1", category: "peptide", name: "KLOW", dose: "15 units", route: null, frequency: "M-F", status: "active" },
            ] : table === "health_measurements" ? [
              { id: "measurement-2", profile_id: "profile-1", measurement_type: "steps", measured_at: "2026-08-15T00:00:00.000Z", value_numeric: 9100, secondary_value_numeric: null, unit: "steps", context: null, notes: null },
              { id: "measurement-1", profile_id: "profile-1", measurement_type: "steps", measured_at: "2026-08-01T00:00:00.000Z", value_numeric: 6200, secondary_value_numeric: null, unit: "steps", context: null, notes: null },
            ] : table === "health_programs" ? [
              { id: "program-1", name: "Jeff Nippard's Legs/Push/Pull Hypertrophy — Block 1", source: "Jeff Nippard", notes: null },
            ] : table === "health_program_days" ? [
              { id: "day-1", program_id: "program-1", day_number: 1, title: "Legs #1", exercises: [
                { name: "Back Squat", sets: "4", reps: "5", intensity: null, notes: null },
                { name: "Deadlift", sets: "2", reps: "8", intensity: null, notes: null },
              ] },
            ] : [],
          error: null,
        }),
        insert: (payload) => insertMock(table, payload),
        update: (payload) => ({ eq: (column, value) => updateMock(table, payload, value) }),
        delete: () => ({ eq: (column, value) => deleteMock(table, value) }),
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
async function goToTab(container, label) {
  const tab = [...container.querySelectorAll("button")].find((button) => button.textContent === label);
  await act(async () => {
    tab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
  });
}

describe("HealthDashboard", () => {
  let mounted;

  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    insertMock.mockClear();
    updateMock.mockClear();
    deleteMock.mockClear();
    getUserMock.mockClear();
  });

  it("requires explicit private workspace setup", () => {
    const markup = renderToStaticMarkup(<HealthDashboard initialMembership={null} />);
    expect(markup).toContain("Create our private health workspace");
    expect(markup).toContain("Only the two explicitly added accounts");
  });

  it("renders the complete private health navigation", () => {
    const markup = renderToStaticMarkup(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    for (const label of ["Overview", "Labs", "Regimen", "Peptides", "Workouts", "Programs", "Vitals", "Timeline"]) expect(markup).toContain(label);
  });

  it("renders a real workout logging form on the Workouts tab, not a placeholder", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Workouts");

    expect(mounted.container.textContent).toContain("Log a workout");
    expect(mounted.container.textContent).toContain("Add exercise");
    expect(mounted.container.textContent).not.toContain("Record strength, cardio and mobility sessions with duration");
  });

  it("attributes a saved workout to the signed-in user (recorded_by)", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Workouts");

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

  it("renders a real trend chart on the Labs tab once lab history exists, not the empty-state placeholder", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Labs");

    expect(mounted.container.textContent).toContain("LDL cholesterol");
    expect(mounted.container.querySelector("svg[aria-label*='LDL cholesterol over time']")).toBeTruthy();
    expect(mounted.container.textContent).not.toContain("Structured results and trend charts will appear here.");
  });

  // Regression guard: the workout form saves its plain date input as UTC midnight, so the history
  // list must format it with timeZone: "UTC" too -- formatting with the viewer's local timezone
  // instead rolls a UTC-midnight timestamp back a day for anyone west of UTC (every US timezone),
  // mislabeling "2026-09-03" as "9/2/2026". This is independent of the test runner's own timezone.
  it("labels a logged workout's date correctly regardless of the viewer's local timezone", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Workouts");

    expect(mounted.container.textContent).toContain("9/3/2026");
    expect(mounted.container.textContent).not.toContain("9/2/2026");
  });

  // Regression guard for Jason's report: household members share one workspace but not every
  // medication, lab result or workout -- lists must never show one person's records while another
  // person's profile is selected, and switching the "Viewing" selector must actually change what's
  // shown.
  it("scopes the Labs tab to exactly the selected profile and switches when you pick someone else", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Labs");

    // Defaults to the signed-in user's own profile (jasonmorgan99@gmail.com / profile-1).
    expect(mounted.container.textContent).toContain("LDL cholesterol");
    expect(mounted.container.textContent).not.toContain("Hemoglobin A1c");

    const spouseButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "spouse@example.com");
    await act(async () => {
      spouseButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await flush();
    });

    expect(mounted.container.textContent).toContain("Hemoglobin A1c");
    expect(mounted.container.textContent).not.toContain("LDL cholesterol");
  });

  it("edits a regimen item in place", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Regimen");

    const editButton = [...mounted.container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Edit Testosterone Cypionate");
    await act(async () => { editButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    setInputValue(mounted.container.querySelector('[aria-label="Dose"]'), "250 mg/mL");
    const saveButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Save");
    await act(async () => { saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(updateMock).toHaveBeenCalledWith("health_regimen_items", expect.objectContaining({ dose: "250 mg/mL" }), "regimen-1");
  });

  it("deletes a workout only after a second confirming click", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Workouts");

    const deleteButton = [...mounted.container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith("Delete workout"));
    await act(async () => { deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });
    expect(deleteMock).not.toHaveBeenCalled();

    const confirmButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Confirm?");
    await act(async () => { confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });
    expect(deleteMock).toHaveBeenCalledWith("health_workouts", "workout-1");
  });

  it("edits a lab result's value and collection date in place", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Labs");

    const editButton = [...mounted.container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Edit LDL cholesterol result from 2026-08-10");
    await act(async () => { editButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    setInputValue(mounted.container.querySelector('[aria-label="Collection date"]'), "2026-05-08");
    const saveButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Save");
    await act(async () => { saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(updateMock).toHaveBeenCalledWith("health_lab_results", expect.objectContaining({ collected_on: "2026-05-08" }), "lab-2");
  });

  it("logs a vital and attributes it to the signed-in user (recorded_by)", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Vitals");

    setInputValue(mounted.container.querySelector('[aria-label="Value"]'), "72");

    const saveButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Save vital");
    await act(async () => { saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(insertMock).toHaveBeenCalledWith("health_measurements", expect.objectContaining({
      recorded_by: "user-1",
      workspace_id: "health-1",
      profile_id: "profile-1",
      measurement_type: "steps",
      value_numeric: 72,
      unit: "steps",
    }));
  });

  it("shows a second numeric field for blood pressure and clears it when switching types away", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Vitals");

    const select = [...mounted.container.querySelectorAll("select")].find((node) => [...node.options].some((option) => option.textContent === "Blood pressure"));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    await act(async () => { setter.call(select, "blood_pressure"); select.dispatchEvent(new Event("change", { bubbles: true })); await flush(); });

    expect(mounted.container.textContent).toContain("Diastolic");
  });

  it("renders a real vitals trend chart on the Vitals tab once a type has a second entry", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Vitals");

    expect(mounted.container.textContent).toContain("Vitals trends");
    expect(mounted.container.querySelector("svg[aria-label*='Steps over time']")).toBeTruthy();
    expect(mounted.container.textContent).toContain("9100 steps");
  });

  it("deletes a vital only after a second confirming click", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Vitals");

    const deleteButton = [...mounted.container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith("Delete Steps"));
    await act(async () => { deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });
    expect(deleteMock).not.toHaveBeenCalled();

    const confirmButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Confirm?");
    await act(async () => { confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });
    expect(deleteMock).toHaveBeenCalledWith("health_measurements", "measurement-2");
  });

  it("saves several regimen items from one form submission without a photo", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Regimen");

    setInputValue(mounted.container.querySelector('[aria-label="Name 1"]'), "Sulfasalazine EC");
    setInputValue(mounted.container.querySelector('[aria-label="Dose 1"]'), "500mg");
    setInputValue(mounted.container.querySelector('[aria-label="Frequency 1"]'), "3 a day");

    const addRowButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "+ Add another");
    await act(async () => { addRowButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });
    setInputValue(mounted.container.querySelector('[aria-label="Name 2"]'), "Hydroxychloroquine");
    setInputValue(mounted.container.querySelector('[aria-label="Dose 2"]'), "200mg");
    setInputValue(mounted.container.querySelector('[aria-label="Frequency 2"]'), "1 a day");

    const saveButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Save items");
    await act(async () => { saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    // Regression guard: health_regimen_items has created_by and updated_by (both not-null, unlike
    // the recorded_by column other health tables use) -- an insert missing either fails in
    // production with 'null value in column "created_by" of relation "health_regimen_items"
    // violates not-null constraint'. Caught live entering a real medication list.
    expect(insertMock).toHaveBeenCalledWith("health_regimen_items", [
      expect.objectContaining({ name: "Sulfasalazine EC", dose: "500mg", frequency: "3 a day", category: "prescription", created_by: "user-1", updated_by: "user-1" }),
      expect.objectContaining({ name: "Hydroxychloroquine", dose: "200mg", frequency: "1 a day", category: "prescription", created_by: "user-1", updated_by: "user-1" }),
    ]);
  });

  it("lists existing peptide regimen items on the Peptides tab instead of hiding them", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Peptides");

    expect(mounted.container.textContent).toContain("KLOW");
  });

  it("selects the first program by default and shows its days and exercises", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Programs");

    expect(mounted.container.textContent).toContain("Jeff Nippard's Legs/Push/Pull Hypertrophy");
    expect(mounted.container.textContent).toContain("Day 1 — Legs #1");
    expect(mounted.container.textContent).toContain("Back Squat");
  });

  it("adds a program day with created_by and updated_by set, not a nonexistent recorded_by", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Programs");

    setInputValue(mounted.container.querySelector('[aria-label="Exercise 1"]'), "Deadlift");
    setInputValue(mounted.container.querySelector('[aria-label="Sets 1"]'), "4");
    setInputValue(mounted.container.querySelector('[aria-label="Reps 1"]'), "4");

    const titleInputs = [...mounted.container.querySelectorAll("input")].filter((input) => input.placeholder === "Legs #1");
    setInputValue(titleInputs[0], "Legs #2");

    const saveButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Save day");
    await act(async () => { saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(insertMock).toHaveBeenCalledWith("health_program_days", expect.objectContaining({
      program_id: "program-1", title: "Legs #2", day_number: 2,
      exercises: [expect.objectContaining({ name: "Deadlift", sets: "4", reps: "4" })],
      created_by: "user-1", updated_by: "user-1",
    }));
  });

  it("builds a workout draft from a checked subset of a program day and hands it to the Workouts tab", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Programs");

    const useButton = [...mounted.container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Use Day 1");
    await act(async () => { useButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    // Uncheck Deadlift -- only Back Squat should carry over to the workout draft.
    const deadliftCheckbox = mounted.container.querySelector('[aria-label="Include Deadlift"]');
    await act(async () => { deadliftCheckbox.click(); await flush(); });

    const startButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Start workout from this day");
    await act(async () => { startButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    // The click above switches the active tab itself -- no goToTab call needed.
    expect(mounted.container.textContent).toContain("Log a workout");
    expect(mounted.container.querySelector('[aria-label="Exercise 1"]').value).toBe("Back Squat");
    expect(mounted.container.querySelector('[aria-label="Sets 1"]').value).toBe("4");
    expect(mounted.container.querySelector('[aria-label="Exercise 2"]')).toBeFalsy();
  });

  it("deletes a program only after a second confirming click", async () => {
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Programs");

    const deleteButton = [...mounted.container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith("Delete Jeff Nippard's"));
    await act(async () => { deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });
    expect(deleteMock).not.toHaveBeenCalled();

    const confirmButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Confirm?");
    await act(async () => { confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });
    expect(deleteMock).toHaveBeenCalledWith("health_programs", "program-1");
  });
});
