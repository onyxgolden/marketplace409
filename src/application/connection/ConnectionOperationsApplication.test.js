import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ConnectionOperationsApplication,
} from "./ConnectionOperationsApplication.js";

describe(
  "ConnectionOperationsApplication",
  () => {
    it(
      "builds connection operations from the connection dashboard",
      async () => {
        const dashboard = {
          type: "connection-dashboard",
          dashboard: {
            summary: {
              totalConnections: 2,
            },
          },
        };

        const connectionReadModelApplication = {
          buildConnectionDashboard:
            vi.fn().mockResolvedValue(
              dashboard,
            ),
        };

        const application =
          new ConnectionOperationsApplication({
            connectionReadModelApplication,
          });

        const result =
          await application
            .buildConnectionOperations();

        expect(result).toEqual({
          type: "connection-operations",
          status: "ready",
          dashboard,
        });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          connectionReadModelApplication
            .buildConnectionDashboard,
        ).toHaveBeenCalledOnce();
      },
    );

    it(
      "requires a connection read model application",
      () => {
        expect(
          () =>
            new ConnectionOperationsApplication(
              {},
            ),
        ).toThrow(
          "ConnectionOperationsApplication requires a connection read model application.",
        );
      },
    );
  },
);
