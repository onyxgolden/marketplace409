// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkPackageBudgetAllocation from "./WorkPackageBudgetAllocation.jsx";

// The control estimate is $2,500.00; the saved allocation splits it
// labor $1,500.00 / material $1,000.00. The planned labor forecast is
// $900.00 — under the labor budget, so the variance wording reads
// "over the planned labor estimate".
const ALLOCATION_DATA = {
  packageCode: "SYN-A",
  packageTitle: "Synthetic exchanger [SYNTHETIC]",
  packageStatus: "in_progress",
  notApplied: false,
  estimate: {
    id: "est_a",
    workPackageId: "pkg_1",
    originalControlEstimateCents: 250000,
    currentControlEstimateCents: 250000,
    contingencyCents: null,
    version: 1,
  },
  allocation: {
    id: "forge_wba_1",
    workPackageId: "pkg_1",
    controlEstimateId: "est_a",
    controlEstimateVersion: 1,
    allocatedTotalCents: 250000,
    version: 1,
    lines: [
      { id: "forge_wbl_1", category: "labor", description: "Crew", amountCents: 150000, sortOrder: 0 },
      { id: "forge_wbl_2", category: "material", description: "Pipe", amountCents: 100000, sortOrder: 1 },
    ],
  },
  plannedLaborForecastCents: 90000,
};

