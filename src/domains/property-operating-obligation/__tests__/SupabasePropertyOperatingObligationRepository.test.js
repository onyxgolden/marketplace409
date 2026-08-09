import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  SupabasePropertyOperatingObligationRepository,
} from "../SupabasePropertyOperatingObligationRepository.js";

const query = {
  upsert: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  is: vi.fn(),
  order: vi.fn(),
  delete: vi.fn(),
  maybeSingle: vi.fn(),
};

const supabaseClient = {
  from: vi.fn(() => query),
};

vi.mock("@/lib/supabase", () => ({
  supabase: null,
}));

function obligation(overrides = {}) {
  return {
    id: "obligation_1",
    scope: "property",
    propertyId: "1214-wagner",
    subjectLabel:
      "1214 Wagner 2025 taxes",
    obligationType: "property_tax",
    annualAmountCents: 186500,
    currencyCode: "USD",
    servicePeriodStart:
      "2025-01-01",
    servicePeriodEnd:
      "2026-01-01",
    paymentDate: "2026-01-06",
    paidAmountCents: 186500,
    status: "active",
    verificationStatus:
      "owner_confirmed",
    recognitionStatus:
      "accrual_ready",
    businessUseBasisPoints: null,
    source: "spreadsheet",
    providerName:
      "County Tax Office",
    providerReference: null,
    evidenceId: null,
    reconciledFinancialEventId:
      null,
    cancelledAt: null,
    createdAt:
      "2026-08-09T14:00:00.000Z",
    updatedAt:
      "2026-08-09T14:00:00.000Z",
    notes: "Annual 2025 taxes.",
    ...overrides,
  };
}

function row(overrides = {}) {
  const value =
    obligation(overrides);

  return {
    id: value.id,
    owner_id: "owner_1",
    scope: value.scope,
    property_id: value.propertyId,
    subject_label:
      value.subjectLabel,
    obligation_type:
      value.obligationType,
    annual_amount_cents:
      value.annualAmountCents,
    currency_code:
      value.currencyCode,
    service_period_start:
      value.servicePeriodStart,
    service_period_end:
      value.servicePeriodEnd,
    payment_date:
      value.paymentDate,
    paid_amount_cents:
      value.paidAmountCents,
    status: value.status,
    verification_status:
      value.verificationStatus,
    recognition_status:
      value.recognitionStatus,
    business_use_basis_points:
      value.businessUseBasisPoints,
    source: value.source,
    provider_name:
      value.providerName,
    provider_reference:
      value.providerReference,
    evidence_id: value.evidenceId,
    reconciled_financial_event_id:
      value.reconciledFinancialEventId,
    cancelled_at:
      value.cancelledAt,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
    notes: value.notes,
  };
}

function repository() {
  return new SupabasePropertyOperatingObligationRepository({
    supabaseClient,
  });
}

