import { describe, expect, test, vi, beforeEach } from "vitest";
import { BusinessClaimService } from "../business-claim.service";

describe("BusinessClaimService", () => {
  let service;
  let approveMock;
  let rejectMock;

  beforeEach(() => {
    approveMock = vi.fn();
    rejectMock = vi.fn();

    const fakeRepo = {
      approveClaim: approveMock,
      rejectClaim: rejectMock,
      createClaim: vi.fn(),
      getAllClaims: vi.fn(),
    };

    service = new BusinessClaimService(fakeRepo);
  });

  test("approveClaim sends correct payload", async () => {
    const claim = {
      id: "claim-1",
      business_id: "biz-1",
      claimant_name: "Jason",
    };

    await service.approveClaim(claim);

    expect(approveMock).toHaveBeenCalledWith(
      claim,
      expect.objectContaining({
        status: "claimed",
        claimed: true,
        claimed_by: "Jason",
      })
    );
  });

  test("rejectClaim forwards id", async () => {
    await service.rejectClaim("claim-1");

    expect(rejectMock).toHaveBeenCalledWith("claim-1");
  });
});
