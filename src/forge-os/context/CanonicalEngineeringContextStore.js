export class CanonicalEngineeringContextStore {
  constructor(initialContext) {
    if (!initialContext) {
      throw new Error(
        "CanonicalEngineeringContextStore requires an initial context.",
      );
    }

    this.currentContext = initialContext;

  }

  getCurrent() {
    return this.currentContext;
  }

  snapshot() {
    return this.currentContext;
  }

  replaceContext(nextContext) {
    if (!nextContext) {
      throw new Error(
        "Cannot replace context with an empty value.",
      );
    }

    this.currentContext = nextContext;

    return this.currentContext;
  }
}
