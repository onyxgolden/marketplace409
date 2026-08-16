import {
  describe,
  expect,
  it,
} from "vitest";

import {
  FORGE_APPLICATIONS,
  isPromotedSubtree,
} from "../ForgeApplicationRail";

describe(
  "FORGE programmer navigation",
  () => {
    it(
      "no longer lists Rental Manager or Programmer as internal Forge sub-nav items",
      () => {
        const hrefs = FORGE_APPLICATIONS.map(
          (application) => application.href,
        );

        expect(hrefs).not.toContain("/forge/rental");
        expect(hrefs).not.toContain("/forge/developer");
      },
    );

    it(
      "treats /forge/developer as a promoted subtree the rail steps aside for",
      () => {
        expect(
          isPromotedSubtree("/forge/developer"),
        ).toBe(true);

        expect(
          isPromotedSubtree("/forge/developer/anything"),
        ).toBe(true);
      },
    );

    it(
      "treats /forge/rental as a promoted subtree the rail steps aside for",
      () => {
        expect(
          isPromotedSubtree("/forge/rental"),
        ).toBe(true);

        expect(
          isPromotedSubtree("/forge/rental/portal"),
        ).toBe(true);
      },
    );

    it(
      "does not treat core Forge routes as promoted",
      () => {
        expect(isPromotedSubtree("/forge")).toBe(false);
        expect(isPromotedSubtree("/forge/financial")).toBe(false);
      },
    );
  },
);
