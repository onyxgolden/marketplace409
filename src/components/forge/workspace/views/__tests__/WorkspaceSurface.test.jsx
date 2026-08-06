import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import WorkspaceSurface from "../WorkspaceSurface.jsx";

describe("WorkspaceSurface", () => {
  it("renders the common workspace regions", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSurface
        surfaceIdentity="test"
        header={<div>Header</div>}
        executive={<div>Executive</div>}
        primary={<div>Primary</div>}
        sidebar={<div>Sidebar</div>}
        secondary={<div>Secondary</div>}
        footer={<div>Footer</div>}
      />,
    );

    expect(markup).toContain(
      'data-workspace-surface="test"',
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
      'data-workspace-region="secondary"',
    );

    expect(markup).toContain(
      'data-workspace-region="footer"',
    );
  });

  it("renders a primary region without an empty sidebar", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSurface
        surfaceIdentity="test"
        primary={<div>Primary Only</div>}
      />,
    );

    expect(markup).toContain(
      'data-workspace-region="primary"',
    );

    expect(markup).toContain(
      "Primary Only",
    );

    expect(markup).not.toContain(
      'data-workspace-region="operations"',
    );

    expect(markup).not.toContain(
      'data-workspace-region="sidebar"',
    );
  });

  it("supports the embedded variant", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSurface
        surfaceIdentity="test"
        variant="embedded"
        primary={<div>Primary</div>}
      />,
    );

    expect(markup).toContain(
      'data-workspace-variant="embedded"',
    );

    expect(markup).toContain("space-y-5");
  });

  it("falls back to the workspace layout", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSurface
        variant="unknown"
        primary={<div>Primary</div>}
      />,
    );

    expect(markup).toContain(
      'data-workspace-surface="workspace"',
    );

    expect(markup).toContain(
      'data-workspace-variant="unknown"',
    );

    expect(markup).toContain("space-y-6");
  });
});
