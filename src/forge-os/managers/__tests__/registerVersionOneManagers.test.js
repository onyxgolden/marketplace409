import {
  describe,
  expect,
  it,
} from "vitest";

import {
  registerVersionOneManagers,
} from "../registerVersionOneManagers.js";

describe(
  "registerVersionOneManagers",
  () => {
    it(
      "registers the Version 1 manager boundary",
      () => {
        const registry =
          registerVersionOneManagers();

        expect(
          registry.has(
            "repository-intelligence-manager",
          ),
        ).toBe(true);

        expect(
          registry.hasCapability(
            "repository.inspect",
          ),
        ).toBe(true);
      },
    );

    it(
      "returns an isolated manager registry",
      () => {
        const registry =
          registerVersionOneManagers();

        expect(
          registry.resolve(
            "repository.inspect",
          ).managerIdentity,
        ).toBe(
          "repository-intelligence-manager",
        );
      },
    );
  },
);