describe(
  "SupabasePropertyOperatingObligationRepository",
  () => {
    beforeEach(() => {
      supabaseClient.from
        .mockReset()
        .mockReturnValue(query);

      for (
        const method of Object.values(
          query,
        )
      ) {
        method.mockReset();
        method.mockReturnValue(query);
      }
    });

    it(
      "upserts owner-scoped obligations",
      async () => {
        query.select.mockResolvedValue({
          data: [row()],
          error: null,
        });

        const saved =
          await repository().save(
            obligation(),
            {
              ownerId: " owner_1 ",
            },
          );

        expect(
          supabaseClient.from,
        ).toHaveBeenCalledWith(
          "property_operating_obligations",
        );
        expect(
          query.upsert,
        ).toHaveBeenCalledWith(
          [
            expect.objectContaining({
              id: "obligation_1",
              owner_id: "owner_1",
              property_id:
                "1214-wagner",
              annual_amount_cents:
                186500,
            }),
          ],
          {
            onConflict: "id",
          },
        );
        expect(saved).toEqual(
          obligation(),
        );
      },
    );

    it(
      "returns a frozen empty save without persistence",
      async () => {
        const saved =
          await repository().saveMany(
            [],
            {
              ownerId: "owner_1",
            },
          );

        expect(saved).toEqual([]);
        expect(
          Object.isFrozen(saved),
        ).toBe(true);
        expect(
          supabaseClient.from,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "requires owner authority before writes",
      async () => {
        await expect(
          repository().save(
            obligation(),
          ),
        ).rejects.toThrow(
          "Property operating obligation owner id is required.",
        );

        expect(
          supabaseClient.from,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "finds an obligation through owner and identity",
      async () => {
        query.maybeSingle
          .mockResolvedValue({
            data: row(),
            error: null,
          });

        await expect(
          repository().findById(
            " obligation_1 ",
            " owner_1 ",
          ),
        ).resolves.toEqual(
          obligation(),
        );

        expect(
          query.eq,
        ).toHaveBeenNthCalledWith(
          1,
          "owner_id",
          "owner_1",
        );
        expect(
          query.eq,
        ).toHaveBeenNthCalledWith(
          2,
          "id",
          "obligation_1",
        );
      },
    );

    it(
      "applies owner scope and optional list filters",
      async () => {
        query.order.mockResolvedValue({
          data: [row()],
          error: null,
        });

        const listed =
          await repository().list(
            {
              propertyId:
                " 1214-wagner ",
              scope: "property",
              obligationType:
                "property_tax",
              status: "active",
              recognitionStatus:
                "accrual_ready",
              unreconciledOnly: true,
            },
            "owner_1",
          );

        expect(
          query.eq,
        ).toHaveBeenNthCalledWith(
          1,
          "owner_id",
          "owner_1",
        );
        expect(
          query.eq,
        ).toHaveBeenNthCalledWith(
          2,
          "property_id",
          "1214-wagner",
        );
        expect(
          query.eq,
        ).toHaveBeenNthCalledWith(
          3,
          "scope",
          "property",
        );
        expect(
          query.eq,
        ).toHaveBeenNthCalledWith(
          4,
          "obligation_type",
          "property_tax",
        );
        expect(
          query.eq,
        ).toHaveBeenNthCalledWith(
          5,
          "status",
          "active",
        );
        expect(
          query.eq,
        ).toHaveBeenNthCalledWith(
          6,
          "recognition_status",
          "accrual_ready",
        );
        expect(
          query.is,
        ).toHaveBeenCalledWith(
          "reconciled_financial_event_id",
          null,
        );
        expect(
          query.order,
        ).toHaveBeenCalledWith(
          "service_period_start",
          {
            ascending: false,
            nullsFirst: false,
          },
        );
        expect(listed).toEqual([
          obligation(),
        ]);
        expect(
          Object.isFrozen(listed),
        ).toBe(true);
      },
    );

    it(
      "lists a property's obligation history",
      async () => {
        query.order.mockResolvedValue({
          data: [row()],
          error: null,
        });

        await repository()
          .findByProperty(
            "1214-wagner",
            "owner_1",
          );

        expect(
          query.eq,
        ).toHaveBeenCalledWith(
          "property_id",
          "1214-wagner",
        );
        expect(
          query.eq,
        ).toHaveBeenCalledWith(
          "scope",
          "property",
        );
      },
    );

    it(
      "returns null when an identity is absent",
      async () => {
        query.maybeSingle
          .mockResolvedValue({
            data: null,
            error: null,
          });

        await expect(
          repository().findById(
            "obligation_1",
            "owner_1",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "deletes only through owner scope",
      async () => {
        query.maybeSingle
          .mockResolvedValue({
            data: row(),
            error: null,
          });

        await expect(
          repository().deleteById(
            "obligation_1",
            "owner_1",
          ),
        ).resolves.toEqual(
          obligation(),
        );

        expect(
          query.delete,
        ).toHaveBeenCalledTimes(1);
        expect(
          query.eq,
        ).toHaveBeenCalledWith(
          "owner_id",
          "owner_1",
        );
      },
    );

    it(
      "propagates Supabase failures",
      async () => {
        const failure =
          new Error(
            "Obligation query failed.",
          );

        query.order.mockResolvedValue({
          data: null,
          error: failure,
        });

        await expect(
          repository().list(
            {},
            "owner_1",
          ),
        ).rejects.toBe(failure);
      },
    );

    it(
      "requires an explicit Supabase client when no default exists",
      () => {
        expect(() =>
          new SupabasePropertyOperatingObligationRepository(),
        ).toThrow(
          "Property operating obligation Supabase client is required.",
        );
      },
    );
  },
);
