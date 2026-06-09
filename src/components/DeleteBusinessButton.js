"use client";

import { supabase } from "@/lib/supabase";

export default function DeleteBusinessButton({ businessId }) {
  async function handleDelete() {
    const confirmed = confirm("Are you sure you want to delete this business?");

    if (!confirmed) return;

    const { error } = await supabase
      .from("businesses")
      .delete()
      .eq("id", businessId);

    if (error) {
      alert("Error deleting business");
      console.log(error);
    } else {
      alert("Business deleted");
      window.location.reload();
    }
  }

  return (
    <button
      onClick={handleDelete}
      className="w-full mt-3 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-500"
    >
      Delete Business
    </button>
  );
}
