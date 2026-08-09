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
  "../PropertyValuationPanel",
  () => ({
    default: function MockValuations() {
      return (
        <section data-valuations-function>
          Valuations function
        </section>
      );
    },
  }),
);

vi.mock(
  "../PropertyConditionAssessmentPanel",
  () => ({
    default: function MockCondition() {
      return (
        <section data-condition-function>
          Condition function
        </section>
      );
    },
  }),
);

vi.mock(
  "../PropertyHVACPanel",
  () => ({
    default: function MockHVAC() {
      return (
        <section data-hvac-function>
          HVAC and evidence function
        </section>
      );
    },
  }),
);

import PropertyApplicationShell, {
  PROPERTY_FUNCTIONS,
} from "../PropertyApplicationShell.jsx";

function renderFunction(
  activeFunctionId,
) {
  return renderToStaticMarkup(
    <PropertyApplicationShell
      activeFunctionId={
        activeFunctionId
      }
    />,
  );
}

describe(
  "PropertyApplicationShell",
  () => {
    it(
      "defines the focused Property function set",
      () => {
        expect(
          PROPERTY_FUNCTIONS,
        ).toEqual([
          {
            id: "valuations",
            label: "Valuations",
          },
          {
            id: "condition",
            label: "Condition",
          },
          {
            id: "hvac",
            label: "HVAC & Evidence",
          },
        ]);
      },
    );

    it.each([
      [
        "valuations",
        "data-valuations-function",
      ],
      [
        "condition",
        "data-condition-function",
      ],
      [
        "hvac",
        "data-hvac-function",
      ],
    ])(
      "renders only the %s function surface",
      (
        activeFunctionId,
        expectedMarker,
      ) => {
        const markup =
          renderFunction(
            activeFunctionId,
          );

        expect(markup).toContain(
          `data-active-function="${activeFunctionId}"`,
        );

        expect(markup).toContain(
          expectedMarker,
        );

        const allMarkers = [
          "data-valuations-function",
          "data-condition-function",
          "data-hvac-function",
        ];

        for (
          const marker of allMarkers
        ) {
          if (
            marker !==
            expectedMarker
          ) {
            expect(markup).not
              .toContain(marker);
          }
        }
      },
    );

    it(
      "falls back to valuations for an unknown function",
      () => {
        const markup =
          renderFunction(
            "unsupported",
          );

        expect(markup).toContain(
          'data-active-function="valuations"',
        );

        expect(markup).toContain(
          "data-valuations-function",
        );
      },
    );
  },
);
