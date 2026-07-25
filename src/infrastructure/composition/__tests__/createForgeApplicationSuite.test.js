import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createConnectionPlatformSuite:
    vi.fn(),
  createFinancialApplicationSuite:
    vi.fn(),
}));

vi.mock(
  "@/infrastructure/composition",
  () => ({
    createConnectionPlatformSuite:
      mocks.createConnectionPlatformSuite,
    createFinancialApplicationSuite:
      mocks.createFinancialApplicationSuite,
  }),
);

import {
  createForgeApplicationSuite,
} from "../createForgeApplicationSuite.js";

describe("createForgeApplicationSuite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("composes connection and financial application suites", async () => {
    const connectionPlatformSuite = {
      connectionOperationsApplication: {},
    };

    const financialApplicationSuite = {
      readModelApplication: {},
    };

    mocks.createConnectionPlatformSuite.mockResolvedValue(
      connectionPlatformSuite,
    );

    mocks.createFinancialApplicationSuite.mockResolvedValue(
      financialApplicationSuite,
    );

    const supabaseClient = {};
    const currentOwnerId = async () => "owner-1";

    const suite =
      await createForgeApplicationSuite({
        supabaseClient,
        ownerId: "owner-1",
        currentOwnerId,
      });

    expect(suite).toEqual({
      connectionPlatformSuite,
      financialApplicationSuite,
      connectionOperationsApplication:
        connectionPlatformSuite.connectionOperationsApplication,
      connectionReadModelApplication:
        connectionPlatformSuite.connectionReadModelApplication,
      financialReadModelApplication:
        financialApplicationSuite.readModelApplication,
    });

    expect(
      mocks.createConnectionPlatformSuite,
    ).toHaveBeenCalledWith({
      supabaseClient,
      ownerId: "owner-1",
      currentOwnerId,
    });

    expect(
      mocks.createFinancialApplicationSuite,
    ).toHaveBeenCalledWith({
      supabaseClient,
      ownerId: "owner-1",
      currentOwnerId,
    });

    expect(Object.isFrozen(suite)).toBe(true);
  });

  it("uses injected suites without composing defaults", async () => {
    const connectionPlatformSuite = {};
    const financialApplicationSuite = {};

    const suite =
      await createForgeApplicationSuite({
        connectionPlatformSuite,
        financialApplicationSuite,
      });

    expect(suite.connectionPlatformSuite)
      .toBe(connectionPlatformSuite);

    expect(suite.financialApplicationSuite)
      .toBe(financialApplicationSuite);

    expect(
      mocks.createConnectionPlatformSuite,
    ).not.toHaveBeenCalled();

    expect(
      mocks.createFinancialApplicationSuite,
    ).not.toHaveBeenCalled();
  });
});
