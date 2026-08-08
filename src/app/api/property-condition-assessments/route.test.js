import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedPropertyConditionAssessmentApplication:
    vi.fn(),
  listLatest:
    vi.fn(),
  listByProperty:
    vi.fn(),
  recordOwnerAssessment:
    vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedPropertyConditionAssessmentApplication",
  () => ({
    createAuthenticatedPropertyConditionAssessmentApplication:
      mocks.createAuthenticatedPropertyConditionAssessmentApplication,
  }),
);

import {
  GET,
  POST,
} from "./route";

function authenticate() {
  mocks.createAuthenticatedPropertyConditionAssessmentApplication
    .mockResolvedValue({
      user: {
        id:
          "authenticated-owner",
      },
      application: {
        listLatest:
          mocks.listLatest,
        listByProperty:
          mocks.listByProperty,
        recordOwnerAssessment:
          mocks.recordOwnerAssessment,
      },
    });
}

function createPostRequest(body) {
  return new Request(
    "http://localhost/api/property-condition-assessments",
    {
      method: "POST",
      body:
        JSON.stringify(body),
    },
  );
}

describe(
  "GET /api/property-condition-assessments",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "returns latest assessments using authenticated owner authority",
      async () => {
        authenticate();

        const assessments = [
          {
            id:
              "assessment_1",
            propertyId:
              "1214-wagner",
          },
        ];

        mocks.listLatest
          .mockResolvedValue(
            assessments,
          );

        const response =
          await GET(
            new Request(
              "http://localhost/api/property-condition-assessments",
            ),
          );

        expect(
          mocks.listLatest,
        ).toHaveBeenCalledWith(
          "authenticated-owner",
        );

        expect(
          mocks.listByProperty,
        ).not.toHaveBeenCalled();

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          assessments,
        });
      },
    );

    it(
      "returns owner-scoped history for a requested property",
      async () => {
        authenticate();

        mocks.listByProperty
          .mockResolvedValue([]);

        await GET(
          new Request(
            "http://localhost/api/property-condition-assessments?propertyId=1214-wagner",
          ),
        );

        expect(
          mocks.listByProperty,
        ).toHaveBeenCalledWith(
          "1214-wagner",
          "authenticated-owner",
        );

        expect(
          mocks.listLatest,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns authentication failure unchanged",
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

        mocks.createAuthenticatedPropertyConditionAssessmentApplication
          .mockResolvedValue({
            response,
          });

        const result =
          await GET(
            new Request(
              "http://localhost/api/property-condition-assessments",
            ),
          );

        expect(result).toBe(
          response,
        );

        expect(
          mocks.listLatest,
        ).not.toHaveBeenCalled();
      },
    );
  },
);

describe(
  "POST /api/property-condition-assessments",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "records an owner assessment with only authenticated owner authority",
      async () => {
        authenticate();

        const input = {
          propertyId:
            "1214-wagner",
          ownerId:
            "spoofed-owner",
          assessmentType:
            "licensed_inspection",
          items: [],
        };

        const assessment = {
          id:
            "assessment_1",
          propertyId:
            "1214-wagner",
          assessmentType:
            "owner_assessment",
        };

        mocks.recordOwnerAssessment
          .mockResolvedValue(
            assessment,
          );

        const response =
          await POST(
            createPostRequest({
              operation:
                "record-owner-assessment",
              ownerId:
                "spoofed-owner",
              assessment:
                input,
            }),
          );

        expect(
          mocks.recordOwnerAssessment,
        ).toHaveBeenCalledWith(
          input,
          "authenticated-owner",
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          assessment,
        });
      },
    );

    it(
      "rejects unsupported operations and missing assessment input",
      async () => {
        authenticate();

        const unsupported =
          await POST(
            createPostRequest({
              operation:
                "unsupported",
            }),
          );

        expect(
          unsupported.status,
        ).toBe(400);

        const missing =
          await POST(
            createPostRequest({
              operation:
                "record-owner-assessment",
            }),
          );

        expect(
          missing.status,
        ).toBe(400);

        expect(
          mocks.recordOwnerAssessment,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns authentication failure without reading request authority",
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

        mocks.createAuthenticatedPropertyConditionAssessmentApplication
          .mockResolvedValue({
            response,
          });

        const result =
          await POST(
            createPostRequest({
              operation:
                "record-owner-assessment",
              assessment: {
                propertyId:
                  "1214-wagner",
                items: [],
              },
            }),
          );

        expect(result).toBe(
          response,
        );

        expect(
          mocks.recordOwnerAssessment,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
