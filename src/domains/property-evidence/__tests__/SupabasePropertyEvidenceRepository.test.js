import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  SupabasePropertyEvidenceRepository,
  evidenceRowToDomain,
  evidenceToRow,
} from "../SupabasePropertyEvidenceRepository";

function evidence(overrides = {}) {
  return {
    id:
      "property_evidence_1",
    ownerId:
      "owner-1",
    propertyId:
      "property-1",
    hvacSystemId:
      "system-1",
    hvacEventId:
      null,
    bucket:
      "property-evidence",
    objectPath:
      "owner-1/property-1/property_evidence_1/invoice.pdf",
    originalFilename:
      "Invoice.pdf",
    mimeType:
      "application/pdf",
    byteSize: 400,
    extractionMethod:
      "native_pdf",
    parserVersion:
      "hvac-invoice-v1",
    reviewStatus:
      "pending_review",
    createdAt:
      "2026-08-08T21:00:00.000Z",
    updatedAt:
      "2026-08-08T21:00:00.000Z",
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    owner_id:
      "owner-1",
    id:
      "property_evidence_1",
    property_id:
      "property-1",
    hvac_system_id:
      "system-1",
    hvac_event_id:
      null,
    bucket:
      "property-evidence",
    object_path:
      "owner-1/property-1/property_evidence_1/invoice.pdf",
    original_filename:
      "Invoice.pdf",
    mime_type:
      "application/pdf",
    byte_size: 400,
    extraction_method:
      "native_pdf",
    parser_version:
      "hvac-invoice-v1",
    review_status:
      "pending_review",
    created_at:
      "2026-08-08T21:00:00.000Z",
    updated_at:
      "2026-08-08T21:00:00.000Z",
    ...overrides,
  };
}

function query({
  data,
  error = null,
} = {}) {
  const builder = {
    insert:
      vi.fn(),
    select:
      vi.fn(),
    single:
      vi.fn(),
    maybeSingle:
      vi.fn(),
    eq:
      vi.fn(),
    update:
      vi.fn(),
  };

  for (
    const method of [
      "insert",
      "select",
      "eq",
      "update",
    ]
  ) {
    builder[method]
      .mockReturnValue(
        builder,
      );
  }

  builder.single
    .mockResolvedValue({
      data,
      error,
    });

  builder.maybeSingle
    .mockResolvedValue({
      data,
      error,
    });

  return builder;
}

describe(
  "SupabasePropertyEvidenceRepository",
  () => {
    let builder;
    let supabaseClient;
    let repository;

    beforeEach(() => {
      builder =
        query({
          data:
            row(),
        });

      supabaseClient = {
        from:
          vi.fn(
            () => builder,
          ),
      };

      repository =
        new SupabasePropertyEvidenceRepository({
          supabaseClient,
        });
    });

    it(
      "maps evidence metadata to and from persistence rows",
      () => {
        expect(
          evidenceToRow(
            evidence(),
            "owner-1",
          ),
        ).toEqual(
          row(),
        );

        const mapped =
          evidenceRowToDomain(
            row(),
          );

        expect(mapped).toEqual(
          evidence(),
        );

        expect(
          Object.isFrozen(
            mapped,
          ),
        ).toBe(true);
      },
    );

    it(
      "inserts owner-scoped evidence metadata",
      async () => {
        const saved =
          await repository.save(
            evidence(),
            {
              ownerId:
                "owner-1",
            },
          );

        expect(
          supabaseClient.from,
        ).toHaveBeenCalledWith(
          "property_evidence",
        );

        expect(
          builder.insert,
        ).toHaveBeenCalledWith(
          row(),
        );

        expect(saved).toEqual(
          evidence(),
        );
      },
    );

    it(
      "rejects owner mismatch before persistence",
      async () => {
        await expect(
          repository.save(
            evidence(),
            {
              ownerId:
                "different-owner",
            },
          ),
        ).rejects.toThrow(
          "Property evidence owner does not match the persistence context.",
        );

        expect(
          supabaseClient.from,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "finds evidence through owner and evidence identity",
      async () => {
        const found =
          await repository.findById(
            "property_evidence_1",
            "owner-1",
          );

        expect(
          builder.eq,
        ).toHaveBeenNthCalledWith(
          1,
          "owner_id",
          "owner-1",
        );

        expect(
          builder.eq,
        ).toHaveBeenNthCalledWith(
          2,
          "id",
          "property_evidence_1",
        );

        expect(found).toEqual(
          evidence(),
        );
      },
    );

    it(
      "attaches reviewed evidence to an HVAC event",
      async () => {
        builder.single
          .mockResolvedValue({
            data:
              row({
                hvac_event_id:
                  "event-1",
                review_status:
                  "approved",
                updated_at:
                  "2026-08-08T22:00:00.000Z",
              }),
            error: null,
          });

        const attached =
          await repository
            .attachToHVACEvent(
              {
                evidenceId:
                  "property_evidence_1",
                hvacEventId:
                  "event-1",
                updatedAt:
                  "2026-08-08T22:00:00.000Z",
              },
              {
                ownerId:
                  "owner-1",
              },
            );

        expect(
          builder.update,
        ).toHaveBeenCalledWith({
          hvac_event_id:
            "event-1",
          review_status:
            "approved",
          updated_at:
            "2026-08-08T22:00:00.000Z",
        });

        expect(
          attached.reviewStatus,
        ).toBe("approved");

        expect(
          attached.hvacEventId,
        ).toBe("event-1");
      },
    );

    it(
      "propagates Supabase failures",
      async () => {
        const failure =
          new Error(
            "Persistence failed.",
          );

        builder.single
          .mockResolvedValue({
            data: null,
            error:
              failure,
          });

        await expect(
          repository.save(
            evidence(),
            {
              ownerId:
                "owner-1",
            },
          ),
        ).rejects.toBe(
          failure,
        );
      },
    );

    it(
      "requires an explicit Supabase client",
      () => {
        expect(
          () =>
            new SupabasePropertyEvidenceRepository(),
        ).toThrow(
          "SupabasePropertyEvidenceRepository requires a Supabase client.",
        );
      },
    );
  },
);
