"use client";

import { ListingApplication } from "@/application";
import { supabase } from "@/lib/supabase";

const listingApplication = new ListingApplication({
  supabase,
});

export default function MarkSoldButton({ listingId, ownerId, isSold }) {
  async function handleMarkSold() {
    const result = await listingApplication.toggleListingSold({
      listingId,
      ownerId,
      isSold,
    });

    if (!result.ok) {
      if (result.message) {
        alert(result.message);
      }

      if (result.error) {
        console.log(result.error);
      }

      if (result.redirectTo) {
        window.location.href = result.redirectTo;
      }

      return;
    }

    if (result.reload) {
      window.location.reload();
    }
  }

  return (
    <button
      onClick={handleMarkSold}
      className="w-full bg-green-700 text-white py-4 rounded-2xl text-xl font-bold hover:bg-green-600 mb-4"
    >
      {isSold ? "Mark as Available" : "Mark as Sold"}
    </button>
  );
}
