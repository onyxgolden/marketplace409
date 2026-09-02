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
  "@/components/forge/workspace/composition/createWorkspaceRegistry",
  () => ({
    createWorkspaceRegistry:
      () => ({
        list:
          () => [
            {
              moduleIdentity:
                "financial",
              renderTile:
                () => (
                  <section data-financial-tile>
                    Financial tile
                  </section>
                ),
              isVisible: () => true,
            },
            {
              moduleIdentity:
                "property",
              renderTile:
                () => (
                  <section data-property-tile>
                    Property tile
                  </section>
                ),
              isVisible: () => true,
            },
            {
              moduleIdentity:
                "health",
              renderTile:
                () => (
                  <section data-health-tile>
                    Health tile
                  </section>
                ),
              isVisible:
                (context) =>
                  context.isOwnerOrCoOwner === true,
            },
          ],
      }),
  }),
);

vi.mock(
  "@/components/forge/workspace/ForgeInformationCenter",
  () => ({
    default: function MockInformationCenter() {
      return (
        <aside data-information-center>
          Information center content
        </aside>
      );
    },
  }),
);

import ForgeWorkspaceDesktop from "../ForgeWorkspaceDesktop.jsx";

describe(
  "ForgeWorkspaceDesktop",
  () => {
    it(
      "renders launch surfaces with an on-demand information center",
      () => {
        const markup =
          renderToStaticMarkup(
            <ForgeWorkspaceDesktop
              riskSummary={{
                severity: "low",
                score: 0,
              }}
              alertItems={[]}
            />,
          );

        expect(markup).toContain(
          "FORGE Workspace",
        );

        expect(markup).toContain(
          "Choose an application",
        );

        expect(markup).toContain(
          "data-workspace-information-center",
        );

        expect(markup).toContain(
          "0 alerts",
        );

        expect(markup).toContain(
          "data-information-center",
        );

        expect(markup).toContain(
          "data-financial-tile",
        );

        expect(markup).toContain(
          "data-property-tile",
        );

        expect(markup).toContain(
          "xl:grid-cols-3",
        );

        expect(markup).not.toContain(
          "data-health-tile",
        );
      },
    );

    it(
      "renders a module gated by isVisible only when its condition is met",
      () => {
        const hiddenMarkup =
          renderToStaticMarkup(
            <ForgeWorkspaceDesktop
              riskSummary={{ severity: "low", score: 0 }}
              alertItems={[]}
              isOwnerOrCoOwner={false}
            />,
          );
        expect(hiddenMarkup).not.toContain("data-health-tile");

        const visibleMarkup =
          renderToStaticMarkup(
            <ForgeWorkspaceDesktop
              riskSummary={{ severity: "low", score: 0 }}
              alertItems={[]}
              isOwnerOrCoOwner
            />,
          );
        expect(visibleMarkup).toContain("data-health-tile");
      },
    );
  },
);
