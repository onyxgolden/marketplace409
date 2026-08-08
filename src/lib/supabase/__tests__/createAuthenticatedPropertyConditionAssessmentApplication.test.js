import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedForgeApplication:
    vi.fn(),
  createPropertyConditionAssessmentRepository:
    vi.fn(),
}));

vi.mock(
  "../createAuthenticatedForgeApplication",
  () => ({
    createAuthenticatedForgeApplication:
      mocks.createAuthenticatedForgeApplication,
  }),
);

vi.mock(
  "@/infrastructure/composition",
  () => ({
    createPropertyConditionAssessmentRepository:
      mocks.createPropertyConditionAssessmentRepository,
  }),
);

import {
  PropertyConditionAssessmentApplication,
} from "@/application/property-condition-assessment";

import {
  createAuthenticatedPropertyConditionAssessmentApplication,
} from "../createAuthenticatedPropertyConditionAssessmentApplication";

describe(
  "createAuthenticatedPropertyConditionAssessmentApplication",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "returns authentication failure without composing services",
      async () => {
        const response =
          Response.json(
            {
              error:
                "Authenticated owner id is required.",
            },
            {
              status: 401,
            },
          );

        mocks.createAuthenticatedForgeApplication
          .mockResolvedValue({
            response,
          });

        const result =
          await createAuthenticatedPropertyConditionAssessmentApplication();

        expect(
          result.response,
        ).toBe(response);

        expect(
          mocks.createPropertyConditionAssessmentRepository,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "awaits explicit Supabase repository composition",
      async () => {
        const supabaseClient = {
          from:
            vi.fn(),
          rpc:
            vi.fn(),
        };

        const repository = {
          save:
            vi.fn(),
          findById:
            vi.fn(),
          findByProperty:
            vi.fn(),
          findLatestByOwnerId:
            vi.fn(),
        };

        mocks.createAuthenticatedForgeApplication
          .mockResolvedValue({
            supabaseClient,
            user: {
              id:
                "authenticated-owner",
            },
          });

        mocks.createPropertyConditionAssessmentRepository
          .mockResolvedValue(
            repository,
          );

        const result =
          await createAuthenticatedPropertyConditionAssessmentApplication();

        expect(
          mocks.createPropertyConditionAssessmentRepository,
        ).toHaveBeenCalledWith({
          storage:
            "supabase",
          supabaseClient,
        });

        expect(
          result.user,
        ).toEqual({
          id:
            "authenticated-owner",
        });

        expect(
          result.application,
        ).toBeInstanceOf(
          PropertyConditionAssessmentApplication,
        );

        expect(
          result.application.repository,
        ).toBe(repository);
      },
    );
  },
);
