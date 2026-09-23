// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }) => <div data-testid="stripe-elements">{children}</div>,
}));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(async () => ({})) }));
vi.mock("./PrivateFinancingAutopaySetupForm", () => ({
  default: () => <div data-testid="pf-setup-form" />,
}));

import PrivateFinancingBorrowerAutopay from "./PrivateFinancingBorrowerAutopay.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount(mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); }

const bankEnrollment = { id: "pf_autopay_1", status: "setup_required",
  paymentMethodType: "us_bank_account", chargeDay: 15 };

let mounted;
let fetchMock;
let onChanged;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
  vi.stubGlobal("fetch", fetchMock);
  onChanged = vi.fn(async () => {});
});

afterEach(() => { if (mounted) unmount(mounted); mounted = null; vi.unstubAllGlobals(); });

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

function openChargeDayCalendar(container) {
  const button = Array.from(container.querySelectorAll("button"))
    .find((b) => b.getAttribute("aria-haspopup") === "dialog");
  act(() => button.click());
  return button;
}

describe("PrivateFinancingBorrowerAutopay charge-day copy", () => {
  it("labels the field as a recurring day of the month with the 1-28 range", () => {
    mounted = mount(<PrivateFinancingBorrowerAutopay accountId="acct_1" enrollments={[]} onChanged={onChanged} />);
    expect(mounted.container.textContent).toContain("Charge day (day of the month)");
    expect(mounted.container.textContent).toContain("charged on this day each month");
    expect(mounted.container.textContent).toContain("15 means the 15th of every month");
    expect(mounted.container.textContent).toContain("Pick a day from 1 to 28.");
    const button = Array.from(mounted.container.querySelectorAll("button"))
      .find((b) => b.getAttribute("aria-haspopup") === "dialog");
    expect(button.textContent).toContain("the 1st of each month");
    const hidden = mounted.container.querySelector('input[name="chargeDay"][type="hidden"]');
    expect(hidden).not.toBeNull();
    expect(hidden.value).toBe("1");
  });

  it("states the recurring charge day as an ordinal in the status line", () => {
    mounted = mount(<PrivateFinancingBorrowerAutopay accountId="acct_1"
      enrollments={[bankEnrollment]} onChanged={onChanged} />);
    expect(mounted.container.textContent).toContain("charged on the 15th of each month");
    expect(mounted.container.textContent).not.toContain("charge day 15");
  });
});

describe("PrivateFinancingBorrowerAutopay charge-day calendar", () => {
  it("offers only days 1-28 in the calendar and submits the picked day", async () => {
    mounted = mount(<PrivateFinancingBorrowerAutopay accountId="acct_1" enrollments={[]} onChanged={onChanged} />);
    openChargeDayCalendar(mounted.container);
    const enabled = Array.from(mounted.container.querySelectorAll('button[aria-label^="Charge on the"]'));
    expect(enabled).toHaveLength(28);
    act(() => enabled.find((b) => b.textContent === "15").click());
    expect(mounted.container.querySelector('input[name="chargeDay"][type="hidden"]').value).toBe("15");
    expect(mounted.container.querySelector('[role="dialog"]')).toBeNull();
    // Consent, then submit: the hidden input carries the picked day.
    const form = mounted.container.querySelector("form");
    act(() => { form.querySelector('input[name="consentConfirmed"]').click(); });
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(fetchMock).toHaveBeenCalledWith("/api/private-financing/portal", expect.objectContaining({ method: "POST" }));
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toEqual({ operation: "request-autopay", accountId: "acct_1",
      paymentMethodType: "us_bank_account", chargeDay: 15, reminderDaysBefore: 3, consentConfirmed: true });
    expect(onChanged).toHaveBeenCalled();
  });

  it("highlights the due day from the portal's next due date", () => {
    mounted = mount(<PrivateFinancingBorrowerAutopay accountId="acct_1" enrollments={[]}
      nextDueDate="2026-10-15" onChanged={onChanged} />);
    openChargeDayCalendar(mounted.container);
    const dueDay = mounted.container.querySelector('[data-due-day="true"]');
    expect(dueDay).not.toBeNull();
    expect(dueDay.textContent).toBe("15");
    expect(mounted.container.textContent).toContain("Your due date is the 15th");
  });

  it("shows no due-day highlight when the next due date is unknown", () => {
    mounted = mount(<PrivateFinancingBorrowerAutopay accountId="acct_1" enrollments={[]}
      nextDueDate={null} onChanged={onChanged} />);
    openChargeDayCalendar(mounted.container);
    expect(mounted.container.querySelector('[data-due-day="true"]')).toBeNull();
  });
});
