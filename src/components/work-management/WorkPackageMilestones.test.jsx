// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkPackageMilestones from "./WorkPackageMilestones.jsx";

const TEMPLATES = [
  {
    id: "forge_wmt_1", templateName: "Standard", milestoneNumber: 3, isMaster: true,
    parentMilestoneNumber: null, description: "T/A Alignment Review (TR-1)",
    responsibilityRole: "Planner", department: "Planning", durationUnit: "months",
    notes: null, stewardshipFlag: true, isStageGate: true, version: 1,
    offsets: [
      { complexityTier: "High", monthsFromAnchor: 27 },
      { complexityTier: "Medium", monthsFromAnchor: 22 },
      { complexityTier: "Low", monthsFromAnchor: 11 },
    ],
  },
];

const INSTANCE = {
  id: "forge_wm_1", sourceTemplateMilestoneId: "forge_wmt_1", milestoneNumber: 3,
  isMaster: true, description: "T/A Alignment Review (TR-1)", responsibilityRole: "Planner",
  department: "Planning", isStageGate: true, complexityTierSelected: "High",
  anchorDate: "2027-06-01", plannedDate: "2025-03-01", actualDate: null,
  percentComplete: 0, late: false, comments: null, justification: null, version: 1,
};

function stubFetch({ templates = TEMPLATES, instances = [], packageStatus = "in_progress", notApplied = false } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    if (url === "/api/work-packages/pkg_1/milestones" && (!options.method || options.method === "GET")) {
      return { ok: true, json: async () => ({ templates, instances, packageStatus, notApplied }) };
    }
    if (url === "/api/work-packages/pkg_1/milestones" && options.method === "POST") {
      return { ok: true, json: async () => ({ instances: [INSTANCE] }) };
    }
    if (url === "/api/work-packages/pkg_1/milestones/forge_wm_1" && options.method === "PATCH") {
      const patch = JSON.parse(options.body);
      return { ok: true, json: async () => ({ instance: { ...INSTANCE, ...patch, version: INSTANCE.version + 1 } }) };
    }
    if (url === "/api/work-packages/pkg_1/milestones/forge_wm_1/retire" && options.method === "POST") {
      return { ok: true, json: async () => ({ instance: { ...INSTANCE, retiredAt: "t1" } }) };
    }
    throw new Error(`unexpected fetch ${options.method || "GET"} ${url}`);
  }));
  return { calls };
}

function renderPanel(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<WorkPackageMilestones packageId="pkg_1" {...props} />);
  });
  return { container, root };
}

async function settle() {
  await act(async () => {});
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("WorkPackageMilestones", () => {
  it("shows an instantiate prompt when the package has no milestones yet", async () => {
    stubFetch({ instances: [] });
    const { container } = renderPanel();
    await settle();
    expect(container.textContent).toContain("No milestones yet");
    expect(container.querySelector("button").textContent).not.toContain("Download PDF");
  });

  it("shows the not-applied message when the migration is not live", async () => {
    stubFetch({ notApplied: true, instances: [] });
    const { container } = renderPanel({ refreshKey: 1 });
    await settle();
    expect(container.textContent).toContain("Milestones isn't available yet");
  });

  it("renders an instantiated milestone row, marking a stage-gate row distinctly", async () => {
    stubFetch({ instances: [INSTANCE] });
    const { container } = renderPanel({ refreshKey: 2 });
    await settle();
    const text = container.textContent;
    expect(text).toContain("T/A Alignment Review (TR-1)");
    expect(text).toContain("03/01/2025");
    const row = container.querySelector('[aria-label="Milestone 3 (stage gate)"]');
    expect(row).not.toBeNull();
    expect(row.className).toContain("bg-amber-50");
  });

  it("instantiates from a template with the chosen anchor date and tier", async () => {
    const { calls } = stubFetch({ instances: [] });
    const { container } = renderPanel({ refreshKey: 3 });
    await settle();

    const instantiateButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent.includes("Instantiate from template"));
    act(() => instantiateButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();

    const anchorInput = container.querySelector("#milestones_anchor_date");
    setInputValue(anchorInput, "2027-06-01");
    const tierSelect = container.querySelector("#milestones_tier");
    act(() => {
      tierSelect.value = "High";
      tierSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    const form = container.querySelector("form");
    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();

    const postCall = calls.find((c) => c.method === "POST" && c.url === "/api/work-packages/pkg_1/milestones");
    expect(postCall).toBeDefined();
    expect(postCall.body).toEqual({ templateName: "Standard", anchorDate: "2027-06-01", complexityTier: "High" });
    expect(container.textContent).toContain("Instantiated milestones from the Standard template");
  });

  it("edits a milestone and shows a plain-words confirmation naming the milestone, after a required reason", async () => {
    const { calls } = stubFetch({ instances: [INSTANCE] });
    const { container } = renderPanel({ refreshKey: 4 });
    await settle();

    const editButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Edit");
    act(() => editButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();

    const saveButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Save");
    act(() => saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();
    // No reason yet — must refuse, not send the PATCH.
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(container.textContent).toContain("Enter a reason for this change first.");

    const reasonInput = container.querySelector('input[placeholder="Reason for this change"]');
    setInputValue(reasonInput, "corrected date after client call");
    act(() => saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();

    const patchCall = calls.find((c) => c.method === "PATCH");
    expect(patchCall).toBeDefined();
    expect(patchCall.body.reason).toBe("corrected date after client call");
    expect(container.textContent).toContain("Saved milestone 3");
  });

  it("retires a milestone only after a reason is given", async () => {
    const { calls } = stubFetch({ instances: [INSTANCE] });
    const { container } = renderPanel({ refreshKey: 5 });
    await settle();

    const retireButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Retire");
    act(() => retireButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();
    expect(calls.some((c) => c.method === "POST" && c.url.includes("retire"))).toBe(false);

    const retireReasonInput = container.querySelector('input[placeholder="Reason to retire"]');
    setInputValue(retireReasonInput, "duplicate instantiation, cleaning up");
    act(() => retireButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();

    const retireCall = calls.find((c) => c.method === "POST" && c.url.includes("retire"));
    expect(retireCall).toBeDefined();
    expect(retireCall.body.reason).toBe("duplicate instantiation, cleaning up");
    expect(container.textContent).toContain("Retired milestone 3");
  });

  it("hides edit/retire controls and the instantiate button on a closed package", async () => {
    stubFetch({ instances: [INSTANCE], packageStatus: "verified_closed" });
    const { container } = renderPanel({ refreshKey: 6 });
    await settle();
    expect(container.textContent).toContain("This work package is closed — Milestones is read-only.");
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent === "Edit")).toBe(false);
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent === "Retire")).toBe(false);
  });

  it("toggling Download PDF shows the print view with the Close control, and Close returns to the table", async () => {
    stubFetch({ instances: [INSTANCE] });
    const { container } = renderPanel({ refreshKey: 7 });
    await settle();

    const pdfButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Download PDF");
    act(() => pdfButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();
    expect(container.textContent).toContain("Milestones — 1 row");

    const closeButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Close");
    act(() => closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();
    expect(container.textContent).toContain("T/A Alignment Review (TR-1)");
  });
});
