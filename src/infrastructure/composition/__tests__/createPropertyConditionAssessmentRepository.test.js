import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {},
}));

import {
  createLazyPropertyConditionAssessmentRepository,
  createPropertyConditionAssessmentRepository,
  PropertyConditionAssessmentRepositoryStorage,
} from "../createPropertyConditionAssessmentRepository.js";

import {
  InMemoryPropertyConditionAssessmentRepository,
} from "../../../domains/property-condition-assessment/in-memory-property-condition-assessment.repository";

import {
  SupabasePropertyConditionAssessmentRepository,
} from "../../../domains/property-condition-assessment/SupabasePropertyConditionAssessmentRepository.js";

describe(
  "createPropertyConditionAssessmentRepository",
  () => {
    const originalStorage =
      process.env
        .PROPERTY_CONDITION_ASSESSMENT_REPOSITORY;

    afterEach(() => {
      if (
        originalStorage === undefined
      ) {
        delete process.env
          .PROPERTY_CONDITION_ASSESSMENT_REPOSITORY;
      } else {
        process.env
          .PROPERTY_CONDITION_ASSESSMENT_REPOSITORY =
          originalStorage;
      }
    });

    it(
      "creates the in-memory repository by default",
      async () => {
        delete process.env
          .PROPERTY_CONDITION_ASSESSMENT_REPOSITORY;

        const repository =
          await createPropertyConditionAssessmentRepository();

        expect(repository).toBeInstanceOf(
          InMemoryPropertyConditionAssessmentRepository,
        );
      },
    );

    it(
      "creates the explicitly selected in-memory repository",
      async () => {
        const repository =
          await createPropertyConditionAssessmentRepository({
            storage:
              PropertyConditionAssessmentRepositoryStorage
                .MEMORY,
          });

        expect(repository).toBeInstanceOf(
          InMemoryPropertyConditionAssessmentRepository,
        );
      },
    );

    it(
      "uses the environment storage selection",
      async () => {
        process.env
          .PROPERTY_CONDITION_ASSESSMENT_REPOSITORY =
          PropertyConditionAssessmentRepositoryStorage
            .MEMORY;

        const repository =
          await createPropertyConditionAssessmentRepository();

        expect(repository).toBeInstanceOf(
          InMemoryPropertyConditionAssessmentRepository,
        );
      },
    );

    it(
      "creates the Supabase repository with the supplied client",
      async () => {
        const supabaseClient = {
          from: vi.fn(),
          rpc: vi.fn(),
        };

        const repository =
          await createPropertyConditionAssessmentRepository({
            storage:
              PropertyConditionAssessmentRepositoryStorage
                .SUPABASE,
            supabaseClient,
          });

        expect(repository).toBeInstanceOf(
          SupabasePropertyConditionAssessmentRepository,
        );

        expect(
          repository.supabase,
        ).toBe(supabaseClient);
      },
    );

    it(
      "rejects unsupported storage selections",
      async () => {
        await expect(
          createPropertyConditionAssessmentRepository({
            storage:
              "unsupported",
          }),
        ).rejects.toThrow(
          "Unsupported property condition assessment repository storage: unsupported",
        );
      },
    );

    it(
      "exposes an immutable lazy repository boundary",
      () => {
        const repository =
          createLazyPropertyConditionAssessmentRepository();

        expect(
          typeof repository.save,
        ).toBe("function");

        expect(
          typeof repository.findById,
        ).toBe("function");

        expect(
          typeof repository.findByProperty,
        ).toBe("function");

        expect(
          typeof repository.findLatestByProperty,
        ).toBe("function");

        expect(
          typeof repository.findLatestByOwnerId,
        ).toBe("function");

        expect(
          Object.isFrozen(repository),
        ).toBe(true);
      },
    );
  },
);
