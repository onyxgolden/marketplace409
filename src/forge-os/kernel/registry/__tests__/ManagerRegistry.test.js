import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ManagerRegistry,
} from "../ManagerRegistry.js";

function createManager(overrides = {}) {
  return {
    managerIdentity:
      "repository-intelligence-manager",
    capabilities: [
      "repository.inspect",
      "repository.status",
    ],
    execute: vi.fn(),
    ...overrides,
  };
}

describe("ManagerRegistry", () => {
  it("registers and resolves a manager by capability", () => {
    const registry = new ManagerRegistry();
    const manager = createManager();

    const registration =
      registry.register(manager);

    expect(
      registry.resolve("repository.inspect"),
    ).toBe(registration);

    expect(
      registry.resolve("repository.status"),
    ).toBe(registration);

    expect(
      registration.managerIdentity,
    ).toBe(
      "repository-intelligence-manager",
    );

    expect(
      typeof registration.execute,
    ).toBe("function");
  });

  it("preserves the manager execution context", () => {
    const registry = new ManagerRegistry();

    const manager = {
      managerIdentity: "context-manager",
      capabilities: ["context.inspect"],
      executionCount: 0,
      execute() {
        this.executionCount += 1;

        return this.executionCount;
      },
    };

    const registration =
      registry.register(manager);

    expect(registration.execute()).toBe(1);
    expect(manager.executionCount).toBe(1);
  });

  it("supports identity lookup and presence checks", () => {
    const registry = new ManagerRegistry();

    registry.register(createManager());

    expect(
      registry.has(
        "repository-intelligence-manager",
      ),
    ).toBe(true);

    expect(
      registry.hasCapability(
        "repository.inspect",
      ),
    ).toBe(true);

    expect(
      registry.get(
        "repository-intelligence-manager",
      )?.managerIdentity,
    ).toBe(
      "repository-intelligence-manager",
    );

    expect(
      registry.get("unknown-manager"),
    ).toBeNull();
  });

  it("returns immutable isolated registration information", () => {
    const registry = new ManagerRegistry();
    const capabilities = [
      "repository.inspect",
    ];

    const registration = registry.register(
      createManager({ capabilities }),
    );

    capabilities.push("repository.modify");

    expect(registration.capabilities).toEqual([
      "repository.inspect",
    ]);

    expect(
      Object.isFrozen(registration),
    ).toBe(true);

    expect(
      Object.isFrozen(
        registration.capabilities,
      ),
    ).toBe(true);

    const registrations = registry.list();

    expect(
      Object.isFrozen(registrations),
    ).toBe(true);
  });

  it("rejects duplicate manager identities", () => {
    const registry = new ManagerRegistry();

    registry.register(createManager());

    expect(() =>
      registry.register(createManager()),
    ).toThrow(
      "Manager already registered: repository-intelligence-manager",
    );
  });

  it("rejects duplicate capability ownership", () => {
    const registry = new ManagerRegistry();

    registry.register(createManager());

    expect(() =>
      registry.register(
        createManager({
          managerIdentity: "planning-manager",
          capabilities: [
            "repository.inspect",
          ],
        }),
      ),
    ).toThrow(
      "Capability already registered: repository.inspect",
    );
  });

  it("rejects duplicate capabilities within one manager", () => {
    const registry = new ManagerRegistry();

    expect(() =>
      registry.register(
        createManager({
          capabilities: [
            "repository.inspect",
            "repository.inspect",
          ],
        }),
      ),
    ).toThrow(
      "Manager declares duplicate capabilities: repository-intelligence-manager",
    );
  });

  it("rejects invalid manager registrations", () => {
    const registry = new ManagerRegistry();

    expect(() =>
      registry.register(null),
    ).toThrow(
      "Manager registration must be an object.",
    );

    expect(() =>
      registry.register(
        createManager({
          managerIdentity: "",
        }),
      ),
    ).toThrow(
      "Manager must have a managerIdentity.",
    );

    expect(() =>
      registry.register(
        createManager({
          capabilities: [],
        }),
      ),
    ).toThrow(
      "Manager must declare at least one capability.",
    );

    expect(() =>
      registry.register(
        createManager({
          capabilities: [""],
        }),
      ),
    ).toThrow(
      "Manager capabilities must be non-empty strings.",
    );

    expect(() =>
      registry.register(
        createManager({
          execute: undefined,
        }),
      ),
    ).toThrow(
      "Manager must provide an execute function.",
    );
  });

  it("throws a deterministic error for unknown capabilities", () => {
    const registry = new ManagerRegistry();

    expect(() =>
      registry.resolve("planning.create"),
    ).toThrow(
      "Unknown manager capability: planning.create",
    );
  });
});
