import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {},
}));

import {
  SupabasePropertyConditionAssessmentRepository,
} from "../SupabasePropertyConditionAssessmentRepository.js";

const query = {
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  maybeSingle: vi.fn(),
};

const client = {
  from: vi.fn(() => query),
  rpc: vi.fn(),
};

function buildAssessment(
  overrides = {},
) {
  return {
    id: "assessment_1",
    propertyId: "1214-wagner",
    assessmentType:
      "owner_assessment",
    effectiveAt:
      "2026-08-08T00:00:00.000Z",
    createdAt:
      "2026-08-08T01:00:00.000Z",
    assessorName: "Property owner",
    assessorCredential: null,
    sourceReference: null,
    summary: "Annual review.",
    items: [
      {
        id: "item_1",
        section: "hvac_systems",
        systemKey: "central_hvac_1",
        itemKey: "outdoor_unit",
        label:
          "Outdoor condensing unit",
        observationStatus:
          "attention_needed",
        condition: "marginal",
        replacementPriority:
          "planned",
        estimatedReplacementCostCents:
          850000,
        plannedReplacementYear: 2028,
        valuationImpact: "negative",
        notes: "Older unit.",
      },
    ],
    ...overrides,
  };
}

function buildItemRow(
  overrides = {},
) {
  const item =
    buildAssessment().items[0];

  return {
    id: item.id,
    assessment_id:
      "assessment_1",
    owner_id: "owner_1",
    section: item.section,
    system_key: item.systemKey,
    item_key: item.itemKey,
    label: item.label,
    observation_status:
      item.observationStatus,
    condition: item.condition,
    replacement_priority:
      item.replacementPriority,
    estimated_replacement_cost_cents:
      item.estimatedReplacementCostCents,
    planned_replacement_year:
      item.plannedReplacementYear,
    valuation_impact:
      item.valuationImpact,
    notes: item.notes,
    ...overrides,
  };
}

function buildAggregateRow(
  overrides = {},
) {
  const assessment =
    buildAssessment(overrides);

  return {
    id: assessment.id,
    owner_id:
      overrides.owner_id ??
      "owner_1",
    property_id:
      assessment.propertyId,
    assessment_type:
      assessment.assessmentType,
    effective_at:
      assessment.effectiveAt,
    created_at:
      assessment.createdAt,
    assessor_name:
      assessment.assessorName,
    assessor_credential:
      assessment.assessorCredential,
    source_reference:
      assessment.sourceReference,
    summary: assessment.summary,
    property_condition_assessment_items:
      overrides.items ?? [
        buildItemRow({
          assessment_id:
            assessment.id,
        }),
      ],
  };
}

