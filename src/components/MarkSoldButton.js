"use client";

import { supabase } from "@/lib/supabase";

export default function MarkSoldButton({ listingId, ownerId, isSold }) {
  async function handleMarkSold() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please sign in first.");
      window.location.href = "/auth";
      return;
    }

    if (user.id !== ownerId) {
      alert("You can only update your own listings.");
      return;
    }

    const { error } = await supabase
      .from("listings")
      .update({ is_sold: !isSold })
      .eq("id", listingId)
      .eq("user_id", user.id);

    if (error) {
      alert("Error updating listing.");
      console.log(error);
    } else {
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
