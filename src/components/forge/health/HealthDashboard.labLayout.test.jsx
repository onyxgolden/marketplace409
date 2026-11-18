// @vitest-environment jsdom
// Focused interaction tests for the lab layout slice: status chips and range
// bars on Overview/Labs rows, the latest-draw summary on the Labs tab,
// section grouping, and the three virtual calculated ratios. Fixture data
// is deterministic and sanitized (no real lab values).
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HealthDashboard from "./HealthDashboard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { insertMock, updateMock, deleteMock, getUserMock } = vi.hoisted(() => ({
  insertMock: vi.fn(() => Promise.resolve({ error: null })),
  updateMock: vi.fn(() => Promise.resolve({ error: null })),
  deleteMock: vi.fn(() => Promise.resolve({ error: null })),
  getUserMock: vi.fn(() => Promise.resolve({ data: { user: { id: "user-1", email: "person-a@example.com" } } })),
}));

// Mutable fixtures so one test can stage the zero-classified case without a
// second mock. The mocked client reads these at call time, after tests set
// them and before mounting.
let LABS = [];
let PROFILES = [];

function defaultLabs() {
  return [
    { id: "a-ldl-2", profile_id: "profile-1", marker_name: "LDL cholesterol", collected_on: "2026-11-09", value_numeric: 110, unit: "mg/dL", flag: "high", reference_low: 0, reference_high: 100 },
    { id: "a-ldl-1", profile_id: "profile-1", marker_name: "LDL cholesterol", collected_on: "2026-08-10", value_numeric: 140, unit: "mg/dL", flag: "high", reference_low: 0, reference_high: 100 },
    { id: "a-hdl", profile_id: "profile-1", marker_name: "HDL cholesterol", collected_on: "2026-11-09", value_numeric: 50, unit: "mg/dL", flag: "normal", reference_low: 40, reference_high: 60 },
    { id: "a-tg", profile_id: "profile-1", marker_name: "Triglycerides", collected_on: "2026-11-09", value_numeric: 150, unit: "mg/dL", flag: "normal", reference_low: 0, reference_high: 150 },
    { id: "a-tc", profile_id: "profile-1", marker_name: "Total cholesterol", collected_on: "2026-11-09", value_numeric: 220, unit: "mg/dL", flag: "high", reference_low: 0, reference_high: 200 },
    { id: "a-apob", profile_id: "profile-1", marker_name: "ApoB", collected_on: "2026-11-09", value_numeric: 80, unit: "mg/dL", flag: "normal", reference_low: 0, reference_high: 90 },
    { id: "a-tsh", profile_id: "profile-1", marker_name: "TSH", collected_on: "2026-11-09", value_numeric: 1.0, unit: "uIU/mL", flag: "normal", reference_low: 0.4, reference_high: 4.5 },
    { id: "a-cortisol", profile_id: "profile-1", marker_name: "Cortisol", collected_on: "2026-11-09", value_numeric: 2.33, unit: "ug/dL", flag: "unknown", reference_low: null, reference_high: null },
    { id: "a-a1c", profile_id: "profile-1", marker_name: "Hemoglobin A1c", collected_on: "2026-11-09", value_numeric: 5.6, unit: "%", flag: "normal", reference_low: 4.0, reference_high: 5.6 },
    { id: "a-vitd", profile_id: "profile-1", marker_name: "Vitamin D", collected_on: "2026-11-09", value_numeric: 31.8, unit: "ng/mL", flag: "unknown", reference_low: null, reference_high: null },
    { id: "a-tpoab", profile_id: "profile-1", marker_name: "Thyroid peroxidase antibodies", collected_on: "2026-11-09", value_numeric: 250, unit: "IU/mL", flag: "high", reference_low: 0, reference_high: 34 },
    { id: "b-glucose", profile_id: "profile-2", marker_name: "Glucose", collected_on: "2026-11-09", value_numeric: 500, unit: "mg/dL", flag: "high", reference_low: 70, reference_high: 99 },
  ];
}

