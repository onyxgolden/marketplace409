import {
  describe,
  expect,
  it,
} from "vitest";

import {
  SupabasePropertyEvidenceRepository,
} from "../../../domains/property-evidence/SupabasePropertyEvidenceRepository.js";

import {
  createPropertyEvidenceRepository,
  PropertyEvidenceRepositoryStorage,
} from "../createPropertyEvidenceRepository.js";

describe(
  "createPropertyEvidenceRepository",
  () => {
    it(
      "creates the Supabase repository with the supplied client",
      async () => {
        const supabaseClient = {
          from() {},
        };

        const repository =
          await createPropertyEvidenceRepository({
            storage:
              PropertyEvidenceRepositoryStorage
                .SUPABASE,
            supabaseClient,
          });

        expect(repository).toBeInstanceOf(
          SupabasePropertyEvidenceRepository,
        );

        expect(
          repository.supabase,
        ).toBe(
          supabaseClient,
        );
      },
    );

    it(
      "uses Supabase as the evidence persistence default",
      async () => {
        const supabaseClient = {
          from() {},
        };

        const repository =
          await createPropertyEvidenceRepository({
            supabaseClient,
          });

        expect(repository).toBeInstanceOf(
          SupabasePropertyEvidenceRepository,
        );
      },
    );

    it(
      "rejects unsupported storage",
      async () => {
        await expect(
          createPropertyEvidenceRepository({
            storage:
              "unsupported",
          }),
        ).rejects.toThrow(
          "Unsupported property evidence repository storage: unsupported",
        );
      },
    );

    it(
      "exposes an immutable storage vocabulary",
      () => {
        expect(
          PropertyEvidenceRepositoryStorage,
        ).toEqual({
          SUPABASE:
            "supabase",
        });

        expect(
          Object.isFrozen(
            PropertyEvidenceRepositoryStorage,
          ),
        ).toBe(true);
      },
    );
  },
);
