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
            "../../../app/page.js",
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

        expect(
          rail,
        ).toContain(
          "409 Marketplace",
        );

        expect(
          rail,
        ).toContain(
          "Return to 409 Marketplace",
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
