import { webcrypto } from "node:crypto";
import { pseudonymizeAnalyticsId } from "./identity";

describe("analytics pseudonyms", () => {
  it("creates deterministic scoped identifiers without exposing the source identifier", async () => {
    const source = "internal-user-id-123";
    const first = await pseudonymizeAnalyticsId("user", source, webcrypto);
    const second = await pseudonymizeAnalyticsId("user", source, webcrypto);
    const workspace = await pseudonymizeAnalyticsId("workspace", source, webcrypto);
    expect(first).toBe(second);
    expect(first).toMatch(/^user_[a-f0-9]{32}$/);
    expect(first).not.toContain(source);
    expect(workspace).not.toBe(first);
  });

  it("rejects missing identifiers and unsupported scopes", async () => {
    expect(await pseudonymizeAnalyticsId("user", "", webcrypto)).toBeNull();
    expect(await pseudonymizeAnalyticsId("tenant", "id", webcrypto)).toBeNull();
  });
});
