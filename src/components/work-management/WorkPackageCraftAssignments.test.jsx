// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "@/hooks/swrCache";

import WorkPackageCraftAssignments from "./WorkPackageCraftAssignments.jsx";

const ACTIVE = {
  id: "forge_wpca_1", workPackageId: "pkg_1", workDate: "2026-11-09",
  craftLabel: "Pipefitter", craftKey: "pipefitter", shiftKind: "day", shiftKey: "day",
  shiftLabel: null, crewSize: 6, hoursPerPerson: 8, plannedPersonHours: 48,
  crewLabel: "Crew A", crewKey: "crew a", note: "Tie-ins", version: 1,
  retiredAt: null, retiredBy: null, createdBy: "user_1", updatedBy: "user_1",
  createdAt: "t1", updatedAt: "t1",
};
const RETIRED = {
  ...ACTIVE, id: "forge_wpca_2", craftLabel: "Welder", craftKey: "welder",
  shiftKind: "night", shiftKey: "night", version: 2, retiredAt: "t2", retiredBy: "user_1",
};
const PAST = { ...ACTIVE, workDate: "2026-11-06" };
const DAY_TOTALS = [{ workDate: "2026-11-09", plannedPersonHours: 48, assignmentCount: 1 }];

function setupFetch({ list = [ACTIVE], revisions = [], listStatus = 200, listError = "" } = {}) {
  let currentList = [...list];
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    const parsed = new URL(url, "https://test");
    const base = "/api/work-packages/pkg_1/craft-assignments";
    if (parsed.pathname === base && !options.method) {
      if (listStatus !== 200) {
        return { ok: false, status: listStatus, json: async () => ({ error: listError }) };
      }
      const includeRetired = parsed.searchParams.get("includeRetired") === "true";
      const rows = includeRetired ? currentList : currentList.filter((a) => !a.retiredAt);
      return {
        ok: true,
        json: async () => ({
          assignments: rows,
          dayTotals: DAY_TOTALS,
          from: "2026-11-09", to: "2026-11-09", packageStatus: "in_progress",
        }),
      };
    }
    if (parsed.pathname === base && options.method === "POST") {
      const body = JSON.parse(options.body);
      const created = {
        ...ACTIVE, id: "forge_wpca_new", workDate: body.workDate, craftLabel: body.craft,
        craftKey: body.craft.toLowerCase(), shiftKind: body.shiftKind,
        shiftKey: body.shiftKind, crewSize: body.crewSize, hoursPerPerson: body.hoursPerPerson,
        plannedPersonHours: body.crewSize * body.hoursPerPerson,
        crewLabel: body.crewLabel || null, note: body.note || null, version: 1,
      };
      currentList = [created, ...currentList];
      return { ok: true, json: async () => ({ assignment: created }) };
    }
    if (parsed.pathname === `${base}/forge_wpca_1` && options.method === "PATCH") {
      const body = JSON.parse(options.body);
      // Mirror the backend presence semantics: a key present with
      // null clears the stored value, an absent key preserves it.
      const updated = {
        ...ACTIVE,
        workDate: body.workDate ?? ACTIVE.workDate,
        craftLabel: body.craft ?? ACTIVE.craftLabel,
        craftKey: body.craft ? body.craft.toLowerCase().replace(/ /g, "-") : ACTIVE.craftKey,
        shiftKind: body.shiftKind ?? ACTIVE.shiftKind,
        shiftLabel: "shiftLabel" in body ? body.shiftLabel : ACTIVE.shiftLabel,
        crewSize: body.crewSize ?? ACTIVE.crewSize,
        hoursPerPerson: body.hoursPerPerson ?? ACTIVE.hoursPerPerson,
        crewLabel: "crewLabel" in body ? body.crewLabel : ACTIVE.crewLabel,
        note: "note" in body ? body.note : ACTIVE.note,
        version: 2,
      };
      updated.plannedPersonHours = updated.crewSize * updated.hoursPerPerson;
      currentList = currentList.map((a) => (a.id === ACTIVE.id ? updated : a));
      return { ok: true, json: async () => ({ assignment: updated }) };
    }
    if (parsed.pathname === `${base}/forge_wpca_1/retire` && options.method === "POST") {
      const retired = { ...ACTIVE, version: 2, retiredAt: "t2", retiredBy: "user_1" };
      currentList = currentList.map((a) => (a.id === ACTIVE.id ? retired : a));
      return { ok: true, json: async () => ({ assignment: retired }) };
    }
    if (parsed.pathname === `${base}/forge_wpca_1/revisions`) {
      return { ok: true, json: async () => ({ revisions }) };
    }
    throw new Error(`unexpected fetch ${options.method || "GET"} ${url}`);
  }));
  return { calls, getList: () => currentList };
}

