// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import ColumnFilterBar from "./CallShieldColumnFilters.jsx";
import { applyColumnFilters } from "@/domains/callShield/callShieldColumnFilters";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const labels = [
  { normalized_phone: "5550100001", label: "personal", symbol: "" },
  { normalized_phone: "5550100002", label: "offender", symbol: "🚫" },
];

const rows = [
  {
    id: "r1",
    phone_number: "(555) 010-0001",
    caller_name: "Acme Supplies",
    started_at: new Date(2026, 8, 25, 9).toISOString(),
    duration_seconds: 30,
    call_type: "incoming",
  },
  {
    id: "r2",
    phone_number: "(555) 010-0002",
    caller_name: "",
    started_at: new Date(2026, 8, 24, 18).toISOString(),
    duration_seconds: 400,
    call_type: "incoming",
  },
  {
    id: "r3",
    phone_number: "(555) 010-0003",
    caller_name: "Beta Services",
    started_at: new Date(2026, 8, 10, 10).toISOString(),
    duration_seconds: 0,
    call_type: "outgoing",
  },
];

let mounted = [];

afterEach(() => {
  for (const { root, container } of mounted) {
    act(() => root.unmount());
    container.remove();
  }
  mounted = [];
});

async function mountBar(initialFilters = {}, options = {}) {
  const store = { filters: initialFilters, setNow: null, opened: [] };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function Harness() {
    const [filters, setFilters] = useState(store.filters);
    // The "now" prop is stateful in the real parent (refreshed when a panel
    // opens) — the store exposes setNow so tests can roll the clock.
    const [now, setNowState] = useState(() => options.now ?? Date.now());
    useEffect(() => {
      store.filters = filters;
    }, [filters]);
    useEffect(() => {
      store.setNow = setNowState;
    }, []);
    const resultCount = applyColumnFilters(rows, filters, { labels, now }).length;
    return (
      <ColumnFilterBar
        rows={rows}
        labels={labels}
        filters={filters}
        onChange={setFilters}
        resultCount={resultCount}
        now={now}
        onOpenColumn={(id) => {
          store.opened.push(id);
          options.onOpenColumn?.(id);
        }}
      />
    );
  }
  await act(async () => {
    root.render(<Harness />);
  });
  mounted.push({ root, container });
  return { container, store };
}

function columnButton(container, name) {
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === name && b.getAttribute("aria-haspopup") === "dialog",
  );
  if (!button) throw new Error(`column button "${name}" not found`);
  return button;
}

async function openPanel(container, name) {
  await act(async () => {
    columnButton(container, name).click();
  });
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  return dialog;
}

function valueCheckbox(dialog, labelText) {
  const label = [...dialog.querySelectorAll("label")].find(
    (l) => l.textContent.trim() === labelText,
  );
  if (!label) throw new Error(`value "${labelText}" not found`);
  return label.querySelector('input[type="checkbox"]');
}

async function click(el) {
  await act(async () => {
    el.click();
  });
}

