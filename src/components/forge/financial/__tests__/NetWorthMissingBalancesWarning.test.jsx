import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import NetWorthMissingBalancesWarning from "../NetWorthMissingBalancesWarning.jsx";

describe("NetWorthMissingBalancesWarning", () => {
  it("renders nothing when every account has a recorded balance", () => {
    expect(
      renderToStaticMarkup(
        <NetWorthMissingBalancesWarning
          missingBalances={[]}
        />,
      ),
    ).toBe("");
  });

  it("renders nothing when the prop is omitted", () => {
    expect(
      renderToStaticMarkup(
        <NetWorthMissingBalancesWarning />,
      ),
    ).toBe("");
  });

  it("warns with the exclusion count and names the accounts", () => {
    const markup = renderToStaticMarkup(
      <NetWorthMissingBalancesWarning
        missingBalances={[
          { id: "a1", name: "Tractor", type: "other" },
          { id: "a2", name: "Card Ladder", type: "credit" },
        ]}
      />,
    );

    expect(markup).toContain(
      "Excludes 2 accounts without recorded balances",
    );
    expect(markup).toContain(
      "Net worth covers only accounts with a recorded balance.",
    );
    expect(markup).toContain("Tractor");
    expect(markup).toContain("Card Ladder");
  });

  it("uses singular copy for a single excluded account", () => {
    const markup = renderToStaticMarkup(
      <NetWorthMissingBalancesWarning
        missingBalances={[
          { id: "a1", name: "Tractor", type: "other" },
        ]}
      />,
    );

    expect(markup).toContain(
      "Excludes 1 account without recorded balances",
    );
  });
});
