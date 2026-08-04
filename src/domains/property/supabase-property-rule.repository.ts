import type { PropertyRuleRepository } from "./property-rule.repository";
import type {
  PropertyResolutionRule,
  PropertyResolutionRuleContext,
  PropertyResolutionRuleMatchMode,
  PropertyResolutionRuleType,
} from "./property-resolution-rule.types";
import type { Property } from "./property.types";

type SupabaseClientLike = Readonly<{
  from(table: string): any;
}>;

type PropertyRuleRow = Readonly<{
  id: string;
  type: PropertyResolutionRuleType;
  property_id: string;
  property_snapshot: Property;
  priority: number | null;
  owner_id: string | null;
  organization_id: string | null;
  enabled: boolean | null;
  match_field: string;
  match_value: string;
  match_mode: PropertyResolutionRuleMatchMode;
}>;

export class SupabasePropertyRuleRepository
  implements PropertyRuleRepository {
  constructor(
    private readonly supabaseClient: SupabaseClientLike,
  ) {
    if (
      !supabaseClient ||
      typeof supabaseClient.from !== "function"
    ) {
      throw new Error(
        "SupabasePropertyRuleRepository requires a Supabase client.",
      );
    }
  }

  async save(
    rule: PropertyResolutionRule,
  ): Promise<PropertyResolutionRule> {
    const row = this.toRow(rule);

    const { data, error } = await this.supabaseClient
      .from("property_rules")
      .upsert(row)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return this.toRule(data as PropertyRuleRow);
  }

  async saveMany(
    rules: readonly PropertyResolutionRule[],
  ): Promise<readonly PropertyResolutionRule[]> {
    if (rules.length === 0) {
      return [];
    }

    const rows = rules.map((rule) => this.toRow(rule));

    const { data, error } = await this.supabaseClient
      .from("property_rules")
      .upsert(rows)
      .select("*");

    if (error) {
      throw error;
    }

    return (data as PropertyRuleRow[]).map((row) =>
      this.toRule(row),
    );
  }

  async findRules(
    context: PropertyResolutionRuleContext = {},
  ): Promise<readonly PropertyResolutionRule[]> {
    const {
      ownerId = null,
      organizationId = null,
    } = context;

    let query = this.supabaseClient
      .from("property_rules")
      .select("*")
      .eq("enabled", true)
      .order("priority", { ascending: false });

    if (ownerId == null) {
      query = query.is("owner_id", null);
    } else {
      query = query.or(
        `owner_id.is.null,owner_id.eq.${ownerId}`,
      );
    }

    if (organizationId == null) {
      query = query.is("organization_id", null);
    } else {
      query = query.or(
        `organization_id.is.null,organization_id.eq.${organizationId}`,
      );
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return (data as PropertyRuleRow[]).map((row) =>
      this.toRule(row),
    );
  }

  private toRow(rule: PropertyResolutionRule) {
    return {
      id: rule.id,
      type: rule.type,
      property_id: rule.property.id,
      property_snapshot: rule.property,
      priority: rule.priority ?? 0,
      owner_id: rule.ownerId ?? null,
      organization_id: rule.organizationId ?? null,
      enabled: rule.enabled ?? true,
      match_field: rule.match.field,
      match_value: rule.match.value,
      match_mode: rule.match.mode,
    };
  }

  private toRule(row: PropertyRuleRow): PropertyResolutionRule {
    return {
      id: row.id,
      type: row.type,
      property: row.property_snapshot,
      priority: row.priority ?? 0,
      ownerId: row.owner_id,
      organizationId: row.organization_id,
      enabled: row.enabled ?? true,
      match: {
        field: row.match_field,
        value: row.match_value,
        mode: row.match_mode,
      },
    };
  }
}
