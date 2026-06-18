export class EngineRegistry {
  constructor() {
    this.engines = new Map();
  }

  register(engine) {
    if (!engine?.name) {
      throw new Error("Engine must have a name.");
    }

    if (this.engines.has(engine.name)) {
      throw new Error(`Engine already registered: ${engine.name}`);
    }

    this.engines.set(engine.name, engine);
  }

  get(name) {
    return this.engines.get(name) || null;
  }

  list() {
    return Array.from(this.engines.values());
  }

  has(name) {
    return this.engines.has(name);
  }

  healthCheck() {
    return this.list().map((engine) => engine.healthCheck());
  }
}

export const engineRegistry = new EngineRegistry();
