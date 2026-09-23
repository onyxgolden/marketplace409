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

describe("PrivateFinancingBorrowerAutopay charge-day copy", () => {
  it("labels the field as a recurring day of the month with the 1-28 range", () => {
    mounted = mount(<PrivateFinancingBorrowerAutopay accountId="acct_1" enrollments={[]} onChanged={onChanged} />);
    expect(mounted.container.textContent).toContain("Charge day (day of the month)");
    expect(mounted.container.textContent).toContain("charged on this day each month");
    expect(mounted.container.textContent).toContain("15 means the 15th of every month");
    expect(mounted.container.textContent).toContain("Enter a day from 1 to 28.");
    const input = mounted.container.querySelector('input[name="chargeDay"]');
    expect(input.getAttribute("min")).toBe("1");
    expect(input.getAttribute("max")).toBe("28");
  });

  it("states the recurring charge day as an ordinal in the status line", () => {
    mounted = mount(<PrivateFinancingBorrowerAutopay accountId="acct_1"
      enrollments={[bankEnrollment]} onChanged={onChanged} />);
    expect(mounted.container.textContent).toContain("charged on the 15th of each month");
    expect(mounted.container.textContent).not.toContain("charge day 15");
  });
});
