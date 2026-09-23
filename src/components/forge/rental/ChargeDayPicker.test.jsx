// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";

import ChargeDayPicker, { ordinalDayOfMonth, dayOfMonth } from "./ChargeDayPicker.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount(mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); }

let mounted;
afterEach(() => { if (mounted) unmount(mounted); mounted = null; });

function openCalendar(container) {
  const button = Array.from(container.querySelectorAll("button"))
    .find((b) => b.getAttribute("aria-haspopup") === "dialog");
  act(() => button.click());
  return button;
}
function enabledDayButtons(container) {
  return Array.from(container.querySelectorAll('button[aria-label^="Charge on the"]'));
}

describe("ordinalDayOfMonth", () => {
  it("renders 1st/2nd/3rd/21st/22nd/23rd/28th ordinals", () => {
    expect(ordinalDayOfMonth(1)).toBe("1st");
    expect(ordinalDayOfMonth(2)).toBe("2nd");
    expect(ordinalDayOfMonth(3)).toBe("3rd");
    expect(ordinalDayOfMonth(21)).toBe("21st");
    expect(ordinalDayOfMonth(22)).toBe("22nd");
    expect(ordinalDayOfMonth(23)).toBe("23rd");
    expect(ordinalDayOfMonth(15)).toBe("15th");
    expect(ordinalDayOfMonth(28)).toBe("28th");
  });
});

describe("dayOfMonth", () => {
  it("parses ISO dates and rejects anything else", () => {
    expect(dayOfMonth("2026-10-15")).toBe(15);
    expect(dayOfMonth("2026-09-01")).toBe(1);
    expect(dayOfMonth(null)).toBeNull();
    expect(dayOfMonth("")).toBeNull();
    expect(dayOfMonth("10/15/2026")).toBeNull();
  });
});

describe("ChargeDayPicker", () => {
  it("shows the current selection as an ordinal and submits it via a hidden input", () => {
    const onChange = vi.fn();
    mounted = mount(
      <form><ChargeDayPicker value={15} onChange={onChange} /></form>
    );
    const button = Array.from(mounted.container.querySelectorAll("button"))
      .find((b) => b.getAttribute("aria-haspopup") === "dialog");
    expect(button.textContent).toContain("the 15th of each month");
    const hidden = mounted.container.querySelector('input[name="chargeDay"][type="hidden"]');
    expect(hidden).not.toBeNull();
    expect(hidden.value).toBe("15");
  });

  it("opens a month calendar where only days 1-28 are selectable", () => {
    const onChange = vi.fn();
    mounted = mount(<ChargeDayPicker value={1} onChange={onChange} />);
    openCalendar(mounted.container);
    const now = new Date();
    expect(mounted.container.textContent).toContain(
      now.toLocaleDateString("en-US", { month: "long", year: "numeric" }));
    const enabled = enabledDayButtons(mounted.container);
    expect(enabled).toHaveLength(28);
    expect(enabled.map((b) => b.textContent)).toEqual(
      Array.from({ length: 28 }, (_, i) => String(i + 1)));
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let day = 29; day <= daysInMonth; day += 1) {
      const disabled = Array.from(mounted.container.querySelectorAll('span[aria-disabled="true"]'))
        .find((s) => s.textContent === String(day));
      expect(disabled, `day ${day} should be disabled`).not.toBeUndefined();
    }
    expect(mounted.container.textContent).toContain("Days 29–31 can't be charge days");
  });

  it("selecting a day calls onChange and closes the calendar", () => {
    const onChange = vi.fn();
    mounted = mount(<ChargeDayPicker value={1} onChange={onChange} />);
    openCalendar(mounted.container);
    const day15 = enabledDayButtons(mounted.container).find((b) => b.textContent === "15");
    act(() => day15.click());
    expect(onChange).toHaveBeenCalledWith(15);
    expect(mounted.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("highlights the suggested due day when due-date data is present", () => {
    const onChange = vi.fn();
    mounted = mount(<ChargeDayPicker value={1} onChange={onChange} suggestedDay={15} />);
    openCalendar(mounted.container);
    const dueDay = mounted.container.querySelector('[data-due-day="true"]');
    expect(dueDay).not.toBeNull();
    expect(dueDay.textContent).toBe("15");
    expect(mounted.container.textContent).toContain("Your due date is the 15th");
  });

  it("shows no due-day highlight when the due day is unknown or out of range", () => {
    const onChange = vi.fn();
    mounted = mount(<ChargeDayPicker value={1} onChange={onChange} suggestedDay={null} />);
    openCalendar(mounted.container);
    expect(mounted.container.querySelector('[data-due-day="true"]')).toBeNull();
    expect(mounted.container.textContent).not.toContain("Your due date is the");
    unmount(mounted); mounted = null;

    mounted = mount(<ChargeDayPicker value={1} onChange={onChange} suggestedDay={31} />);
    openCalendar(mounted.container);
    expect(mounted.container.querySelector('[data-due-day="true"]')).toBeNull();
  });
});
