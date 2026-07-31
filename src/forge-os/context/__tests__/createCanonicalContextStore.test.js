import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createCanonicalContextStore,
} from "../createCanonicalContextStore.js";

describe(
  "createCanonicalContextStore",
  () => {
    it(
      "creates a Version 1 canonical context store",
      () => {
        const store =
          createCanonicalContextStore();

        const context =
          store.getCurrent();

        expect(
          context.metadata.contractType,
        ).toBe(
          "context",
        );

        expect(
          context.payload.contextIdentity,
        ).toBe(
          "forge-canonical-context-v1",
        );

        expect(
          context.payload.repositoryState,
        ).toEqual(
          {},
        );
      },
    );
  },
);
