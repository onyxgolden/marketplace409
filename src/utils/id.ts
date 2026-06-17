export function createId(prefix: string): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${random}`;
}