import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

vi.mock(
  "@/components/forge/ForgePortfolioSummary",
  () => ({
    default: () => (
      <div data-portfolio-summary>
        Compact portfolio summary
      </div>
    ),
  }),
);

vi.mock(
  "@/components/forge/workspace/ForgeWorkspaceTile",
  () => ({
    default: ({
      children,
      href,
      actionLabel,
      expandedChildren,
    }) => (
      <section
        data-workspace-tile
        data-href={href}
        data-action-label={
          actionLabel
        }
      >
        {children}
        {expandedChildren}
      </section>
    ),
  }),
);

import {
  PropertyPortfolioWorkspaceModule,
} from "../PropertyPortfolioWorkspaceModule.jsx";

describe(
  "PropertyPortfolioWorkspaceModule",
  () => {
    it(
      "composes a launch-only Property application tile",
      () => {
        const markup =
          renderToStaticMarkup(
            PropertyPortfolioWorkspaceModule
              .renderTile({
                portfolioSummaryItems:
                  [],
              }),
          );

        expect(markup).toContain(
          "data-workspace-tile",
        );

        expect(markup).toContain(
          "data-portfolio-summary",
        );

        expect(markup).toContain(
          'data-href="/forge/property"',
        );

        expect(markup).toContain(
          'data-action-label="Open property application"',
        );

        expect(markup).not.toContain(
          "data-property-portfolio-operations",
        );

        expect(markup).not.toContain(
          "Manage property records",
        );
      },
    );
  },
);
