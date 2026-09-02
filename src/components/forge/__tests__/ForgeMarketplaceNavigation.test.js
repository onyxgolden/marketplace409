import {
  readFileSync,
} from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

function source(relativePath) {
  return readFileSync(
    new URL(
      relativePath,
      import.meta.url,
    ),
    "utf8",
  );
}

describe(
  "Marketplace and FORGE navigation bridge",
  () => {
    it(
      "launches FORGE from desktop and mobile marketplace navigation",
      () => {
        const header =
          source(
            "../../Header.js",
          );

        const homePage =
          source(
            "../../../app/page.jsx",
          );

        expect(
          header.match(
            /href="\/forge"/g,
          ),
        ).toHaveLength(2);

        expect(
          header.match(
            /Launch FORGE/g,
          ),
        ).toHaveLength(2);

        expect(
          header,
        ).not.toContain(
          'href="/import"',
        );

        expect(
          homePage,
        ).not.toContain(
          "HomeForgeLaunch",
        );
      },
    );

    it(
      "names the marketplace return destination in every FORGE navigation",
      () => {
        const rail =
          source(
            "../ForgeApplicationRail.jsx",
          );

        const sidebar =
          source(
            "../ForgeSidebar.js",
          );

        const bar =
          source(
            "../ForgeNavigationBar.js",
          );

        // ForgeApplicationRail no longer names its own return link — it
        // renders the shared cross-workspace switcher (WorkspaceLinks),
        // which includes a "Marketplace" destination pointing at /market,
        // plus an explicit "All apps" link back to the hub. Assert the
        // rail wires in that shared switcher rather than duplicating its
        // own copy of the marketplace link.
        expect(
          rail,
        ).toContain(
          "WorkspaceLinks",
        );

        const shell =
          source(
            "../../workspace-shell.jsx",
          );

        expect(
          shell,
        ).toContain(
          "All apps",
        );

        expect(
          sidebar,
        ).toContain(
          "Return to 409 Marketplace",
        );

        expect(
          bar,
        ).toContain(
          "← 409 Marketplace",
        );
      },
    );
  },
);
