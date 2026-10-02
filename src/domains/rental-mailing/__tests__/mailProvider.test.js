import { describe, expect, it } from "vitest";
import {
  PROVIDER_NOT_CONNECTED_MESSAGE,
  getMailProviderStatus,
  sendLetterViaProvider,
} from "../mailProvider";

describe("mail provider gate", () => {
  it("reports the provider as not connected with the three pending approvals", () => {
    const status = getMailProviderStatus();
    expect(status.connected).toBe(false);
    expect(status.provider).toBeNull();
    expect(status.message).toBe(PROVIDER_NOT_CONNECTED_MESSAGE);
    expect(status.pendingApprovals).toHaveLength(3);
    expect(status.pendingApprovals.join(" ")).toMatch(/per-piece cost/i);
    expect(status.pendingApprovals.join(" ")).toMatch(/who pays/i);
  });

  it("the stub always refuses — no credentials are read, no request is made", async () => {
    await expect(sendLetterViaProvider()).rejects.toMatchObject({ code: "PROVIDER_NOT_CONNECTED" });
    await expect(sendLetterViaProvider()).rejects.toThrow(/not connected/);
  });

  it("names the spend gate in the refusal message", async () => {
    const failure = await sendLetterViaProvider().catch((error) => error);
    expect(failure.message).toMatch(/print or mail manually/i);
    expect(failure.message).toMatch(/per-piece cost/i);
  });
});
