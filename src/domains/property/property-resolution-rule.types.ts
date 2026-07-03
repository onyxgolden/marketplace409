import type { Property } from "./property.types";

export type PropertyResolutionRuleType =
  | "explicit_assignment"
  | "manual"
  | "merchant"
  | "description"
  | "provider_metadata"
  | "learned";

export type PropertyResolutionRuleMatchMode =
  | "equals"
  | "contains";

export type PropertyResolutionRule = Readonly<{
  id: string;
  type: PropertyResolutionRuleType;
  property: Property;
  priority?: number;
  ownerId?: string | null;
  organizationId?: string | null;
  enabled?: boolean;
  match: Readonly<{
    field: string;
    value: string;
    mode: PropertyResolutionRuleMatchMode;
  }>;
}>;

export type PropertyResolutionRuleContext = Readonly<{
  ownerId?: string | null;
  organizationId?: string | null;
}>;
