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
  "@/components/forge/property/PropertyPortfolioOperationsPanel",
  () => ({
    default: () => (
      <div data-property-portfolio-operations>
        Expanded property operations
      </div>
    ),
  }),
);

vi.mock(
  "@/components/forge/workspace/ForgeWorkspaceTile",
  () => ({
    default: ({
      children,
      expandedChildren,
      expandLabel,
      collapseLabel,
    }) => (
      <section data-workspace-tile>
        <div data-compact-content>
          {children}
        </div>

        <div data-expanded-content>
          {expandedChildren}
        </div>

        <div>
          {expandLabel}
        </div>

        <div>
          {collapseLabel}
        </div>
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
      "composes compact portfolio and expanded property operations",
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
          "Compact portfolio summary",
        );

        expect(markup).toContain(
          "data-property-portfolio-operations",
        );

        expect(markup).toContain(
          "Expanded property operations",
        );

        expect(markup).toContain(
          "Manage property records",
        );

        expect(markup).toContain(
          "Show portfolio summary",
        );
      },
    );
  },
);
