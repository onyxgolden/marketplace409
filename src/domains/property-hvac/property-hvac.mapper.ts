import {
  createHVACComponent,
  createHVACComponentEvent,
  createHVACSystem,
} from "./property-hvac.types";

import type {
  HVACComponent,
  HVACComponentEvent,
  HVACComponentEventType,
  HVACComponentStatus,
  HVACComponentType,
  HVACCondition,
  HVACEnergySource,
  HVACSystem,
  HVACSystemStatus,
  HVACSystemType,
} from "./property-hvac.types";

export type HVACSystemRow = Readonly<{
  owner_id: string;
  id: string;
  property_id: string;
  name: string;
  system_type: HVACSystemType;
  energy_source: HVACEnergySource;
  refrigerant_type: string | null;
  tonnage: number | string | null;
  efficiency_rating: string | null;
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string | null;
  installed_at: string | null;
  estimated_age_years:
    number | string | null;
  location: string | null;
  thermostat_type: string | null;
  warranty_expiration: string | null;
  status: HVACSystemStatus;
  condition: HVACCondition;
  notes: string | null;
  created_at: string;
}>;

export type HVACComponentRow = Readonly<{
  owner_id: string;
  id: string;
  system_id: string;
  component_type: HVACComponentType;
  name: string;
  manufacturer: string | null;
  model_number: string | null;
  part_number: string | null;
  serial_number: string | null;
  installed_at: string | null;
  removed_at: string | null;
  estimated_age_years:
    number | string | null;
  condition: HVACCondition;
  status: HVACComponentStatus;
  estimated_replacement_cost_cents:
    number | string | null;
  vendor_name: string | null;
  invoice_reference: string | null;
  warranty_expiration: string | null;
  notes: string | null;
  created_at: string;
}>;

export type HVACComponentEventRow =
  Readonly<{
    owner_id: string;
    id: string;
    system_id: string;
    component_id: string | null;
    event_type:
      HVACComponentEventType;
    occurred_at: string;
    failure_symptoms: string | null;
    work_performed: string | null;
    cost_cents:
      number | string | null;
    vendor_name: string | null;
    invoice_reference: string | null;
    photo_references:
      readonly string[];
    notes: string | null;
    created_at: string;
  }>;

function requireOwnerId(
  ownerId: string,
): string {
  if (
    typeof ownerId !== "string" ||
    ownerId.trim() === ""
  ) {
    throw new Error(
      "HVAC owner id is required.",
    );
  }

  return ownerId.trim();
}

function optionalNumber(
  value:
    number | string | null,
): number | null {
  return value === null
    ? null
    : Number(value);
}

export function mapHVACSystemToRow(
  system: HVACSystem,
  ownerId: string,
): HVACSystemRow {
  return Object.freeze({
    owner_id:
      requireOwnerId(ownerId),
    id: system.id,
    property_id:
      system.propertyId,
    name: system.name,
    system_type:
      system.systemType,
    energy_source:
      system.energySource,
    refrigerant_type:
      system.refrigerantType,
    tonnage: system.tonnage,
    efficiency_rating:
      system.efficiencyRating,
    manufacturer:
      system.manufacturer,
    model_number:
      system.modelNumber,
    serial_number:
      system.serialNumber,
    installed_at:
      system.installedAt,
    estimated_age_years:
      system.estimatedAgeYears,
    location: system.location,
    thermostat_type:
      system.thermostatType,
    warranty_expiration:
      system.warrantyExpiration,
    status: system.status,
    condition: system.condition,
    notes: system.notes,
    created_at:
      system.createdAt,
  });
}

