"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function BusinessClaimActions({ claim }) {
  const router = useRouter();

  async function approveClaim() {
    await supabase
      .from("business_claims")
      .update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: "Jason",
      })
      .eq("id", claim.id);

    await supabase
      .from("businesses")
      .update({
        claimed: true,
        claimed_at: new Date().toISOString(),
        claimed_by: claim.claimant_name,
      })
      .eq("id", claim.business_id);

    router.refresh();
  }

  async function denyClaim() {
    await supabase
      .from("business_claims")
      .update({
        status: "denied",
        reviewed_at: new Date().toISOString(),
        reviewed_by: "Jason",
      })
      .eq("id", claim.id);

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