async function renderPanel(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<WorkPackageCraftAssignments packageId="pkg_1" {...props} />);
  });
  await act(async () => {});
  return { container, root };
}

function buttonByText(container, text) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
}

function setInput(container, labelText, value) {
  const inputs = [...container.querySelectorAll("input, select")];
  const input = inputs.find((el) => el.getAttribute("aria-label") === labelText)
    || inputs.find((el) => el.placeholder === labelText)
    || inputs.find((el) => container.querySelector(`label[for="${el.id}"]`)?.textContent.includes(labelText));
  if (!input) throw new Error(`no input for ${labelText}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      input.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

async function submitForm(container, submitButtonText = null) {
  const form = submitButtonText
    ? buttonByText(container, submitButtonText)?.closest("form")
    : container.querySelector("form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

// Retries an assertion across act flushes: a save triggers a list
// refresh, and the reread only lands after its fetch resolves.
async function waitFor(check) {
  for (let i = 0; i < 10; i++) {
    try {
      check();
      return;
    } catch {
      await act(async () => {});
    }
  }
  check();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSWRCache();
  document.body.innerHTML = "";
});

describe("WorkPackageCraftAssignments", () => {
  it("renders assignments with day totals", async () => {
    setupFetch();
    const { container } = await renderPanel();
    expect(container.textContent).toContain("Pipefitter");
    expect(container.textContent).toContain("6 crew");
    expect(container.textContent).toContain("48 person-hours");
    expect(container.textContent).toContain("Crew A");
  });

  it("creates an assignment and confirms it in plain words", async () => {
    const { calls } = setupFetch({ list: [] });
    const { container } = await renderPanel();
    setInput(container, "Craft", "Welder");
    setInput(container, "Crew size", "4");
    setInput(container, "Hours per person", "10");
    await submitForm(container);
    expect(container.textContent).toContain("Craft assignment added");
    const post = calls.find((c) => c.method === "POST");
    expect(JSON.parse(post.body)).toMatchObject({ craft: "Welder", crewSize: 4, hoursPerPerson: 10, shiftKind: "day" });
  });

  it("edits an assignment and keeps the version guard", async () => {
    const { calls } = setupFetch();
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "Edit").click(); });
    setInput(container, "Crew size", "8");
    setInput(container, "Reason for this change", "Two extra hands");
    await submitForm(container, "Save changes");
    expect(container.textContent).toContain("Craft assignment updated");
    const patch = calls.find((c) => c.method === "PATCH");
    expect(JSON.parse(patch.body)).toMatchObject({ expectedVersion: 1, crewSize: 8, reason: "Two extra hands" });
  });

  it("prefills the stored craft label on edit and rereads the saved label", async () => {
    const { calls } = setupFetch();
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "Edit").click(); });
    // The P1 regression: the edit form read assignment.craft, which
    // the real service never returns, so this input was blank.
    expect(container.querySelector('input[aria-label="Craft"]').value).toBe("Pipefitter");
    setInput(container, "Craft", "Welder");
    await submitForm(container, "Save changes");
    expect(container.textContent).toContain("Craft assignment updated");
    const patch = calls.find((c) => c.method === "PATCH");
    expect(JSON.parse(patch.body)).toMatchObject({ expectedVersion: 1, craft: "Welder" });
    // The reread list row (not just the confirmation) shows the label.
    await waitFor(() => {
      const row = [...container.querySelectorAll("li")].find((li) => li.textContent.includes("— Welder"));
      expect(row).toBeTruthy();
    });
  });

  it("clears a crew name and note on edit and keeps untouched fields", async () => {
    const { calls } = setupFetch();
    const { container } = await renderPanel();
    expect(container.textContent).toContain("Crew A");
    expect(container.textContent).toContain("Tie-ins");
    await act(async () => { buttonByText(container, "Edit").click(); });
    setInput(container, "Crew name", "");
    setInput(container, "Note", "");
    await submitForm(container, "Save changes");
    expect(container.textContent).toContain("Craft assignment updated");
    const patch = calls.find((c) => c.method === "PATCH");
    const body = JSON.parse(patch.body);
    // An emptied field is an explicit clear, not an omission.
    expect(body).toMatchObject({ crewLabel: null, note: null });
    // Untouched fields are still sent with their stored values.
    expect(body).toMatchObject({
      expectedVersion: 1, craft: "Pipefitter", workDate: "2026-11-09",
      shiftKind: "day", crewSize: 6, hoursPerPerson: 8,
    });
    await waitFor(() => {
      expect(container.textContent).not.toContain("Crew A");
      expect(container.textContent).not.toContain("Tie-ins");
      expect(container.textContent).toContain("6 crew");
      expect(container.textContent).toContain("48 person-hours");
    });
  });

  it("retires a past-day assignment only after the correction is confirmed", async () => {
    const { calls } = setupFetch({ list: [PAST] });
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "Retire").click(); });
    setInput(container, "Reason for retiring", "Day was cancelled");
    const confirm = buttonByText(container, "Retire this assignment");
    expect(confirm.disabled).toBe(true);
    const checkbox = container.querySelector('input[aria-label="This retires a past day — mark it as a historical correction"]');
    expect(checkbox).not.toBeNull();
    await act(async () => { checkbox.click(); });
    expect(buttonByText(container, "Retire this assignment").disabled).toBe(false);
    await act(async () => { buttonByText(container, "Retire this assignment").click(); });
    await act(async () => {});
    expect(container.textContent).toContain("Craft assignment retired");
    const retire = calls.find((c) => c.url.endsWith("/retire"));
    expect(JSON.parse(retire.body)).toMatchObject({
      expectedVersion: 1, reason: "Day was cancelled", historicalCorrection: true,
    });
  });

  it("refuses a past-day retire without the correction confirmation", async () => {
    const { calls } = setupFetch({ list: [PAST] });
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "Retire").click(); });
    setInput(container, "Reason for retiring", "Day was cancelled");
    expect(buttonByText(container, "Retire this assignment").disabled).toBe(true);
    expect(calls.filter((c) => c.url.endsWith("/retire"))).toHaveLength(0);
  });

  it("retires only with a reason", async () => {
    const { calls } = setupFetch();
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "Retire").click(); });
    expect(buttonByText(container, "Retire this assignment").disabled).toBe(true);
    setInput(container, "Reason for retiring", "Crew stood down");
    await act(async () => { buttonByText(container, "Retire this assignment").click(); });
    await act(async () => {});
    expect(container.textContent).toContain("Craft assignment retired");
    const retire = calls.find((c) => c.url.endsWith("/retire"));
    expect(JSON.parse(retire.body)).toMatchObject({ expectedVersion: 1, reason: "Crew stood down" });
  });

  it("shows history on demand", async () => {
    setupFetch({
      revisions: [{
        id: "forge_wpcr_1", version: 1, action: "create", recordedAt: "t1",
        reason: null, historicalCorrection: false,
        oldValues: null,
        newValues: { work_date: "2026-11-09", craft_label: "Pipefitter", shift_kind: "day", crew_size: 6, hours_per_person: 8 },
      }],
    });
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "History").click(); });
    await act(async () => {});
    expect(container.textContent).toContain("Added");
    expect(container.textContent).toContain("Pipefitter");
  });

  it("shows the plain-words unavailable message while the migration is unapplied", async () => {
    setupFetch({
      listStatus: 503,
      listError: "Craft assignments aren't available yet — the database change for this feature hasn't been applied.",
    });
    const { container } = await renderPanel();
    expect(container.textContent).toContain("Craft assignments aren't available yet");
  });

  it("hides retired assignments unless asked", async () => {
    setupFetch({ list: [ACTIVE, RETIRED] });
    const { container } = await renderPanel();
    expect(container.textContent).toContain("Pipefitter");
    expect(container.textContent).not.toContain("Welder");
  });
});
