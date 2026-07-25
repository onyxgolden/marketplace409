function freeze(value) {
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item) => freeze(item)),
    );
  }

  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(
          ([key, entryValue]) => [
            key,
            freeze(entryValue),
          ],
        ),
      ),
    );
  }

  return value;
}

export class CanonicalIntelligenceContext {
  constructor({
    financial = {},
    connections = {},
    provenance = {},
  } = {}) {
    this.type = "canonical-intelligence-context";

    this.financial = freeze(financial);

    this.connections = freeze(connections);

    this.provenance = freeze({
      repositoryBacked:
        provenance.repositoryBacked === true,

      aiGenerated:
        provenance.aiGenerated === true,

      sources:
        Array.isArray(provenance.sources)
          ? provenance.sources
          : [],
    });

    Object.freeze(this);
  }

  toJSON() {
    return {
      type: this.type,
      financial: this.financial,
      connections: this.connections,
      provenance: this.provenance,
    };
  }
}

Object.freeze(CanonicalIntelligenceContext);
