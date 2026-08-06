import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import FinancialOperationsPanel from "../FinancialOperationsPanel.jsx";

describe("FinancialOperationsPanel", () => {
  it("renders presentation-ready operations guidance", () => {
    const markup = renderToStaticMarkup(
      <FinancialOperationsPanel
        focus="Protect operating cash"
        summary="Review near-term obligations."
        priority="high"
        actions={[
          {
            id: "action-1",
            title: "Review receivables",
            status: "recommended",
            priority: "high",
            rationale: "Collections are behind plan.",
          },
          {
            id: "action-2",
            title: "Confirm reserves",
            status: "monitoring",
            priority: "medium",
            rationale: "Maintain adequate liquidity.",
          },
        ]}
      />,
    );

    expect(markup).toContain(
      "data-financial-operations-panel",
    );

    expect(markup).toContain(
      "text-xs font-black uppercase",
    );

    expect(markup).toContain(
      "Protect operating cash",
    );

    expect(markup).toContain(
      "Review near-term obligations.",
    );

    expect(markup).toContain("high");
    expect(markup).toContain("Review receivables");
    expect(markup).toContain("recommended");
    expect(markup).toContain(
      "Collections are behind plan.",
    );
    expect(markup).toContain("Confirm reserves");
  });

  it("renders stable loading defaults and an empty action state", () => {
    const markup = renderToStaticMarkup(
      <FinancialOperationsPanel />,
    );

    expect(markup).toContain("Operations Plan");
    expect(markup).toContain(
      "Financial operations guidance is loading.",
    );
    expect(markup).toContain("monitor");
    expect(markup).toContain(
      "No financial operations actions are available yet.",
    );
  });
});
