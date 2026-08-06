import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import FinancialPositionSnapshot from "../FinancialPositionSnapshot.jsx";

describe("FinancialPositionSnapshot", () => {
  it("renders presentation-ready balance-sheet lines", () => {
    const markup = renderToStaticMarkup(
      <FinancialPositionSnapshot
        lines={[
          {
            accountId: "cash",
            accountName: "Cash",
            amount: "$125,000",
            isNegative: false,
          },
          {
            accountId: "credit-line",
            accountName: "Credit Line",
            amount: "-$25,000",
            isNegative: true,
          },
        ]}
      />,
    );

    expect(markup).toContain(
      "data-financial-position-snapshot",
    );

    expect(markup).toContain(
      "Balance Sheet Snapshot",
    );

    expect(markup).toContain("Cash");
    expect(markup).toContain("$125,000");
    expect(markup).toContain("Credit Line");
    expect(markup).toContain("-$25,000");
    expect(markup).toContain("text-rose-700");
  });

  it("renders an explicit empty state", () => {
    const markup = renderToStaticMarkup(
      <FinancialPositionSnapshot />,
    );

    expect(markup).toContain(
      "No balance-sheet accounts are available yet.",
    );

    expect(markup).toContain("<table");
  });
});
