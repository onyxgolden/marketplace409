"use client";

import { PetVotingApplication } from "@/application";
import { supabase } from "@/lib/supabase";

const application = new PetVotingApplication({
  supabase,
});

export default function VotePetButton({ petId, currentVotes = 0 }) {
  async function handleVote() {
    const result = await application.voteForPet({
      petId,
      currentVotes,
    });

    if (!result.ok) {
      alert(result.message);
      return;
    }

    if (result.reload) {
      window.location.reload();
    }
  }

  return (
    <button
      onClick={handleVote}
      className="w-full mt-3 bg-pink-600 text-white py-3 rounded-xl font-bold hover:bg-pink-500"
    >
      ❤️ Vote for this Pet
    </button>
  );
}
