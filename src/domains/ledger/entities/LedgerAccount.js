export class LedgerAccount {
  constructor({
    id,
    name,
    type,
    subtype = null,
    currency = "USD",
    parentAccountId = null,
    metadata = {},
    createdAt = new Date(),
    updatedAt = new Date(),
  }) {
    if (!id) throw new Error("LedgerAccount requires an id");
    if (!name) throw new Error("LedgerAccount requires a name");
    if (!type) throw new Error("LedgerAccount requires a type");

    this.id = id;
    this.name = name;
    this.type = type;
    this.subtype = subtype;
    this.currency = currency;
    this.parentAccountId = parentAccountId;
    this.metadata = metadata;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  rename(newName) {
    if (!newName) throw new Error("LedgerAccount name cannot be empty");

    this.name = newName;
    this.updatedAt = new Date();

    return this;
  }

  moveToParent(parentAccountId) {
    this.parentAccountId = parentAccountId;
    this.updatedAt = new Date();

    return this;
  }

  updateMetadata(metadata = {}) {
    this.metadata = {
      ...this.metadata,
      ...metadata,
    };

    this.updatedAt = new Date();

    return this;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      subtype: this.subtype,
      currency: this.currency,
      parentAccountId: this.parentAccountId,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
