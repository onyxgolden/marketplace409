export class ForgeEntity {
  constructor({
    id,
    objectType,
    ownerId = null,
    status = "active",
    tags = [],
    metadata = {},
    createdAt = new Date().toISOString(),
    updatedAt = new Date().toISOString(),
  }) {
    this.id = id;
    this.objectType = objectType;
    this.ownerId = ownerId;
    this.status = status;
    this.tags = tags;
    this.metadata = metadata;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  isActive() {
    return this.status === "active";
  }

  archive() {
    this.status = "archived";
    this.touch();
  }

  restore() {
    this.status = "active";
    this.touch();
  }

  addTag(tag) {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
      this.touch();
    }
  }

  removeTag(tag) {
    this.tags = this.tags.filter((existingTag) => existingTag !== tag);
    this.touch();
  }

  updateMetadata(key, value) {
    this.metadata[key] = value;
    this.touch();
  }

  touch() {
    this.updatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      objectType: this.objectType,
      ownerId: this.ownerId,
      status: this.status,
      tags: this.tags,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
