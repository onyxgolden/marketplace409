import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildForgeApplications,
  FORGE_APPLICATIONS,
  FORGE_PROGRAMMER_APPLICATION,
} from "../ForgeApplicationRail";

describe(
  "FORGE programmer navigation",
  () => {
    it(
      "hides programmer tools by default",
      () => {
        const applications =
          buildForgeApplications();

        expect(
          applications,
        ).toBe(
          FORGE_APPLICATIONS,
        );

        expect(
          applications,
        ).not.toContain(
          FORGE_PROGRAMMER_APPLICATION,
        );
      },
    );

    it(
      "adds programmer tools only after authorization",
      () => {
        const applications =
          buildForgeApplications(
            true,
          );

        expect(
          applications.at(-1),
        ).toBe(
          FORGE_PROGRAMMER_APPLICATION,
        );

        expect(
          applications.at(-1),
        ).toEqual({
          href:
            "/forge/developer",
          label:
            "Programmer",
          shortLabel:
            "D",
        });
      },
    );
  },
);
