function validateManager(manager) {
  if (
    !manager ||
    typeof manager !== "object"
  ) {
    throw new Error(
      "Manager registration must be an object.",
    );
  }

  if (
    typeof manager.managerIdentity !== "string" ||
    manager.managerIdentity.length === 0
  ) {
    throw new Error(
      "Manager must have a managerIdentity.",
    );
  }

  if (
    !Array.isArray(manager.capabilities) ||
    manager.capabilities.length === 0
  ) {
    throw new Error(
      "Manager must declare at least one capability.",
    );
  }

  for (const capability of manager.capabilities) {
    if (
      typeof capability !== "string" ||
      capability.length === 0
    ) {
      throw new Error(
        "Manager capabilities must be non-empty strings.",
      );
    }
  }

  if (typeof manager.execute !== "function") {
    throw new Error(
      "Manager must provide an execute function.",
    );
  }
}

export class ManagerRegistry {
  constructor() {
    this.managers = new Map();
    this.capabilityOwners = new Map();
  }

  register(manager) {
    validateManager(manager);

    const {
      managerIdentity,
      capabilities,
    } = manager;

    if (this.managers.has(managerIdentity)) {
      throw new Error(
        `Manager already registered: ${managerIdentity}`,
      );
    }

    const uniqueCapabilities =
      new Set(capabilities);

    if (
      uniqueCapabilities.size !==
      capabilities.length
    ) {
      throw new Error(
        `Manager declares duplicate capabilities: ${managerIdentity}`,
      );
    }

    for (const capability of capabilities) {
      if (
        this.capabilityOwners.has(capability)
      ) {
        throw new Error(
          `Capability already registered: ${capability}`,
        );
      }
    }

    const registration = Object.freeze({
      managerIdentity,
      capabilities: Object.freeze([
        ...capabilities,
      ]),
      execute: (...args) =>
        manager.execute(...args),
    });

    this.managers.set(
      managerIdentity,
      registration,
    );

    for (
      const capability
      of registration.capabilities
    ) {
      this.capabilityOwners.set(
        capability,
        registration,
      );
    }

    return registration;
  }

  resolve(capability) {
    if (
      !this.capabilityOwners.has(capability)
    ) {
      throw new Error(
        `Unknown manager capability: ${capability}`,
      );
    }

    return this.capabilityOwners.get(capability);
  }

  get(managerIdentity) {
    return (
      this.managers.get(managerIdentity) ||
      null
    );
  }

  has(managerIdentity) {
    return this.managers.has(managerIdentity);
  }

  hasCapability(capability) {
    return this.capabilityOwners.has(capability);
  }

  list() {
    return Object.freeze(
      Array.from(this.managers.values()),
    );
  }
}
