import { BusinessClaimRepository } from "./business-claim.repository";

export class BusinessClaimService {
  private repo: BusinessClaimRepository;

  // STRICT dependency injection (no fallback instantiation)
  constructor(repo: BusinessClaimRepository) {
    this.repo = repo;
  }

  async submitClaim(payload: any) {
    return this.repo.createClaim(payload);
  }

  async approveClaim(claim: any) {
    await this.repo.approveClaim(claim, {
      status: "claimed",
      claimed: true,
      claimed_at: new Date().toISOString(),
      claimed_by: claim.claimant_name,
    });
  }

  async rejectClaim(claimId: string) {
    return this.repo.rejectClaim(claimId);
  }

  async getAllClaims() {
    return this.repo.getAllClaims();
  }
}
