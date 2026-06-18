export class ForgeConfig {
  constructor(initialValues = {}) {
    this.values = new Map(Object.entries(initialValues));
  }

  set(key, value) {
    if (!key) {
      throw new Error("Config key is required.");
    }

    this.values.set(key, value);
  }

  get(key, fallback = null) {
    if (!this.values.has(key)) {
      return fallback;
    }

    return this.values.get(key);
  }

  has(key) {
    return this.values.has(key);
  }

  all() {
    return Object.fromEntries(this.values);
  }
}

export const forgeConfig = new ForgeConfig();
