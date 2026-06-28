"use client";

import { useRouter } from "next/navigation";
import { BusinessClaimService } from "@/domains/business-claims/business-claim.service";

export default function BusinessClaimActions({ claim }) {
  const router = useRouter();
  const service = new BusinessClaimService();

  async function approveClaim() {
    await service.approveClaim(claim);
    router.refresh();
  }

  async function denyClaim() {
    await service.rejectClaim(claim.id);
    router.refresh();
  }

  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <button
        onClick={approveClaim}
        className="bg-green-700 text-white px-4 py-2 rounded-xl font-bold hover:bg-green-600"
      >
        Approve Claim
      </button>

      <button
        onClick={denyClaim}
        className="bg-red-700 text-white px-4 py-2 rounded-xl font-bold hover:bg-red-600"
      >
        Deny Claim
      </button>
    </div>
  );
}
