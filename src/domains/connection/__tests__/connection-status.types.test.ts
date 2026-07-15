import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CONNECTION_STATUS_DETAILS,
  getConnectionStatusDetails,
} from "../connection-status.types";
import { CONNECTION_STATUSES } from "../connection.types";

describe("ConnectionStatusDetails", () => {
  it("defines details for every supported connection status", () => {
    expect(Object.keys(CONNECTION_STATUS_DETAILS).sort()).toEqual(
      [...CONNECTION_STATUSES].sort(),
    );
  });

  it("marks connected connections as import-ready and healthy", () => {
    expect(getConnectionStatusDetails("connected")).toEqual({
      status: "connected",
      label: "Connected",
      severity: "healthy",
      requiresUserAction: false,
      allowsImport: true,
    });
  });

  it("marks syncing connections as import-capable work in progress", () => {
    expect(getConnectionStatusDetails("syncing")).toEqual({
      status: "syncing",
      label: "Syncing",
      severity: "in_progress",
      requiresUserAction: false,
      allowsImport: true,
    });
  });

  it("marks broken or incomplete connections as requiring user action", () => {
    expect(getConnectionStatusDetails("not_connected").requiresUserAction).toBe(
      true,
    );
    expect(getConnectionStatusDetails("needs_attention").requiresUserAction).toBe(
      true,
    );
    expect(getConnectionStatusDetails("disconnected").requiresUserAction).toBe(
      true,
    );
    expect(getConnectionStatusDetails("error").requiresUserAction).toBe(true);
  });

  it("blocks imports when a connection cannot be trusted", () => {
    expect(getConnectionStatusDetails("not_connected").allowsImport).toBe(false);
    expect(getConnectionStatusDetails("pending").allowsImport).toBe(false);
    expect(getConnectionStatusDetails("needs_attention").allowsImport).toBe(
      false,
    );
    expect(getConnectionStatusDetails("disconnected").allowsImport).toBe(false);
    expect(getConnectionStatusDetails("error").allowsImport).toBe(false);
  });
});
