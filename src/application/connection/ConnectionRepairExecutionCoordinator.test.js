import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ConnectionRepairExecutionCoordinator,
} from "./ConnectionRepairExecutionCoordinator.js";

describe(
  "ConnectionRepairExecutionCoordinator",
  () => {
    it(
      "executes an authenticated connection repair workflow",
      async () => {
        const connection = Object.freeze({
          id: "connection-1",
          userId: "owner-1",
          name: "Primary Bank",
          type: "bank",
          status: "needs_attention",
          provider: "plaid",
          credentialReferenceId:
            "credential-1",
          createdAt:
            "2026-07-20T01:00:00.000Z",
          updatedAt:
            "2026-07-24T01:00:00.000Z",
        });

        const credentialReference =
          Object.freeze({
            id: "credential-1",
            provider: "plaid",
            connectionId:
              "connection-1",
          });

        const institutionReference =
          Object.freeze({
            id: "institution-1",
            connectionId:
              "connection-1",
            provider: "plaid",
            institutionId:
              "institution-1",
            institutionName:
              "Primary Bank",
          });

        const credentialValidationResult =
          Object.freeze({
            provider: "plaid",
            operation:
              "validate_credentials",
            success: true,
            message:
              "Credentials are valid.",
            occurredAt:
              "2026-07-24T02:00:00.000Z",
          });

        const synchronizationResult =
          Object.freeze({
            provider: "plaid",
            operation: "synchronize",
            success: true,
            message:
              "Connection synchronized.",
            occurredAt:
              "2026-07-24T02:01:00.000Z",
          });

        const provider = {
          provider: "plaid",
          validateCredentials:
            vi.fn().mockResolvedValue(
              credentialValidationResult,
            ),
          refreshStatus:
            vi.fn().mockResolvedValue(
              "connected",
            ),
          synchronize:
            vi.fn().mockResolvedValue(
              synchronizationResult,
            ),
        };

        const providerRegistry =
          Object.freeze({
            providers: Object.freeze([
              provider,
            ]),
            totalProviders: 1,
            providerNames:
              Object.freeze(["plaid"]),
          });

        const connectionRepository = {
          getById:
            vi.fn().mockResolvedValue(
              connection,
            ),
        };

        const credentialReferenceRepository =
          {
            getById:
              vi.fn().mockResolvedValue(
                credentialReference,
              ),
          };

        const institutionReferenceRepository =
          {
            getAll:
              vi.fn().mockResolvedValue([
                institutionReference,
              ]),
          };

        const coordinator =
          new ConnectionRepairExecutionCoordinator({
            connectionRepository,
            credentialReferenceRepository,
            institutionReferenceRepository,
            providerRegistry,
          });

        const result =
          await coordinator.executeRepair({
            connectionId:
              "connection-1",
            ownerId: "owner-1",
          });

        expect(result).toEqual({
          type:
            "connection-repair-execution",
          connectionId:
            "connection-1",
          ownerId: "owner-1",
          provider: "plaid",
          previousStatus:
            "needs_attention",
          status: "connected",
          credentialValid: true,
          synchronized: true,
          repaired: true,
          allowsImport: true,
          requiresUserAction: false,
          recommendedOperation:
            "import-transactions",
          occurredAt:
            "2026-07-24T02:01:00.000Z",
        });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          connectionRepository.getById,
        ).toHaveBeenCalledWith(
          "connection-1",
          Object.freeze({
            ownerId: "owner-1",
          }),
        );

        expect(
          credentialReferenceRepository
            .getById,
        ).toHaveBeenCalledWith(
          "credential-1",
          Object.freeze({
            ownerId: "owner-1",
          }),
        );

        expect(
          institutionReferenceRepository
            .getAll,
        ).toHaveBeenCalledWith(
          Object.freeze({
            ownerId: "owner-1",
          }),
        );

        expect(
          provider.validateCredentials,
        ).toHaveBeenCalledWith(
          credentialReference,
        );

        expect(
          provider.refreshStatus,
        ).toHaveBeenCalledWith(
          connection,
        );

        expect(
          provider.synchronize,
        ).toHaveBeenCalledWith(
          connection,
        );
      },
    );

    it(
      "returns user action when credentials cannot be repaired automatically",
      async () => {
        const connection =
          Object.freeze({
            id: "connection-1",
            userId: "owner-1",
            status:
              "needs_attention",
            provider: "plaid",
            credentialReferenceId:
              "credential-1",
          });

        const credentialReference =
          Object.freeze({
            id: "credential-1",
            provider: "plaid",
          });

        const provider = {
          provider: "plaid",
          validateCredentials:
            vi.fn().mockResolvedValue({
              provider: "plaid",
              operation:
                "validate_credentials",
              success: false,
              occurredAt:
                "2026-07-24T02:00:00.000Z",
            }),
          refreshStatus: vi.fn(),
          synchronize: vi.fn(),
        };

        const coordinator =
          new ConnectionRepairExecutionCoordinator({
            connectionRepository: {
              getById:
                vi.fn().mockResolvedValue(
                  connection,
                ),
            },
            credentialReferenceRepository:
              {
                getById:
                  vi.fn().mockResolvedValue(
                    credentialReference,
                  ),
              },
            institutionReferenceRepository:
              {
                getAll:
                  vi.fn().mockResolvedValue([
                    {
                      id:
                        "institution-1",
                      connectionId:
                        "connection-1",
                    },
                  ]),
              },
            providerRegistry: {
              providers: [provider],
            },
          });

        const result =
          await coordinator.executeRepair({
            connectionId:
              "connection-1",
            ownerId: "owner-1",
          });

        expect(result).toEqual({
          type:
            "connection-repair-execution",
          connectionId:
            "connection-1",
          ownerId: "owner-1",
          provider: "plaid",
          previousStatus:
            "needs_attention",
          status:
            "needs_attention",
          credentialValid: false,
          synchronized: false,
          repaired: false,
          allowsImport: false,
          requiresUserAction: true,
          recommendedOperation:
            "reauthenticate-connection",
          occurredAt:
            "2026-07-24T02:00:00.000Z",
        });

        expect(
          provider.refreshStatus,
        ).not.toHaveBeenCalled();

        expect(
          provider.synchronize,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects an unknown authenticated connection",
      async () => {
        const coordinator =
          new ConnectionRepairExecutionCoordinator({
            connectionRepository: {
              getById:
                vi.fn().mockResolvedValue(
                  null,
                ),
            },
            credentialReferenceRepository:
              {},
            institutionReferenceRepository:
              {},
            providerRegistry: {},
          });

        await expect(
          coordinator.executeRepair({
            connectionId: "missing",
            ownerId: "owner-1",
          }),
        ).rejects.toThrow(
          "Connection not found for repair execution.",
        );
      },
    );

    it(
      "rejects a missing credential reference",
      async () => {
        const coordinator =
          new ConnectionRepairExecutionCoordinator({
            connectionRepository: {
              getById:
                vi.fn().mockResolvedValue({
                  id: "connection-1",
                  provider: "plaid",
                  credentialReferenceId:
                    "credential-1",
                }),
            },
            credentialReferenceRepository:
              {
                getById:
                  vi.fn().mockResolvedValue(
                    null,
                  ),
              },
            institutionReferenceRepository:
              {},
            providerRegistry: {},
          });

        await expect(
          coordinator.executeRepair({
            connectionId:
              "connection-1",
            ownerId: "owner-1",
          }),
        ).rejects.toThrow(
          "Credential reference not found for repair execution.",
        );
      },
    );

    it(
      "rejects a missing institution reference",
      async () => {
        const coordinator =
          new ConnectionRepairExecutionCoordinator({
            connectionRepository: {
              getById:
                vi.fn().mockResolvedValue({
                  id: "connection-1",
                  provider: "plaid",
                  credentialReferenceId:
                    "credential-1",
                }),
            },
            credentialReferenceRepository:
              {
                getById:
                  vi.fn().mockResolvedValue({
                    id: "credential-1",
                  }),
              },
            institutionReferenceRepository:
              {
                getAll:
                  vi.fn().mockResolvedValue(
                    [],
                  ),
              },
            providerRegistry: {},
          });

        await expect(
          coordinator.executeRepair({
            connectionId:
              "connection-1",
            ownerId: "owner-1",
          }),
        ).rejects.toThrow(
          "Institution reference not found for repair execution.",
        );
      },
    );

    it(
      "rejects an unsupported connection provider",
      async () => {
        const coordinator =
          new ConnectionRepairExecutionCoordinator({
            connectionRepository: {
              getById:
                vi.fn().mockResolvedValue({
                  id: "connection-1",
                  provider: "missing",
                  credentialReferenceId:
                    "credential-1",
                }),
            },
            credentialReferenceRepository:
              {
                getById:
                  vi.fn().mockResolvedValue({
                    id: "credential-1",
                  }),
              },
            institutionReferenceRepository:
              {
                getAll:
                  vi.fn().mockResolvedValue([
                    {
                      id:
                        "institution-1",
                      connectionId:
                        "connection-1",
                    },
                  ]),
              },
            providerRegistry: {
              providers: [],
            },
          });

        await expect(
          coordinator.executeRepair({
            connectionId:
              "connection-1",
            ownerId: "owner-1",
          }),
        ).rejects.toThrow(
          "Connection provider not found for repair execution.",
        );
      },
    );
  },
);
