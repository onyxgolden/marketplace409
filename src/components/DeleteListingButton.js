"use client";

import { supabase } from "@/lib/supabase";

export default function DeleteListingButton({ listingId, ownerId }) {
  async function handleDelete() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please sign in first.");
      window.location.href = "/auth";
      return;
    }

    if (user.id !== ownerId) {
      alert("You can only delete your own listings.");
      return;
    }

    const confirmDelete = confirm("Are you sure you want to delete this listing?");

    if (!confirmDelete) {
      return;
    }

    const { error } = await supabase
      .from("listings")
      .delete()
      .eq("id", listingId)
      .eq("user_id", user.id);

    if (error) {
      alert("Error deleting listing");
      console.log(error);
    } else {
      alert("Listing deleted");
      window.location.href = "/browse";
    }
  }

  return (
    <button
      onClick={handleDelete}
      className="w-full bg-gray-300 text-gray-900 py-4 rounded-2xl text-xl font-bold hover:bg-gray-400 mt-4"
    >
      Delete Listing
    </button>
  );
}