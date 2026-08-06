import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import FinancialWorkspaceSurface from "../FinancialWorkspaceSurface.jsx";

describe("FinancialWorkspaceSurface", () => {
  it("renders the financial workspace regions", () => {
    const markup = renderToStaticMarkup(
      <FinancialWorkspaceSurface
        header={<div>Header</div>}
        executive={<div>Executive</div>}
        portfolio={<div>Portfolio</div>}
        sidebar={<div>Sidebar</div>}
      />,
    );

    expect(markup).toContain(
      'data-workspace-surface="financial"',
    );

    expect(markup).toContain(
      'data-workspace-variant="workspace"',
    );

    expect(markup).toContain(
      'data-workspace-region="header"',
    );

    expect(markup).toContain(
      'data-workspace-region="executive"',
    );

    expect(markup).toContain(
      'data-workspace-region="operations"',
    );

    expect(markup).toContain(
      'data-workspace-region="primary"',
    );

    expect(markup).toContain(
      'data-workspace-region="sidebar"',
    );

    expect(markup).toContain("Header");
    expect(markup).toContain("Executive");
    expect(markup).toContain("Portfolio");
    expect(markup).toContain("Sidebar");
  });

  it("renders a portfolio region without an empty sidebar", () => {
    const markup = renderToStaticMarkup(
      <FinancialWorkspaceSurface
        portfolio={<div>Portfolio Only</div>}
      />,
    );

    expect(markup).toContain(
      'data-workspace-region="primary"',
    );

    expect(markup).toContain("Portfolio Only");

    expect(markup).not.toContain(
      'data-workspace-region="operations"',
    );

    expect(markup).not.toContain(
      'data-workspace-region="sidebar"',
    );
  });

  it("supports the embedded presentation variant", () => {
    const markup = renderToStaticMarkup(
      <FinancialWorkspaceSurface
        variant="embedded"
        executive={<div>Embedded</div>}
      />,
    );

    expect(markup).toContain(
      'data-workspace-variant="embedded"',
    );

    expect(markup).toContain("space-y-5");
  });

  it("falls back to the workspace layout for unknown variants", () => {
    const markup = renderToStaticMarkup(
      <FinancialWorkspaceSurface
        variant="unknown"
        header={<div>Header</div>}
      />,
    );

    expect(markup).toContain(
      'data-workspace-variant="unknown"',
    );

    expect(markup).toContain("space-y-6");
  });

  it("omits unused workspace regions", () => {
    const markup = renderToStaticMarkup(
      <FinancialWorkspaceSurface
        executive={<div>Executive</div>}
      />,
    );

    expect(markup).toContain(
      'data-workspace-region="executive"',
    );

    expect(markup).not.toContain(
      'data-workspace-region="header"',
    );

    expect(markup).not.toContain(
      'data-workspace-region="operations"',
    );
  });
});
