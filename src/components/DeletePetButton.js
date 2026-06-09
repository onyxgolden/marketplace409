"use client";

import { supabase } from "@/lib/supabase";

export default function DeletePetButton({ petId }) {
  async function handleDelete() {
    const confirmed = confirm("Delete this pet post?");

    if (!confirmed) return;

    const { error } = await supabase.from("pets").delete().eq("id", petId);

    if (error) {
      alert("Error deleting pet post");
      console.log(error);
    } else {
      alert("Pet post deleted");
      window.location.reload();
    }
  }

  return (
    <button
      onClick={handleDelete}
      className="w-full mt-3 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-500"
    >
      Delete Pet Post
    </button>
  );
}