function stubFetch({ data = ALLOCATION_DATA, packageStatus = "in_progress", saveError = null } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    if (url === "/api/work-packages/pkg_1/budget-allocation" && options.method === "POST") {
      if (saveError) {
        return { ok: false, json: async () => ({ error: saveError }) };
      }
      const body = JSON.parse(options.body);
      const categoryTotals = { labor: 0, material: 0, equipment: 0, external_services: 0, rental: 0 };
      for (const line of body.lines) categoryTotals[line.category] += line.amountCents;
      return {
        ok: true,
        json: async () => ({
          allocation: {
            ...ALLOCATION_DATA.allocation,
            version: (ALLOCATION_DATA.allocation.version || 0) + 1,
            lines: body.lines.map((line, i) => ({ ...line, id: line.id || `forge_wbl_new${i}`, sortOrder: i })),
          },
          categoryTotals,
          packageStatus,
        }),
      };
    }
    if (url === "/api/work-packages/pkg_1/budget-allocation/retire" && options.method === "POST") {
      return { ok: true, json: async () => ({ allocation: { retired: true, version: 2 }, packageStatus }) };
    }
    if (url === "/api/work-packages/pkg_1/budget-allocation") {
      return { ok: true, json: async () => ({ ...data, packageStatus }) };
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
    root.render(<WorkPackageBudgetAllocation packageId="pkg_1" {...props} />);
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

function setSelectValue(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function buttonNamed(container, text) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent.trim().includes(text));
}

async function clickButton(button) {
  await act(async () => {
    button.click();
  });
  await settle();
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("WorkPackageBudgetAllocation", () => {
  it("renders the saved five-way lines, the total, and the labor variance in plain words", async () => {
    stubFetch();
    const { container } = renderPanel({ refreshKey: 1 });
    await settle();
    const text = container.textContent;
    expect(text).toContain("Budget allocation");
    expect(text).toContain("Labor");
    expect(text).toContain("Crew");
    expect(text).toContain("$1,500.00");
    expect(text).toContain("Material");
    expect(text).toContain("Pipe");
    expect(text).toContain("$1,000.00");
    expect(text).toContain("$2,500.00");
    expect(text).toContain("over the planned labor estimate");
    expect(text).toContain("planned labor $900.00");
    expect(buttonNamed(container, "Edit budget allocation")).toBeDefined();
  });

  it("shows the not-applied message when the migration is not live", async () => {
    stubFetch({ data: { ...ALLOCATION_DATA, notApplied: true, estimate: null, allocation: null } });
    const { container } = renderPanel({ refreshKey: 2 });
    await settle();
    expect(container.textContent).toContain("Budget allocation isn't available yet");
    expect(container.textContent).not.toContain("$2,500.00");
  });

  it("asks for the control estimate first when none is set, with a button to set it", async () => {
    stubFetch({ data: { ...ALLOCATION_DATA, estimate: null, allocation: null } });
    const onRequestEstimateEdit = vi.fn();
    const { container } = renderPanel({ refreshKey: 3, onRequestEstimateEdit });
    await settle();
    expect(container.textContent).toContain("No control estimate set — set the control estimate first");
    const button = buttonNamed(container, "Set control estimate");
    expect(button).toBeDefined();
    await clickButton(button);
    expect(onRequestEstimateEdit).toHaveBeenCalledTimes(1);
  });

  it("offers to add an allocation when the estimate exists but no allocation does", async () => {
    stubFetch({ data: { ...ALLOCATION_DATA, allocation: null } });
    const { container } = renderPanel({ refreshKey: 4 });
    await settle();
    expect(container.textContent).toContain("No budget allocation yet");
    expect(buttonNamed(container, "Add budget allocation")).toBeDefined();
  });

  it("is read-only on a closed package: notice, and the actions stay visible but disabled with the reason", async () => {
    stubFetch({ packageStatus: "cancelled" });
    const { container } = renderPanel({ refreshKey: 5, isTerminal: true });
    await settle();
    expect(container.textContent).toContain("This package is closed — the budget allocation is read-only.");
    const edit = buttonNamed(container, "Edit budget allocation");
    const del = buttonNamed(container, "Delete this allocation");
    expect(edit).toBeDefined();
    expect(edit.disabled).toBe(true);
    expect(del).toBeDefined();
    expect(del.disabled).toBe(true);
    // Disabled, not removed: clicking the edit button changes nothing.
    await clickButton(edit);
    expect(container.textContent).not.toContain("Save budget allocation");
  });

  it("keeps the add and set-estimate actions visible but disabled on a closed package with nothing saved yet", async () => {
    stubFetch({ data: { ...ALLOCATION_DATA, allocation: null } });
    const { container } = renderPanel({ refreshKey: 51, isTerminal: true });
    await settle();
    expect(container.textContent).toContain("This package is closed — the budget allocation is read-only.");
    const add = buttonNamed(container, "Add budget allocation");
    expect(add).toBeDefined();
    expect(add.disabled).toBe(true);
    await clickButton(add);
    expect(container.textContent).not.toContain("Save budget allocation");
  });

  it("keeps the set-estimate action visible but disabled on a closed package with no control estimate", async () => {
    stubFetch({ data: { ...ALLOCATION_DATA, estimate: null, allocation: null } });
    const onRequestEstimateEdit = vi.fn();
    const { container } = renderPanel({ refreshKey: 52, isTerminal: true, onRequestEstimateEdit });
    await settle();
    expect(container.textContent).toContain("This package is closed — the budget allocation is read-only.");
    const button = buttonNamed(container, "Set control estimate");
    expect(button).toBeDefined();
    expect(button.disabled).toBe(true);
    await clickButton(button);
    expect(onRequestEstimateEdit).not.toHaveBeenCalled();
  });

  it("keeps save disabled until the draft balances exactly, showing the precise gap", async () => {
    const { calls } = stubFetch({ data: { ...ALLOCATION_DATA, allocation: null } });
    const { container } = renderPanel({ refreshKey: 6 });
    await settle();
    await clickButton(buttonNamed(container, "Add budget allocation"));
    const save = buttonNamed(container, "Save budget allocation");
    expect(save.disabled).toBe(true);
    // The draft starts with one blank line: the first hint is to fix it.
    expect(container.textContent).toContain("Fix the descriptions and amounts above first");
    // One line of $1,500.00 against a $2,500.00 estimate: $1,000.00 short.
    const description = container.querySelector("input[placeholder='What this line covers']");
    const amount = container.querySelector("input[placeholder='0.00']");
    await act(async () => { setInputValue(description, "Crew"); });
    await act(async () => { setInputValue(amount, "1500.00"); });
    await settle();
    expect(buttonNamed(container, "Save budget allocation").disabled).toBe(true);
    expect(container.textContent).toContain("Add $1,000.00 more.");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    // Add a second line to balance exactly.
    await clickButton(buttonNamed(container, "Add line"));
    const descriptions = container.querySelectorAll("input[placeholder='What this line covers']");
    const amounts = container.querySelectorAll("input[placeholder='0.00']");
    await act(async () => { setSelectValue(descriptions[1].closest("div").parentElement.querySelector("select"), "material"); });
    await act(async () => { setInputValue(descriptions[1], "Pipe"); });
    await act(async () => { setInputValue(amounts[1], "1000.00"); });
    const reason = container.querySelector("input[aria-label='Reason for this budget allocation change']");
    await act(async () => { setInputValue(reason, "First allocation"); });
    await settle();
    expect(buttonNamed(container, "Save budget allocation").disabled).toBe(false);
    expect(container.textContent).not.toContain("Add $1,000.00 more.");
  });

  it("saves a balanced draft with the exact RPC body and confirms in plain words with names", async () => {
    const { calls } = stubFetch({ data: { ...ALLOCATION_DATA, allocation: null } });
    const onChanged = vi.fn();
    const { container } = renderPanel({ refreshKey: 7, onChanged });
    await settle();
    await clickButton(buttonNamed(container, "Add budget allocation"));
    await act(async () => { setInputValue(container.querySelector("input[placeholder='What this line covers']"), "Crew"); });
    await act(async () => { setInputValue(container.querySelector("input[placeholder='0.00']"), "1500.00"); });
    await clickButton(buttonNamed(container, "Add line"));
    const descriptions = container.querySelectorAll("input[placeholder='What this line covers']");
    const amounts = container.querySelectorAll("input[placeholder='0.00']");
    await act(async () => { setSelectValue(descriptions[1].closest("div").parentElement.querySelector("select"), "material"); });
    await act(async () => { setInputValue(descriptions[1], "Pipe"); });
    await act(async () => { setInputValue(amounts[1], "1000.00"); });
    await act(async () => { setInputValue(container.querySelector("input[aria-label='Reason for this budget allocation change']"), "First allocation"); });
    await settle();
    await clickButton(buttonNamed(container, "Save budget allocation"));
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/budget-allocation"));
    expect(post).toBeDefined();
    expect(post.body).toEqual({
      expectedAllocationVersion: 0,
      expectedEstimateId: "est_a",
      expectedEstimateVersion: 1,
      lines: [
        { id: null, category: "labor", description: "Crew", amountCents: 150000 },
        { id: null, category: "material", description: "Pipe", amountCents: 100000 },
      ],
      reason: "First allocation",
    });
    expect(container.textContent).toContain("Budget allocation saved for SYN-A — labor $1,500.00, material $1,000.00.");
    expect(onChanged).toHaveBeenCalled();
  });

  it("copies the planned labor forecast into a draft line only — no save until the user saves", async () => {
    const { calls } = stubFetch({ data: { ...ALLOCATION_DATA, allocation: null } });
    const { container } = renderPanel({ refreshKey: 8 });
    await settle();
    await clickButton(buttonNamed(container, "Add budget allocation"));
    await clickButton(buttonNamed(container, "Use planned labor estimate"));
    await settle();
    const descriptions = container.querySelectorAll("input[placeholder='What this line covers']");
    const amounts = container.querySelectorAll("input[placeholder='0.00']");
    // Blank first line untouched, forecast line appended after it.
    expect(descriptions[1].value).toBe("Planned labor");
    expect(amounts[1].value).toBe("900.00");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("deletes one draft line and deletes all draft lines", async () => {
    stubFetch();
    const { container } = renderPanel({ refreshKey: 9 });
    await settle();
    await clickButton(buttonNamed(container, "Edit budget allocation"));
    expect(container.querySelectorAll("input[placeholder='What this line covers']")).toHaveLength(2);
    await clickButton(buttonNamed(container, "Delete line"));
    await settle();
    expect(container.querySelectorAll("input[placeholder='What this line covers']")).toHaveLength(1);
    expect(buttonNamed(container, "Delete all lines")).toBeDefined();
    await clickButton(buttonNamed(container, "Delete all lines"));
    await settle();
    expect(container.querySelectorAll("input[placeholder='What this line covers']")).toHaveLength(0);
    expect(container.textContent).toContain("No lines yet");
  });

  it("cancel discards the draft and shows the saved allocation again", async () => {
    stubFetch();
    const { container } = renderPanel({ refreshKey: 10 });
    await settle();
    await clickButton(buttonNamed(container, "Edit budget allocation"));
    await act(async () => { setInputValue(container.querySelector("input[placeholder='What this line covers']"), "Changed"); });
    await clickButton(buttonNamed(container, "Cancel"));
    await settle();
    expect(container.textContent).toContain("Crew");
    expect(container.textContent).not.toContain("Save budget allocation");
  });

  it("names the package and the consequence in the delete confirmation, before anything is deleted", async () => {
    const { calls } = stubFetch();
    const { container } = renderPanel({ refreshKey: 13 });
    await settle();
    await clickButton(buttonNamed(container, "Delete this allocation"));
    // Pre-submit copy: package named, split consequence explained.
    expect(container.textContent).toContain("Delete the budget allocation for SYN-A?");
    expect(container.textContent).toContain("The project dashboard cost split will remain incomplete until a replacement allocation is saved.");
    // Nothing has been deleted yet — no retire call until confirmed.
    expect(calls.filter((c) => c.url.endsWith("/budget-allocation/retire"))).toHaveLength(0);
  });

  it("retires the allocation with a reason and confirms in plain words", async () => {
    const { calls } = stubFetch();
    const { container } = renderPanel({ refreshKey: 11 });
    await settle();
    await clickButton(buttonNamed(container, "Delete this allocation"));
    await act(async () => { setInputValue(container.querySelector("input[aria-label='Reason for deleting the budget allocation']"), "Wrong split"); });
    // The opener and the confirm share the label — the confirm is the
    // last one, inside the retire panel.
    const confirmButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Delete this allocation");
    await clickButton(confirmButtons[confirmButtons.length - 1]);
    await settle();
    const retire = calls.find((c) => c.url.endsWith("/budget-allocation/retire"));
    expect(retire).toBeDefined();
    expect(retire.body).toEqual({ expectedVersion: 1, reason: "Wrong split" });
    expect(container.textContent).toContain("Budget allocation deleted for SYN-A");
  });

  it("keeps the draft when the save is refused as stale, showing the server's reason", async () => {
    stubFetch({ saveError: "The budget allocation was changed by someone else — refresh and try again." });
    const { container } = renderPanel({ refreshKey: 12 });
    await settle();
    await clickButton(buttonNamed(container, "Edit budget allocation"));
    // The saved lines already balance, so only the reason is needed.
    await act(async () => { setInputValue(container.querySelector("input[aria-label='Reason for this budget allocation change']"), "Rebalance"); });
    await settle();
    await clickButton(buttonNamed(container, "Save budget allocation"));
    await settle();
    expect(container.textContent).toContain("The budget allocation was changed by someone else — refresh and try again.");
    // The draft is still there — the user did not lose their work.
    expect(container.querySelector("input[placeholder='What this line covers']").value).toBe("Crew");
    expect(buttonNamed(container, "Save budget allocation")).toBeDefined();
  });
});
