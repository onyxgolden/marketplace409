export class PropertyId {
  private constructor(private readonly value: string) {}

  static fromSourceName(sourceName: string): PropertyId {
    return new PropertyId(this.canonicalize(sourceName));
  }

  toString(): string {
    return this.value;
  }

  private static canonicalize(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
}
