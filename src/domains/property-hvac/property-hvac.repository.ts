import type {
  HVACComponent,
  HVACComponentEvent,
  HVACSystem,
} from "./property-hvac.types";

import type {
  HVACSystemReplacementCommand,
  HVACSystemReplacementResult,
} from "./property-hvac-system-replacement.types";

export type HVACPersistenceContext =
  Readonly<{
    ownerId: string;
  }>;

export interface PropertyHVACRepository {
  saveSystem(
    system: HVACSystem,
    context: HVACPersistenceContext,
  ): Promise<HVACSystem>;

  findSystemById(
    systemId: string,
    ownerId: string,
  ): Promise<HVACSystem | null>;

  findSystemsByProperty(
    propertyId: string,
    ownerId: string,
  ): Promise<readonly HVACSystem[]>;

  saveComponent(
    component: HVACComponent,
    context: HVACPersistenceContext,
  ): Promise<HVACComponent>;

  findComponentById(
    componentId: string,
    ownerId: string,
  ): Promise<HVACComponent | null>;

  findComponentsBySystem(
    systemId: string,
    ownerId: string,
  ): Promise<readonly HVACComponent[]>;

  appendComponentEvent(
    event: HVACComponentEvent,
    context: HVACPersistenceContext,
  ): Promise<HVACComponentEvent>;

  findEventsBySystem(
    systemId: string,
    ownerId: string,
  ): Promise<readonly HVACComponentEvent[]>;

  findEventsByComponent(
    componentId: string,
    ownerId: string,
  ): Promise<readonly HVACComponentEvent[]>;

  replaceSystem(
    command: HVACSystemReplacementCommand,
    context: HVACPersistenceContext,
  ): Promise<HVACSystemReplacementResult>;
}
