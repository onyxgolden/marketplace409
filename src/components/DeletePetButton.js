"use client";

import { PetApplication } from "@/application";
import { supabase } from "@/lib/supabase";

const petApplication = new PetApplication({
  supabase,
});

export default function DeletePetButton({ petId }) {
  async function handleDelete() {
    const confirmed = window.confirm("Delete this pet post?");

    if (!confirmed) return;

    const result = await petApplication.deletePet(petId);

    if (!result.ok) {
      alert(result.message);

      if (result.error) {
        console.log(result.error);
      }

      return;
    }

    alert(result.message);
    window.location.reload();
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
