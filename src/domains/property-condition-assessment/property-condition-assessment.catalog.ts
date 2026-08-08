import type {
  PropertyConditionSection,
} from "./property-condition-assessment.types";

export const PROPERTY_CONDITION_CATALOG_SOURCE =
  Object.freeze({
    authority:
      "Texas Real Estate Commission",
    formId: "REI 7-6",
    effectiveDate: "2022-02-01",
    usage:
      "Checklist alignment only; owner assessments are not licensed inspections.",
  });

export const PROPERTY_CONDITION_ATTRIBUTE_INPUT_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "boolean",
] as const;

export type PropertyConditionAttributeInputType =
  typeof PROPERTY_CONDITION_ATTRIBUTE_INPUT_TYPES[number];

export type PropertyConditionAttributeDefinition =
  Readonly<{
    key: string;
    label: string;
    inputType:
      PropertyConditionAttributeInputType;
    unit: string | null;
    options: readonly string[];
  }>;

export type PropertyConditionChecklistItemDefinition =
  Readonly<{
    section: PropertyConditionSection;
    itemKey: string;
    label: string;
    attributes:
      readonly PropertyConditionAttributeDefinition[];
  }>;

function field(
  key: string,
  label: string,
  inputType:
    PropertyConditionAttributeInputType =
      "text",
  options:
    readonly string[] = [],
  unit: string | null = null,
): PropertyConditionAttributeDefinition {
  return Object.freeze({
    key,
    label,
    inputType,
    unit,
    options:
      Object.freeze([
        ...options,
      ]),
  });
}

function item(
  section: PropertyConditionSection,
  itemKey: string,
  label: string,
  attributes:
    readonly PropertyConditionAttributeDefinition[] =
      [],
): PropertyConditionChecklistItemDefinition {
  return Object.freeze({
    section,
    itemKey,
    label,
    attributes:
      Object.freeze([
        ...attributes,
      ]),
  });
}

const AGE_FIELDS = Object.freeze([
  field(
    "installedYear",
    "Installed year",
    "number",
  ),
  field(
    "estimatedAgeYears",
    "Estimated age",
    "number",
    [],
    "years",
  ),
]);

const EQUIPMENT_IDENTITY_FIELDS =
  Object.freeze([
    field(
      "manufacturer",
      "Manufacturer",
    ),
    field(
      "modelNumber",
      "Model number",
    ),
    field(
      "serialNumber",
      "Serial number",
    ),
    ...AGE_FIELDS,
    field(
      "location",
      "Location",
    ),
    field(
      "warrantyExpiration",
      "Warranty expiration",
      "date",
    ),
  ]);

const APPLIANCE_FIELDS =
  Object.freeze([
    ...EQUIPMENT_IDENTITY_FIELDS,
    field(
      "energySource",
      "Energy source",
      "select",
      [
        "electric",
        "natural_gas",
        "propane",
        "other",
        "unknown",
      ],
    ),
  ]);

