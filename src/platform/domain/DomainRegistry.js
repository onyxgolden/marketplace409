export class DomainRegistry {
  constructor() {
    this.domains = new Map();
  }

  register(domain) {
    if (!domain?.key) {
      throw new Error("Domain must have a key.");
    }

    if (this.domains.has(domain.key)) {
      throw new Error(`Domain already registered: ${domain.key}`);
    }

    this.domains.set(domain.key, domain);
  }

  get(key) {
    return this.domains.get(key) || null;
  }

  list() {
    return Array.from(this.domains.values());
  }

  has(key) {
    return this.domains.has(key);
  }
}

export const domainRegistry = new DomainRegistry();