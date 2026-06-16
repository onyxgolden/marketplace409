"use client";

import { supabase } from "@/lib/supabase";

export default function DeleteWholesalerButton({ wholesalerId }) {
  async function handleDelete() {
    const confirmed = window.confirm(
      "Delete this wholesaler contact? This cannot be undone.",
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("investor_wholesalers")
      .delete()
      .eq("id", wholesalerId);

    if (error) {
      alert("Error deleting wholesaler contact: " + error.message);
      console.log(error);
      return;
    }

    alert("Wholesaler contact deleted");
    window.location.reload();
  }

  return (
    <button
      onClick={handleDelete}
      className="block w-full mt-3 bg-red-600 text-white text-center py-3 rounded-xl font-bold hover:bg-red-500"
    >
      Delete Contact
    </button>
  );
}