function defaultProfiles() {
  return [
    { id: "profile-1", display_name: "person-a@example.com", profile_type: "self" },
    { id: "profile-2", display_name: "person-b@example.com", profile_type: "self" },
  ];
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table) => {
      const node = {
        select: () => node,
        eq: () => node,
        order: () => Promise.resolve({
          data: table === "health_profiles" ? PROFILES
            : table === "health_lab_results" ? LABS
            : [],
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
async function switchProfile(container, label) {
  const button = [...container.querySelectorAll("button")].find((button) => button.textContent === label);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
  });
}
function sectionHeadings(container) {
  return [...container.querySelectorAll("h3")].map((node) => node.textContent);
}

describe("HealthDashboard lab layout", () => {
  let mounted;
  let workspaceCounter = 0;
  // Each mount gets its own workspace id: the dashboard caches its
  // snapshot per workspace id, and reusing one across fixture changes
  // would serve the previous test's snapshot.
  function nextWorkspaceId() {
    workspaceCounter += 1;
    return `health-layout-${workspaceCounter}`;
  }

  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    insertMock.mockClear();
    updateMock.mockClear();
    deleteMock.mockClear();
    getUserMock.mockClear();
    LABS = defaultLabs();
    PROFILES = defaultProfiles();
  });

  it("shows a status chip and range bar on Overview rows with a range, value only without one", async () => {
    LABS = defaultLabs();
    PROFILES = defaultProfiles();
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: nextWorkspaceId(), role: "owner" }} />);
    await flush();

    const text = mounted.container.textContent;
    expect(text).toContain("Latest laboratory results");
    expect(text).toContain("Above range");
    expect(text).toContain("Within range");
    expect(text).toContain("Reference range unavailable");
    expect(text).not.toContain("Optimal");
    expect(text).not.toContain("Latest lab summary");
    expect(text).not.toContain("Calculated ratios");

    // Sections in brief order: Heart Health before Thyroid Function; the
    // latest eight rows include Hormone Balance (Cortisol) but no Other marker.
    const headings = sectionHeadings(mounted.container);
    expect(headings).toContain("Heart Health");
    expect(headings).toContain("Thyroid Function");
    expect(headings).toContain("Hormone Balance");
    expect(headings).not.toContain("Other");
    expect(headings.indexOf("Heart Health")).toBeLessThan(headings.indexOf("Thyroid Function"));

    // The LDL row carries a bar with an accessible label; the Cortisol row does not.
    const bars = [...mounted.container.querySelectorAll('[role="img"]')];
    expect(bars.some((bar) => bar.getAttribute("aria-label")?.includes("LDL cholesterol"))).toBe(true);
    expect(bars.some((bar) => bar.getAttribute("aria-label")?.includes("Cortisol"))).toBe(false);
  });

  it("shows the latest-draw summary first on the Labs tab with counts and 1-decimal percentages", async () => {
    LABS = defaultLabs();
    PROFILES = defaultProfiles();
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: nextWorkspaceId(), role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Labs");

    const text = mounted.container.textContent;
    expect(text).toContain("Latest lab summary");
    expect(text).toContain("Latest collection date: 2026-11-09");
    expect(text).toContain("8 classified of 10 results");
    expect(text).toContain("Unclassified: 2");
    // Within 5 of 8 = 62.5%; Above 3 of 8 = 37.5%; Below 0 of 8 = 0.0%.
    expect(text).toContain("62.5%");
    expect(text).toContain("37.5%");
    expect(text).toContain("0.0%");
    expect(text).not.toContain("Optimal");

    // Summary comes before the document importer in the grid.
    expect(text.indexOf("Latest lab summary")).toBeLessThan(text.indexOf("Upload a photo or document"));
    const summarySection = [...mounted.container.querySelectorAll("section")].find((node) => node.textContent.includes("Latest lab summary"));
    expect(summarySection.parentElement.className).toContain("lg:col-span-2");
  });

  it("shows the zero-classified empty state instead of deceptive 0% tiles", async () => {
    LABS = defaultLabs().map((row) => ({ ...row, reference_low: null, reference_high: null }));
    PROFILES = defaultProfiles();
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: nextWorkspaceId(), role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Labs");

    const text = mounted.container.textContent;
    expect(text).toContain("No comparable reference ranges for the latest date");
    expect(text).toContain("0 classified of 10 results");
    expect(text).toContain("Unclassified: 10");
    expect(text).not.toContain("62.5%");
  });

  it("groups Labs history by section and keeps the per-marker charts adjacent", async () => {
    LABS = defaultLabs();
    PROFILES = defaultProfiles();
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: nextWorkspaceId(), role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Labs");

    const headings = sectionHeadings(mounted.container);
    for (const section of ["Hormone Balance", "Metabolic Fitness", "Heart Health", "Kidney & Liver Essentials", "Thyroid Function", "CBC Essentials", "Other"]) {
      if (["Hormone Balance", "Metabolic Fitness", "Heart Health", "Thyroid Function", "Other"].includes(section)) {
        expect(headings).toContain(section);
      }
    }
    expect(headings.indexOf("Heart Health")).toBeLessThan(headings.indexOf("Thyroid Function"));
    // Unmapped Vitamin D lands in Other, never dropped.
    expect(mounted.container.textContent).toContain("Vitamin D");
    // The two-draw LDL marker still renders its trend chart.
    expect(mounted.container.querySelector("svg[aria-label*='LDL cholesterol over time']")).toBeTruthy();
  });

  it("shows the three calculated ratios under Heart Health, labelled Calculated, and never feeds them to charts or mutations", async () => {
    LABS = defaultLabs();
    PROFILES = defaultProfiles();
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: nextWorkspaceId(), role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Labs");

    const text = mounted.container.textContent;
    expect(text).toContain("Calculated ratios — latest date");
    expect(text).toContain("Triglycerides/HDL (calculated)");
    expect(text).toContain("LDL/ApoB (calculated)");
    expect(text).toContain("Total cholesterol/HDL (calculated)");
    expect(text).toContain("3.00");
    expect(text).toContain("1.38");
    expect(text).toContain("4.40");
    expect(text).toContain("Calculated from Triglycerides and HDL cholesterol on 2026-11-09");

    // No ratio reaches a trend chart or a write call.
    const chartLabels = [...mounted.container.querySelectorAll("svg[aria-label]")].map((node) => node.getAttribute("aria-label"));
    expect(chartLabels.some((label) => label.includes("ratio") || label.includes("Calculated"))).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("switches the summary and ratios with the profile and never leaks the other person's labs", async () => {
    LABS = defaultLabs();
    PROFILES = defaultProfiles();
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: nextWorkspaceId(), role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Labs");

    expect(mounted.container.textContent).toContain("LDL cholesterol");
    expect(mounted.container.textContent).not.toContain("Glucose");

    await switchProfile(mounted.container, "person-b@example.com");

    const text = mounted.container.textContent;
    expect(text).toContain("Glucose");
    expect(text).not.toContain("LDL cholesterol");
    expect(text).toContain("Latest collection date: 2026-11-09");
    expect(text).toContain("1 classified of 1 results");
    expect(text).toContain("100.0%");
    expect(text).not.toContain("Calculated ratios");
  });

  it("keeps lab Edit/Delete working on the restructured history rows", async () => {
    LABS = defaultLabs();
    PROFILES = defaultProfiles();
    mounted = mount(<HealthDashboard initialMembership={{ workspace_id: nextWorkspaceId(), role: "owner" }} />);
    await flush();
    await goToTab(mounted.container, "Labs");

    const editButton = [...mounted.container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Edit LDL cholesterol result from 2026-11-09");
    await act(async () => { editButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    setInputValue(mounted.container.querySelector('[aria-label="Value"]'), "105");
    const saveButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Save");
    await act(async () => { saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(updateMock).toHaveBeenCalledWith("health_lab_results", expect.objectContaining({ value_numeric: 105 }), "a-ldl-2");

    const deleteButton = [...mounted.container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Delete LDL cholesterol result from 2026-08-10");
    await act(async () => { deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });
    expect(deleteMock).not.toHaveBeenCalled();
    const confirmButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Confirm?");
    await act(async () => { confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });
    expect(deleteMock).toHaveBeenCalledWith("health_lab_results", "a-ldl-1");
  });
});
