import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import ApplicationShell, {
  normalizeApplicationFunctions,
  resolveActiveFunction,
} from "../../ApplicationShell.jsx";

describe(
  "ApplicationShell",
  () => {
    const functions = [
      {
        id: "overview",
        label: "Overview",
      },
      {
        id: "transactions",
        label: "Transactions",
      },
      {
        id: "properties",
        label: "Properties",
      },
    ];

    it(
      "renders contextual application navigation and one active surface",
      () => {
        const markup =
          renderToStaticMarkup(
            <ApplicationShell
              applicationName="Financial"
              applicationDescription="Focused financial operations."
              functions={functions}
              activeFunctionId="transactions"
              activeSurface={
                <section>
                  Transaction workspace
                </section>
              }
            />,
          );

        expect(markup).toContain(
          "data-application-shell",
        );

        expect(markup).toContain(
          'data-active-function="transactions"',
        );

        expect(markup).toContain(
          'data-active-function-surface="transactions"',
        );

        expect(markup).not.toContain(
          "← Workspace",
        );

        expect(markup).toContain(
          "Financial",
        );

        expect(markup).toContain(
          "Overview",
        );

        expect(markup).toContain(
          "Transactions",
        );

        expect(markup).toContain(
          "Properties",
        );

        expect(markup).toContain(
          'aria-current="page"',
        );

        expect(markup).toContain(
          "Transaction workspace",
        );

        expect(markup).not.toContain(
          "Inactive overview content",
        );
      },
    );

    it(
      "falls back to the first valid function",
      () => {
        expect(
          resolveActiveFunction(
            functions,
            "missing",
          ),
        ).toBe("overview");

        const markup =
          renderToStaticMarkup(
            <ApplicationShell
              applicationName="Financial"
              functions={functions}
              activeFunctionId="missing"
              activeSurface={
                <div>
                  Overview workspace
                </div>
              }
            />,
          );

        expect(markup).toContain(
          'data-active-function="overview"',
        );

        expect(markup).toContain(
          "Overview workspace",
        );
      },
    );

    it(
      "normalizes the function contract",
      () => {
        const normalized =
          normalizeApplicationFunctions([
            {
              id: " overview ",
              label: " Overview ",
            },
            {
              id: "",
              label: "Invalid",
            },
            null,
          ]);

        expect(normalized).toEqual([
          {
            id: "overview",
            label: "Overview",
          },
        ]);

        expect(
          Object.isFrozen(
            normalized,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            normalized[0],
          ),
        ).toBe(true);
      },
    );

    it(
      "recomposes navigation through overflow instead of shrinking controls",
      () => {
        const markup =
          renderToStaticMarkup(
            <ApplicationShell
              applicationName="Financial"
              functions={functions}
              activeFunctionId="overview"
              activeSurface={
                <div>Overview</div>
              }
            />,
          );

        expect(markup).toContain(
          "overflow-x-auto",
        );

        expect(markup).toContain(
          "shrink-0",
        );

        expect(markup).toContain(
          "max-w-[1800px]",
        );
      },
    );
  },
);
