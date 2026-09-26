// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import FinancialPositionSnapshot from "../FinancialPositionSnapshot.jsx";
import FinancialWorkspaceHeader from "../FinancialWorkspaceHeader.jsx";

let mounted = null;

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

afterEach(() => {
  if (mounted) {
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  }
});

const LINES = [
  { accountId: "acct-cash", accountName: "Cash", amount: "$125,000", isNegative: false },
  { accountId: "acct-line", accountName: "Credit Line", amount: "-$25,000", isNegative: true },
];

describe("FinancialPositionSnapshot drill-down", () => {
  it("renders row amounts as static text without onSelectAccount", () => {
    const markup = renderToStaticMarkup(
      <FinancialPositionSnapshot lines={LINES} />,
    );
    expect(markup).toContain("$125,000");
    expect(markup).not.toContain("data-balance-sheet-account-link");
  });

  it("renders row amounts as account-activity links with onSelectAccount", () => {
    const onSelectAccount = vi.fn();
    mounted = mount(
      <FinancialPositionSnapshot lines={LINES} onSelectAccount={onSelectAccount} />,
    );

    const buttons = mounted.container.querySelectorAll(
      "[data-balance-sheet-account-link]",
    );
    expect(buttons.length).toBe(2);

    act(() => {
      buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectAccount).toHaveBeenCalledWith("acct-cash", "Cash");
  });
});

describe("FinancialWorkspaceHeader headline deep link", () => {
  it("links the headline number to its drill-down", () => {
    const markup = renderToStaticMarkup(
      <FinancialWorkspaceHeader
        health={{ label: "Healthy", detail: "All good." }}
        kpis={[]}
        headline={{
          value: "$125,000",
          label: "Cash on hand",
          caption: "Liquid cash across your accounts.",
          ready: true,
          href: "#cash-forecast",
        }}
      />,
    );

    expect(markup).toContain('href="#cash-forecast"');
    expect(markup).toContain("$125,000");
  });
});
