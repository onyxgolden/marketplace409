// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import FinancialPositionSnapshot from "../FinancialPositionSnapshot.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}

describe("FinancialPositionSnapshot", () => {
  let mounted;

  afterEach(() => {
    if (mounted) {
      act(() => { mounted.root.unmount(); });
      mounted.container.remove();
      mounted = null;
    }
  });

  it("starts collapsed, with the header visible but no table rendered", () => {
    const markup = renderToStaticMarkup(
      <FinancialPositionSnapshot
        lines={[{ accountId: "cash", accountName: "Cash", amount: "$125,000", isNegative: false }]}
      />,
    );

    expect(markup).toContain("data-financial-position-snapshot");
    expect(markup).toContain("Balance Sheet Snapshot");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("Cash");
  });

  it("expands to show presentation-ready balance-sheet lines on click", () => {
    mounted = mount(
      <FinancialPositionSnapshot
        lines={[
          { accountId: "cash", accountName: "Cash", amount: "$125,000", isNegative: false },
          { accountId: "credit-line", accountName: "Credit Line", amount: "-$25,000", isNegative: true },
        ]}
      />,
    );

    const toggle = mounted.container.querySelector("button");
    expect(mounted.container.querySelector("table")).toBeNull();
    act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const text = mounted.container.textContent;
    expect(text).toContain("Cash");
    expect(text).toContain("$125,000");
    expect(text).toContain("Credit Line");
    expect(text).toContain("-$25,000");
    expect(mounted.container.querySelector(".text-rose-700")).not.toBeNull();
  });

  it("renders an explicit empty state once expanded", () => {
    mounted = mount(<FinancialPositionSnapshot />);
    const toggle = mounted.container.querySelector("button");
    act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(mounted.container.textContent).toContain("No balance-sheet accounts are available yet.");
    expect(mounted.container.querySelector("table")).not.toBeNull();
  });

  it("collapses and expands the table on click, toggling aria-expanded", () => {
    mounted = mount(
      <FinancialPositionSnapshot
        lines={[{ accountId: "cash", accountName: "Cash", amount: "$125,000", isNegative: false }]}
      />,
    );

    const toggle = mounted.container.querySelector("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(mounted.container.querySelector("table")).toBeNull();

    act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(mounted.container.querySelector("table")).not.toBeNull();

    act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(mounted.container.querySelector("table")).toBeNull();
  });
});