describe(
  "SupabasePropertyConditionAssessmentRepository",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      for (
        const method of
          Object.values(query)
      ) {
        method.mockReturnValue(query);
      }
    });

    it(
      "saves an aggregate through the atomic RPC and reloads persisted data",
      async () => {
        client.rpc.mockResolvedValue({
          data: {
            assessment_id:
              "assessment_1",
            created: true,
          },
          error: null,
        });

        query.maybeSingle
          .mockResolvedValue({
            data:
              buildAggregateRow(),
            error: null,
          });

        const repository =
          new SupabasePropertyConditionAssessmentRepository({
            supabaseClient: client,
          });

        const result =
          await repository.save(
            buildAssessment(),
            {
              ownerId:
                "owner_1",
            },
          );

        expect(
          client.rpc,
        ).toHaveBeenCalledWith(
          "save_property_condition_assessment",
          {
            p_owner_id:
              "owner_1",
            p_assessment:
              expect.objectContaining({
                id:
                  "assessment_1",
                owner_id:
                  "owner_1",
                property_id:
                  "1214-wagner",
              }),
            p_items: [
              expect.objectContaining({
                id: "item_1",
                owner_id:
                  "owner_1",
                assessment_id:
                  "assessment_1",
              }),
            ],
          },
        );

        expect(result).toEqual(
          buildAssessment(),
        );
      },
    );

    it(
      "requires owner scope before calling the RPC",
      async () => {
        const repository =
          new SupabasePropertyConditionAssessmentRepository({
            supabaseClient: client,
          });

        await expect(
          repository.save(
            buildAssessment(),
            {},
          ),
        ).rejects.toThrow(
          "Property condition assessment owner id is required.",
        );

        expect(
          client.rpc,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns null when an assessment is absent",
      async () => {
        query.maybeSingle
          .mockResolvedValue({
            data: null,
            error: null,
          });

        const repository =
          new SupabasePropertyConditionAssessmentRepository({
            supabaseClient: client,
          });

        await expect(
          repository.findById(
            "assessment_1",
            "owner_1",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "loads owner-scoped property history with embedded items",
      async () => {
        query.order.mockResolvedValue({
          data: [
            buildAggregateRow(),
          ],
          error: null,
        });

        const repository =
          new SupabasePropertyConditionAssessmentRepository({
            supabaseClient: client,
          });

        const result =
          await repository.findByProperty(
            "1214-wagner",
            "owner_1",
          );

        expect(
          query.select,
        ).toHaveBeenCalledWith(
          "*, property_condition_assessment_items(*)",
        );

        expect(
          query.eq,
        ).toHaveBeenCalledWith(
          "owner_id",
          "owner_1",
        );

        expect(
          query.eq,
        ).toHaveBeenCalledWith(
          "property_id",
          "1214-wagner",
        );

        expect(result).toEqual([
          buildAssessment(),
        ]);
      },
    );

    it(
      "loads the latest assessment for a property",
      async () => {
        query.maybeSingle
          .mockResolvedValue({
            data:
              buildAggregateRow(),
            error: null,
          });

        const repository =
          new SupabasePropertyConditionAssessmentRepository({
            supabaseClient: client,
          });

        const result =
          await repository.findLatestByProperty(
            "1214-wagner",
            "owner_1",
          );

        expect(
          query.limit,
        ).toHaveBeenCalledWith(1);

        expect(result).toEqual(
          buildAssessment(),
        );
      },
    );

    it(
      "selects one latest assessment per property for an owner",
      async () => {
        query.order.mockResolvedValue({
          data: [
            buildAggregateRow({
              id:
                "property_1_new",
              items: [],
            }),
            buildAggregateRow({
              id:
                "property_1_old",
              effectiveAt:
                "2026-01-01T00:00:00.000Z",
              items: [],
            }),
            buildAggregateRow({
              id:
                "property_2_new",
              propertyId:
                "1218-wagner",
              items: [],
            }),
          ],
          error: null,
        });

        const repository =
          new SupabasePropertyConditionAssessmentRepository({
            supabaseClient: client,
          });

        const result =
          await repository.findLatestByOwnerId(
            "owner_1",
          );

        expect(
          result.map(({ id }) => id),
        ).toEqual([
          "property_1_new",
          "property_2_new",
        ]);
      },
    );

    it(
      "propagates RPC and query failures",
      async () => {
        const rpcFailure =
          new Error("RPC failed");

        client.rpc.mockResolvedValue({
          data: null,
          error: rpcFailure,
        });

        const repository =
          new SupabasePropertyConditionAssessmentRepository({
            supabaseClient: client,
          });

        await expect(
          repository.save(
            buildAssessment(),
            {
              ownerId:
                "owner_1",
            },
          ),
        ).rejects.toBe(
          rpcFailure,
        );

        const queryFailure =
          new Error("query failed");

        query.order.mockResolvedValue({
          data: null,
          error: queryFailure,
        });

        await expect(
          repository.findByProperty(
            "1214-wagner",
            "owner_1",
          ),
        ).rejects.toBe(
          queryFailure,
        );
      },
    );

    it(
      "rejects a save that cannot be reloaded",
      async () => {
        client.rpc.mockResolvedValue({
          data: {
            assessment_id:
              "assessment_1",
            created: false,
          },
          error: null,
        });

        query.maybeSingle
          .mockResolvedValue({
            data: null,
            error: null,
          });

        const repository =
          new SupabasePropertyConditionAssessmentRepository({
            supabaseClient: client,
          });

        await expect(
          repository.save(
            buildAssessment(),
            {
              ownerId:
                "owner_1",
            },
          ),
        ).rejects.toThrow(
          "Saved property condition assessment could not be loaded.",
        );
      },
    );
  },
);
