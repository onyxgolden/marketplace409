import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

vi.mock(
  "@/components/forge/property/PropertyApplicationShell",
  () => ({
    default: function MockPropertyApplicationShell({
      activeFunctionId,
    }) {
      return (
        <section
          data-property-application
          data-active-function={
            activeFunctionId
          }
        />
      );
    },
  }),
);

import PropertyPage from "./page.js";

describe(
  "/forge/property",
  () => {
    it(
      "opens the focused Property application on valuations",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyPage />,
          );

        expect(markup).toContain(
          "data-property-application",
        );

        expect(markup).toContain(
          'data-active-function="valuations"',
        );
      },
    );
  },
);