export function mapHVACSystemRowToDomain(
  row: HVACSystemRow,
): HVACSystem {
  return createHVACSystem({
    id: row.id,
    propertyId: row.property_id,
    name: row.name,
    systemType:
      row.system_type,
    energySource:
      row.energy_source,
    refrigerantType:
      row.refrigerant_type,
    tonnage:
      optionalNumber(
        row.tonnage,
      ),
    efficiencyRating:
      row.efficiency_rating,
    manufacturer:
      row.manufacturer,
    modelNumber:
      row.model_number,
    serialNumber:
      row.serial_number,
    installedAt:
      row.installed_at,
    estimatedAgeYears:
      optionalNumber(
        row.estimated_age_years,
      ),
    location: row.location,
    thermostatType:
      row.thermostat_type,
    warrantyExpiration:
      row.warranty_expiration,
    status: row.status,
    condition: row.condition,
    notes: row.notes,
    createdAt:
      row.created_at,
  });
}

export function mapHVACComponentToRow(
  component: HVACComponent,
  ownerId: string,
): HVACComponentRow {
  return Object.freeze({
    owner_id:
      requireOwnerId(ownerId),
    id: component.id,
    system_id:
      component.systemId,
    component_type:
      component.componentType,
    name: component.name,
    manufacturer:
      component.manufacturer,
    model_number:
      component.modelNumber,
    part_number:
      component.partNumber,
    serial_number:
      component.serialNumber,
    installed_at:
      component.installedAt,
    removed_at:
      component.removedAt,
    estimated_age_years:
      component.estimatedAgeYears,
    condition:
      component.condition,
    status:
      component.status,
    estimated_replacement_cost_cents:
      component
        .estimatedReplacementCostCents,
    vendor_name:
      component.vendorName,
    invoice_reference:
      component.invoiceReference,
    warranty_expiration:
      component.warrantyExpiration,
    notes: component.notes,
    created_at:
      component.createdAt,
  });
}

export function mapHVACComponentRowToDomain(
  row: HVACComponentRow,
): HVACComponent {
  return createHVACComponent({
    id: row.id,
    systemId: row.system_id,
    componentType:
      row.component_type,
    name: row.name,
    manufacturer:
      row.manufacturer,
    modelNumber:
      row.model_number,
    partNumber:
      row.part_number,
    serialNumber:
      row.serial_number,
    installedAt:
      row.installed_at,
    removedAt:
      row.removed_at,
    estimatedAgeYears:
      optionalNumber(
        row.estimated_age_years,
      ),
    condition: row.condition,
    status: row.status,
    estimatedReplacementCostCents:
      optionalNumber(
        row
          .estimated_replacement_cost_cents,
      ),
    vendorName:
      row.vendor_name,
    invoiceReference:
      row.invoice_reference,
    warrantyExpiration:
      row.warranty_expiration,
    notes: row.notes,
    createdAt:
      row.created_at,
  });
}

export function mapHVACComponentEventToRow(
  event: HVACComponentEvent,
  ownerId: string,
): HVACComponentEventRow {
  return Object.freeze({
    owner_id:
      requireOwnerId(ownerId),
    id: event.id,
    system_id:
      event.systemId,
    component_id:
      event.componentId,
    event_type:
      event.eventType,
    occurred_at:
      event.occurredAt,
    failure_symptoms:
      event.failureSymptoms,
    work_performed:
      event.workPerformed,
    cost_cents:
      event.costCents,
    vendor_name:
      event.vendorName,
    invoice_reference:
      event.invoiceReference,
    photo_references:
      Object.freeze([
        ...event.photoReferences,
      ]),
    notes: event.notes,
    created_at:
      event.createdAt,
  });
}

export function mapHVACComponentEventRowToDomain(
  row: HVACComponentEventRow,
): HVACComponentEvent {
  return createHVACComponentEvent({
    id: row.id,
    systemId:
      row.system_id,
    componentId:
      row.component_id,
    eventType:
      row.event_type,
    occurredAt:
      row.occurred_at,
    failureSymptoms:
      row.failure_symptoms,
    workPerformed:
      row.work_performed,
    costCents:
      optionalNumber(
        row.cost_cents,
      ),
    vendorName:
      row.vendor_name,
    invoiceReference:
      row.invoice_reference,
    photoReferences:
      row.photo_references ?? [],
    notes: row.notes,
    createdAt:
      row.created_at,
  });
}
