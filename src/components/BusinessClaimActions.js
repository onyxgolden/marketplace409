"use client";

import { useRouter } from "next/navigation";

import {
  createBusinessApplicationSuite,
} from "@/infrastructure/composition";

const {
  businessClaimApplication,
} = createBusinessApplicationSuite();

export default function BusinessClaimActions({ claim }) {
  const router = useRouter();

  async function approveClaim() {
    const result = await businessClaimApplication.approveClaim(claim);

    if (result.ok && result.refresh) {
      router.refresh();
    }
  }

  async function denyClaim() {
    const result = await businessClaimApplication.rejectClaim(claim.id);

    if (result.ok && result.refresh) {
      router.refresh();
    }
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
