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
          "Inbox",
          "Financial",
          "Budget",
          "Property",
          "Work Packages",
          "Connections",
          "Results",
          "Import",
          "Members",
          "Capture",
          "Call Shield",
          "Charts",
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
        const byHref = (href) =>
          FORGE_APPLICATIONS.find((application) => application.href === href);

        expect(
          isForgeApplicationActive(
            "/forge",
            FORGE_APPLICATIONS[0],
          ),
        ).toBe(true);

        expect(
          isForgeApplicationActive(
            "/forge/inbox",
            byHref("/forge/inbox"),
          ),
        ).toBe(true);

        expect(
          isForgeApplicationActive(
            "/forge/financial/report",
            byHref("/forge/financial"),
          ),
        ).toBe(true);

        expect(
          isForgeApplicationActive(
            "/forge/property",
            byHref("/forge/financial"),
          ),
        ).toBe(false);

        expect(
          isForgeApplicationActive(
            "/forge/import/review",
            byHref("/forge/import"),
          ),
        ).toBe(true);

        expect(
          isForgeApplicationActive(
            "/forge/workspace",
            byHref("/forge/workspace"),
          ),
        ).toBe(true);
      },
    );

    it(
      "keeps the Work Packages entry (D2) in the frozen destination list",
      () => {
        const entry = FORGE_APPLICATIONS.find(
          (application) => application.href === "/forge/work",
        );

        expect(entry).toBeDefined();
        expect(entry.label).toBe("Work Packages");
        expect(entry.shortLabel).toBe("WP");

        // Navigation keys must stay unique or rail rendering/active state
        // would collide between two entries.
        const hrefs = FORGE_APPLICATIONS.map((application) => application.href);
        expect(new Set(hrefs).size).toBe(hrefs.length);
      },
    );

    it(
      "activates Work Packages for its list, create, and detail routes only",
      () => {
        const byHref = (href) =>
          FORGE_APPLICATIONS.find((application) => application.href === href);
        const work = byHref("/forge/work");

        expect(isForgeApplicationActive("/forge/work", work)).toBe(true);
        expect(isForgeApplicationActive("/forge/work/new", work)).toBe(true);
        expect(
          isForgeApplicationActive("/forge/work/forge_wp_1", work),
        ).toBe(true);
        expect(isForgeApplicationActive("/forge", work)).toBe(false);
        expect(isForgeApplicationActive("/forge/workspaces", work)).toBe(false);
        expect(
          isForgeApplicationActive("/forge", byHref("/forge")),
        ).toBe(true);
      },
    );

    it(
      "renders the Work Packages link, not active, in the collapsed rail",
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

        // Collapsed rail: the link is announced by aria-label and mirrors the
        // visible label in its tooltip; it must not be the active page (the
        // mocked route is /forge/property).
        expect(markup).toContain('href="/forge/work"');
        expect(markup).toContain('aria-label="Work Packages"');
        const workLink = markup.match(/<a[^>]*href="\/forge\/work"[^>]*>/);
        expect(workLink).not.toBeNull();
        expect(workLink[0]).not.toContain("aria-current");
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
      "offers a one-click way back to the outer workspace picker from deep inside Forge",
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
          "All apps",
        );
        // "All apps" links to /?chooseWorkspace=1, not plain "/" -- the hub page redirects a
        // fresh "/" visit straight to a saved favorite workspace, so "All apps" must opt out of
        // that redirect explicitly or it would just send you right back where you came from.
        expect(
          markup.match(/href="\/\?chooseWorkspace=1"/g),
        ).not.toBeNull();
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