export const PROPERTY_CONDITION_CHECKLIST_CATALOG =
  Object.freeze([
    item(
      "structural_systems",
      "foundations",
      "Foundations",
      [
        field(
          "foundationType",
          "Foundation type",
          "select",
          [
            "slab_on_grade",
            "pier_and_beam",
            "basement",
            "crawlspace",
            "other",
            "unknown",
          ],
        ),
        field(
          "foundationMaterial",
          "Foundation material",
        ),
        ...AGE_FIELDS,
      ],
    ),
    item(
      "structural_systems",
      "grading_and_drainage",
      "Grading and Drainage",
      [
        field(
          "drainageType",
          "Drainage type",
        ),
        field(
          "standingWaterObserved",
          "Standing water observed",
          "boolean",
        ),
      ],
    ),
    item(
      "structural_systems",
      "roof_covering_materials",
      "Roof Covering Materials",
      [
        field(
          "roofCoveringType",
          "Roof covering type",
          "select",
          [
            "asphalt_shingle",
            "metal",
            "tile",
            "built_up",
            "modified_bitumen",
            "single_ply",
            "wood_shake",
            "other",
            "unknown",
          ],
        ),
        ...AGE_FIELDS,
        field(
          "warrantyExpiration",
          "Warranty expiration",
          "date",
        ),
        field(
          "viewedFrom",
          "Viewed from",
        ),
      ],
    ),
    item(
      "structural_systems",
      "roof_structures_and_attics",
      "Roof Structures and Attics",
      [
        field(
          "roofStructureType",
          "Roof structure type",
        ),
        field(
          "insulationDepthInches",
          "Average insulation depth",
          "number",
          [],
          "inches",
        ),
        field(
          "viewedFrom",
          "Viewed from",
        ),
      ],
    ),
    item(
      "structural_systems",
      "walls",
      "Walls (Interior and Exterior)",
    ),
    item(
      "structural_systems",
      "ceilings_and_floors",
      "Ceilings and Floors",
    ),
    item(
      "structural_systems",
      "doors",
      "Doors (Interior and Exterior)",
    ),
    item(
      "structural_systems",
      "windows",
      "Windows",
      [
        field(
          "windowType",
          "Window type",
        ),
        ...AGE_FIELDS,
      ],
    ),
    item(
      "structural_systems",
      "stairways",
      "Stairways (Interior and Exterior)",
    ),
    item(
      "structural_systems",
      "fireplaces_and_chimneys",
      "Fireplaces and Chimneys",
      [
        field(
          "fireplaceType",
          "Fireplace type",
        ),
        field(
          "energySource",
          "Energy source",
        ),
      ],
    ),
    item(
      "structural_systems",
      "porches_balconies_decks_carports",
      "Porches, Balconies, Decks, and Carports",
      [
        field(
          "constructionMaterial",
          "Construction material",
        ),
        ...AGE_FIELDS,
      ],
    ),
    item(
      "structural_systems",
      "structural_other",
      "Other Structural Systems",
    ),

    item(
      "electrical_systems",
      "service_entrance_and_panels",
      "Service Entrance and Panels",
      [
        field(
          "serviceAmperage",
          "Service amperage",
          "number",
          [],
          "amps",
        ),
        field(
          "panelManufacturer",
          "Panel manufacturer",
        ),
        field(
          "panelModel",
          "Panel model",
        ),
        field(
          "panelLocation",
          "Panel location",
        ),
        ...AGE_FIELDS,
      ],
    ),
    item(
      "electrical_systems",
      "branch_circuits_devices_fixtures",
      "Branch Circuits, Connected Devices, and Fixtures",
      [
        field(
          "wiringType",
          "Wiring type",
        ),
        field(
          "afciPresent",
          "AFCI protection present",
          "boolean",
        ),
        field(
          "gfciPresent",
          "GFCI protection present",
          "boolean",
        ),
      ],
    ),
    item(
      "electrical_systems",
      "electrical_other",
      "Other Electrical Systems",
    ),

    item(
      "hvac_systems",
      "heating_equipment",
      "Heating Equipment",
      [
        field(
          "systemType",
          "Heating system type",
        ),
        field(
          "energySource",
          "Energy source",
          "select",
          [
            "electric",
            "natural_gas",
            "propane",
            "heat_pump",
            "other",
            "unknown",
          ],
        ),
        ...EQUIPMENT_IDENTITY_FIELDS,
        field(
          "efficiencyRating",
          "Efficiency rating",
        ),
      ],
    ),
    item(
      "hvac_systems",
      "cooling_equipment",
      "Cooling Equipment",
      [
        field(
          "systemType",
          "Cooling system type",
          "select",
          [
            "split_system",
            "package_unit",
            "mini_split",
            "window_unit",
            "evaporative",
            "other",
            "unknown",
          ],
        ),
        field(
          "refrigerantType",
          "Refrigerant type",
          "select",
          [
            "R-22",
            "R-410A",
            "R-32",
            "R-454B",
            "other",
            "unknown",
          ],
        ),
        field(
          "tonnage",
          "Cooling capacity",
          "number",
          [],
          "tons",
        ),
        field(
          "seerRating",
          "SEER rating",
          "number",
        ),
        ...EQUIPMENT_IDENTITY_FIELDS,
        field(
          "thermostatType",
          "Thermostat type",
        ),
      ],
    ),
    item(
      "hvac_systems",
      "duct_systems_chases_vents",
      "Duct Systems, Chases, and Vents",
      [
        field(
          "ductMaterial",
          "Duct material",
        ),
        ...AGE_FIELDS,
      ],
    ),
    item(
      "hvac_systems",
      "hvac_other",
      "Other HVAC Systems",
    ),

    item(
      "plumbing_systems",
      "supply_distribution_fixtures",
      "Plumbing Supply, Distribution Systems, and Fixtures",
      [
        field(
          "waterMeterLocation",
          "Water meter location",
        ),
        field(
          "mainValveLocation",
          "Main water valve location",
        ),
        field(
          "staticPressurePsi",
          "Static water pressure",
          "number",
          [],
          "psi",
        ),
        field(
          "supplyPipingMaterial",
          "Supply piping material",
        ),
        ...AGE_FIELDS,
      ],
    ),
    item(
      "plumbing_systems",
      "drains_wastes_vents",
      "Drains, Wastes, and Vents",
      [
        field(
          "drainPipingMaterial",
          "Drain piping material",
        ),
        ...AGE_FIELDS,
      ],
    ),
    item(
      "plumbing_systems",
      "water_heating_equipment",
      "Water Heating Equipment",
      [
        field(
          "heaterType",
          "Water heater type",
          "select",
          [
            "tank",
            "tankless",
            "heat_pump",
            "solar",
            "other",
            "unknown",
          ],
        ),
        field(
          "energySource",
          "Energy source",
          "select",
          [
            "electric",
            "natural_gas",
            "propane",
            "solar",
            "other",
            "unknown",
          ],
        ),
        field(
          "capacityGallons",
          "Capacity",
          "number",
          [],
          "gallons",
        ),
        ...EQUIPMENT_IDENTITY_FIELDS,
      ],
    ),
    item(
      "plumbing_systems",
      "hydro_massage_equipment",
      "Hydro-Massage Therapy Equipment",
      EQUIPMENT_IDENTITY_FIELDS,
    ),
    item(
      "plumbing_systems",
      "gas_distribution_and_appliances",
      "Gas Distribution Systems and Gas Appliances",
      [
        field(
          "gasMeterLocation",
          "Gas meter location",
        ),
        field(
          "gasPipingMaterial",
          "Gas piping material",
        ),
      ],
    ),
    item(
      "plumbing_systems",
      "plumbing_other",
      "Other Plumbing Systems",
    ),

    item(
      "appliances",
      "dishwashers",
      "Dishwashers",
      APPLIANCE_FIELDS,
    ),
    item(
      "appliances",
      "food_waste_disposers",
      "Food Waste Disposers",
      APPLIANCE_FIELDS,
    ),
    item(
      "appliances",
      "range_hood_exhaust_systems",
      "Range Hood and Exhaust Systems",
      APPLIANCE_FIELDS,
    ),
    item(
      "appliances",
      "ranges_cooktops_ovens",
      "Ranges, Cooktops, and Ovens",
      APPLIANCE_FIELDS,
    ),
    item(
      "appliances",
      "microwave_ovens",
      "Microwave Ovens",
      APPLIANCE_FIELDS,
    ),
    item(
      "appliances",
      "mechanical_exhaust_bathroom_heaters",
      "Mechanical Exhaust Vents and Bathroom Heaters",
      APPLIANCE_FIELDS,
    ),
    item(
      "appliances",
      "garage_door_operators",
      "Garage Door Operators",
      APPLIANCE_FIELDS,
    ),
    item(
      "appliances",
      "dryer_exhaust_systems",
      "Dryer Exhaust Systems",
      [
        field(
          "ductMaterial",
          "Duct material",
        ),
        field(
          "terminationLocation",
          "Termination location",
        ),
        ...AGE_FIELDS,
      ],
    ),
    item(
      "appliances",
      "appliances_other",
      "Other Appliances",
      APPLIANCE_FIELDS,
    ),

    item(
      "optional_systems",
      "landscape_irrigation",
      "Landscape Irrigation (Sprinkler) Systems",
      [
        field(
          "zoneCount",
          "Number of zones",
          "number",
        ),
        field(
          "controllerManufacturer",
          "Controller manufacturer",
        ),
        ...AGE_FIELDS,
      ],
    ),
    item(
      "optional_systems",
      "pools_spas_hot_tubs",
      "Swimming Pools, Spas, Hot Tubs, and Equipment",
      [
        field(
          "constructionType",
          "Construction type",
        ),
        ...EQUIPMENT_IDENTITY_FIELDS,
      ],
    ),
    item(
      "optional_systems",
      "outbuildings",
      "Outbuildings",
      [
        field(
          "buildingType",
          "Building type",
        ),
        ...AGE_FIELDS,
      ],
    ),
    item(
      "optional_systems",
      "private_water_wells",
      "Private Water Wells",
      [
        field(
          "pumpType",
          "Pump type",
        ),
        field(
          "storageEquipmentType",
          "Storage equipment type",
        ),
        ...EQUIPMENT_IDENTITY_FIELDS,
      ],
    ),
    item(
      "optional_systems",
      "private_sewage_disposal",
      "Private Sewage Disposal Systems",
      [
        field(
          "systemType",
          "System type",
        ),
        field(
          "drainFieldLocation",
          "Drain field location",
        ),
        ...AGE_FIELDS,
      ],
    ),
    item(
      "optional_systems",
      "other_built_in_appliances",
      "Other Built-in Appliances",
      APPLIANCE_FIELDS,
    ),
    item(
      "optional_systems",
      "optional_other",
      "Other Optional Systems",
    ),
  ] satisfies
    readonly PropertyConditionChecklistItemDefinition[]);

export function getPropertyConditionChecklistItem(
  itemKey: string,
): PropertyConditionChecklistItemDefinition | null {
  return (
    PROPERTY_CONDITION_CHECKLIST_CATALOG.find(
      (definition) =>
        definition.itemKey ===
        itemKey,
    ) ?? null
  );
}

export function getPropertyConditionChecklistBySection(
  section: PropertyConditionSection,
): readonly PropertyConditionChecklistItemDefinition[] {
  return Object.freeze(
    PROPERTY_CONDITION_CHECKLIST_CATALOG.filter(
      (definition) =>
        definition.section ===
        section,
    ),
  );
}
