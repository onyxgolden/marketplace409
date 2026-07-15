import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ConnectionPersistenceService,
} from "../connection-persistence.service";

import {
  InMemoryConnectionRepository,
} from "../in-memory-connection.repository";

import {
  InMemoryCredentialReferenceRepository,
} from "../in-memory-credential-reference.repository";

import {
  InMemoryInstitutionReferenceRepository,
} from "../in-memory-institution-reference.repository";

import type {
  ConnectionProvisioningResult,
} from "../connection-provisioning.types";

const buildProvisioningResult = (
  overrides:
    Partial<ConnectionProvisioningResult> = {},
): ConnectionProvisioningResult => ({
  connection: {
    id: "connection-1",
    userId: "user-1",
    name: "Sandbox Bank Connection",
    type: "bank",
    provider: "plaid",
    status: "connected",
    credentialReferenceId:
      "credential-1",
    createdAt:
      "2026-07-02T00:00:00.000Z",
    updatedAt:
      "2026-07-02T00:00:00.000Z",
  },
  credentialReference: {
    id: "credential-1",
    provider: "plaid",
    externalCredentialId: "item-1",
    vaultReference:
      "vault://provider/items/item-1/access-token",
    status: "active",
    createdAt:
      "2026-07-02T00:00:00.000Z",
    updatedAt:
      "2026-07-02T00:00:00.000Z",
  },
  institutionReference: {
    id: "institution-1",
    connectionId: "connection-1",
    provider: "plaid",
    externalInstitutionId: "ins_1",
    name: "Sandbox Bank",
    type: "bank",
    createdAt:
      "2026-07-02T00:00:00.000Z",
    updatedAt:
      "2026-07-02T00:00:00.000Z",
  },
  provisionedAt:
    "2026-07-02T01:00:00.000Z",
  readyForPersistence: true,
  ...overrides,
});

describe(
  "ConnectionPersistenceService",
  () => {
    it("persists a provisioned connection through repository contracts", () => {
      const connectionRepository =
        new InMemoryConnectionRepository();

      const credentialReferenceRepository =
        new InMemoryCredentialReferenceRepository();

      const institutionReferenceRepository =
        new InMemoryInstitutionReferenceRepository();

      const service =
        new ConnectionPersistenceService(
          connectionRepository,
          credentialReferenceRepository,
          institutionReferenceRepository,
        );

      const provisionedConnection =
        buildProvisioningResult();

      const result = service.persist(
        provisionedConnection,
      );

      expect(
        connectionRepository.getById(
          "connection-1",
        ),
      ).toEqual(
        provisionedConnection.connection,
      );

      expect(
        credentialReferenceRepository.getById(
          "credential-1",
        ),
      ).toEqual(
        provisionedConnection
          .credentialReference,
      );

      expect(
        institutionReferenceRepository.getById(
          "institution-1",
        ),
      ).toEqual(
        provisionedConnection
          .institutionReference,
      );

      expect(result.connection).toEqual(
        provisionedConnection.connection,
      );

      expect(
        result.credentialReference,
      ).toEqual(
        provisionedConnection
          .credentialReference,
      );

      expect(
        result.institutionReference,
      ).toEqual(
        provisionedConnection
          .institutionReference,
      );

      expect(result.provisionedAt).toBe(
        provisionedConnection.provisionedAt,
      );

      expect(
        result.readyForImport,
      ).toBe(true);

      expect(result.persistedAt).toEqual(
        expect.any(String),
      );
    });

    it("does not require provider-specific repository implementations", () => {
      const connectionRepository =
        new InMemoryConnectionRepository();

      const credentialReferenceRepository =
        new InMemoryCredentialReferenceRepository();

      const institutionReferenceRepository =
        new InMemoryInstitutionReferenceRepository();

      const service =
        new ConnectionPersistenceService(
          connectionRepository,
          credentialReferenceRepository,
          institutionReferenceRepository,
        );

      const result = service.persist(
        buildProvisioningResult({
          connection: {
            id: "connection-2",
            userId: "user-1",
            name: "Manual Source",
            type: "manual",
            provider: "manual",
            status: "connected",
            credentialReferenceId:
              "credential-2",
            createdAt:
              "2026-07-02T00:00:00.000Z",
            updatedAt:
              "2026-07-02T00:00:00.000Z",
          },
          credentialReference: {
            id: "credential-2",
            provider: "manual",
            externalCredentialId:
              "manual-source-1",
            vaultReference:
              "vault://manual/sources/manual-source-1",
            status: "active",
            createdAt:
              "2026-07-02T00:00:00.000Z",
            updatedAt:
              "2026-07-02T00:00:00.000Z",
          },
          institutionReference: {
            id: "institution-2",
            connectionId:
              "connection-2",
            provider: "manual",
            externalInstitutionId:
              "manual-institution-1",
            name: "Manual Source",
            type: "manual_source",
            createdAt:
              "2026-07-02T00:00:00.000Z",
            updatedAt:
              "2026-07-02T00:00:00.000Z",
          },
        }),
      );

      expect(
        result.connection.provider,
      ).toBe("manual");

      expect(
        result.readyForImport,
      ).toBe(true);
    });
  },
);
