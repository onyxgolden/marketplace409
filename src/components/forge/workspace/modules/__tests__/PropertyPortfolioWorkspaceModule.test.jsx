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
  "@/components/forge/property/PropertyValuationPanel",
  () => ({
    default: () => (
      <div data-property-valuation-panel>
        Expanded valuation application
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
      "composes compact portfolio and expanded valuation surfaces",
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
          "data-property-valuation-panel",
        );

        expect(markup).toContain(
          "Expanded valuation application",
        );

        expect(markup).toContain(
          "Manage valuations",
        );

        expect(markup).toContain(
          "Show portfolio summary",
        );
      },
    );
  },
);
