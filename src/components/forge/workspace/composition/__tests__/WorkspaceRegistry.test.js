import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  WorkspaceModule,
} from "../WorkspaceModule.js";

import {
  WorkspaceRegistry,
} from "../WorkspaceRegistry.js";

function createWorkspaceModule(
  moduleIdentity,
  priority = 100,
) {
  return new WorkspaceModule({
    moduleIdentity,
    displayName: moduleIdentity,
    category: "test",
    priority,
    renderTile: vi.fn(),
  });
}

describe("WorkspaceRegistry", () => {
  it("registers and retrieves workspace modules", () => {
    const registry = new WorkspaceRegistry();

    const workspaceModule =
      registry.register(
        createWorkspaceModule(
          "financial-position",
          10,
        ),
      );

    expect(
      registry.get("financial-position"),
    ).toBe(workspaceModule);

    expect(
      registry.has("financial-position"),
    ).toBe(true);

    expect(
      registry.get("missing-module"),
    ).toBeNull();

    expect(
      registry.has("missing-module"),
    ).toBe(false);
  });

  it("lists modules by priority and then identity", () => {
    const registry = new WorkspaceRegistry();

    registry.register(
      createWorkspaceModule(
        "transaction-review",
        20,
      ),
    );

    registry.register(
      createWorkspaceModule(
        "forge-operating-system",
        30,
      ),
    );

    registry.register(
      createWorkspaceModule(
        "property-portfolio",
        20,
      ),
    );

    registry.register(
      createWorkspaceModule(
        "financial-position",
        10,
      ),
    );

    expect(
      registry.list().map(
        ({ moduleIdentity }) =>
          moduleIdentity,
      ),
    ).toEqual([
      "financial-position",
      "property-portfolio",
      "transaction-review",
      "forge-operating-system",
    ]);
  });

  it("returns an immutable module listing", () => {
    const registry = new WorkspaceRegistry();

    registry.register(
      createWorkspaceModule(
        "financial-position",
      ),
    );

    expect(
      Object.isFrozen(registry.list()),
    ).toBe(true);
  });

  it("rejects duplicate module identities", () => {
    const registry = new WorkspaceRegistry();

    registry.register(
      createWorkspaceModule(
        "financial-position",
      ),
    );

    expect(() =>
      registry.register(
        createWorkspaceModule(
          "financial-position",
        ),
      ),
    ).toThrow(
      "Workspace module already registered: financial-position",
    );
  });

  it("rejects non-workspace module registrations", () => {
    const registry = new WorkspaceRegistry();

    expect(() =>
      registry.register({
        moduleIdentity:
          "financial-position",
      }),
    ).toThrow(
      "WorkspaceRegistry requires a WorkspaceModule.",
    );
  });
});
