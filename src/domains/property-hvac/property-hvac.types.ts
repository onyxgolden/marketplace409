export const HVAC_SYSTEM_TYPES = [
  "split_system",
  "package_unit",
  "mini_split",
  "heat_pump",
  "furnace_and_ac",
  "window_unit",
  "evaporative",
  "other",
  "unknown",
] as const;

export type HVACSystemType =
  typeof HVAC_SYSTEM_TYPES[number];

export const HVAC_ENERGY_SOURCES = [
  "electric",
  "natural_gas",
  "propane",
  "dual_fuel",
  "other",
  "unknown",
] as const;

export type HVACEnergySource =
  typeof HVAC_ENERGY_SOURCES[number];

export const HVAC_SYSTEM_STATUSES = [
  "active",
  "inactive",
  "replaced",
  "removed",
  "unknown",
] as const;

export type HVACSystemStatus =
  typeof HVAC_SYSTEM_STATUSES[number];

export const HVAC_CONDITIONS = [
  "good",
  "serviceable",
  "marginal",
  "poor",
  "failed",
  "unknown",
] as const;

export type HVACCondition =
  typeof HVAC_CONDITIONS[number];

export const HVAC_COMPONENT_TYPES = [
  "compressor",
  "condenser_coil",
  "condenser_fan_motor",
  "capacitor",
  "contactor",
  "control_board",
  "pressure_switch",
  "reversing_valve",
  "evaporator_coil",
  "blower_motor",
  "ecm_module",
  "transformer",
  "relay_or_sequencer",
  "heat_strip",
  "txv_or_metering_device",
  "drain_pan",
  "condensate_pump",
  "float_switch",
  "gas_valve",
  "igniter",
  "flame_sensor",
  "inducer_motor",
  "heat_exchanger",
] as const;

export type HVACComponentType =
  typeof HVAC_COMPONENT_TYPES[number];

export const HVAC_COMPONENT_STATUSES = [
  "installed",
  "removed",
  "failed",
  "spare",
  "unknown",
] as const;

export type HVACComponentStatus =
  typeof HVAC_COMPONENT_STATUSES[number];

export const HVAC_COMPONENT_EVENT_TYPES = [
  "installed",
  "inspected",
  "serviced",
  "repaired",
  "failed",
  "replaced",
  "removed",
] as const;

export type HVACComponentEventType =
  typeof HVAC_COMPONENT_EVENT_TYPES[number];

export type HVACSystem = Readonly<{
  id: string;
  propertyId: string;
  name: string;
  systemType: HVACSystemType;
  energySource: HVACEnergySource;
  refrigerantType: string | null;
  tonnage: number | null;
  efficiencyRating: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  installedAt: string | null;
  estimatedAgeYears: number | null;
  location: string | null;
  thermostatType: string | null;
  warrantyExpiration: string | null;
  status: HVACSystemStatus;
  condition: HVACCondition;
  notes: string | null;
  createdAt: string;
}>;

export type HVACComponent = Readonly<{
  id: string;
  systemId: string;
  componentType: HVACComponentType;
  name: string;
  manufacturer: string | null;
  modelNumber: string | null;
  partNumber: string | null;
  serialNumber: string | null;
  installedAt: string | null;
  removedAt: string | null;
  estimatedAgeYears: number | null;
  condition: HVACCondition;
  status: HVACComponentStatus;
  estimatedReplacementCostCents:
    number | null;
  vendorName: string | null;
  invoiceReference: string | null;
  warrantyExpiration: string | null;
  notes: string | null;
  createdAt: string;
}>;

export type HVACComponentEvent = Readonly<{
  id: string;
  systemId: string;
  componentId: string | null;
  eventType: HVACComponentEventType;
  occurredAt: string;
  failureSymptoms: string | null;
  workPerformed: string | null;
  costCents: number | null;
  vendorName: string | null;
  invoiceReference: string | null;
  photoReferences: readonly string[];
  notes: string | null;
  createdAt: string;
}>;

