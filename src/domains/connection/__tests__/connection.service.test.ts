import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ConnectionService,
  createConnectionCollection,
  getConnectionStatusDetails,
  type Connection,
  type ConnectionCapabilities,
  type ConnectionHealth,
  type ConnectionHealthState,
  type ConnectionStatusSeverity,
  type ConnectionSummary,
  type InstitutionReference,
} from "../index";

const CREATED_AT =
  "2026-06-30T10:00:00.000Z";

const UPDATED_AT =
  "2026-06-30T12:00:00.000Z";

function severityForHealth(
  state: ConnectionHealthState,
): ConnectionStatusSeverity {
  switch (state) {
    case "healthy":
      return "healthy";

    case "syncing":
      return "in_progress";

    case "stale":
    case "needs_attention":
      return "warning";

    case "critical":
      return "critical";

    case "not_ready":
      return "neutral";
  }
}

function statusForHealth(
  state: ConnectionHealthState,
): Connection["status"] {
  switch (state) {
    case "healthy":
      return "connected";

    case "syncing":
      return "syncing";

    case "stale":
    case "needs_attention":
      return "needs_attention";

    case "critical":
      return "error";

    case "not_ready":
      return "pending";
  }
}

function buildConnection(
  overrides: Partial<Connection> = {},
): Connection {
  return {
    id: "connection-1",
    userId: "user-1",
    name: "Operating Bank",
    type: "bank",
    status: "connected",
    provider: "plaid",
    credentialReferenceId:
      "credential-1",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function buildCapabilities(
  connectionId: string,
  overrides:
    Partial<ConnectionCapabilities> = {},
): ConnectionCapabilities {
  return {
    connectionId,
    capabilities: [
      "import_transactions",
    ],
    supportsAutomaticSync: true,
    supportsManualSync: true,
    supportsWebhooks: false,
    supportsRealtimeUpdates: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function buildHealth(
  connectionId: string,
  state: ConnectionHealthState =
    "healthy",
  overrides:
    Partial<ConnectionHealth> = {},
): ConnectionHealth {
  return {
    connectionId,
    state,
    severity:
      severityForHealth(state),
    label: state,
    allowsImport:
      state === "healthy",
    requiresUserAction:
      state === "critical" ||
      state === "needs_attention",
    issueCount:
      state === "critical" ? 1 : 0,
    warningCount:
      state === "stale" ||
      state === "needs_attention"
        ? 1
        : 0,
    checkedAt: UPDATED_AT,
    ...overrides,
  };
}

function buildInstitution(
  connectionId: string,
  overrides:
    Partial<InstitutionReference> = {},
): InstitutionReference {
  return {
    id: `institution-${connectionId}`,
    connectionId,
    name: "Forge Bank",
    type: "bank",
    provider: "plaid",
    externalInstitutionId: "ins_1",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function makeConnectionSummary(
  overrides:
    Partial<ConnectionSummary> = {},
): ConnectionSummary {
  const connection =
    overrides.connection ??
    buildConnection();

  const connectionId =
    connection.id;

  const updatedAt =
    overrides.updatedAt ??
    connection.updatedAt;

  return {
    connection,
    statusDetails:
      overrides.statusDetails ??
      getConnectionStatusDetails(
        connection.status,
      ),
    capabilities:
      overrides.capabilities ??
      buildCapabilities(
        connectionId,
        {
          updatedAt,
        },
      ),
    institution:
      overrides.institution ??
      buildInstitution(
        connectionId,
        {
          provider:
            connection.provider,
          updatedAt,
        },
      ),
    health:
      overrides.health ??
      buildHealth(
        connectionId,
        "healthy",
        {
          checkedAt: updatedAt,
        },
      ),
    createdAt:
      overrides.createdAt ??
      CREATED_AT,
    updatedAt,
  };
}

describe("ConnectionService", () => {
  it("returns summary, all connections, and latest update from the collection", () => {
    const older =
      makeConnectionSummary({
        connection:
          buildConnection({
            id:
              "connection-older",
            name: "Older Bank",
            updatedAt:
              "2026-06-30T11:00:00.000Z",
          }),
        updatedAt:
          "2026-06-30T11:00:00.000Z",
      });

    const newer =
      makeConnectionSummary({
        connection:
          buildConnection({
            id:
              "connection-newer",
            provider: "stripe",
            type: "stripe",
            name:
              "Newer Processor",
            updatedAt:
              "2026-06-30T13:00:00.000Z",
          }),
        updatedAt:
          "2026-06-30T13:00:00.000Z",
      });

    const collection =
      createConnectionCollection([
        older,
        newer,
      ]);

    const service =
      new ConnectionService(
        collection,
      );

    expect(
      service.summary(),
    ).toBe(collection);

    expect(service.all()).toEqual([
      older,
      newer,
    ]);

    expect(
      service.latestUpdate(),
    ).toBe(
      "2026-06-30T13:00:00.000Z",
    );
  });

  it.each([
    ["not_ready", []],
    [
      "critical",
      [
        "critical",
        "needs_attention",
        "stale",
        "syncing",
        "healthy",
      ],
    ],
    [
      "needs_attention",
      [
        "needs_attention",
        "stale",
        "syncing",
        "healthy",
      ],
    ],
    [
      "stale",
      [
        "stale",
        "syncing",
        "healthy",
      ],
    ],
    [
      "syncing",
      [
        "syncing",
        "healthy",
      ],
    ],
    [
      "healthy",
      [
        "healthy",
        "healthy",
      ],
    ],
  ] as const)(
    "reports overall health as %s",
    (
      expectedHealth,
      states,
    ) => {
      const collection =
        createConnectionCollection(
          states.map(
            (
              state,
              index,
            ) => {
              const id =
                `connection-${index}`;

              return makeConnectionSummary({
                connection:
                  buildConnection({
                    id,
                    name:
                      `Connection ${index}`,
                    status:
                      statusForHealth(
                        state,
                      ),
                  }),
                health:
                  buildHealth(
                    id,
                    state,
                  ),
              });
            },
          ),
        );

      const service =
        new ConnectionService(
          collection,
        );

      expect(
        service.overallHealth(),
      ).toBe(expectedHealth);
    },
  );

  it("filters connections by health state", () => {
    const healthy =
      makeConnectionSummary({
        connection:
          buildConnection({
            id: "healthy",
            name: "Healthy Bank",
          }),
        health:
          buildHealth(
            "healthy",
            "healthy",
          ),
      });

    const syncing =
      makeConnectionSummary({
        connection:
          buildConnection({
            id: "syncing",
            provider: "stripe",
            type: "stripe",
            status: "syncing",
            name:
              "Syncing Processor",
          }),
        health:
          buildHealth(
            "syncing",
            "syncing",
            {
              allowsImport: false,
            },
          ),
      });

    const stale =
      makeConnectionSummary({
        connection:
          buildConnection({
            id: "stale",
            provider:
              "quickbooks",
            type: "quickbooks",
            status:
              "needs_attention",
            name:
              "Stale Accounting",
          }),
        health:
          buildHealth(
            "stale",
            "stale",
          ),
      });

    const needsAttention =
      makeConnectionSummary({
        connection:
          buildConnection({
            id:
              "needs-attention",
            status:
              "needs_attention",
            name:
              "Needs Attention Bank",
          }),
        health:
          buildHealth(
            "needs-attention",
            "needs_attention",
          ),
      });

    const critical =
      makeConnectionSummary({
        connection:
          buildConnection({
            id: "critical",
            status: "error",
            name: "Critical Bank",
          }),
        health:
          buildHealth(
            "critical",
            "critical",
            {
              issueCount: 2,
            },
          ),
      });

    const notReady =
      makeConnectionSummary({
        connection:
          buildConnection({
            id: "not-ready",
            provider: "manual",
            type: "manual",
            status: "pending",
            name:
              "Not Ready Manual Source",
          }),
        health:
          buildHealth(
            "not-ready",
            "not_ready",
          ),
      });

    const service =
      new ConnectionService(
        createConnectionCollection([
          healthy,
          syncing,
          stale,
          needsAttention,
          critical,
          notReady,
        ]),
      );

    expect(
      service.healthyConnections(),
    ).toEqual([healthy]);

    expect(
      service.syncingConnections(),
    ).toEqual([syncing]);

    expect(
      service.staleConnections(),
    ).toEqual([stale]);

    expect(
      service.needsAttention(),
    ).toEqual([
      needsAttention,
    ]);

    expect(
      service.criticalConnections(),
    ).toEqual([critical]);

    expect(
      service.notReadyConnections(),
    ).toEqual([notReady]);
  });

  it("only marks import ready when at least one connection allows import and supports transaction import", () => {
    const eligible =
      makeConnectionSummary({
        connection:
          buildConnection({
            id: "eligible",
            name: "Eligible Bank",
          }),
      });

    const blockedByHealth =
      makeConnectionSummary({
        connection:
          buildConnection({
            id:
              "blocked-health",
            status: "error",
            name: "Blocked Bank",
          }),
        health:
          buildHealth(
            "blocked-health",
            "critical",
          ),
      });

    const blockedByCapability =
      makeConnectionSummary({
        connection:
          buildConnection({
            id:
              "blocked-capability",
            provider: "stripe",
            type: "stripe",
            name:
              "Blocked Processor",
          }),
        capabilities:
          buildCapabilities(
            "blocked-capability",
            {
              capabilities: [
                "import_balances",
              ],
            },
          ),
      });

    const service =
      new ConnectionService(
        createConnectionCollection([
          blockedByHealth,
          blockedByCapability,
          eligible,
        ]),
      );

    expect(
      service.readyForImport(),
    ).toBe(true);

    expect(
      service
        .importEligibleConnections(),
    ).toEqual([eligible]);
  });

  it("does not mark import ready when no connection is import eligible", () => {
    const blockedByHealth =
      makeConnectionSummary({
        connection:
          buildConnection({
            id:
              "blocked-health",
            status: "error",
            name: "Blocked Bank",
          }),
        health:
          buildHealth(
            "blocked-health",
            "critical",
          ),
      });

    const blockedByCapability =
      makeConnectionSummary({
        connection:
          buildConnection({
            id:
              "blocked-capability",
            provider: "stripe",
            type: "stripe",
            name:
              "Blocked Processor",
          }),
        capabilities:
          buildCapabilities(
            "blocked-capability",
            {
              capabilities: [
                "import_balances",
              ],
            },
          ),
      });

    const service =
      new ConnectionService(
        createConnectionCollection([
          blockedByHealth,
          blockedByCapability,
        ]),
      );

    expect(
      service.readyForImport(),
    ).toBe(false);

    expect(
      service
        .importEligibleConnections(),
    ).toEqual([]);
  });
});
