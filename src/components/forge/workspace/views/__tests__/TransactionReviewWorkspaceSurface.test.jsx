import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import TransactionReviewWorkspaceSurface from "../TransactionReviewWorkspaceSurface.jsx";

describe("TransactionReviewWorkspaceSurface", () => {
  it("renders the transaction review workspace regions", () => {
    const markup = renderToStaticMarkup(
      <TransactionReviewWorkspaceSurface
        header={<div>Header</div>}
        summary={<div>Summary</div>}
        queue={<div>Queue</div>}
        sidebar={<div>Sidebar</div>}
        footer={<div>Footer</div>}
      />,
    );

    expect(markup).toContain(
      'data-workspace-surface="transaction-review"',
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

    expect(markup).toContain(
      'data-workspace-region="footer"',
    );

    expect(markup).toContain("Header");
    expect(markup).toContain("Summary");
    expect(markup).toContain("Queue");
    expect(markup).toContain("Sidebar");
    expect(markup).toContain("Footer");
  });

  it("renders a queue without an empty sidebar", () => {
    const markup = renderToStaticMarkup(
      <TransactionReviewWorkspaceSurface
        queue={<div>Review Queue</div>}
      />,
    );

    expect(markup).toContain(
      'data-workspace-region="primary"',
    );

    expect(markup).toContain("Review Queue");

    expect(markup).not.toContain(
      'data-workspace-region="operations"',
    );

    expect(markup).not.toContain(
      'data-workspace-region="sidebar"',
    );
  });

  it("supports the embedded presentation variant", () => {
    const markup = renderToStaticMarkup(
      <TransactionReviewWorkspaceSurface
        variant="embedded"
        queue={<div>Embedded Queue</div>}
      />,
    );

    expect(markup).toContain(
      'data-workspace-variant="embedded"',
    );

    expect(markup).toContain("space-y-5");
    expect(markup).toContain("Embedded Queue");
  });

  it("omits unused workspace regions", () => {
    const markup = renderToStaticMarkup(
      <TransactionReviewWorkspaceSurface
        summary={<div>Summary Only</div>}
      />,
    );

    expect(markup).toContain(
      'data-workspace-region="executive"',
    );

    expect(markup).not.toContain(
      'data-workspace-region="header"',
    );

    expect(markup).not.toContain(
      'data-workspace-region="primary"',
    );

    expect(markup).not.toContain(
      'data-workspace-region="sidebar"',
    );

    expect(markup).not.toContain(
      'data-workspace-region="footer"',
    );
  });
});
