import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ContextContributionApplier,
} from "../ContextContributionApplier.js";

import {
  createCanonicalContextStore,
} from "../createCanonicalContextStore.js";


describe(
  "ContextContributionApplier",
  () => {
    it(
      "appends immutable contribution history",
      () => {
        const store =
          createCanonicalContextStore();

        const applier =
          new ContextContributionApplier();

        const nextContext =
          applier.apply({
            currentContext:
              store.getCurrent(),
            managerIdentity:
              "planning-manager",
            contextContribution: {
              planningCompleted:
                true,
            },
          });

        expect(
          nextContext.payload.contributionHistory.length,
        ).toBe(1);

        expect(
          nextContext.payload.contributionHistory[0].metadata.contractType,
        ).toBe(
          "context-evolution-record",
        );

        expect(
          nextContext.payload.contributionHistory[0].payload.sourceManager,
        ).toBe(
          "planning-manager",
        );
      },
    );

    it(
      "rejects invalid contributions",
      () => {
        const store =
          createCanonicalContextStore();

        const applier =
          new ContextContributionApplier();

        expect(
          () =>
            applier.apply({
              currentContext:
                store.getCurrent(),
              managerIdentity:
                "test-manager",
              contextContribution:
                null,
            }),
        ).toThrow();
      },
    );
  },
);
