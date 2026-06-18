export class ForgeEngine {
  constructor({
    name,
    version = "1.0.0",
    config = null,
    services = null,
    dependencies = [],
  }) {
    if (!name) {
      throw new Error("Engine name is required.");
    }

    this.name = name;
    this.version = version;
    this.config = config;
    this.services = services;
    this.dependencies = dependencies;
    this.initialized = false;
    this.running = false;
  }

  initialize() {
    this.initialized = true;
    return this;
  }

  start() {
    if (!this.initialized) {
      this.initialize();
    }

    this.running = true;
    return this;
  }

  stop() {
    this.running = false;
    return this;
  }

  healthCheck() {
    return {
      name: this.name,
      version: this.version,
      initialized: this.initialized,
      running: this.running,
      dependencies: this.dependencies,
    };
  }
}
