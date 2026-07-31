import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CanonicalEngineeringContextStore,
} from "../CanonicalEngineeringContextStore.js";

describe(
  "CanonicalEngineeringContextStore",
  () => {
    it(
      "returns the current immutable context",
      () => {
        const context =
          Object.freeze({
            id: "context-1",
          });

        const store =
          new CanonicalEngineeringContextStore(
            context,
          );

        expect(
          store.getCurrent(),
        ).toBe(
          context,
        );

        expect(
          store.snapshot(),
        ).toBe(
          context,
        );
      },
    );

    it(
      "replaces the current context version",
      () => {
        const initialContext =
          Object.freeze({
            id: "context-1",
          });

        const nextContext =
          Object.freeze({
            id: "context-2",
          });

        const store =
          new CanonicalEngineeringContextStore(
            initialContext,
          );

        store.replaceContext(
          nextContext,
        );

        expect(
          store.getCurrent(),
        ).toBe(
          nextContext,
        );

        expect(
          initialContext.id,
        ).toBe(
          "context-1",
        );
      },
    );
  },
);