function requireString(
  value: string,
  message: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new Error(message);
  }

  return value.trim();
}

function optionalString(
  value: string | null,
): string | null {
  return value?.trim() || null;
}

function timestamp(
  value: string,
  message: string,
): string {
  const required =
    requireString(
      value,
      message,
    );

  if (
    Number.isNaN(
      Date.parse(required),
    )
  ) {
    throw new Error(message);
  }

  return required;
}

function optionalTimestamp(
  value: string | null,
  message: string,
): string | null {
  return value === null
    ? null
    : timestamp(
        value,
        message,
      );
}

function optionalAge(
  value: number | null,
): number | null {
  if (
    value !== null &&
    (
      !Number.isFinite(value) ||
      value < 0
    )
  ) {
    throw new Error(
      "HVAC estimated age must be a non-negative finite number.",
    );
  }

  return value;
}

function optionalCents(
  value: number | null,
  message: string,
): number | null {
  if (
    value !== null &&
    (
      !Number.isSafeInteger(value) ||
      value < 0
    )
  ) {
    throw new Error(message);
  }

  return value;
}

export function createHVACSystem(
  system: HVACSystem,
): HVACSystem {
  if (
    !HVAC_SYSTEM_TYPES.includes(
      system.systemType,
    )
  ) {
    throw new Error(
      "HVAC system requires a supported system type.",
    );
  }

  if (
    !HVAC_ENERGY_SOURCES.includes(
      system.energySource,
    )
  ) {
    throw new Error(
      "HVAC system requires a supported energy source.",
    );
  }

  if (
    !HVAC_SYSTEM_STATUSES.includes(
      system.status,
    )
  ) {
    throw new Error(
      "HVAC system requires a supported status.",
    );
  }

  if (
    !HVAC_CONDITIONS.includes(
      system.condition,
    )
  ) {
    throw new Error(
      "HVAC system requires a supported condition.",
    );
  }

  if (
    system.tonnage !== null &&
    (
      !Number.isFinite(
        system.tonnage,
      ) ||
      system.tonnage <= 0
    )
  ) {
    throw new Error(
      "HVAC system tonnage must be a positive finite number.",
    );
  }

  return Object.freeze({
    ...system,
    id:
      requireString(
        system.id,
        "HVAC system id is required.",
      ),
    propertyId:
      requireString(
        system.propertyId,
        "HVAC system property id is required.",
      ),
    name:
      requireString(
        system.name,
        "HVAC system name is required.",
      ),
    refrigerantType:
      optionalString(
        system.refrigerantType,
      ),
    efficiencyRating:
      optionalString(
        system.efficiencyRating,
      ),
    manufacturer:
      optionalString(
        system.manufacturer,
      ),
    modelNumber:
      optionalString(
        system.modelNumber,
      ),
    serialNumber:
      optionalString(
        system.serialNumber,
      ),
    installedAt:
      optionalTimestamp(
        system.installedAt,
        "HVAC system installation date must be valid.",
      ),
    estimatedAgeYears:
      optionalAge(
        system.estimatedAgeYears,
      ),
    location:
      optionalString(
        system.location,
      ),
    thermostatType:
      optionalString(
        system.thermostatType,
      ),
    warrantyExpiration:
      optionalTimestamp(
        system.warrantyExpiration,
        "HVAC system warranty expiration must be valid.",
      ),
    notes:
      optionalString(
        system.notes,
      ),
    createdAt:
      timestamp(
        system.createdAt,
        "HVAC system creation date must be valid.",
      ),
  });
}