async function setSearch(dialog, text) {
  const input = dialog.querySelector('input[placeholder="Search"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ColumnFilterBar", () => {
  it("renders one filter button per column", async () => {
    const { container } = await mountBar();
    for (const name of ["Phone", "Caller name", "Date", "Duration", "Type", "Label"]) {
      expect(() => columnButton(container, name)).not.toThrow();
    }
  });

  it("opens a panel with search, (Select All), and distinct values", async () => {
    const { container } = await mountBar();
    const dialog = await openPanel(container, "Type");
    expect(dialog.querySelector('input[placeholder="Search"]')).not.toBeNull();
    expect(valueCheckbox(dialog, "(Select All)")).not.toBeNull();
    expect(valueCheckbox(dialog, "Incoming")).not.toBeNull();
    expect(valueCheckbox(dialog, "Outgoing")).not.toBeNull();
    // All values start checked, like Excel.
    for (const box of dialog.querySelectorAll('input[type="checkbox"]')) {
      expect(box.checked).toBe(true);
    }
  });

  it("narrows the checkbox list through the search box", async () => {
    const { container } = await mountBar();
    const dialog = await openPanel(container, "Type");
    await setSearch(dialog, "out");
    const labels = [...dialog.querySelectorAll("label")].map((l) => l.textContent.trim());
    expect(labels).toContain("Outgoing");
    expect(labels).not.toContain("Incoming");
    expect(labels).toContain("(Select All)");
  });

  it("applies the checked values on OK and marks the column active", async () => {
    const { container, store } = await mountBar();
    const dialog = await openPanel(container, "Type");
    await click(valueCheckbox(dialog, "(Select All)")); // uncheck all
    await click(valueCheckbox(dialog, "Incoming")); // check one
    const ok = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "OK");
    await click(ok);

    expect(store.filters).toEqual({ callType: ["incoming"] });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    // Excel's funnel indicator: the button title flips to "filtered".
    expect(columnButton(container, "Type").getAttribute("title")).toBe("Type: filtered");
    expect(container.textContent).toContain("Clear all filters (1)");
    expect(container.textContent).toContain("Showing 2 of 3 staged calls.");
  });

  it("treats OK with everything checked as no filter", async () => {
    const { container, store } = await mountBar();
    const dialog = await openPanel(container, "Type");
    const ok = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "OK");
    await click(ok);
    expect(store.filters).toEqual({});
    expect(container.textContent).not.toContain("Clear all filters");
    expect(columnButton(container, "Type").getAttribute("title")).toBe("Filter by Type");
  });

  it("discards the draft on Cancel", async () => {
    const { container, store } = await mountBar();
    const dialog = await openPanel(container, "Type");
    await click(valueCheckbox(dialog, "(Select All)"));
    const cancel = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    await click(cancel);
    expect(store.filters).toEqual({});
    expect(container.textContent).not.toContain("Clear all filters");
  });

  it("clears the column filter from inside the panel", async () => {
    const { container, store } = await mountBar({ callType: ["incoming"] });
    const dialog = await openPanel(container, "Type");
    const clear = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "Clear filter",
    );
    await click(clear);
    expect(store.filters).toEqual({});
    expect(container.textContent).not.toContain("Clear all filters");
  });

  it("cascades the value list through the other columns' filters", async () => {
    const { container } = await mountBar({ callType: ["incoming"] });
    // Only r1 (30s) and r2 (400s) survive the Type=incoming filter.
    const dialog = await openPanel(container, "Duration");
    const labels = [...dialog.querySelectorAll("label")].map((l) => l.textContent.trim());
    expect(labels).toContain("< 1 min");
    expect(labels).toContain("5+ min");
    expect(labels).not.toContain("1–5 min");
  });

  it("clears every column filter at once", async () => {
    const { container, store } = await mountBar({
      callType: ["incoming"],
      label: ["offender"],
    });
    expect(container.textContent).toContain("Clear all filters (2)");
    const clearAll = [...container.querySelectorAll("button")].find((b) =>
      b.textContent.startsWith("Clear all filters"),
    );
    await click(clearAll);
    expect(store.filters).toEqual({});
  });

  it("closes the panel on Escape", async () => {
    const { container } = await mountBar();
    await openPanel(container, "Date");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("re-buckets dates when the now prop advances past midnight", async () => {
    // r1 started Sept 25 at 9:00 AM local.
    const beforeMidnight = new Date(2026, 8, 25, 23, 50).getTime();
    const afterMidnight = new Date(2026, 8, 26, 0, 10).getTime();
    const { container, store } = await mountBar({}, { now: beforeMidnight });

    let dialog = await openPanel(container, "Date");
    expect(() => valueCheckbox(dialog, "Today")).not.toThrow();
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Cancel"));

    // Roll the clock past midnight: r1's call is now "Yesterday", and no
    // call in the list falls under "Today" anymore.
    await act(async () => {
      store.setNow(afterMidnight);
    });
    dialog = await openPanel(container, "Date");
    expect(() => valueCheckbox(dialog, "Yesterday")).not.toThrow();
    expect(() => valueCheckbox(dialog, "Today")).toThrow();
  });

  it("notifies the parent when a panel opens so it can refresh the clock", async () => {
    const { container, store } = await mountBar();
    await openPanel(container, "Date");
    expect(store.opened).toEqual(["startedAt"]);
  });
});
