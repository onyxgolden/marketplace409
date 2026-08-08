import {
  describe,
  expect,
  it,
} from "vitest";

import {
  PROPERTY_CONDITION_CATALOG_SOURCE,
  PROPERTY_CONDITION_CHECKLIST_CATALOG,
  getPropertyConditionChecklistBySection,
  getPropertyConditionChecklistItem,
} from "../property-condition-assessment.catalog";

describe(
  "property condition assessment catalog",
  () => {
    it(
      "contains the 41 REI 7-6 checklist items",
      () => {
        expect(
          PROPERTY_CONDITION_CHECKLIST_CATALOG,
        ).toHaveLength(41);

        expect(
          new Set(
            PROPERTY_CONDITION_CHECKLIST_CATALOG.map(
              ({ itemKey }) =>
                itemKey,
            ),
          ).size,
        ).toBe(41);

        expect(
          PROPERTY_CONDITION_CATALOG_SOURCE,
        ).toMatchObject({
          formId: "REI 7-6",
          effectiveDate:
            "2022-02-01",
        });
      },
    );

    it.each([
      [
        "structural_systems",
        12,
      ],
      [
        "electrical_systems",
        3,
      ],
      [
        "hvac_systems",
        4,
      ],
      [
        "plumbing_systems",
        6,
      ],
      [
        "appliances",
        9,
      ],
      [
        "optional_systems",
        7,
      ],
    ] as const)(
      "%s contains %i definitions",
      (section, count) => {
        expect(
          getPropertyConditionChecklistBySection(
            section,
          ),
        ).toHaveLength(count);
      },
    );

    it(
      "defines structured roof fields",
      () => {
        const roof =
          getPropertyConditionChecklistItem(
            "roof_covering_materials",
          );

        expect(
          roof?.attributes.map(
            ({ key }) => key,
          ),
        ).toEqual(
          expect.arrayContaining([
            "roofCoveringType",
            "installedYear",
            "estimatedAgeYears",
            "warrantyExpiration",
          ]),
        );
      },
    );

    it(
      "defines detailed cooling equipment fields",
      () => {
        const cooling =
          getPropertyConditionChecklistItem(
            "cooling_equipment",
          );

        expect(
          cooling?.attributes.map(
            ({ key }) => key,
          ),
        ).toEqual(
          expect.arrayContaining([
            "systemType",
            "refrigerantType",
            "tonnage",
            "seerRating",
            "manufacturer",
            "modelNumber",
            "serialNumber",
            "installedYear",
            "estimatedAgeYears",
            "thermostatType",
            "warrantyExpiration",
          ]),
        );
      },
    );

    it(
      "defines structured water-heater fields",
      () => {
        const waterHeater =
          getPropertyConditionChecklistItem(
            "water_heating_equipment",
          );

        expect(
          waterHeater?.attributes.map(
            ({ key }) => key,
          ),
        ).toEqual(
          expect.arrayContaining([
            "heaterType",
            "energySource",
            "capacityGallons",
            "manufacturer",
            "modelNumber",
            "serialNumber",
            "installedYear",
            "estimatedAgeYears",
            "warrantyExpiration",
          ]),
        );
      },
    );

    it(
      "deep-freezes catalog definitions",
      () => {
        const cooling =
          getPropertyConditionChecklistItem(
            "cooling_equipment",
          );

        expect(
          Object.isFrozen(
            PROPERTY_CONDITION_CHECKLIST_CATALOG,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(cooling),
        ).toBe(true);

        expect(
          Object.isFrozen(
            cooling?.attributes,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            cooling?.attributes[0],
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            cooling?.attributes[0]
              .options,
          ),
        ).toBe(true);
      },
    );

    it(
      "returns null for an unknown item key",
      () => {
        expect(
          getPropertyConditionChecklistItem(
            "unknown",
          ),
        ).toBeNull();
      },
    );
  },
);