export function createHVACComponent(
  component: HVACComponent,
): HVACComponent {
  if (
    !HVAC_COMPONENT_TYPES.includes(
      component.componentType,
    )
  ) {
    throw new Error(
      "HVAC component requires a supported component type.",
    );
  }

  if (
    !HVAC_CONDITIONS.includes(
      component.condition,
    )
  ) {
    throw new Error(
      "HVAC component requires a supported condition.",
    );
  }

  if (
    !HVAC_COMPONENT_STATUSES.includes(
      component.status,
    )
  ) {
    throw new Error(
      "HVAC component requires a supported status.",
    );
  }

  const installedAt =
    optionalTimestamp(
      component.installedAt,
      "HVAC component installation date must be valid.",
    );

  const removedAt =
    optionalTimestamp(
      component.removedAt,
      "HVAC component removal date must be valid.",
    );

  if (
    installedAt !== null &&
    removedAt !== null &&
    Date.parse(removedAt) <
      Date.parse(installedAt)
  ) {
    throw new Error(
      "HVAC component removal date cannot precede installation.",
    );
  }

  return Object.freeze({
    ...component,
    id:
      requireString(
        component.id,
        "HVAC component id is required.",
      ),
    systemId:
      requireString(
        component.systemId,
        "HVAC component system id is required.",
      ),
    name:
      requireString(
        component.name,
        "HVAC component name is required.",
      ),
    manufacturer:
      optionalString(
        component.manufacturer,
      ),
    modelNumber:
      optionalString(
        component.modelNumber,
      ),
    partNumber:
      optionalString(
        component.partNumber,
      ),
    serialNumber:
      optionalString(
        component.serialNumber,
      ),
    installedAt,
    removedAt,
    estimatedAgeYears:
      optionalAge(
        component.estimatedAgeYears,
      ),
    estimatedReplacementCostCents:
      optionalCents(
        component.estimatedReplacementCostCents,
        "HVAC component replacement cost must be a non-negative integer number of cents.",
      ),
    vendorName:
      optionalString(
        component.vendorName,
      ),
    invoiceReference:
      optionalString(
        component.invoiceReference,
      ),
    warrantyExpiration:
      optionalTimestamp(
        component.warrantyExpiration,
        "HVAC component warranty expiration must be valid.",
      ),
    notes:
      optionalString(
        component.notes,
      ),
    createdAt:
      timestamp(
        component.createdAt,
        "HVAC component creation date must be valid.",
      ),
  });
}

export function createHVACComponentEvent(
  event: HVACComponentEvent,
): HVACComponentEvent {
  if (
    !HVAC_COMPONENT_EVENT_TYPES.includes(
      event.eventType,
    )
  ) {
    throw new Error(
      "HVAC component event requires a supported event type.",
    );
  }

  if (
    !Array.isArray(
      event.photoReferences,
    )
  ) {
    throw new Error(
      "HVAC component event photo references must be an array.",
    );
  }

  return Object.freeze({
    ...event,
    id:
      requireString(
        event.id,
        "HVAC component event id is required.",
      ),
    systemId:
      requireString(
        event.systemId,
        "HVAC component event system id is required.",
      ),
    componentId:
      optionalString(
        event.componentId,
      ),
    occurredAt:
      timestamp(
        event.occurredAt,
        "HVAC component event occurrence date must be valid.",
      ),
    failureSymptoms:
      optionalString(
        event.failureSymptoms,
      ),
    workPerformed:
      optionalString(
        event.workPerformed,
      ),
    costCents:
      optionalCents(
        event.costCents,
        "HVAC component event cost must be a non-negative integer number of cents.",
      ),
    vendorName:
      optionalString(
        event.vendorName,
      ),
    invoiceReference:
      optionalString(
        event.invoiceReference,
      ),
    photoReferences:
      Object.freeze(
        event.photoReferences.map(
          (reference) =>
            requireString(
              reference,
              "HVAC component event photo reference must not be empty.",
            ),
        ),
      ),
    notes:
      optionalString(
        event.notes,
      ),
    createdAt:
      timestamp(
        event.createdAt,
        "HVAC component event creation date must be valid.",
      ),
  });
}
