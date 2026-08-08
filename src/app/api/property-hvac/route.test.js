import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedPropertyHVACApplication:
    vi.fn(),
  listSystems:
    vi.fn(),
  getSystemHistory:
    vi.fn(),
  saveSystem:
    vi.fn(),
  saveComponent:
    vi.fn(),
  recordComponentEvent:
    vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedPropertyHVACApplication",
  () => ({
    createAuthenticatedPropertyHVACApplication:
      mocks.createAuthenticatedPropertyHVACApplication,
  }),
);

import {
  GET,
  POST,
} from "./route";

function authenticate() {
  mocks.createAuthenticatedPropertyHVACApplication
    .mockResolvedValue({
      user: {
        id:
          "authenticated-owner",
      },
      application: {
        listSystems:
          mocks.listSystems,
        getSystemHistory:
          mocks.getSystemHistory,
        saveSystem:
          mocks.saveSystem,
        saveComponent:
          mocks.saveComponent,
        recordComponentEvent:
          mocks.recordComponentEvent,
      },
    });
}

function post(body) {
  return POST(
    new Request(
      "http://localhost/api/property-hvac",
      {
        method: "POST",
        body:
          JSON.stringify(body),
      },
    ),
  );
}

describe(
  "GET /api/property-hvac",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "lists systems by authenticated owner and property",
      async () => {
        authenticate();

        mocks.listSystems
          .mockResolvedValue([]);

        const response =
          await GET(
            new Request(
              "http://localhost/api/property-hvac?propertyId=1214-wagner",
            ),
          );

        expect(
          mocks.listSystems,
        ).toHaveBeenCalledWith(
          "1214-wagner",
          "authenticated-owner",
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          systems: [],
        });
      },
    );

    it(
      "returns complete owner-scoped system history",
      async () => {
        authenticate();

        const history = {
          system: {
            id: "system_1",
          },
          components: [],
          events: [],
        };

        mocks.getSystemHistory
          .mockResolvedValue(
            history,
          );

        const response =
          await GET(
            new Request(
              "http://localhost/api/property-hvac?systemId=system_1",
            ),
          );

        expect(
          mocks.getSystemHistory,
        ).toHaveBeenCalledWith(
          "system_1",
          "authenticated-owner",
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          history,
        });
      },
    );

    it(
      "returns not found without exposing ownership",
      async () => {
        authenticate();

        mocks.getSystemHistory
          .mockResolvedValue(
            null,
          );

        const response =
          await GET(
            new Request(
              "http://localhost/api/property-hvac?systemId=other-owner-system",
            ),
          );

        expect(response.status).toBe(
          404,
        );
      },
    );

    it(
      "requires a property or system identity",
      async () => {
        authenticate();

        const response =
          await GET(
            new Request(
              "http://localhost/api/property-hvac",
            ),
          );

        expect(response.status).toBe(
          400,
        );
      },
    );
  },
);

describe(
  "POST /api/property-hvac",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it.each([
      [
        "save-system",
        "system",
        "saveSystem",
      ],
      [
        "save-component",
        "component",
        "saveComponent",
      ],
      [
        "record-component-event",
        "event",
        "recordComponentEvent",
      ],
    ])(
      "executes %s with authenticated owner authority",
      async (
        operation,
        field,
        method,
      ) => {
        authenticate();

        const input = {
          id: "record_1",
          ownerId:
            "spoofed-owner",
        };

        mocks[method]
          .mockResolvedValue(
            input,
          );

        const response =
          await post({
            operation,
            ownerId:
              "spoofed-owner",
            [field]:
              input,
          });

        expect(
          mocks[method],
        ).toHaveBeenCalledWith(
          input,
          "authenticated-owner",
        );

        expect(response.status).toBe(
          200,
        );
      },
    );

    it(
      "passes reviewed evidence to atomic event recording",
      async () => {
        authenticate();

        const event = {
          systemId:
            "system_1",
          eventType:
            "serviced",
        };

        mocks.recordComponentEvent
          .mockResolvedValue({
            id:
              "event_1",
          });

        const response =
          await post({
            operation:
              "record-component-event",
            event,
            evidenceId:
              " property_evidence_1 ",
          });

        expect(
          mocks.recordComponentEvent,
        ).toHaveBeenCalledWith(
          event,
          "authenticated-owner",
          "property_evidence_1",
        );

        expect(response.status)
          .toBe(200);
      },
    );

    it(
      "rejects unsupported or incomplete operations",
      async () => {
        authenticate();

        const unsupported =
          await post({
            operation:
              "unsupported",
          });

        expect(
          unsupported.status,
        ).toBe(400);

        const missing =
          await post({
            operation:
              "save-system",
          });

        expect(
          missing.status,
        ).toBe(400);

        expect(
          mocks.saveSystem,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "passes through authentication failure",
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

        mocks.createAuthenticatedPropertyHVACApplication
          .mockResolvedValue({
            response,
          });

        const result =
          await post({
            operation:
              "save-system",
            system: {
              propertyId:
                "1214-wagner",
            },
          });

        expect(result).toBe(
          response,
        );

        expect(
          mocks.saveSystem,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
