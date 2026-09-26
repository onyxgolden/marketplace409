import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import ForgeDashboardCard from "../ForgeDashboardCard.jsx";

describe("ForgeDashboardCard", () => {
  it("renders the number as a deep link when href is provided", () => {
    const markup = renderToStaticMarkup(
      <ForgeDashboardCard
        label="Cash"
        value="$125,000"
        detail="Receivables $0"
        href="#cash-forecast"
      />,
    );

    expect(markup).toContain("Cash");
    expect(markup).toContain("$125,000");
    expect(markup).toContain('href="#cash-forecast"');
    expect(markup).toContain("data-dashboard-card-link");
    // The number itself is the link -- not the label or detail.
    expect(markup).toMatch(/<a[^>]*>\s*<div[^>]*>\$125,000<\/div>\s*<\/a>/);
  });

  it("renders static text when no href is provided", () => {
    const markup = renderToStaticMarkup(
      <ForgeDashboardCard
        label="Cash"
        value="$125,000"
        detail="Receivables $0"
      />,
    );

    expect(markup).toContain("$125,000");
    expect(markup).not.toContain("<a");
    expect(markup).not.toContain("data-dashboard-card-link");
  });

  it("labels the link for assistive technology", () => {
    const markup = renderToStaticMarkup(
      <ForgeDashboardCard
        label="Net Worth / Equity"
        value="$725,000"
        href="#financial-position-snapshot"
      />,
    );

    expect(markup).toContain('aria-label="Net Worth / Equity — view details"');
  });
});
