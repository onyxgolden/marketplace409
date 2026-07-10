"use client";

import { InvestorWholesalerApplication } from "@/application/investors";
import { supabase } from "@/lib/supabase";

const application = new InvestorWholesalerApplication({ supabase });

export default function DeleteWholesalerButton({ wholesalerId }) {
  async function handleDelete() {
    const confirmed = window.confirm(
      "Delete this wholesaler contact? This cannot be undone.",
    );

    if (!confirmed) return;

    const result = await application.deleteWholesaler(wholesalerId);

    if (!result.ok) {
      alert("Error deleting wholesaler contact: " + result.message);
      console.log(result.error);
      return;
    }

    alert(result.message);
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
