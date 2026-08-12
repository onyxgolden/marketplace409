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
          "Property",
          "Rental Manager",
          "Connections",
          "Results",
          "Import",
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
      },
    );

    it(
      "wraps one route surface with desktop and mobile navigation",
      () => {
        const markup =
          renderToStaticMarkup(
            <ForgeApplicationRail>
              <main>
                Property workspace
              </main>
            </ForgeApplicationRail>,
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
  },
);
