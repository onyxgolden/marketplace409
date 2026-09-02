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
  "next/navigation",
  () => ({
    usePathname: () =>
      "/forge/property",
  }),
);

import ThemeProvider from "@/components/theme/ThemeProvider";

import ForgeApplicationRail, {
  FORGE_APPLICATIONS,
  isForgeApplicationActive,
} from "../ForgeApplicationRail.jsx";

describe(
  "ForgeApplicationRail",
  () => {
    it(
      "defines the shared application destinations",
      () => {
        expect(
          FORGE_APPLICATIONS.map(
            ({ label }) =>
              label,
          ),
        ).toEqual([
          "Workspace",
          "Financial",
          "Health",
          "Property",
          "Connections",
          "Results",
          "Import",
          "Members",
        ]);

        expect(
          Object.isFrozen(
            FORGE_APPLICATIONS,
          ),
        ).toBe(true);
      },
    );

    it(
      "resolves exact and nested active routes",
      () => {
        expect(
          isForgeApplicationActive(
            "/forge",
            FORGE_APPLICATIONS[0],
          ),
        ).toBe(true);

        expect(
          isForgeApplicationActive(
            "/forge/financial/report",
            FORGE_APPLICATIONS[1],
          ),
        ).toBe(true);

        expect(
          isForgeApplicationActive(
            "/forge/property",
            FORGE_APPLICATIONS[1],
          ),
        ).toBe(false);

        expect(
          FORGE_APPLICATIONS[6].href,
        ).toBe(
          "/forge/import",
        );

        expect(
          isForgeApplicationActive(
            "/forge/import/review",
            FORGE_APPLICATIONS[6],
          ),
        ).toBe(true);

        expect(
          FORGE_APPLICATIONS[7].href,
        ).toBe(
          "/forge/workspace",
        );

        expect(
          isForgeApplicationActive(
            "/forge/workspace",
            FORGE_APPLICATIONS[7],
          ),
        ).toBe(true);
      },
    );

    it(
      "wraps one route surface with desktop and mobile navigation",
      () => {
        const markup =
          renderToStaticMarkup(
            <ThemeProvider>
              <ForgeApplicationRail>
                <main>
                  Property workspace
                </main>
              </ForgeApplicationRail>
            </ThemeProvider>,
          );

        expect(markup).toContain(
          "data-forge-route-shell",
        );
        expect(markup).toContain(
          "data-forge-application-rail",
        );
        expect(markup).toContain(
          "data-forge-route-content",
        );
        expect(markup).toContain(
          "Property workspace",
        );
        expect(markup).toContain(
          'aria-label="Forge applications"',
        );
        expect(markup).toContain(
          'aria-current="page"',
        );
        expect(markup).toContain(
          'data-expanded="false"',
        );
        expect(markup).toContain(
          "Open Forge navigation",
        );
      },
    );

    it(
      "renders a compact, accessible theme menu button in the persistent nav",
      () => {
        const markup =
          renderToStaticMarkup(
            <ThemeProvider>
              <ForgeApplicationRail>
                <main>
                  Property workspace
                </main>
              </ForgeApplicationRail>
            </ThemeProvider>,
          );

        expect(markup).toContain(
          'aria-haspopup="menu"',
        );
        expect(markup).toContain(
          'aria-expanded="false"',
        );
        expect(markup).toContain(
          "Theme: System",
        );
      },
    );
  },
);
