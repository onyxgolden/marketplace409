import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(
  () => ({
    redirect:
      vi.fn(),
  }),
);

vi.mock(
  "next/navigation",
  () => ({
    redirect:
      mocks.redirect,
  }),
);

import ImportPage from "./page.js";

describe(
  "/import",
  () => {
    beforeEach(() => {
      mocks.redirect.mockReset();
    });

    it(
      "redirects legacy imports into the FORGE application shell",
      () => {
        ImportPage();

        expect(
          mocks.redirect,
        ).toHaveBeenCalledWith(
          "/forge/import",
        );
      },
    );
  },
);
